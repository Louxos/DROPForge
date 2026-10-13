/**
 * Identity storage on Windows: the private keys live in the same local SQLite
 * database as everything else (per-user, in the application data folder), and are
 * never written anywhere else. The key of this store is that a record which cannot
 * be used is *reported*, never silently replaced — replacing it would break every
 * trusted device.
 */
import { DropForgeError, ERROR_CODES, type MetaStore } from '@dropforge/app-core';
import { hydrateIdentity, type StoredIdentity } from '@dropforge/security';
import type { IdentityStore } from '@dropforge/web';

const COLLECTION = 'settings';
const KEY = 'identity';

export class SqliteIdentityStore implements IdentityStore {
  constructor(private readonly store: MetaStore) {}

  async load(): Promise<StoredIdentity | undefined> {
    const record = await this.store.get<StoredIdentity>(COLLECTION, KEY);
    if (!record) return undefined;
    if (record.v !== 1 || !record.privateKey || !record.publicKeyRef) {
      throw new DropForgeError(
        ERROR_CODES.IDENTITY_UNAVAILABLE,
        'The stored identity is unusable; reset the device identity in the settings',
      );
    }
    // Proves the record actually works before anything relies on it.
    await hydrateIdentity(record);
    return record;
  }

  async save(identity: StoredIdentity): Promise<void> {
    await this.store.put(COLLECTION, KEY, identity);
  }
}
