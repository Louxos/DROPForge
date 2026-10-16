/**
 * Where this installation's long-term identity lives.
 *
 * On the web it is IndexedDB: `CryptoKey` handles are structured-cloneable, so the
 * private key never has to leave the browser's crypto implementation in raw form.
 * The record is versioned, so a future change of algorithm can migrate instead of
 * silently generating a new identity (which would look like a new device).
 */
import { DropForgeError, ERROR_CODES, type MetaStore } from '@dropforge/app-core';
import type { StoredIdentity } from '@dropforge/security';

/**
 * The store this device's identity lives in.
 *
 * Exported so the schema test can prove it exists: it did not, and the application
 * could not start in any real browser (see `indexed-db-store.ts`, version 3).
 */
export const IDENTITY_COLLECTION = 'identity';
const COLLECTION = IDENTITY_COLLECTION;
const KEY = 'self';

export class IndexedDbIdentityStore {
  constructor(private readonly store: MetaStore) {}

  async load(): Promise<StoredIdentity | undefined> {
    const record = await this.store.get<StoredIdentity>(COLLECTION, KEY);
    if (!record) return undefined;
    if (record.v !== 1 || !record.privateKey || !record.publicKeyRef) {
      // A record we cannot use is reported, never silently replaced: replacing it
      // would change the device identity and break other devices' trust.
      throw new DropForgeError(
        ERROR_CODES.IDENTITY_UNAVAILABLE,
        'The stored device identity is not usable on this installation',
      );
    }
    return record;
  }

  async save(identity: StoredIdentity): Promise<void> {
    await this.store.put(COLLECTION, KEY, identity);
  }
}
