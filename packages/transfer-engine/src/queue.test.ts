import { describe, expect, it } from 'vitest';
import { DropForgeError, ERROR_CODES } from '@dropforge/app-core';
import type { Clock } from '@dropforge/protocol';
import { TransferQueue, type QueueJob, type TaskHooks, type TaskResult } from './queue.js';

/** Deterministic clock: timers only fire when the test says so. */
class FakeClock implements Clock {
  private nowMs = 0;
  private readonly timers: Array<{ at: number; fn: () => void }> = [];

  now(): number {
    return this.nowMs;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    this.timers.push({ at: this.nowMs + ms, fn });
    return fn;
  }

  clearTimeout(handle: unknown): void {
    const index = this.timers.findIndex((t) => t.fn === handle);
    if (index >= 0) this.timers.splice(index, 1);
  }

  setInterval(): unknown {
    // The queue under test only uses setTimeout; intervals are never scheduled.
    throw new Error('setInterval is not used by the queue tests');
  }

  clearInterval(): void {}

  /** Runs every timer due at or before `nowMs + ms`, advancing the clock. */
  async advance(ms: number): Promise<void> {
    this.nowMs += ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= this.nowMs).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers.splice(this.timers.indexOf(due), 1);
      due.fn();
      await Promise.resolve();
    }
    await Promise.resolve();
  }
}

interface Controlled {
  job: QueueJob;
  hooks: TaskHooks[];
  finish: (result: TaskResult) => void;
  started: number;
}

/** A job that only finishes when the test says so. */
function controlledJob(id: string, priority = 0): Controlled {
  const control: Controlled = { job: undefined as unknown as QueueJob, hooks: [], finish: () => {}, started: 0 };
  control.job = {
    id,
    direction: 'send',
    label: id,
    totalBytes: 1000,
    filesTotal: 1,
    priority,
    run: (hooks) => {
      control.started += 1;
      control.hooks.push(hooks);
      hooks.provideControl({
        pause: () => {},
        resume: () => {},
        cancel: () => {},
        interrupt: () => {},
      });
      return new Promise<TaskResult>((resolve) => {
        control.finish = resolve;
      });
    },
  };
  return control;
}

const idle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

