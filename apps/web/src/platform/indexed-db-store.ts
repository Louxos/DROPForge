/**
 * `MetaStore` on IndexedDB: devices, history, settings and resume checkpoints.
 *
 * File bytes never go through here (they stay in the filesystem, or in the
 * browser's download/File System Access path), and every write is a single
 * transaction, so a crash cannot leave a half-written record visible.
 */
import { DropForgeError, ERROR_CODES, type MetaStore, type StoredRecord } from '@dropforge/app-core';

const DB_NAME = 'dropforge';
/**
 * Schema version. Version 2 added the `handles` store (a remembered receiving
 * folder). The upgrade is additive and idempotent: an existing database is only
 * given the stores it is missing, so no user data is ever rewritten or dropped.
 */
const DB_VERSION = 2;
const COLLECTIONS = ['settings', 'devices', 'transfers', 'resume', 'shares'] as const;
const HANDLE_STORE = 'handles';

export class IndexedDbMetaStore implements MetaStore {
  readonly kind = 'indexeddb' as const;
  schemaVersion = 0;
  private db: IDBDatabase | undefined;

  async init(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      throw new DropForgeError(ERROR_CODES.STORAGE_UNAVAILABLE, 'This browser does not provide local storage');
    }
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        // One object store per collection family, keyed by the record key.
        for (const collection of [...COLLECTIONS, HANDLE_STORE]) {
          if (!db.objectStoreNames.contains(collection)) db.createObjectStore(collection);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          new DropForgeError(ERROR_CODES.STORAGE_UNAVAILABLE, 'The local database could not be opened', {
            cause: request.error,
          }),
        );
    });
    this.schemaVersion = DB_VERSION;
  }

  async get<T>(collection: string, key: string): Promise<T | undefined> {
    const store = await this.store(collection, 'readonly');
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(this.fail(request.error));
    });
  }

  async put<T>(collection: string, key: string, value: T): Promise<void> {
    const store = await this.store(collection, 'readwrite');
    await new Promise<void>((resolve, reject) => {
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(this.fail(request.error));
    });
  }

  async putMany(collection: string, records: StoredRecord<unknown>[]): Promise<void> {
    // A single transaction: either every record is written or none is.
    const db = await this.database();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(collection, 'readwrite');
      const store = transaction.objectStore(collection);
      for (const record of records) store.put(record.value, record.key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(this.fail(transaction.error));
      transaction.onabort = () => reject(this.fail(transaction.error));
    });
  }

  async list<T>(collection: string, options: { prefix?: string; limit?: number } = {}): Promise<Array<StoredRecord<T>>> {
    const store = await this.store(collection, 'readonly');
    return await new Promise<Array<StoredRecord<T>>>((resolve, reject) => {
      const out: Array<StoredRecord<T>> = [];
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        const key = String(cursor.key);
        if (!options.prefix || key.startsWith(options.prefix)) {
          out.push({ key, value: cursor.value as T });
          if (options.limit && out.length >= options.limit) {
            resolve(out);
            return;
          }
        }
        cursor.continue();
      };
      request.onerror = () => reject(this.fail(request.error));
    });
  }

  async delete(collection: string, key: string): Promise<void> {
    const store = await this.store(collection, 'readwrite');
    await new Promise<void>((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(this.fail(request.error));
    });
  }

  async deleteCollection(collection: string): Promise<void> {
    const store = await this.store(collection, 'readwrite');
    await new Promise<void>((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(this.fail(request.error));
    });
  }

  /* ------------------------------------------------------------------ *
   * Remembered filesystem handles
   *
   * A directory handle can be stored in IndexedDB (it is structured-cloneable),
   * which is how a browser can offer to reuse a receiving folder next time. The
   * permission still has to be granted again by the user for each new session:
   * the browser decides that, and this code never assumes it was granted.
   * ------------------------------------------------------------------ */

  async putHandle(key: string, handle: unknown): Promise<void> {
    const store = await this.store(HANDLE_STORE, 'readwrite');
    await new Promise<void>((resolve, reject) => {
      const request = store.put(handle, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(this.fail(request.error));
    });
  }

  async getHandle<T>(key: string): Promise<T | undefined> {
    const store = await this.store(HANDLE_STORE, 'readonly');
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(this.fail(request.error));
    });
  }

  async deleteHandle(key: string): Promise<void> {
    const store = await this.store(HANDLE_STORE, 'readwrite');
    await new Promise<void>((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(this.fail(request.error));
    });
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = undefined;
  }

  private async database(): Promise<IDBDatabase> {
    if (!this.db) await this.init();
    if (!this.db) throw new DropForgeError(ERROR_CODES.STORAGE_UNAVAILABLE, 'The local database is not available');
    return this.db;
  }

  private async store(collection: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.database();
    if (!db.objectStoreNames.contains(collection)) {
      throw new DropForgeError(ERROR_CODES.STORAGE_UNAVAILABLE, `The local database has no "${collection}" store`);
    }
    return db.transaction(collection, mode).objectStore(collection);
  }

  private fail(cause: unknown): DropForgeError {
    return new DropForgeError(ERROR_CODES.STORAGE_UNAVAILABLE, 'The local database rejected the operation', { cause });
  }
}
