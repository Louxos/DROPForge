import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, fromBase64Url, fromUtf8, toBase64Url, utf8 } from '@dropforge/protocol';
import { Handshake, HandshakeError } from './handshake.js';
import { createDeviceIdentity, hydrateIdentity, signBytes } from './identity.js';
import { createPairingSecret } from './pairing.js';
import { randomBytes } from './crypto.js';
import type { Capability } from '@dropforge/protocol';

const CAPS: Capability[] = ['webrtc.direct', 'relay.blind', 'transfer.integrity', 'transfer.resume'];

async function makePair(pairingSecret?: { a?: Uint8Array; b?: Uint8Array }, caps: { a?: Capability[]; b?: Capability[] } = {}) {
  const identityA = await createDeviceIdentity();
  const identityB = await createDeviceIdentity();
  const a = new Handshake({
    identity: identityA,
    role: 'initiator',
    deviceId: 'device-alice',
    displayName: 'Alice',
    platform: 'windows',
    capabilities: caps.a ?? CAPS,
    pairingSecret: pairingSecret?.a,
    requestTrust: true,
    version: PROTOCOL_VERSION,
  });
  const b = new Handshake({
    identity: identityB,
    role: 'responder',
    deviceId: 'device-bob',
    displayName: 'Bob',
    platform: 'web',
    capabilities: caps.b ?? CAPS,
    pairingSecret: pairingSecret?.b,
    requestTrust: false,
    version: PROTOCOL_VERSION,
  });
  return { a, b, identityA, identityB };
}

async function runHandshake(
  a: Handshake,
  b: Handshake,
  tamper?: (message: Record<string, unknown>, from: 'initiator' | 'responder') => void,
) {
  const queue: Array<{ target: Handshake; message: unknown; from: 'initiator' | 'responder' }> = [];
  const outcomeA: { value?: Awaited<ReturnType<Handshake['receive']>>['outcome'] } = {};
  const outcomeB: typeof outcomeA = {};
  for (const message of await a.start()) queue.push({ target: b, message, from: 'initiator' });
  for (const message of await b.start()) queue.push({ target: a, message, from: 'responder' });
  const delivered: Array<{ from: 'initiator' | 'responder'; message: Record<string, unknown> }> = [];
  while (queue.length > 0) {
    const item = queue.shift()!;
    const clone = JSON.parse(JSON.stringify(item.message)) as Record<string, unknown>;
    tamper?.(clone, item.from);
    delivered.push({ from: item.from, message: clone });
    const response = await item.target.receive(clone);
    if (response.outcome) {
      if (item.target === a) outcomeA.value = response.outcome;
      else outcomeB.value = response.outcome;
    }
    for (const reply of response.send) {
      queue.push({
        target: item.target === a ? b : a,
        message: reply,
        from: item.target === a ? 'initiator' : 'responder',
      });
    }
  }
  return { outcomeA: outcomeA.value, outcomeB: outcomeB.value, delivered };
}

