/**
 * Transfer queue: ordering, concurrency, pause/resume/cancel/retry.
 *
 * The queue knows nothing about sockets or files. A job is a function that
 * receives control hooks (pause, resume, cancel) and reports progress; the
 * queue guarantees:
 *  - at most `concurrency` jobs run at once (user-configurable, and never more
 *    than the platform can reasonably sustain);
 *  - the queue order is the user's order (`move`), stable for equal priorities;
 *  - a paused job does not occupy a slot: while nothing is being sent for it,
 *    a waiting transfer starts, so pausing a big transfer really does let a small
 *    one through (the paused job keeps its open handles and its exact position);
 *  - `retry` only re-enqueues jobs whose outcome says retrying is meaningful
 *    (failed, interrupted, or a partial delivery), never a completed one.
 */
import {
  DropForgeError,
  Emitter,
  ERROR_CODES,
  backoffDelay,
  isTerminal,
  nextState,
  type TransferState,
} from '@dropforge/app-core';
import type { Clock, Logger } from '@dropforge/protocol';
import type { TransferProgress } from './sender.js';

export interface TaskHooks {
  onProgress: (progress: TransferProgress) => void;
  /** The runner must check this between chunks and stop cleanly when true. */
  isCancelled: () => boolean;
  /** The runner must check this and suspend its work when true. */
  isPaused: () => boolean;
  /** Registers the pause/resume/cancel implementations of the running job. */
  provideControl: (control: TaskControl) => void;
}

export interface TaskControl {
  pause(): void;
  resume(): void;
  cancel(): void;
  interrupt(): void;
}

export interface TaskResult {
  outcome: 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted' | 'declined';
  errorCode?: string;
  bytesDone?: number;
  /** Files actually verified on the receiving side. */
  verifiedFiles?: number;
  detail?: string;
  /**
   * Whether the same job may succeed if it is run again. Defaults to `false`: a job
   * that does not say it can succeed again is not retried behind the user's back. A
   * refusal, a cancellation or a failed integrity check are decisions or facts, and
   * replaying them would offer the same transfer again to someone who already said no.
   */
  retryable?: boolean;
}

export interface QueueJob {
  id: string;
  direction: 'send' | 'receive';
  /** Display label (peer name + a short summary), never sensitive. */
  label: string;
  totalBytes: number;
  filesTotal: number;
  /** Lower value runs first; equal values keep insertion order. */
  priority: number;
  /**
   * Whether a failed job may be retried automatically. Sending can always be tried
   * again; receiving cannot — the offer it answers is consumed once, and replaying it
   * would wait for an offer that will never come. Defaults to `true`.
   */
  retry?: boolean;
  run: (hooks: TaskHooks) => Promise<TaskResult>;
}

export interface QueueEntry {
  id: string;
  direction: 'send' | 'receive';
  label: string;
  totalBytes: number;
  filesTotal: number;
  priority: number;
  state: TransferState;
  /**
   * The user asked this job to pause. `state` keeps the machine's honest value
   * (a job paused before it ever moved bytes is still `connecting`), so the UI
   * reads this flag to show "paused" without lying about the transfer phase.
   */
  paused: boolean;
  progress: TransferProgress | undefined;
  errorCode: string | undefined;
  attempts: number;
  updatedAt: number;
}

export interface QueueOptions {
  clock: Clock;
  concurrency?: number;
  logger?: Logger;
  maxAttempts?: number;
  onChange?: (entries: QueueEntry[]) => void;
}

interface InternalJob {
  job: QueueJob;
  state: TransferState;
  progress: TransferProgress | undefined;
  errorCode: string | undefined;
  attempts: number;
  updatedAt: number;
  control: TaskControl | undefined;
  paused: boolean;
  cancelRequested: boolean;
  /** Earliest time a scheduled automatic retry may run again. */
  retryAt: number | undefined;
  sequence: number;
  /**
   * True from the moment the job started running until its promise settled.
   * Needed because a job takes a moment to register its control hooks: without
   * this flag the pump would start more jobs than the concurrency allows.
   */
  started: boolean;
}

const MAX_CONCURRENCY = 8;

export class TransferQueue {
  private readonly entries = new Map<string, InternalJob>();
  private readonly events = new Emitter<{ changed: QueueEntry[] }>();
  private sequence = 0;
  private paused = false;
  private readonly concurrency: number;
  private readonly maxAttempts: number;

