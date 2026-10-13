import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@dropforge/app-core';
import type { PeerInfo } from '@dropforge/security';
import { DeviceManager } from './devices.js';
import { DiscoveryCache, methodsFor, parseAnnouncement } from './discovery.js';
import { MemoryStore } from '../../../tests/helpers/memory-store.js';

const peer = (overrides: Partial<PeerInfo> = {}): PeerInfo => ({
  deviceId: 'device-alice-0001',
  displayName: 'Alice PC',
  platform: 'windows',
  sign: 'ed25519',
  agree: 'x25519',
  publicKey: 'AAAA',
  fingerprint: 'a'.repeat(64),
  ...overrides,
});

describe('DeviceManager', () => {
  it('remembers a first contact as untrusted, never as approved', async () => {
    const store = new MemoryStore();
    const devices = new DeviceManager(store, () => 1000);
    const result = await devices.remember(peer());

    expect(result.isNew).toBe(true);
    expect(result.record.trusted).toBe(false);
    expect(result.record.autoAccept).toBe(false);
    expect(await devices.isTrusted(peer().deviceId)).toBe(false);
    expect(await devices.canAutoAccept(peer().deviceId)).toBe(false);
  });

  it('marks a favourite without granting any trust', async () => {
    const store = new MemoryStore();
    const devices = new DeviceManager(store, () => 1000);
    await devices.remember(peer());
    const updated = await devices.setFavorite(peer().deviceId, true);

    expect(updated.favorite).toBe(true);
    // A favourite is a convenience flag: it is neither approved nor auto-accepted.
    expect(updated.trusted).toBe(false);
    expect(await devices.isTrusted(peer().deviceId)).toBe(false);
    expect(await devices.canAutoAccept(peer().deviceId)).toBe(false);
    // And it survives a re-read: it is stored, not kept in memory.
    expect((await devices.get(peer().deviceId))?.favorite).toBe(true);
  });

  it('keeps favourites first, then the most recently seen', async () => {
    const store = new MemoryStore();
    let now = 1000;
    const devices = new DeviceManager(store, () => now);
    await devices.remember(peer({ deviceId: 'device-alice-0001', displayName: 'Alice' }));
    now = 2000;
    await devices.remember(peer({ deviceId: 'device-bob-0002', displayName: 'Bob', fingerprint: 'b'.repeat(64) }));
    now = 3000;
    await devices.remember(
      peer({ deviceId: 'device-carol-0003', displayName: 'Carol', fingerprint: 'c'.repeat(64) }),
    );
    await devices.setFavorite('device-alice-0001', true);

    expect((await devices.list()).map((record) => record.displayName)).toEqual(['Alice', 'Carol', 'Bob']);
    await devices.setFavorite('device-alice-0001', false);
    expect((await devices.list()).map((record) => record.displayName)).toEqual(['Carol', 'Bob', 'Alice']);
  });

  it('refuses to favourite a device it does not know', async () => {
    const store = new MemoryStore();
    const devices = new DeviceManager(store);
    await expect(devices.setFavorite('device-inconnu-01', true)).rejects.toThrow(/not known on this installation/);
  });

  it('keeps the first-seen date when a known device comes back', async () => {
    const store = new MemoryStore();
    let now = 1000;
    const devices = new DeviceManager(store, () => now);
    await devices.remember(peer());
    now = 5000;
    const second = await devices.remember(peer({ displayName: 'Alice renamed' }));

    expect(second.isNew).toBe(false);
    expect(second.record.firstSeenAt).toBe(1000);
    expect(second.record.lastSeenAt).toBe(5000);
    expect(second.record.displayName).toBe('Alice renamed');
  });

  it('refuses a device id that suddenly presents another key', async () => {
    const store = new MemoryStore();
    const devices = new DeviceManager(store);
    await devices.remember(peer());

    await expect(devices.remember(peer({ fingerprint: 'b'.repeat(64) }))).rejects.toMatchObject({
      code: ERROR_CODES.DEVICE_IDENTITY_MISMATCH,
    });
    await expect(devices.verify(peer({ fingerprint: 'b'.repeat(64) }))).rejects.toMatchObject({
      code: ERROR_CODES.DEVICE_IDENTITY_MISMATCH,
    });
  });

  it('trusts, revokes and requires a new approval after a revocation', async () => {
    const store = new MemoryStore();
    let now = 10;
    const devices = new DeviceManager(store, () => now);
    await devices.remember(peer());
    await devices.trust(peer().deviceId, { autoAccept: true });
    expect(await devices.canAutoAccept(peer().deviceId)).toBe(true);
    expect(await devices.verify(peer())).toBe('trusted');

    now = 20;
    const revoked = await devices.revoke(peer().deviceId);
    expect(revoked.revokedAt).toBe(20);
    expect(await devices.isTrusted(peer().deviceId)).toBe(false);
    expect(await devices.verify(peer())).toBe('revoked');

    // A revoked device must not be silently re-trusted by simply reconnecting.
    const seenAgain = await devices.remember(peer(), { trusted: true });
    expect(seenAgain.wasRevoked).toBe(true);
    expect(seenAgain.record.trusted).toBe(false);
    expect(seenAgain.record.revokedAt).toBe(20);

    // …only an explicit action by the user does it, and it clears the mark.
    const trusted = await devices.trust(peer().deviceId);
    expect(trusted.trusted).toBe(true);
    expect(trusted.revokedAt).toBeUndefined();
  });

  it('forgets a device completely, leaving nothing pinned', async () => {
    const store = new MemoryStore();
    const devices = new DeviceManager(store);
    await devices.remember(peer(), { trusted: true });
    await devices.forget(peer().deviceId);

    expect(await devices.get(peer().deviceId)).toBeUndefined();
    expect(store.dump()['devices']).toEqual({});
    // A device that comes back after being forgotten is new again, hence untrusted.
    const again = await devices.remember(peer());
    expect(again.isNew).toBe(true);
    expect(again.record.trusted).toBe(false);
  });

  it('lists trusted devices only when they are neither revoked nor expired', async () => {
    const store = new MemoryStore();
    const devices = new DeviceManager(store);
    await devices.remember(peer(), { trusted: true });
    await devices.remember(peer({ deviceId: 'device-bob-0002', displayName: 'Bob phone' }));
    await devices.remember(peer({ deviceId: 'device-eve-0003', displayName: 'Eve' }), { trusted: true });
    await devices.revoke('device-eve-0003');

    const trusted = await devices.trusted();
    expect(trusted.map((record) => record.id)).toEqual(['device-alice-0001']);
  });

  it('rejects a name that cannot be displayed safely', async () => {
    const store = new MemoryStore();
    const devices = new DeviceManager(store);
    await devices.remember(peer());
    await expect(devices.rename(peer().deviceId, '   ')).rejects.toMatchObject({
      code: ERROR_CODES.UNSUPPORTED_OPERATION,
    });
    const renamed = await devices.rename(peer().deviceId, '  Alice’s laptop  ');
    expect(renamed.displayName).toBe('Alice’s laptop');
  });
});

