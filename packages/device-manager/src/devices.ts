/**
 * Device manager: who this installation knows, who it trusts, and how a device
 * gets from "seen once" to "remembered".
 *
 * Rules taken straight from the spec:
 *  - nothing is trusted implicitly. A device that was never approved is stored as
 *    untrusted and every incoming transfer from it still asks the user;
 *  - trust is bound to the *key*, not the name: a record whose fingerprint does not
 *    match the key the peer proves is refused, so renaming cannot impersonate;
 *  - revocation is real: the record is marked, the user sees it in the history, and
 *    the device must be approved again from scratch;
 *  - forgetting removes the record, which also drops the trust — no orphan pins.
 */
import {
  DropForgeError,
  ERROR_CODES,
  type DeviceRecord,
  type MetaStore,
} from '@dropforge/app-core';
import type { PeerInfo } from '@dropforge/security';

export const DEVICE_COLLECTION = 'devices';

export interface UpsertResult {
  record: DeviceRecord;
  /** True when this device was unknown until now. */
  isNew: boolean;
  /** True when the stored record was revoked and had to be reset. */
  wasRevoked: boolean;
}

export class DeviceManager {
  constructor(
    private readonly store: MetaStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async list(): Promise<DeviceRecord[]> {
    const records = await this.store.list<DeviceRecord>(DEVICE_COLLECTION);
    return records
      .map((entry) => entry.value)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.displayName.localeCompare(b.displayName));
  }

  async trusted(): Promise<DeviceRecord[]> {
    return (await this.list()).filter((record) => record.trusted && record.revokedAt === undefined);
  }

  async get(deviceId: string): Promise<DeviceRecord | undefined> {
    return this.store.get<DeviceRecord>(DEVICE_COLLECTION, deviceId);
  }

  /**
   * Records a peer after a successful handshake and returns the stored record.
   *
   * A record already stored under this id but carrying another fingerprint is a
   * hard error: the id belongs to a key, and a different key means a different
   * device (or an attempt to take over a trusted identity).
   *
   * This method never grants trust to a device that was revoked; use `trust()`
   * after an explicit user decision instead.
   */
  async remember(
    peer: PeerInfo,
    options: { trusted?: boolean; autoAccept?: boolean } = {},
  ): Promise<UpsertResult> {
    const existing = await this.get(peer.deviceId);
    if (existing && existing.fingerprint !== peer.fingerprint) {
      throw new DropForgeError(
        ERROR_CODES.DEVICE_IDENTITY_MISMATCH,
        'A device with this identifier already exists but with a different key',
        { context: { deviceId: peer.deviceId } },
      );
    }
    const wasRevoked = existing?.revokedAt !== undefined;
    const timestamp = this.now();
    const record: DeviceRecord = {
      v: 1,
      id: peer.deviceId,
      displayName: peer.displayName,
      platform: peer.platform,
      publicKey: peer.publicKey,
      fingerprint: peer.fingerprint,
      sign: peer.sign,
      agree: peer.agree,
      trusted: options.trusted ?? existing?.trusted ?? false,
      autoAccept: options.autoAccept ?? existing?.autoAccept ?? false,
      firstSeenAt: existing?.firstSeenAt ?? timestamp,
      lastSeenAt: timestamp,
    };
    if (wasRevoked) {
      // A revoked device stays revoked, whatever the caller asks for: reconnecting
      // never restores trust, only an explicit `trust()` after a fresh user
      // decision does. This is the whole point of revocation.
      record.trusted = false;
      record.autoAccept = false;
      record.revokedAt = existing?.revokedAt;
    }
    await this.store.put(DEVICE_COLLECTION, record.id, record);
    return { record, isNew: existing === undefined, wasRevoked };
  }

  /** Marks a device as trusted (the user just said yes, on purpose). */
  async trust(deviceId: string, options: { autoAccept?: boolean } = {}): Promise<DeviceRecord> {
    const record = await this.require(deviceId);
    const updated: DeviceRecord = {
      ...record,
      trusted: true,
      autoAccept: options.autoAccept ?? record.autoAccept,
    };
    delete updated.revokedAt;
    updated.lastSeenAt = this.now();
    await this.store.put(DEVICE_COLLECTION, deviceId, updated);
    return updated;
  }

  /** Revokes trust: the device keeps working only after a new explicit approval. */
  async revoke(deviceId: string): Promise<DeviceRecord> {
    const record = await this.require(deviceId);
    const updated: DeviceRecord = { ...record, trusted: false, autoAccept: false, revokedAt: this.now() };
    await this.store.put(DEVICE_COLLECTION, deviceId, updated);
    return updated;
  }

  /** Removes the record entirely (device forgotten, nothing left to pin). */
  async forget(deviceId: string): Promise<void> {
    await this.require(deviceId);
    await this.store.delete(DEVICE_COLLECTION, deviceId);
  }

  async rename(deviceId: string, displayName: string): Promise<DeviceRecord> {
    const trimmed = displayName.trim();
    if (trimmed.length === 0 || trimmed.length > 64) {
      throw new DropForgeError(ERROR_CODES.UNSUPPORTED_OPERATION, 'A device name must be 1 to 64 characters long');
    }
    const record = await this.require(deviceId);
    const updated: DeviceRecord = { ...record, displayName: trimmed };
    await this.store.put(DEVICE_COLLECTION, deviceId, updated);
    return updated;
  }

  /** Whether a brand-new transfer from this peer may start without asking again. */
  async canAutoAccept(deviceId: string): Promise<boolean> {
    const record = await this.get(deviceId);
    return record !== undefined && record.trusted && record.autoAccept && record.revokedAt === undefined;
  }

  async isTrusted(deviceId: string): Promise<boolean> {
    const record = await this.get(deviceId);
    return record !== undefined && record.trusted && record.revokedAt === undefined;
  }

  /**
   * Checks an authenticated peer against the stored pin. Called before anything is
   * accepted: the peer already proved its key, and this proves it is the device the
   * user approved, not another one claiming the same name.
   */
  async verify(peer: PeerInfo): Promise<'unknown' | 'trusted' | 'untrusted' | 'revoked'> {
    const record = await this.get(peer.deviceId);
    if (!record) return 'unknown';
    if (record.fingerprint !== peer.fingerprint) {
      throw new DropForgeError(
        ERROR_CODES.DEVICE_IDENTITY_MISMATCH,
        'This device is not the one that was approved',
        { context: { deviceId: peer.deviceId } },
      );
    }
    if (record.revokedAt !== undefined) return 'revoked';
    return record.trusted ? 'trusted' : 'untrusted';
  }

  private async require(deviceId: string): Promise<DeviceRecord> {
    const record = await this.get(deviceId);
    if (!record) {
      throw new DropForgeError(ERROR_CODES.LINK_NOT_FOUND, 'This device is not known on this installation', {
        context: { deviceId },
      });
    }
    return record;
  }
}
