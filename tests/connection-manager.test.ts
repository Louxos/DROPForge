/**
 * Connection manager: from method selection to a live session, then a real
 * transfer on top of it.
 *
 * The handshake is the real one (WebCrypto, real signatures, real SAS); the
 * transport is in-memory. Nothing about the identity checks is stubbed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DropForgeError, ERROR_CODES } from '@dropforge/app-core';
import {
  ConnectionManager,
  selectTransportMethod,
  type Connection,
  type ConnectionEvent,
  type ConnectionFactory,
  type ConnectionTarget,
  type TransportMethod,
} from '@dropforge/connection-manager';
import {
  createDeviceIdentity,
  exportPublicKey,
  fingerprintOf,
  formatSasCode,
  signBytes,
  type StoredIdentity,
} from '@dropforge/security';
import { systemClock, type Transport } from '@dropforge/protocol';
import { MemoryTransport } from './helpers/memory-transport.js';
import { MemoryFileSystem, MemorySource } from './helpers/memory-fs.js';
import { plan, rigFromSessions, runTransfer } from './helpers/transfer-rig.js';
import { TEST_CAPABILITIES, testLogger } from './helpers/loopback.js';

interface Harness {
  alice: ConnectionManager;
  bob: ConnectionManager;
  bobId: string;
  bobFingerprint: string;
  connect: (target: ConnectionTarget) => Promise<Connection>;
  /** Resolves when the receiving side accepted the connection. */
  accepted: () => Promise<Connection>;
  events: ConnectionEvent[];
  close: () => Promise<void>;
}

const closers: Array<() => Promise<void>> = [];

/** Fingerprint of the public key an identity will actually prove possession of. */
async function fingerprintOfIdentity(identity: StoredIdentity): Promise<string> {
  return fingerprintOf(await exportPublicKey(identity.publicKeyRef));
}

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function harness(options: { refuse?: TransportMethod[]; expectAlice?: boolean } = {}): Promise<Harness> {
  const logger = testLogger();
  const aliceIdentity = await createDeviceIdentity();
  const bobIdentity = await createDeviceIdentity();
  const aliceId = crypto.randomUUID();
  const bobId = crypto.randomUUID();
  const bobFingerprint = await fingerprintOfIdentity(bobIdentity);
  const aliceFingerprint = await fingerprintOfIdentity(aliceIdentity);

  const events: ConnectionEvent[] = [];
  let pendingAccept: Promise<Connection> | undefined;

  let bob!: ConnectionManager;
  const factory: ConnectionFactory = {
    async create(method): Promise<Transport> {
      if (options.refuse?.includes(method)) {
        throw new DropForgeError(ERROR_CODES.RELAY_UNAVAILABLE, 'This path is not usable for this test');
      }
      const [alice, bobSide] = MemoryTransport.pair();
      // The receiving side handles its end of the same connection and — exactly
      // like the real app — checks that the caller is the device it expects.
      const expectations =
        options.expectAlice === false
          ? { deviceId: crypto.randomUUID() }
          : { deviceId: aliceId, fingerprint: aliceFingerprint };
      pendingAccept = bob.accept(bobSide, expectations, { requestTrust: false });
      // The storing side of the connection is also the side that may *refuse*: this
      // promise rejects on purpose in the "not the expected device" test. The test
      // attaches its own handler a few microtasks later (it first lets Alice dial in),
      // and Node reports a rejection that has no handler *yet* as an unhandled
      // rejection — which turns the whole run red, on a schedule that depends on
      // timing. This branch only keeps the rejection observed; the original promise
      // still rejects for whoever awaits it.
      pendingAccept.catch(() => undefined);
      return alice;
    },
  };

  const alice = new ConnectionManager({
    identity: aliceIdentity,
    deviceId: aliceId,
    displayName: 'Alice PC',
    platform: 'windows',
    capabilities: TEST_CAPABILITIES,
    factory,
    clock: systemClock,
    logger,
  });
  bob = new ConnectionManager({
    identity: bobIdentity,
    deviceId: bobId,
    displayName: 'Bob phone',
    platform: 'android',
    capabilities: TEST_CAPABILITIES,
    factory: { create: async () => { throw new Error('Bob never dials in this test'); } },
    clock: systemClock,
    logger,
  });
  alice.onEvent((event) => events.push(event));

  closers.push(async () => {
    await alice.close('test finished');
    await bob.close('test finished');
  });

  return {
    alice,
    bob,
    bobId,
    bobFingerprint,
    events,
    connect: (target) => alice.connect(target),
    accepted: async () => {
      if (!pendingAccept) throw new Error('no inbound connection was started');
      return pendingAccept;
    },
    close: async () => {
      await alice.close('test finished');
      await bob.close('test finished');
    },
  };
}

