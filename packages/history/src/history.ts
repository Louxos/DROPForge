/**
 * Transfer history: what really happened, searchable, filterable and deletable.
 *
 * Two honesty rules, both from the spec:
 *  - an entry stores the state the engine actually reached. A transfer that was
 *    partially delivered is stored as `failed`/`interrupted`, never rounded up to
 *    "done", and `completedAt` is only set for a verified transfer;
 *  - the history is local metadata only: file contents are never stored here, and
 *    a file path is kept for the user to find the file again — nothing else.
 */
import { DropForgeError, ERROR_CODES, type MetaStore, type TransferRecord } from '@dropforge/app-core';
import type { TransferState } from '@dropforge/app-core';

export const HISTORY_COLLECTION = 'transfers';

export interface HistoryQuery {
  /** Free text: peer name, device id or file path. */
  query?: string;
  direction?: TransferRecord['direction'];
  states?: TransferState[];
  /** Inclusive lower bound on `updatedAt`. */
  since?: number;
  /** Exclusive upper bound on `updatedAt`. */
  until?: number;
  limit?: number;
  offset?: number;
}

export interface HistoryStats {
  transfers: number;
  bytesSent: number;
  bytesReceived: number;
}

export interface HistoryOptions {
  /** Entries older than this are pruned (undefined keeps everything). */
  retentionDays?: number;
  /** Hard cap; the oldest entries are pruned first. */
  maxEntries?: number;
  now?: () => number;
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_ENTRIES = 1_000;

export class HistoryStore {
  private readonly now: () => number;

  constructor(
    private readonly store: MetaStore,
    private readonly options: HistoryOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
  }

  /** Stores (or replaces) the final record of a transfer. */
  async save(record: TransferRecord): Promise<void> {
    if (record.state === 'completed' && record.completedAt === undefined) {
      throw new DropForgeError(
        ERROR_CODES.INTEGRITY_FAILED,
        'A completed transfer must carry the moment its verification succeeded',
        { context: { transferId: record.id } },
      );
    }
    await this.store.put(HISTORY_COLLECTION, record.id, record);
  }

  async get(id: string): Promise<TransferRecord | undefined> {
    return this.store.get<TransferRecord>(HISTORY_COLLECTION, id);
  }

  async list(query: HistoryQuery = {}): Promise<TransferRecord[]> {
    const all = await this.all();
    const needle = query.query?.trim().toLowerCase();
    const filtered = all.filter((record) => {
      if (query.direction && record.direction !== query.direction) return false;
      if (query.states && !query.states.includes(record.state)) return false;
      if (query.since !== undefined && record.updatedAt < query.since) return false;
      if (query.until !== undefined && record.updatedAt >= query.until) return false;
      if (!needle) return true;
      if (record.peerName.toLowerCase().includes(needle)) return true;
      if (record.peerDeviceId.toLowerCase().includes(needle)) return true;
      return record.files.some((file) => file.path.toLowerCase().includes(needle));
    });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? filtered.length;
    return filtered.slice(offset, offset + limit);
  }

  async remove(id: string): Promise<boolean> {
    if (!(await this.get(id))) return false;
    await this.store.delete(HISTORY_COLLECTION, id);
    return true;
  }

  /** Deletes everything. Returns how many entries were removed. */
  async clear(): Promise<number> {
    const count = (await this.all()).length;
    await this.store.deleteCollection(HISTORY_COLLECTION);
    return count;
  }

  async stats(): Promise<HistoryStats> {
    const all = await this.all();
    let bytesSent = 0;
    let bytesReceived = 0;
    for (const record of all) {
      // Only bytes really delivered are counted, using the engine's own figure.
      const delivered = Math.min(record.bytesDone, record.totalBytes);
      if (record.direction === 'send') bytesSent += delivered;
      else bytesReceived += delivered;
    }
    return { transfers: all.length, bytesSent, bytesReceived };
  }

  /**
   * Applies the retention policy. Returns the ids that were pruned, so the caller
   * can tell the user what was removed instead of deleting silently.
   */
  async prune(): Promise<string[]> {
    const all = await this.all();
    const removed: string[] = [];
    const cutoff = this.options.retentionDays ? this.now() - this.options.retentionDays * DAY_MS : undefined;
    const maxEntries = this.options.maxEntries ?? DEFAULT_MAX_ENTRIES;

    const kept: TransferRecord[] = [];
    for (const record of all) {
      const tooOld = cutoff !== undefined && record.updatedAt < cutoff;
      // A running transfer is never pruned by age: it is not history yet.
      const active = record.state === 'queued' || record.state === 'connecting' || record.state === 'transferring' || record.state === 'verifying' || record.state === 'paused';
      if (tooOld && !active) removed.push(record.id);
      else kept.push(record);
    }
    if (kept.length > maxEntries) {
      for (const record of kept.splice(maxEntries)) {
        if (record.state === 'queued' || record.state === 'transferring' || record.state === 'verifying') {
          kept.push(record);
          continue;
        }
        removed.push(record.id);
      }
    }
    for (const id of removed) await this.store.delete(HISTORY_COLLECTION, id);
    if (removed.length > 0) {
      const keep: Array<{ key: string; value: unknown }> = kept.map((record) => ({ key: record.id, value: record }));
      // Rewrite in one shot so the store is never half-pruned after a crash.
      await this.store.deleteCollection(HISTORY_COLLECTION);
      await this.store.putMany(HISTORY_COLLECTION, keep);
    }
    return removed;
  }

  /** Exports everything as JSON (the user owns their data and can take it away). */
  async exportJson(): Promise<string> {
    return JSON.stringify({ v: 1, exportedAt: this.now(), transfers: await this.all() }, null, 2);
  }

  private async all(): Promise<TransferRecord[]> {
    const records = await this.store.list<TransferRecord>(HISTORY_COLLECTION);
    return records.map((entry) => entry.value).sort((a, b) => b.updatedAt - a.updatedAt);
  }
}