describe('TransferQueue', () => {
  it('never runs more jobs than the concurrency allows', async () => {
    const clock = new FakeClock();
    const queue = new TransferQueue({ clock, concurrency: 2 });
    const a = controlledJob('a');
    const b = controlledJob('b');
    const c = controlledJob('c');
    queue.enqueue(a.job);
    queue.enqueue(b.job);
    queue.enqueue(c.job);
    await idle();

    expect(a.started).toBe(1);
    expect(b.started).toBe(1);
    expect(c.started).toBe(0);
    expect(queue.list().find((e) => e.id === 'c')?.state).toBe('queued');

    a.finish({ outcome: 'completed' });
    await idle();
    expect(c.started).toBe(1);
  });

  it('runs jobs in the user order, and move() reorders waiting jobs', async () => {
    const clock = new FakeClock();
    const queue = new TransferQueue({ clock, concurrency: 1 });
    const first = controlledJob('first', 0);
    const second = controlledJob('second', 0);
    queue.enqueue(first.job);
    queue.enqueue(second.job);
    await idle();
    expect(first.started).toBe(1);
    expect(second.started).toBe(0);

    // Pulling the second job to the front has to win over insertion order.
    expect(queue.move('second', -1)).toBe(true);
    first.finish({ outcome: 'completed' });
    await idle();
    expect(second.started).toBe(1);
  });

  it('frees the slot of a paused job so a waiting transfer can start', async () => {
    const clock = new FakeClock();
    const queue = new TransferQueue({ clock, concurrency: 1 });
    const long = controlledJob('long');
    queue.enqueue(long.job);
    await idle();
    expect(long.started).toBe(1);

    const small = controlledJob('small');
    queue.enqueue(small.job);
    await idle();
    expect(small.started).toBe(0);

    queue.pause('long');
    await idle();
    // The job had not started moving bytes, so its state stays "connecting"
    // (the state machine is not allowed to lie); the paused flag is what the UI
    // shows, and the slot is released either way.
    const paused = queue.list().find((e) => e.id === 'long');
    expect(paused?.paused).toBe(true);
    expect(paused?.state).toBe('connecting');
    // The paused job holds no slot any more: the waiting one runs.
    expect(small.started).toBe(1);
    expect(queue.activeCount).toBe(1);
  });

  it('reports a partial delivery as failed, never as completed', async () => {
    const clock = new FakeClock();
    const queue = new TransferQueue({ clock, concurrency: 1 });
    const job = controlledJob('partial');
    queue.enqueue(job.job);
    await idle();
    job.finish({ outcome: 'partial', bytesDone: 400, verifiedFiles: 0 });
    await idle();

    const entry = queue.list()[0];
    expect(entry?.state).toBe('failed');
    // The exact figures the runner reported are kept, not invented.
    expect(entry?.progress?.bytesDone).toBe(400);
  });

  it('retries a failed job but never a completed one', async () => {
    const clock = new FakeClock();
    const queue = new TransferQueue({ clock, concurrency: 1, maxAttempts: 1 });
    const failing = controlledJob('failing');
    queue.enqueue(failing.job);
    await idle();
    failing.finish({ outcome: 'failed', errorCode: ERROR_CODES.CONNECTION_LOST });
    await idle();
    expect(queue.list()[0]?.state).toBe('failed');

    expect(queue.retry('failing')).toBe(true);
    await idle();
    expect(failing.started).toBe(2);

    failing.finish({ outcome: 'completed' });
    await idle();
    expect(queue.list()[0]?.state).toBe('completed');
    expect(queue.retry('failing')).toBe(false);
  });

  it('schedules a bounded automatic retry with backoff for transient failures', async () => {
    const clock = new FakeClock();
    const queue = new TransferQueue({ clock, concurrency: 1, maxAttempts: 3 });
    const flaky = controlledJob('flaky');
    queue.enqueue(flaky.job);
    await idle();
    flaky.finish({ outcome: 'failed', errorCode: ERROR_CODES.CONNECTION_LOST });
    await idle();

    // The first backoff is drawn from [375, 750] ms: just under it, nothing runs.
    await clock.advance(370);
    expect(flaky.started).toBe(1);
    // …then it runs again, without the user touching anything.
    await clock.advance(800);
    expect(flaky.started).toBe(2);
  });

  it('turns an unexpected throw into a failed job, keeping the error code', async () => {
    const clock = new FakeClock();
    const queue = new TransferQueue({ clock, concurrency: 1, maxAttempts: 1 });
    queue.enqueue({
      id: 'boom',
      direction: 'send',
      label: 'boom',
      totalBytes: 10,
      filesTotal: 1,
      priority: 0,
      run: async () => {
        throw new DropForgeError(ERROR_CODES.PERMISSION_DENIED, 'Reading the source is not allowed');
      },
    });
    await idle();
    const entry = queue.list()[0];
    expect(entry?.state).toBe('failed');
    expect(entry?.errorCode).toBe(ERROR_CODES.PERMISSION_DENIED);
  });

  it('cancel() marks a queued job cancelled and never starts it', async () => {
    const clock = new FakeClock();
    const queue = new TransferQueue({ clock, concurrency: 1 });
    const running = controlledJob('running');
    const waiting = controlledJob('waiting');
    queue.enqueue(running.job);
    queue.enqueue(waiting.job);
    await idle();

    queue.cancel('waiting');
    expect(queue.list().find((e) => e.id === 'waiting')?.state).toBe('cancelled');
    running.finish({ outcome: 'completed' });
    await idle();
    expect(waiting.started).toBe(0);
    // A user-cancelled job is not resurrected by retry().
    expect(queue.retry('waiting')).toBe(false);
  });

  it('pauseAll() stops new jobs and resumeAll() starts them again', async () => {
    const clock = new FakeClock();
    const queue = new TransferQueue({ clock, concurrency: 2 });
    const a = controlledJob('a');
    const b = controlledJob('b');
    queue.enqueue(a.job);
    queue.pauseAll();
    queue.enqueue(b.job);
    await idle();
    expect(b.started).toBe(0);

    queue.resumeAll();
    await idle();
    expect(b.started).toBe(1);
  });
});
