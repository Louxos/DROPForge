import { describe, expect, it } from 'vitest';
import { ERROR_CODES, type TransferRecord } from '@dropforge/app-core';
import { HistoryStore } from './history.js';
import { MemoryStore } from '../../../tests/helpers/memory-store.js';

const record = (overrides: Partial<TransferRecord> = {}): TransferRecord => ({
  v: 1,
  id: 't-1',
  direction: 'send',
  peerDeviceId: 'peer-device-01',
  peerName: 'Bob phone',
  state: 'completed',
  startedAt: 1_000,
  updatedAt: 2_000,
  completedAt: 2_000,
  totalBytes: 1_000,
  bytesDone: 1_000,
  files: [{ index: 0, path: 'holiday/photo.jpg', kind: 'file', size: 1_000, bytesDone: 1_000, verified: true }],
  ...overrides,
});

describe('HistoryStore', () => {
  it('refuses to store a completed transfer that never completed', async () => {
    const store = new HistoryStore(new MemoryStore());
    await expect(store.save(record({ completedAt: undefined }))).rejects.toMatchObject({
      code: ERROR_CODES.INTEGRITY_FAILED,
    });
  });

  it('keeps the real state of an unfinished transfer untouched', async () => {
    const meta = new MemoryStore();
    const store = new HistoryStore(meta);
    await store.save(record({ state: 'interrupted', completedAt: undefined, bytesDone: 400 }));
    const saved = await store.get('t-1');
    expect(saved?.state).toBe('interrupted');
    expect(saved?.bytesDone).toBe(400);
  });

  it('searches by peer name, device id and file path', async () => {
    const store = new HistoryStore(new MemoryStore());
    await store.save(record());
    await store.save(
      record({
        id: 't-2',
        direction: 'receive',
        peerName: 'Alice PC',
        peerDeviceId: 'device-alice-0001',
        updatedAt: 3_000,
        completedAt: 3_000,
        files: [{ index: 0, path: 'documents/report.pdf', kind: 'file', size: 10, bytesDone: 10 }],
      }),
    );

    expect((await store.list({ query: 'bob' })).map((r) => r.id)).toEqual(['t-1']);
    expect((await store.list({ query: 'alice' })).map((r) => r.id)).toEqual(['t-2']);
    expect((await store.list({ query: 'report.pdf' })).map((r) => r.id)).toEqual(['t-2']);
    expect((await store.list({ query: 'nothing-matches' }))).toEqual([]);
  });

  it('filters by direction, state and date range, and paginates', async () => {
    const store = new HistoryStore(new MemoryStore());
    await store.save(record({ id: 'a', updatedAt: 1_000, completedAt: 1_000 }));
    await store.save(record({ id: 'b', updatedAt: 2_000, completedAt: 2_000, direction: 'receive' }));
    await store.save(record({ id: 'c', updatedAt: 3_000, completedAt: undefined, state: 'failed' }));

    // 'a' and 'c' were both sent (newest first), 'b' was received.
    expect((await store.list({ direction: 'send' })).map((r) => r.id)).toEqual(['c', 'a']);
    expect((await store.list({ direction: 'receive' })).map((r) => r.id)).toEqual(['b']);
    expect((await store.list({ states: ['failed'] })).map((r) => r.id)).toEqual(['c']);
    expect((await store.list({ since: 2_000, until: 3_000 })).map((r) => r.id)).toEqual(['b']);
    expect((await store.list({ limit: 2 })).map((r) => r.id)).toEqual(['c', 'b']);
    expect((await store.list({ offset: 1, limit: 1 })).map((r) => r.id)).toEqual(['b']);
  });

  it('counts only the bytes that were actually delivered', async () => {
    const store = new HistoryStore(new MemoryStore());
    await store.save(record({ id: 'a', totalBytes: 1_000, bytesDone: 1_000 }));
    await store.save(record({ id: 'b', direction: 'receive', totalBytes: 1_000, bytesDone: 250, state: 'failed', completedAt: undefined }));

    const stats = await store.stats();
    expect(stats.transfers).toBe(2);
    expect(stats.bytesSent).toBe(1_000);
    expect(stats.bytesReceived).toBe(250);
  });

  it('prunes old entries but never an active transfer', async () => {
    let now = 40 * 24 * 60 * 60 * 1_000;
    const store = new HistoryStore(new MemoryStore(), { retentionDays: 30, now: () => now });
    await store.save(record({ id: 'old', updatedAt: 1_000, completedAt: 1_000 }));
    await store.save(record({ id: 'recent', updatedAt: now - 1_000, completedAt: now - 1_000 }));
    await store.save(
      record({ id: 'running', updatedAt: 1_000, completedAt: undefined, state: 'transferring' }),
    );

    const removed = await store.prune();
    expect(removed).toEqual(['old']);
    expect((await store.list()).map((r) => r.id).sort()).toEqual(['recent', 'running']);
  });

  it('deletes a single entry and can clear everything', async () => {
    const store = new HistoryStore(new MemoryStore());
    await store.save(record({ id: 'a' }));
    await store.save(record({ id: 'b' }));

    expect(await store.remove('a')).toBe(true);
    expect(await store.remove('a')).toBe(false);
    expect(await store.clear()).toBe(1);
    expect(await store.list()).toEqual([]);
  });

  it('exports the user data as JSON, with its own version', async () => {
    const store = new HistoryStore(new MemoryStore(), { now: () => 12_345 });
    await store.save(record());
    const parsed = JSON.parse(await store.exportJson()) as { v: number; exportedAt: number; transfers: unknown[] };
    expect(parsed.v).toBe(1);
    expect(parsed.exportedAt).toBe(12_345);
    expect(parsed.transfers).toHaveLength(1);
  });
});