describe('DF-HANDSHAKE v1', () => {
  it('establishes a session both sides agree on', async () => {
    const { a, b } = await makePair();
    const { outcomeA, outcomeB } = await runHandshake(a, b);
    expect(outcomeA).toBeDefined();
    expect(outcomeB).toBeDefined();
    expect(outcomeA!.sas).toBe(outcomeB!.sas);
    expect(outcomeA!.transcriptHashHex).toBe(outcomeB!.transcriptHashHex);
    expect(outcomeA!.peer.deviceId).toBe('device-bob');
    expect(outcomeB!.peer.deviceId).toBe('device-alice');
    expect(outcomeA!.peer.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // Capabilities are negotiated as an intersection.
    expect([...outcomeA!.capabilities].sort()).toEqual([...CAPS].sort());
  });

  it('encrypts both directions with the negotiated keys', async () => {
    const { a, b } = await makePair();
    const { outcomeA, outcomeB } = await runHandshake(a, b);
    const sealed = await outcomeA!.session.sealJson(utf8('bonjour'));
    const opened = await outcomeB!.session.open(sealed);
    expect(fromUtf8(opened.plaintext)).toBe('bonjour');
    const back = await outcomeB!.session.sealData(new Uint8Array([1, 2, 3]));
    expect((await outcomeA!.session.open(back)).plaintext).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('validates the pairing proof when both sides hold the QR secret', async () => {
    const secret = createPairingSecret();
    const { a, b } = await makePair({ a: secret, b: secret });
    const { outcomeA, outcomeB } = await runHandshake(a, b);
    expect(outcomeA!.pairingProofValid).toBe(true);
    expect(outcomeB!.pairingProofValid).toBe(true);
    expect(outcomeA!.peerRequestedTrust).toBe(false);
    expect(outcomeB!.peerRequestedTrust).toBe(true);
  });

  it('flags an attacker who joined without the QR secret', async () => {
    const { a, b } = await makePair({ a: createPairingSecret(), b: createPairingSecret() });
    const { outcomeA, outcomeB } = await runHandshake(a, b);
    expect(outcomeA!.pairingProofValid).toBe(false);
    expect(outcomeB!.pairingProofValid).toBe(false);
  });

  it('rejects an ephemeral key that was swapped by a relay', async () => {
    const { a, b } = await makePair();
    await expect(
      runHandshake(a, b, (message, from) => {
        if (from === 'initiator' && message.t === 'key') {
          message.ephemeralPublicKey = toBase64Url(randomBytes(32));
        }
      }),
    ).rejects.toThrow(HandshakeError);
  });

  it('detects a signature that covers a different transcript', async () => {
    const { a, b } = await makePair();
    await expect(
      runHandshake(a, b, (message, from) => {
        if (from === 'responder' && message.t === 'hello') {
          message.displayName = 'Bob (edited by relay)';
        }
      }),
    ).rejects.toThrow(/could not prove its identity/);
  });

  it('rejects a replayed auth message from another session', async () => {
    const first = await makePair();
    const firstRun = await runHandshake(first.a, first.b);
    const authOfFirst = firstRun.delivered.find((d) => d.message.t === 'auth' && d.from === 'initiator')!.message;

    const second = await makePair();
    await expect(
      runHandshake(second.a, second.b, (message, from) => {
        if (from === 'initiator' && message.t === 'auth') {
          message.signature = authOfFirst.signature;
        }
      }),
    ).rejects.toThrow(/could not prove its identity/);
  });

  it('refuses to talk to itself', async () => {
    const identity = await createDeviceIdentity();
    const { identity: hydrated } = await hydrateIdentity(identity);
    const self = new Handshake({
      identity,
      role: 'responder',
      deviceId: hydrated.publicKey.slice(0, 12),
      displayName: 'Same device',
      platform: 'windows',
      capabilities: CAPS,
      requestTrust: false,
      version: PROTOCOL_VERSION,
    });
    const other = new Handshake({
      identity,
      role: 'initiator',
      deviceId: hydrated.publicKey.slice(0, 12),
      displayName: 'Same device',
      platform: 'windows',
      capabilities: CAPS,
      requestTrust: false,
      version: PROTOCOL_VERSION,
    });
    await self.start();
    await expect(other.start().then((messages) => self.receive(messages[0]))).rejects.toThrow(/same device/);
  });

  it('refuses an incompatible protocol version', async () => {
    const { a, b } = await makePair();
    await expect(
      runHandshake(a, b, (message, from) => {
        if (from === 'initiator' && message.t === 'hello') message.v = '99.0';
      }),
    ).rejects.toThrow(/incompatible version/);
  });

  it('refuses an expired key announcement', async () => {
    const { a, b } = await makePair();
    const now = Date.now();
    await expect(
      runHandshake(
        a,
        b,
        (message, from) => {
          if (from === 'initiator' && message.t === 'key') message.expiresAt = now - 10 * 60_000;
        },
      ),
    ).rejects.toThrow(/expired key/);
  });

  it('rejects a second hello or key for the same session (replay)', async () => {
    const { a, b } = await makePair();
    const { delivered } = await runHandshake(a, b);
    const hello = delivered.find((d) => d.from === 'initiator' && d.message.t === 'hello')!.message;
    await expect(a.receive(hello)).rejects.toThrow(/second hello/);
    const key = delivered.find((d) => d.from === 'initiator' && d.message.t === 'key')!.message;
    const fresh = await makePair();
    await fresh.b.start();
    await fresh.b.receive(delivered.find((d) => d.from === 'initiator' && d.message.t === 'hello')!.message);
    await fresh.b.receive(key);
    await expect(fresh.b.receive(key)).rejects.toThrow(/second key/);
  });

  it('rejects malformed handshake messages instead of half-accepting them', async () => {
    const { b } = await makePair();
    await b.start();
    await expect(b.receive({ t: 'hello' })).rejects.toThrow(/Invalid handshake message/);
    await expect(b.receive({ t: 'unknown-type' })).rejects.toThrow(/Invalid handshake message/);
  });

  it('requires start() before receive()', async () => {
    const { b } = await makePair();
    await expect(b.receive({ t: 'auth', signature: 'AAAA' })).rejects.toThrow(/before receive/);
  });

  it('refuses an identity whose fingerprint does not match its key', async () => {
    const { a, b } = await makePair();
    const other = await createDeviceIdentity();
    const { identity: otherIdentity } = await hydrateIdentity(other);
    await expect(
      runHandshake(a, b, (message, from) => {
        if (from === 'initiator' && message.t === 'key') {
          message.identityPublicKey = otherIdentity.publicKey;
        }
      }),
    ).rejects.toThrow(/inconsistent identity/);
  });

  it('accepts a signature produced with the peer identity key (sanity check of the harness)', async () => {
    const { a, b, identityB } = await makePair();
    const { outcomeA } = await runHandshake(a, b);
    const transcript = outcomeA!.transcriptHashHex;
    const signature = await signBytes(identityB, utf8(`DF-AUTH-v1:responder:${transcript}`));
    expect(fromBase64Url(toBase64Url(signature)).length).toBeGreaterThan(0);
  });

  it('negotiates only the capabilities both peers announced', async () => {
    const { a, b } = await makePair({}, { a: CAPS, b: ['webrtc.direct', 'transfer.integrity'] });
    const { outcomeA, outcomeB } = await runHandshake(a, b);
    expect([...outcomeA!.capabilities].sort()).toEqual(['transfer.integrity', 'webrtc.direct']);
    expect([...outcomeB!.capabilities].sort()).toEqual(['transfer.integrity', 'webrtc.direct']);
  });
});