describe('ConnectionManager', () => {
  it('connects two devices over a local transport and reports the real path', async () => {
    const h = await harness();
    const target: ConnectionTarget = {
      deviceId: h.bobId,
      displayName: 'Bob phone',
      methods: ['lan'],
    };

    const connection = await h.connect(target);
    const inbound = await h.accepted();

    expect(connection.method).toBe('lan');
    expect(connection.peer.deviceId).toBe(h.bobId);
    expect(connection.peer.displayName).toBe('Bob phone');
    // Both sides computed the same short authentication string: the users can
    // compare it, and a man-in-the-middle would make them differ.
    expect(connection.sas).toBe(inbound.sas);
    // Six digits, shown to the user as "123 456" so the two screens are easy to compare.
    expect(connection.sas).toMatch(/^\d{6}$/);
    expect(formatSasCode(connection.sas)).toMatch(/^\d{3} \d{3}$/);
    expect(h.alice.state).toBe('connected');

    const types = h.events.map((event) => event.type);
    expect(types).toEqual(['attempt', 'handshaking', 'connected']);
  });

  it('tries the next method when the preferred path is refused', async () => {
    const h = await harness({ refuse: ['lan'] });
    const choice = selectTransportMethod({
      samePrivateNetwork: true,
      webRtcSupported: true,
      stunReachable: true,
      relayReachable: true,
      localCapabilities: TEST_CAPABILITIES,
      peerCapabilities: TEST_CAPABILITIES,
    });
    expect(choice.method).toBe('lan');

    const connection = await h.connect({
      deviceId: h.bobId,
      displayName: 'Bob phone',
      methods: ['lan', 'webrtc'],
    });
    await h.accepted();

    expect(connection.method).toBe('webrtc');
    const failed = h.events.find((event) => event.type === 'attempt-failed');
    expect(failed && failed.type === 'attempt-failed' ? failed.code : undefined).toBe(ERROR_CODES.RELAY_UNAVAILABLE);
  });

  it('refuses a peer whose key does not match the announced fingerprint', async () => {
    const h = await harness();
    const impostor = await createDeviceIdentity();
    const impostorFingerprint = await fingerprintOfIdentity(impostor);
    // A device that announced one key and now proves another is exactly the
    // spoofing attempt the QR/identity pinning has to stop.
    expect(impostorFingerprint).not.toBe(h.bobFingerprint);

    const error = await h
      .connect({
        deviceId: h.bobId,
        displayName: 'Bob phone',
        fingerprint: impostorFingerprint,
        methods: ['lan'],
      })
      .then(
        () => undefined,
        (thrown: unknown) => thrown as DropForgeError,
      );
    expect(error?.code).toBe(ERROR_CODES.DEVICE_IDENTITY_MISMATCH);
    expect(error?.message).toContain('not the one that was announced');
    // A spoofed identity stops the whole connection: no second path is tried.
    expect(h.events.filter((event) => event.type === 'attempt')).toHaveLength(1);

    const failed = h.events.at(-1);
    expect(failed?.type).toBe('failed');
    if (failed?.type === 'failed') {
      expect(failed.failures[0]?.code).toBe(ERROR_CODES.DEVICE_IDENTITY_MISMATCH);
    }
  });

  it('refuses an inbound peer that is not the expected device', async () => {
    // Bob expects Alice, but a different installation dials in.
    const h = await harness({ expectAlice: false });
    const aliceConnection = await h.alice.connect({
      deviceId: h.bobId,
      displayName: 'Bob phone',
      methods: ['lan'],
    });
    // Bob refuses: the identity he was given does not match the key that proved
    // possession of the connection, so no session is ever created on his side.
    const refused = await h.accepted().then(
      () => undefined,
      (error: unknown) => (error as DropForgeError).code,
    );

    expect(refused).toBe(ERROR_CODES.DEVICE_IDENTITY_MISMATCH);
    expect(h.bob.state).toBe('idle');
    // Alice's side is not left silently "connected" either: the transport the
    // receiver closed is really closed.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(['closing', 'closed', 'failed']).toContain(aliceConnection.transport.state);
  });

  it('reports every failed path instead of pretending it connected', async () => {
    const h = await harness({ refuse: ['lan', 'webrtc'] });
    const error = await h.connect({
      deviceId: h.bobId,
      displayName: 'Bob phone',
      methods: ['lan', 'webrtc'],
    }).then(
      () => undefined,
      (thrown: unknown) => thrown as DropForgeError,
    );

    expect(error?.code).toBe(ERROR_CODES.PEER_UNREACHABLE);
    expect(error?.context.attempts).toBe(2);
    // The paths that were tried travel with the error: an interface that only says
    // "unreachable" has thrown away the one thing that explains the failure.
    expect(String(error?.context.path)).toContain('lan:');
    expect(String(error?.context.path)).toContain('webrtc:');
    const failed = h.events.at(-1);
    expect(failed?.type).toBe('failed');
    if (failed?.type === 'failed') {
      expect(failed.failures.map((f) => f.method)).toEqual(['lan', 'webrtc']);
    }
    expect(h.alice.state).toBe('idle');
  });

  it('carries a real transfer over a connection it established', async () => {
    const h = await harness();
    const connection = await h.connect({ deviceId: h.bobId, displayName: 'Bob phone', methods: ['lan'] });
    const inbound = await h.accepted();

    const payload = new Uint8Array(200 * 1024);
    for (let i = 0; i < payload.length; i += 1) payload[i] = (i * 7) % 251;
    const store = new MemoryFileSystem();
    const rig = rigFromSessions({ aliceSession: connection.session, bobSession: inbound.session, store });
    plan(rig, [new MemorySource('holiday.jpg', payload)], 64 * 1024);

    const result = await runTransfer(rig);
    expect(result.sender.outcome).toBe('completed');
    expect(result.receiver.outcome).toBe('completed');
    expect(store.content('holiday.jpg')?.length).toBe(payload.length);
    expect(store.content('holiday.jpg')).toEqual(payload);
  });

  it('does not let a signing key be reused as a device fingerprint', async () => {
    // Sanity check that the fingerprint really comes from the public key: signing
    // something never yields the fingerprint, so pinning it actually means something.
    const identity = await createDeviceIdentity();
    const fingerprint = await fingerprintOfIdentity(identity);
    const signature = await signBytes(identity, new TextEncoder().encode('challenge'));
    const signatureHex = [...signature].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(fingerprint).not.toBe(signatureHex);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});
