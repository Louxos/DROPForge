/**
 * Sender side of a transfer.
 *
 * Guarantees:
 *  - progress counts only chunks the *receiver* acknowledged (plus the ranges a
 *    previous session already delivered), never bytes parked in a socket buffer;
 *  - a file is only reported as sent once its sha-256 digest was accepted by the
 *    receiver (`fileDigestResult.action === 'accept'`);
 *  - pause/resume are honoured between chunks, so no partial chunk can end up
 *    half-sent;
 *  - a peer that stops acknowledging is detected and the transfer moves to
 *    `interrupted` with a resumable state instead of hanging silently;
 *  - `completed` is never claimed by the sender: the receiver's
 *    `transferResult` decides, and the UI translates it.
 */
import {
  CHUNK_MAX_ATTEMPTS,
  CHUNK_RETRY_BASE_MS,
  CHUNK_RETRY_MAX_MS,
  CHUNK_WINDOW,
  HANDSHAKE_TIMEOUT_MS,
  Sha256Stream,
  toHex,
  type ChunkAck,
  type Clock,
  type ConflictDecision,
  type ControlMessage,
  type FileDigestResult,
  type Logger,
  type ManifestEntry,
  type TransferAccept,
  type TransferOffer,
  type TransferReject,
  type TransferResult,
} from '@dropforge/protocol';
import {
  DropForgeError,
  ERROR_CODES,
  SpeedMeter,
  backoffDelay,
  isTerminal,
  nextState,
  type SourceFile,
  type TransferState,
} from '@dropforge/app-core';
import { chunkCountFor, missingRanges, type ByteRange } from './ranges.js';
import type { PeerSession } from './session.js';

export interface TransferProgress {
  transferId: string;
  state: TransferState;
  direction: 'send' | 'receive';
  bytesDone: number;
  totalBytes: number;
  fileIndex: number;
  path: string;
  filesDone: number;
  filesTotal: number;
  bytesPerSecond: number | undefined;
  etaSeconds: number | undefined;
  /** Whether speed/ETA may be displayed as-is. */
  reliable: boolean;
  /** Extra, user-facing note key (e.g. "pausedByPeer"). */
  note?: string;
}

export type UnavailableReason = 'skipped' | 'unreadable' | 'changed' | 'cancelled' | 'refused';
export type FailedReason = 'digestMismatch' | 'writeFailed' | 'noSpace';

export interface SenderOutcome {
  outcome: 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted';
  bytesDone: number;
  verifiedFiles: number;
  unavailable: Array<{ index: number; reason: UnavailableReason }>;
  failed: Array<{ index: number; reason: FailedReason }>;
  errorCode?: string;
  /**
   * Whether trying the same transfer again may succeed.
   *
   * A refusal, a cancelled transfer, a device that is not trusted: retrying those
   * repeats a decision the user already took. A connection that dropped is the
   * opposite — the same attempt deserves another run. The queue reads this flag
   * instead of guessing from the code.
   */
  retryable?: boolean;
}

export interface SenderOptions {
  session: PeerSession;
  /** Stream index used by the sealed data frames of this transfer. */
  streamIndex: number;
  offer: TransferOffer;
  /** Local sources, keyed by manifest entry index. */
  sources: ReadonlyMap<number, SourceFile>;
  accept: TransferAccept;
  /** Answers about name conflicts, received before the transfer starts. */
  decisions?: ConflictDecision['decisions'];
  clock: Clock;
  logger?: Logger;
  window?: number;
  /** Longest time without any acknowledgement before the transfer is interrupted. */
  ackTimeoutMs?: number;
  /** Minimum delay between two progress events (0 in tests). */
  progressThrottleMs?: number;
  onProgress?: (progress: TransferProgress) => void;
}

class StopSignal extends Error {
  constructor(
    readonly kind: 'cancelled' | 'interrupted' | 'rejected' | 'aborted',
    message: string,
    readonly rejectReason?: TransferReject['reason'],
  ) {
    super(message);
  }
}

