/**
 * The local database, exercised against a real IndexedDB implementation
 * (`fake-indexeddb`), which is what makes the migration test meaningful: a database
 * created by version 1 of DropForge must open in version 2 with its data intact.
 */
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@dropforge/app-core';
import { DEVICE_COLLECTION } from '@dropforge/device-manager';
import { HISTORY_COLLECTION } from '@dropforge/history';
import { SETTINGS_COLLECTION } from '@dropforge/settings';
import { IDENTITY_COLLECTION } from './identity-store.js';
import { IndexedDbMetaStore } from './indexed-db-store.js';

const realIndexedDb = globalThis.indexedDB;

beforeEach(() => {
  // A fresh database per test: no test may depend on another one's leftovers.
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

afterEach(() => {
  (globalThis as { indexedDB: unknown }).indexedDB = realIndexedDb;
});

describe('IndexedDbMetaStore', () => {
  it('stores and reads a record by collection and key', async () => {
    const store = new IndexedDbMetaStore();
    await store.init();
    expect(store.schemaVersion).toBe(3);

    await store.put('settings', 'preferences', { v: 2, theme: 'dark' });
    expect(await store.get('settings', 'preferences')).toEqual({ v: 2, theme: 'dark' });
    expect(await store.get('settings', 'inconnu')).toBeUndefined();
    await store.close();
  });

  it('writes a batch in one transaction, so a crash cannot show half of it', async () => {
    const store = new IndexedDbMetaStore();
    await store.init();
    await store.putMany('transfers', [
      { key: 'a', value: { v: 1, id: 'a' } },
      { key: 'b', value: { v: 1, id: 'b' } },
    ]);
    const listed = await store.list<{ id: string }>('transfers');
    expect(listed.map((record) => record.key).sort()).toEqual(['a', 'b']);
    await store.close();
  });

  it('lists with a prefix and a limit', async () => {
    const store = new IndexedDbMetaStore();
    await store.init();
    await store.putMany('resume', [
      { key: 'r1', value: { n: 1 } },
      { key: 'r2', value: { n: 2 } },
      { key: 'x1', value: { n: 3 } },
    ]);
    expect((await store.list('resume', { prefix: 'r' })).map((record) => record.key)).toEqual(['r1', 'r2']);
    expect((await store.list('resume', { limit: 1 })).length).toBe(1);
    await store.close();
  });

  it('toutes les collections que l’application utilise existent dans le schéma', async () => {
    // Le défaut que ce test empêche : l'identité de l'appareil vit dans la collection
    // « identity », qui n'était pas créée par le schéma. Chaque écriture échouait donc
    // dans un vrai navigateur — l'application ne démarrait pas — alors que toute la
    // suite était verte, parce qu'elle remplace le magasin par un objet en mémoire.
    const store = new IndexedDbMetaStore();
    await store.init();

    // Les noms viennent des paquets qui les utilisent, jamais d'une copie ici.
    const used = [IDENTITY_COLLECTION, SETTINGS_COLLECTION, DEVICE_COLLECTION, HISTORY_COLLECTION, 'resume', 'shares'];
    for (const collection of used) {
      await store.put(collection, 'clé', { collection });
      expect(await store.get(collection, 'clé')).toEqual({ collection });
    }

    // Et les dossiers mémorisés, qui ont leur propre magasin.
    await store.putHandle('receive-folder', { kind: 'directory', name: 'Reçus' });
    expect(await store.getHandle('receive-folder')).toEqual({ kind: 'directory', name: 'Reçus' });
    await store.close();
  });

  it('deletes one record, or everything in a collection', async () => {
    const store = new IndexedDbMetaStore();
    await store.init();
    await store.put('devices', 'd1', { id: 'd1' });
    await store.put('devices', 'd2', { id: 'd2' });
    await store.delete('devices', 'd1');
    expect(await store.get('devices', 'd1')).toBeUndefined();
    await store.deleteCollection('devices');
    expect(await store.list('devices')).toEqual([]);
    await store.close();
  });

  it('remembers a filesystem handle and can forget it again', async () => {
    const store = new IndexedDbMetaStore();
    await store.init();
    // A fake handle: anything structured-cloneable behaves like a directory handle
    // for the storage layer.
    const handle = { kind: 'directory', name: 'Reçus' };
    await store.putHandle('receive-folder', handle);
    expect(await store.getHandle('receive-folder')).toEqual(handle);
    await store.deleteHandle('receive-folder');
    expect(await store.getHandle('receive-folder')).toBeUndefined();
    await store.close();
  });

  it('reports a stable error code when the database cannot be opened', async () => {
    (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
    const store = new IndexedDbMetaStore();
    await expect(store.init()).rejects.toMatchObject({ code: ERROR_CODES.STORAGE_UNAVAILABLE });
  });

  it('reports a stable error code for an unknown collection', async () => {
    const store = new IndexedDbMetaStore();
    await store.init();
    await expect(store.put('inconnue', 'k', {})).rejects.toMatchObject({ code: ERROR_CODES.STORAGE_UNAVAILABLE });
    await store.close();
  });
});

/* ------------------------------------------------------------------ *
 * Migration
 * ------------------------------------------------------------------ */

describe('IndexedDbMetaStore migration', () => {
  /** Creates a version-1 database, the way the first release of the app did. */
  async function createVersionOneDatabase(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('dropforge', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const collection of ['settings', 'devices', 'transfers', 'resume', 'shares']) {
          db.createObjectStore(collection);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('transfers', 'readwrite');
        transaction.objectStore('transfers').put({ v: 1, id: 'ancien', state: 'completed' }, 'ancien');
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });
  }

  it('adds the new store without losing what version 1 had written', async () => {
    await createVersionOneDatabase();

    const store = new IndexedDbMetaStore();
    await store.init();
    expect(store.schemaVersion).toBe(3);

    // The history written by the older version is still there…
    expect(await store.get('transfers', 'ancien')).toEqual({ v: 1, id: 'ancien', state: 'completed' });
    // …and the new capability works on the migrated database.
    await store.putHandle('receive-folder', { kind: 'directory', name: 'Reçus' });
    expect(await store.getHandle('receive-folder')).toEqual({ kind: 'directory', name: 'Reçus' });
    await store.close();
  });

  it('is idempotent: opening twice changes nothing', async () => {
    const first = new IndexedDbMetaStore();
    await first.init();
    await first.put('settings', 'preferences', { v: 2, theme: 'light' });
    await first.close();

    const second = new IndexedDbMetaStore();
    await second.init();
    expect(await second.get('settings', 'preferences')).toEqual({ v: 2, theme: 'light' });
    await second.close();
  });
});