  constructor(private readonly options: QueueOptions) {
    this.concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, options.concurrency ?? 2));
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  onChange(listener: (entries: QueueEntry[]) => void): () => void {
    return this.events.on('changed', listener);
  }

  /** Adds a job; resolves immediately (the job itself runs asynchronously). */
  enqueue(job: QueueJob): QueueEntry {
    const entry: InternalJob = {
      job,
      state: 'queued',
      progress: undefined,
      errorCode: undefined,
      attempts: 0,
      updatedAt: this.options.clock.now(),
      control: undefined,
      paused: false,
      cancelRequested: false,
      retryAt: undefined,
      sequence: this.sequence++,
      started: false,
    };
    this.entries.set(job.id, entry);
    this.publish();
    this.pump();
    return this.toEntry(entry);
  }

  /** Pauses the whole queue: running jobs pause, nothing new starts. */
  pauseAll(): void {
    this.paused = true;
    for (const entry of this.entries.values()) this.pause(entry.job.id);
  }

  resumeAll(): void {
    this.paused = false;
    for (const entry of this.entries.values()) this.resume(entry.job.id);
    this.pump();
  }

  pause(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.paused = true;
    entry.control?.pause();
    if (entry.state === 'queued') {
      entry.state = 'paused';
      this.publish();
      return;
    }
    entry.state = transition(entry.state, 'pause');
    this.publish();
    // The slot this job was using is released: a waiting transfer starts now.
    this.pump();
  }

  resume(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.paused = false;
    if (entry.state === 'paused') {
      if (entry.control) {
        entry.control.resume();
        entry.state = transition(entry.state, 'resume');
      } else {
        entry.state = 'queued';
      }
    }
    this.publish();
    this.pump();
  }

  /**
   * Cancels a job. Returns whether the job had already started:
   *  - `started`: the running job was asked to stop and will report its own
   *    outcome, so the caller must not write the final state itself;
   *  - `not-started`: nothing was running, the entry is cancelled here, and the
   *    caller is responsible for finishing whatever record it keeps for it. Without
   *    this distinction a cancelled-but-never-started transfer would stay
   *    "queued" forever in the history;
   *  - `unknown`: there was no such job.
   */
  cancel(id: string): 'started' | 'not-started' | 'unknown' {
    const entry = this.entries.get(id);
    if (!entry) return 'unknown';
    entry.cancelRequested = true;
    if (entry.control) {
      entry.control.cancel();
      this.publish();
      return 'started';
    }
    entry.state = 'cancelled';
    this.publish();
    return 'not-started';
  }

  /**
   * Re-enqueues a finished job. Only outcomes that can plausibly succeed again
   * are accepted: a completed transfer is never restarted by accident.
   */
  retry(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (entry.state !== 'failed' && entry.state !== 'interrupted' && entry.state !== 'cancelled') return false;
    if (entry.cancelRequested && entry.state === 'cancelled') return false;
    entry.state = transition(entry.state, 'retry');
    entry.errorCode = undefined;
    entry.paused = false;
    entry.cancelRequested = false;
    entry.retryAt = undefined;
    entry.updatedAt = this.options.clock.now();
    this.publish();
    this.pump();
    return true;
  }

  /** Moves a queued or failed job within the order (0 = first). */
  move(id: string, newPriority: number): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (isTerminal(entry.state) && entry.state !== 'failed') return false;
    entry.job = { ...entry.job, priority: newPriority };
    entry.updatedAt = this.options.clock.now();
    this.publish();
    return true;
  }

  remove(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (!isTerminal(entry.state) && entry.control) entry.control.cancel();
    this.entries.delete(id);
    this.publish();
    return true;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Number of jobs currently holding a slot (paused jobs hold none). */
  get activeCount(): number {
    return this.slotsInUse();
  }

  /**
   * Slots really in use: a job that is paused releases its slot without losing
   * its place, its open file handles or its exact byte position.
   */
  private slotsInUse(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.started && !entry.paused) count += 1;
    }
    return count;
  }

  list(): QueueEntry[] {
    return this.sorted().map((entry) => this.toEntry(entry));
  }

  private sorted(): InternalJob[] {
    return [...this.entries.values()].sort(
      (a, b) => a.job.priority - b.job.priority || a.sequence - b.sequence,
    );
  }

  private toEntry(entry: InternalJob): QueueEntry {
    return {
      id: entry.job.id,
      direction: entry.job.direction,
      label: entry.job.label,
      totalBytes: entry.job.totalBytes,
      filesTotal: entry.job.filesTotal,
      priority: entry.job.priority,
      state: entry.state,
      paused: entry.paused,
      progress: entry.progress,
      errorCode: entry.errorCode,
      attempts: entry.attempts,
      updatedAt: entry.updatedAt,
    };
  }

  private publish(): void {
    const snapshot = this.list();
    this.events.emit('changed', snapshot);
    this.options.onChange?.(snapshot);
  }

  private pump(): void {
    if (this.paused) return;
    while (this.slotsInUse() < this.concurrency) {
      // `!entry.started` is essential: a job that already runs counts as one of
      // the slots above, and starting it a second time would run it twice.
      const next = this.sorted().find(
        (entry) => (entry.state === 'queued' || entry.state === 'connecting') &&
          !entry.started &&
          !entry.paused &&
          !entry.cancelRequested &&
          // A job waiting for its retry backoff is "queued" but not runnable yet.
          (entry.retryAt === undefined || entry.retryAt <= this.options.clock.now()),
      );
      if (!next) return;
      void this.start(next);
    }
  }

  private async start(entry: InternalJob): Promise<void> {
    if (entry.started) return; // defence in depth: one job, one run
    entry.started = true;
    entry.retryAt = undefined;
    entry.attempts += 1;
    entry.state = transition(entry.state, 'start');
    entry.updatedAt = this.options.clock.now();
    this.publish();

    let settled = false;
    const hooks: TaskHooks = {
      onProgress: (progress) => {
        entry.progress = progress;
        entry.state = progress.state;
        entry.updatedAt = this.options.clock.now();
        this.publish();
      },
      isCancelled: () => entry.cancelRequested,
      isPaused: () => entry.paused,
      provideControl: (control) => {
        entry.control = control;
      },
    };

    try {
      const result = await entry.job.run(hooks);
      settled = true;
      entry.state = mapOutcome(result.outcome);
      entry.errorCode = result.errorCode;
      // The final figures are recorded even when the job never emitted a
      // progress event: "stopped at 400 bytes" must never be lost, and speed or
      // ETA are left undefined rather than invented.
      if (result.bytesDone !== undefined || result.verifiedFiles !== undefined) {
        entry.progress = {
          ...(entry.progress ?? {
            transferId: entry.job.id,
            state: entry.state,
            direction: entry.job.direction,
            bytesDone: 0,
            totalBytes: entry.job.totalBytes,
            fileIndex: 0,
            path: '',
            filesDone: 0,
            filesTotal: entry.job.filesTotal,
            bytesPerSecond: undefined,
            etaSeconds: undefined,
            reliable: false,
          }),
          bytesDone: result.bytesDone ?? entry.progress?.bytesDone ?? 0,
          filesDone: result.verifiedFiles ?? entry.progress?.filesDone ?? 0,
        };
      }
      if (
        result.outcome === 'failed' &&
        result.retryable === true &&
        entry.job.retry !== false &&
        entry.attempts < this.maxAttempts &&
        !entry.cancelRequested
      ) {
        // Automatic, jittered retry for transient failures only.
        entry.state = 'queued';
        const delay = backoffDelay(entry.attempts, 750, 8_000);
        entry.retryAt = this.options.clock.now() + delay;
        this.options.logger?.log('info', 'scheduling a retry', { id: entry.job.id, attempt: entry.attempts, delay });
        this.options.clock.setTimeout(() => {
          if (!entry.cancelRequested) this.pump();
        }, delay);
      }
    } catch (error) {
      settled = true;
      const dfError =
        error instanceof DropForgeError
          ? error
          : new DropForgeError(ERROR_CODES.CONNECTION_LOST, 'The transfer stopped unexpectedly', { retryable: true });
      entry.state = 'failed';
      entry.errorCode = dfError.code;
      this.options.logger?.log('error', 'transfer job threw', { id: entry.job.id, code: dfError.code });
    } finally {
      entry.control = undefined;
      entry.started = false;
      entry.updatedAt = this.options.clock.now();
      if (!settled) {
        entry.state = 'failed';
        entry.errorCode = ERROR_CODES.CONNECTION_LOST;
      }
      this.publish();
      this.pump();
    }
  }
}

function transition(state: TransferState, event: 'start' | 'pause' | 'resume' | 'retry'): TransferState {
  const next = nextState(state, event, { pauseSupported: true, resumable: true });
  return next ?? state;
}

function mapOutcome(outcome: TaskResult['outcome']): TransferState {
  switch (outcome) {
    case 'completed':
      return 'completed';
    case 'partial':
      // A partially delivered transfer is a failure the user can inspect: it is
      // never displayed as completed.
      return 'failed';
    case 'interrupted':
      return 'interrupted';
    case 'cancelled':
      return 'cancelled';
    case 'declined':
      return 'cancelled';
    default:
      return 'failed';
  }
}
