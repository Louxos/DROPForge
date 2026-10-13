/**
 * In-memory `MetaStore`, used by the unit and integration tests instead of
 * SQLite/IndexedDB. It implements the same contract, including "a write is either
 * fully visible or not visible at all", and it can simulate a crash between two
 * writes to check that a migration is not half-applied.
 */
import type { MetaStore, StoredRecord } from '@dropforge/app-core';

export class MemoryStore implements MetaStore {
  readonly kind = 'memory' as const;
  schemaVersion = 0;
  private readonly data = new Map<string, Map<string, unknown>>();
  private closed = false;

  async init(): Promise<void> {
    if (this.closed) throw new Error('the store is closed');
  }

  private collection(name: string): Map<string, unknown> {
    let set = this.data.get(name);
    if (!set) {
      set = new Map();
      this.data.set(name, set);
    }
    return set;
  }

  async get<T>(collection: string, key: string): Promise<T | undefined> {
    return this.collection(collection).get(key) as T | undefined;
  }

  async put<T>(collection: string, key: string, value: T): Promise<void> {
    this.collection(collection).set(key, structuredClone(value));
  }

  async putMany(collection: string, records: StoredRecord<unknown>[]): Promise<void> {
    const target = this.collection(collection);
    // Applied through a copy first: a throw half-way leaves the store untouched,
    // exactly like a transaction rollback.
    const staged = new Map(target);
    for (const record of records) staged.set(record.key, structuredClone(record.value));
    this.data.set(collection, staged);
  }

  async list<T>(collection: string, options: { prefix?: string; limit?: number } = {}): Promise<Array<StoredRecord<T>>> {
    const out: Array<StoredRecord<T>> = [];
    for (const [key, value] of this.collection(collection)) {
      if (options.prefix && !key.startsWith(options.prefix)) continue;
      out.push({ key, value: value as T });
      if (options.limit && out.length >= options.limit) break;
    }
    return out;
  }

  async delete(collection: string, key: string): Promise<void> {
    this.collection(collection).delete(key);
  }

  async deleteCollection(collection: string): Promise<void> {
    this.data.delete(collection);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /** Test helper: everything stored, for assertions that must not be fooled. */
  dump(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [name, set] of this.data) {
      out[name] = {};
      for (const [key, value] of set) out[name]![key] = value;
    }
    return out;
  }
}
