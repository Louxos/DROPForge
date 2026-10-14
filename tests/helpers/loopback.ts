/**
 * Loopback rig: two real peers, real WebCrypto handshake, real framing, an
 * in-memory transport and an in-memory filesystem. Nothing about the protocol,
 * the crypto or the transfer engine is stubbed — only the network and the disk.
 */
import {
  PROTOCOL_VERSION,
  fromUtf8,
  systemClock,
  utf8,
  type Capability,
  type Clock,
  type Logger,
  type Transport,
} from '@dropforge/protocol';
import {
  Handshake,
  createDeviceIdentity,
  type HandshakeOutcome,
  type StoredIdentity,
} from '@dropforge/security';
import { PeerSession } from '@dropforge/transfer-engine';
import { MemoryTransport } from './memory-transport.js';

export const TEST_CAPABILITIES: Capability[] = [
  'webrtc.direct',
  'relay.blind',
  'fs.directory',
  'fs.download',
  'transfer.resume',
  'transfer.pause',
  'transfer.folders',
  'transfer.integrity',
  // Les managers de ces tests savent demander une confirmation à leur utilisateur.
  'trust.request',
];

export interface TestPeer {
  deviceId: string;
  displayName: string;
  identity: StoredIdentity;
  transport: MemoryTransport;
  session?: PeerSession;
  handshake?: Handshake;
  outcome?: HandshakeOutcome;
}

export interface LoopbackOptions {
  capabilitiesA?: Capability[];
  capabilitiesB?: Capability[];
  pairingSecret?: Uint8Array;
  /** A different secret on Bob's side models an attacker who lacks the QR code. */
  pairingSecretB?: Uint8Array;
  clock?: Clock;
  logger?: Logger;
  latencyMs?: number;
  now?: number;
  /** Modifies each handshake message before it is delivered (attack simulation). */
  tamper?: (message: Record<string, unknown>, from: 'initiator' | 'responder') => void;
}

export interface LoopbackResult {
  alice: TestPeer;
  bob: TestPeer;
  outcomeA: HandshakeOutcome;
  outcomeB: HandshakeOutcome;
}

export interface TestLogger extends Logger {
  lines: string[];
}

export function testLogger(): TestLogger {
  const lines: string[] = [];
  return {
    lines,
    log(level, message, fields) {
      lines.push(`${level}:${message}${fields ? ` ${JSON.stringify(fields)}` : ''}`);
    },
  };
}

export async function createPeer(
  name: string,
  options: { transport?: MemoryTransport; latencyMs?: number } = {},
): Promise<TestPeer> {
  const identity = await createDeviceIdentity();
  return {
    deviceId: crypto.randomUUID(),
    displayName: name,
    identity,
    transport: options.transport ?? new MemoryTransport(options.latencyMs ? { latencyMs: options.latencyMs } : {}),
  };
}

/** Runs the full DF-HANDSHAKE v1 between two freshly created identities. */
export async function connect(options: LoopbackOptions = {}): Promise<LoopbackResult> {
  const clock = options.clock ?? systemClock;
  const latency = options.latencyMs ? { latencyMs: options.latencyMs } : {};
  const [transportA, transportB] = MemoryTransport.pair(latency);
  const alice = await createPeer('Alice', { transport: transportA });
  const bob = await createPeer('Bob', { transport: transportB });
  const capsA = options.capabilitiesA ?? TEST_CAPABILITIES;
  const capsB = options.capabilitiesB ?? TEST_CAPABILITIES;

  const handshakeA = new Handshake({
    identity: alice.identity,
    role: 'initiator',
    deviceId: alice.deviceId,
    displayName: alice.displayName,
    platform: 'windows',
    capabilities: capsA,
    pairingSecret: options.pairingSecret,
    requestTrust: false,
    now: options.now ?? clock.now(),
    version: PROTOCOL_VERSION,
  });
  const handshakeB = new Handshake({
    identity: bob.identity,
    role: 'responder',
    deviceId: bob.deviceId,
    displayName: bob.displayName,
    platform: 'web',
    capabilities: capsB,
    pairingSecret: options.pairingSecretB ?? options.pairingSecret,
    requestTrust: false,
    now: options.now ?? clock.now(),
    version: PROTOCOL_VERSION,
  });

  const outcome = await runHandshake(handshakeA, handshakeB, options.tamper);
  alice.handshake = handshakeA;
  bob.handshake = handshakeB;
  alice.outcome = outcome.a;
  bob.outcome = outcome.b;
  return { alice, bob, outcomeA: outcome.a, outcomeB: outcome.b };
}

/**
 * Pumps handshake messages directly between two Handshake instances.
 * Messages are serialised to JSON and back exactly like on the wire.
 */
export async function runHandshake(
  initiator: Handshake,
  responder: Handshake,
  tamper?: (message: Record<string, unknown>, from: 'initiator' | 'responder') => void,
): Promise<{ a: HandshakeOutcome; b: HandshakeOutcome }> {
  let outcomeA: HandshakeOutcome | undefined;
  let outcomeB: HandshakeOutcome | undefined;

  const queue: Array<{ target: Handshake; message: unknown; from: 'initiator' | 'responder' }> = [];
  // Both peers call start() when the connection opens, exactly like the app does.
  for (const message of await initiator.start()) queue.push({ target: responder, message, from: 'initiator' });
  for (const message of await responder.start()) queue.push({ target: initiator, message, from: 'responder' });

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    const clone = JSON.parse(JSON.stringify(item.message)) as Record<string, unknown>;
    tamper?.(clone, item.from);
    const response = await item.target.receive(clone);
    if (response.outcome) {
      if (item.target === initiator) outcomeA = response.outcome;
      else outcomeB = response.outcome;
    }
    for (const reply of response.send) {
      queue.push({ target: item.target === initiator ? responder : initiator, message: reply, from: item.target === initiator ? 'initiator' : 'responder' });
    }
  }
  if (!outcomeA || !outcomeB) throw new Error('handshake did not complete');
  return { a: outcomeA, b: outcomeB };
}

/** Builds PeerSessions from a completed loopback handshake. */
export function sessionsFrom(result: LoopbackResult, clock: Clock = systemClock, logger?: Logger): void {
  result.alice.session = PeerSession.create(result.alice.transport, result.outcomeA.session, { clock, logger });
  result.bob.session = PeerSession.create(result.bob.transport, result.outcomeB.session, { clock, logger });
  result.alice.session.start();
  result.bob.session.start();
}

/** Runs a PeerSession pair until both sides report "open". */
export async function settle(ms = 10): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export { fromUtf8, utf8 };