export class TransferSender {
  private readonly meter = new SpeedMeter();
  private readonly window: number;
  private readonly ackTimeoutMs: number;
  private state: TransferState = 'connecting';
  private paused = false;
  private pauseNote: string | undefined;
  private stop: StopSignal | undefined;
  private ackWaiters: Array<() => void> = [];
  private ackedChunk = -1;
  private sentChunks = 0;
  private creditedThisRun = 0;
  private creditedChunks = new Set<number>();
  private currentFile = -1;
  private bytesDone: number;
  private verifiedFiles = 0;
  private readonly unavailable: Array<{ index: number; reason: UnavailableReason }> = [];
  private readonly failed: Array<{ index: number; reason: FailedReason }> = [];
  private digestResolvers: Array<(result: FileDigestResult | undefined) => void> = [];
  private resultResolver: ((result: TransferResult | undefined) => void) | undefined;
  private rejectResolver: ((reason: TransferReject) => void) | undefined;
  private lastProgressAt = 0;
  private unsubscribe: (() => void) | undefined;
  private readonly skipped = new Set<number>();
  private readonly refused = new Set<number>();
  private readonly progressThrottleMs: number;
  private abortReason: 'writeFailed' | 'noSpace' | 'permissionDenied' | 'conflict' | 'integrityFailed' | 'busy' | undefined;
  private readonly overwritten = new Set<number>();
  /** Bytes the receiver already had before this run (resume). */
  private readonly preexistingBytes: number;

  constructor(private readonly options: SenderOptions) {
    this.window = options.window ?? CHUNK_WINDOW;
    this.ackTimeoutMs = options.ackTimeoutMs ?? 30_000;
    this.progressThrottleMs = options.progressThrottleMs ?? 250;
    for (const decision of options.decisions ?? []) {
      if (decision.action === 'skip') this.skipped.add(decision.index);
      if (decision.action === 'overwrite') this.overwritten.add(decision.index);
    }
    // Entries the receiver refused outright: never send a single byte for them.
    for (const refusal of options.accept.refused ?? []) this.refused.add(refusal.index);
    let preexisting = 0;
    for (const entry of options.accept.existing) {
      const manifestEntry = options.offer.entries.find((e) => e.index === entry.index);
      if (!manifestEntry || manifestEntry.kind === 'directory') continue;
      for (const range of entry.ranges) preexisting += Math.max(0, range.end - range.start);
    }
    this.preexistingBytes = preexisting;
    this.bytesDone = preexisting;
  }

  get currentState(): TransferState {
    return this.state;
  }

  /** Bytes already durable at the receiver when this run started. */
  get resumedBytes(): number {
    return this.preexistingBytes;
  }

  pause(note?: string): void {
    if (this.state !== 'transferring') return;
    this.paused = true;
    this.pauseNote = note;
    this.transition('pause');
    this.emitProgress(true);
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.paused = false;
    this.pauseNote = undefined;
    this.transition('resume');
    this.emitProgress(true);
  }

  cancel(): void {
    this.stop = new StopSignal('cancelled', 'Transfer cancelled');
    this.abortPending();
  }

  /** Keeps the resume state but stops sending (network loss, app closing). */
  interrupt(): void {
    this.stop = new StopSignal('interrupted', 'Transfer interrupted');
    // Tell the peer we stopped on purpose: it then shows the honest state
    // instead of waiting for bytes that will never come.
    void this.safeControl({
      t: 'transferPause',
      transferId: this.options.offer.transferId,
      note: 'senderInterrupted',
    });
    this.abortPending();
  }

  /**
   * Releases every promise the run loop may be waiting on. Without this, a stop
   * requested while waiting for a digest verdict or a final result would keep
   * the transfer alive until the acknowledgement timeout.
   */
  private abortPending(): void {
    const digests = this.digestResolvers;
    this.digestResolvers = [];
    for (const resolve of digests) resolve(undefined);
    this.resultResolver?.(undefined);
    this.resultResolver = undefined;
    this.wake();
  }

  private wake(): void {
    const waiters = this.ackWaiters;
    this.ackWaiters = [];
    for (const waiter of waiters) waiter();
  }

  private transition(event: Parameters<typeof nextState>[1], context: { pauseSupported?: boolean } = {}): void {
    const next = nextState(this.state, event, { pauseSupported: true, resumable: true, ...context });
    if (next === undefined || isTerminal(this.state)) return;
    this.state = next;
  }

  private assertRunnable(): void {
    if (this.stop) throw this.stop;
  }