describe('discovery', () => {
  it('accepts a well-formed announcement and normalises it', () => {
    const entry = parseAnnouncement(
      {
        deviceId: 'peer-device-01',
        displayName: ' Bob ',
        platform: 'android',
        fingerprint: 'c'.repeat(64),
        capabilities: ['webrtc.direct', 'relay.blind', 42],
        route: 'room-1',
      },
      { now: 500 },
    );
    expect(entry.displayName).toBe('Bob');
    expect(entry.platform).toBe('android');
    expect(entry.capabilities).toEqual(['webrtc.direct', 'relay.blind']);
    expect(entry.lastSeenAt).toBe(500);
  });

  it('rejects malformed identifiers and our own announcements', () => {
    expect(() => parseAnnouncement({ deviceId: 'short' }, { now: 0 })).toThrow(/identifier is malformed/);
    expect(() =>
      parseAnnouncement({ deviceId: 'peer-device-01' }, { now: 0, ownDeviceId: 'peer-device-01' }),
    ).toThrow(/this very device/);
  });

  it('drops a fingerprint that is not a sha-256 hex string instead of trusting it', () => {
    const entry = parseAnnouncement({ deviceId: 'peer-device-01', fingerprint: 'not-a-fingerprint' }, { now: 0 });
    expect(entry.fingerprint).toBeUndefined();
  });

  it('expires peers that stopped announcing, so the UI never shows a ghost', () => {
    let now = 1_000;
    const cache = new DiscoveryCache({ ttlMs: 5_000, now: () => now });
    cache.upsert(parseAnnouncement({ deviceId: 'peer-device-01', displayName: 'Bob' }, { now }));
    expect(cache.list()).toHaveLength(1);

    now = 4_000;
    cache.upsert(parseAnnouncement({ deviceId: 'peer-device-02', displayName: 'Carol' }, { now }));
    expect(cache.list()).toHaveLength(2);

    now = 6_500;
    // Eight seconds after its last announcement, Bob is gone; Carol is still there.
    const listed = cache.list();
    expect(listed.map((p) => p.deviceId)).toEqual(['peer-device-02']);
  });

  it('keeps the first-seen date across refreshes and caps the cache size', () => {
    const cache = new DiscoveryCache({ ttlMs: 60_000, maxEntries: 2, now: () => 10 });
    cache.upsert(parseAnnouncement({ deviceId: 'peer-device-01' }, { now: 10 }));
    cache.upsert(parseAnnouncement({ deviceId: 'peer-device-01' }, { now: 20 }));
    expect(cache.list()[0]?.firstSeenAt).toBe(10);

    cache.upsert(parseAnnouncement({ deviceId: 'peer-device-02' }, { now: 30 }));
    cache.upsert(parseAnnouncement({ deviceId: 'peer-device-03' }, { now: 40 }));
    expect(cache.size).toBe(2);
    // The oldest entry was dropped to respect the cap.
    expect(cache.list().map((p) => p.deviceId)).toEqual(['peer-device-03', 'peer-device-02']);
  });

  it('only offers methods the peer actually announced', () => {
    const [entry] = [
      parseAnnouncement(
        { deviceId: 'peer-device-01', capabilities: ['webrtc.direct'] },
        { now: 0 },
      ),
    ];
    expect(methodsFor({ ...entry!, source: 'lan', firstSeenAt: 0 }, { samePrivateNetwork: true })).toEqual([
      'lan',
      'webrtc',
    ]);
    expect(methodsFor({ ...entry!, source: 'lan', firstSeenAt: 0 }, { samePrivateNetwork: false })).toEqual(['webrtc']);

    const [relayOnly] = [parseAnnouncement({ deviceId: 'peer-device-02', capabilities: ['relay.blind'] }, { now: 0 })];
    expect(methodsFor({ ...relayOnly!, source: 'signaling', firstSeenAt: 0 }, { samePrivateNetwork: true })).toEqual([
      'relay',
    ]);
  });
});