  /** Resolves false when the acknowledgement timeout expires first. */
  private async waitForAckOrTimeout(): Promise<boolean> {
    if (this.sentChunks - (this.ackedChunk + 1) < this.window) return true;
    return await new Promise<boolean>((resolve) => {
      const timer = this.options.clock.setTimeout(() => resolve(false), this.ackTimeoutMs);
      this.ackWaiters.push(() => {
        this.options.clock.clearTimeout(timer);
        resolve(true);
      });
    });
  }

  private waitTick(): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = this.options.clock.setTimeout(() => resolve(), 200);
      this.ackWaiters.push(() => {
        this.options.clock.clearTimeout(timer);
        resolve();
      });
    });
  }

  private onControl = (message: ControlMessage): void => {
    const transferId = 'transferId' in message ? message.transferId : undefined;
    if (transferId !== this.options.offer.transferId) return;
    switch (message.t) {
      case 'chunkAck':
        this.onAck(message);
        break;
      case 'progress': {
        // The receiver is authoritative about what it really holds.
        const reported = Math.min(message.receivedBytes, this.options.offer.totalBytes);
        if (reported > this.bytesDone) {
          this.meter.add(reported - this.bytesDone, this.options.clock.now());
          this.bytesDone = reported;
          this.emitProgress();
        }
        break;
      }
      case 'fileDigestResult':
        this.digestResolvers.shift()?.(message);
        break;
      case 'transferResult':
        this.resultResolver?.(message);
        break;
      case 'transferReject':
        this.rejectResolver?.(message);
        this.stop = new StopSignal('rejected', 'The transfer was refused', message.reason);
        this.wake();
        break;
      case 'transferAbort':
        // The receiver cannot continue: stop immediately instead of waiting for
        // acknowledgements that will never arrive.
        this.abortReason = message.reason;
        this.stop = new StopSignal('aborted', 'The receiving side stopped the transfer');
        this.abortPending();
        break;
      case 'transferPause':
        this.pause('pausedByPeer');
        break;
      case 'transferResume':
        this.resume();
        break;
      case 'transferCancel':
        this.cancel();
        break;
      default:
        break;
    }
  };

  private onAck(ack: ChunkAck): void {
    if (ack.fileIndex !== this.currentFile) return;
    if (ack.chunkIndex <= this.ackedChunk) return;
    this.ackedChunk = ack.chunkIndex;
    this.creditChunks(ack.fileIndex, ack.chunkIndex);
    this.wake();
  }

  /** Credits the freshly acknowledged chunks with their real byte sizes. */
  private creditChunks(entryIndex: number, upToChunk: number): void {
    const entry = this.options.offer.entries.find((e) => e.index === entryIndex);
    if (!entry || entry.kind === 'directory') return;
    const chunkBytes = this.options.offer.chunkBytes;
    for (let index = 0; index <= upToChunk; index += 1) {
      if (this.creditedChunks.has(index)) continue;
      this.creditedChunks.add(index);
      const start = index * chunkBytes;
      const end = Math.min(start + chunkBytes, entry.size);
      if (end > start) this.creditedThisRun += end - start;
    }
    const total = Math.min(this.options.offer.totalBytes, this.preexistingBytes + this.creditedThisRun);
    if (total > this.bytesDone) this.bytesDone = total;
  }

  async run(): Promise<SenderOutcome> {
    this.unsubscribe = this.options.session.events.on('control', this.onControl);
    try {
      this.transition('connected');
      this.emitProgress(true);
      for (const entry of this.options.offer.entries) {
        this.assertRunnable();
        await this.waitWhilePaused();
        if (this.skipped.has(entry.index)) {
          this.unavailable.push({ index: entry.index, reason: 'skipped' });
          continue;
        }
        if (this.refused.has(entry.index)) {
          this.unavailable.push({ index: entry.index, reason: 'refused' });
          continue;
        }
        if (entry.kind === 'directory') continue;
        const result = await this.sendFile(entry);
        if (result === 'ok') this.verifiedFiles += 1;
      }
      // A stop requested during the last file must not be turned into a
      // "transferComplete" followed by a wait for a verdict that never comes.
      this.assertRunnable();
      await this.options.session.sendControl({
        t: 'transferComplete',
        transferId: this.options.offer.transferId,
        unavailable: this.unavailable.filter((u) => u.reason !== 'cancelled'),
      });
      const result = await this.awaitTransferResult();
      this.assertRunnable();
      const reported: SenderOutcome['outcome'] = result?.outcome ?? 'partial';
      // A receiver that answered "completed" only proofed the files it received:
      // files the user selected but that were skipped, refused or unreadable keep
      // the transfer honest as "partial".
      const senderOutcome: SenderOutcome['outcome'] =
        reported === 'completed' && (this.unavailable.length > 0 || this.failed.length > 0) ? 'partial' : reported;
      const outcome: SenderOutcome = {
        outcome: senderOutcome,
        bytesDone: this.bytesDone,
        verifiedFiles: result?.verifiedFiles ?? this.verifiedFiles,
        unavailable: this.unavailable,
        failed: result?.failedFiles
          ? [...this.failed, ...result.failedFiles.map((f) => ({ index: f.index, reason: f.reason as FailedReason }))]
          : this.failed,
      };
      if (outcome.outcome === 'completed') {
        // Only a fully verified transfer reaches "completed".
        this.transition('verify');
        this.transition('verified');
      } else {
        this.state = 'failed';
      }
      this.emitProgress(true);
      return outcome;
    } catch (error) {
      if (error instanceof StopSignal) {
        if (error.kind === 'cancelled') {
          await this.safeControl({ t: 'transferCancel', transferId: this.options.offer.transferId });
          this.state = 'cancelled';
        } else if (error.kind === 'interrupted') {
          this.state = 'interrupted';
        } else {
          this.state = 'failed';
        }
        this.emitProgress(true);
        return {
          outcome:
          error.kind === 'cancelled'
            ? 'cancelled'
            : error.kind === 'interrupted'
              ? 'interrupted'
              : 'failed',
          bytesDone: this.bytesDone,
          verifiedFiles: this.verifiedFiles,
          unavailable: this.unavailable,
          failed: this.failed,
          errorCode:
            error.kind === 'cancelled'
              ? ERROR_CODES.TRANSFER_CANCELLED
              : error.kind === 'rejected'
                ? rejectionCode(error.rejectReason)
                : error.kind === 'aborted'
                  ? abortCode(this.abortReason)
                  : ERROR_CODES.CONNECTION_LOST,
        };
      }
      const dfError =
        error instanceof DropForgeError
          ? error
          : new DropForgeError(ERROR_CODES.CONNECTION_LOST, 'The transfer stopped unexpectedly', { retryable: true });
      this.state = 'failed';
      this.emitProgress(true);
      return {
        outcome: 'failed',
        bytesDone: this.bytesDone,
        verifiedFiles: this.verifiedFiles,
        unavailable: this.unavailable,
        failed: this.failed,
        errorCode: dfError.code,
        // A refusal and a cancellation are decisions: the queue must not replay them.
        retryable: dfError.retryable,
      };
    } finally {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.emitProgress(true);
    }
  }

  private async safeControl(message: ControlMessage): Promise<void> {
    try {
      await this.options.session.sendControl(message);
    } catch {
      // Never turn a cleanup into a new error.
    }
  }

  private async awaitTransferResult(): Promise<TransferResult | undefined> {
    return new Promise<TransferResult | undefined>((resolve) => {
      const timer = this.options.clock.setTimeout(() => resolve(undefined), this.ackTimeoutMs);
      this.resultResolver = (result) => {
        this.options.clock.clearTimeout(timer);
        resolve(result);
      };
    });
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.paused) {
      this.assertRunnable();
      await this.waitTick();
    }
  }

  private async sendFile(entry: ManifestEntry): Promise<'ok' | 'failed' | 'unavailable'> {
    const source = this.options.sources.get(entry.index);
    if (!source) {
      this.unavailable.push({ index: entry.index, reason: 'unreadable' });
      return 'unavailable';
    }
    this.currentFile = entry.index;
    // Chunk indices are per file: the acknowledgement state is reset for every
    // file, including for files that end up being skipped or unreadable.
    this.ackedChunk = -1;
    this.sentChunks = 0;
    this.creditedChunks.clear();
    this.emitProgress(true);
    const validation = await source.revalidate();
    if (validation !== 'unchanged') {
      this.unavailable.push({ index: entry.index, reason: validation === 'missing' ? 'unreadable' : 'changed' });
      return 'unavailable';
    }
    const missing = this.overwritten.has(entry.index)
      ? missingRanges(entry.size, [])
      : missingRanges(entry.size, this.options.accept.existing.find((e) => e.index === entry.index)?.ranges ?? []);

    const hasher = new Sha256Stream();
    // Hash-only ranges: bytes the receiver already has. They are read again so
    // that the whole-file digest describes the complete file, but never resent.
    for (const range of hashOnlyRanges(entry.size, missing)) {
      for (let offset = range.start; offset < range.end; ) {
        this.assertRunnable();
        await this.waitWhilePaused();
        const length = Math.min(this.options.offer.chunkBytes, range.end - offset);
        const data = await this.readSource(source, offset, length, entry.index);
        if (!data) return 'unavailable';
        hasher.update(data);
        offset += length;
      }
    }
    for (const range of missing) {
      const first = Math.floor(range.start / this.options.offer.chunkBytes);
      const last = Math.floor(Math.max(range.start, range.end - 1) / this.options.offer.chunkBytes);
      for (let chunkIndex = first; chunkIndex <= last; chunkIndex += 1) {
        this.assertRunnable();
        await this.waitWhilePaused();
        const start = chunkIndex * this.options.offer.chunkBytes;
        const end = Math.min(start + this.options.offer.chunkBytes, entry.size);
        const data = await this.readSource(source, start, Math.max(0, end - start), entry.index);
        if (!data) return 'unavailable';
        hasher.update(data);
        await this.sendChunk(entry, chunkIndex, data, end >= entry.size);
        // Emit after every chunk (throttled): a UI must be able to pause or
        // cancel between two chunks without waiting for the file to end.
        this.emitProgress();
      }
    }
    if (entry.size === 0) {
      // Zero-length files still need one explicit frame so the receiver creates them.
      await this.sendChunk(entry, 0, new Uint8Array(0), true);
      this.creditChunks(entry.index, 0);
    }
    const digest = toHex(hasher.digest());
    const verified = await this.exchangeDigest(entry, digest);
    if (verified) return 'ok';
    this.failed.push({ index: entry.index, reason: 'digestMismatch' });
    return 'failed';
  }

  private async readSource(
    source: SourceFile,
    offset: number,
    length: number,
    index: number,
  ): Promise<Uint8Array | undefined> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        if (length === 0) return new Uint8Array(0);
        const data = await source.read(offset, length);
        if (data && data.length === length) return data;
        // A short read means the file changed underneath: stop touching it.
        this.unavailable.push({ index, reason: 'changed' });
        return undefined;
      } catch (error) {
        if (attempt === 3) {
          this.options.logger?.log('warn', 'source read failed', { index, attempt });
          this.unavailable.push({ index, reason: 'unreadable' });
          return undefined;
        }
        await delay(this.options.clock, backoffDelay(attempt, CHUNK_RETRY_BASE_MS, CHUNK_RETRY_MAX_MS));
      }
    }
    return undefined;
  }

  private async sendChunk(
    entry: ManifestEntry,
    chunkIndex: number,
    data: Uint8Array,
    lastChunk: boolean,
  ): Promise<void> {
    for (let attempt = 1; attempt <= CHUNK_MAX_ATTEMPTS; attempt += 1) {
      this.assertRunnable();
      const allowed = await this.waitForAckOrTimeout();
      if (!allowed) {
        this.options.logger?.log('warn', 'acknowledgement timeout', { index: entry.index, chunk: chunkIndex });
        this.interrupt();
        this.assertRunnable();
      }
      try {
        await this.options.session.sendData(
          {
            streamIndex: this.options.streamIndex,
            fileIndex: entry.index,
            chunkIndex,
            lastChunk,
            emptyFile: entry.size === 0,
          },
          data,
        );
        this.sentChunks += 1;
        return;
      } catch (error) {
        if (attempt === CHUNK_MAX_ATTEMPTS) {
          throw new DropForgeError(ERROR_CODES.CONNECTION_LOST, 'A chunk could not be sent', {
            retryable: true,
            cause: error,
          });
        }
        await delay(this.options.clock, backoffDelay(attempt, CHUNK_RETRY_BASE_MS, CHUNK_RETRY_MAX_MS));
      }
    }
  }

  private async exchangeDigest(entry: ManifestEntry, digest: string): Promise<boolean> {
    const answer = await this.requestDigestVerdict(entry, digest);
    if (!answer) return false;
    if (answer.ok || answer.action === 'accept') return true;
    return false;
  }

  private async requestDigestVerdict(
    entry: ManifestEntry,
    digest: string,
  ): Promise<FileDigestResult | undefined> {
    await this.options.session.sendControl({
      t: 'fileDigest',
      transferId: this.options.offer.transferId,
      index: entry.index,
      algorithm: 'sha-256',
      digest,
      size: entry.size,
    });
    return await new Promise<FileDigestResult | undefined>((resolve) => {
      const timer = this.options.clock.setTimeout(() => resolve(undefined), this.ackTimeoutMs);
      this.digestResolvers.push((result) => {
        this.options.clock.clearTimeout(timer);
        resolve(result);
      });
    });
  }

  private emitProgress(force = false): void {
    const now = this.options.clock.now();
    if (!force && now - this.lastProgressAt < this.progressThrottleMs) return;
    this.lastProgressAt = now;
    const remaining = Math.max(0, this.options.offer.totalBytes - this.bytesDone);
    const reading = this.meter.read(now, remaining);
    const entry = this.options.offer.entries.find((e) => e.index === this.currentFile);
    this.options.onProgress?.({
      transferId: this.options.offer.transferId,
      state: this.state,
      direction: 'send',
      bytesDone: this.bytesDone,
      totalBytes: this.options.offer.totalBytes,
      fileIndex: this.currentFile,
      path: entry?.path ?? '',
      filesDone: this.verifiedFiles,
      filesTotal: this.options.offer.entries.filter((e) => e.kind === 'file').length,
      bytesPerSecond: reading.bytesPerSecond,
      etaSeconds: reading.etaSeconds,
      reliable: reading.reliable,
      note: this.pauseNote,
    });
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function hashOnlyRanges(limit: number, missing: readonly ByteRange[]): ByteRange[] {
  const out: ByteRange[] = [];
  let cursor = 0;
  for (const range of missing) {
    if (range.start > cursor) out.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < limit) out.push({ start: cursor, end: limit });
  return out;
}

function abortCode(reason: 'writeFailed' | 'noSpace' | 'permissionDenied' | 'conflict' | 'integrityFailed' | 'busy' | undefined): string {
  switch (reason) {
    case 'noSpace':
      return ERROR_CODES.NO_SPACE_LEFT;
    case 'permissionDenied':
      return ERROR_CODES.PERMISSION_DENIED;
    case 'conflict':
      return ERROR_CODES.NAME_CONFLICT;
    case 'integrityFailed':
      return ERROR_CODES.INTEGRITY_FAILED;
    case 'busy':
      return ERROR_CODES.BUSY;
    default:
      return ERROR_CODES.WRITE_FAILED;
  }
}

function rejectionCode(reason: TransferReject['reason'] | undefined): string {
  switch (reason) {
    case 'noSpace':
      return ERROR_CODES.NO_SPACE_LEFT;
    case 'declined':
      return ERROR_CODES.TRANSFER_DECLINED;
    case 'busy':
      return ERROR_CODES.BUSY;
    case 'tooLarge':
      return ERROR_CODES.TOO_LARGE;
    default:
      return ERROR_CODES.TRANSFER_CANCELLED;
  }
}

export function delay(clock: Clock, ms: number): Promise<void> {
  return new Promise((resolve) => clock.setTimeout(() => resolve(), ms));
}

/**
 * Offer/accept exchange. Sends the offer, then waits for the receiver's answer.
 * Returns `{ accept: undefined, reject: undefined }` when the peer never
 * answered before the timeout — never a fabricated success.
 */
export async function negotiateWithReceiver(
  session: PeerSession,
  offer: TransferOffer,
  clock: Clock,
  options: { timeoutMs?: number } = {},
): Promise<{ accept: TransferAccept | undefined; reject: TransferReject | undefined; decisions?: ConflictDecision }> {
  let accept: TransferAccept | undefined;
  let reject: TransferReject | undefined;
  let decisions: ConflictDecision | undefined;
  const timeout = options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS * 2;

  const answer = new Promise<void>((resolve) => {
    const timer = clock.setTimeout(() => {
      unsubscribe();
      resolve();
    }, timeout);
    const unsubscribe = session.events.on('control', (message: ControlMessage) => {
      if (!('transferId' in message) || message.transferId !== offer.transferId) return;
      if (message.t === 'transferAccept') accept = message;
      else if (message.t === 'transferReject') reject = message;
      else if (message.t === 'conflictDecision') {
        decisions = message;
        return;
      } else {
        return;
      }
      clock.clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });

  await session.sendControl(offer);
  await answer;
  return { accept, reject, decisions };
}
