/**
 * Orchestrates a full transfer the way the application does:
 *   1. the sender announces the offer on the session;
 *   2. the receiving side reads the offer from the channel, asks its user
 *      (unless a policy answers automatically) and accepts or refuses;
 *   3. the sender streams, the receiver acknowledges, verifies and reports.
 *
 * Nothing here bypasses the protocol: the offer really travels through the
 * sealed control channel, and the conflict decisions are collected from the wire.
 */
import {
  systemClock,
  sha256Hex,
  type Capability,
  type Clock,
  type ConflictDecision,
  type ControlMessage,
  type TransferAccept,
  type TransferOffer,
  type TransferReject,
} from '@dropforge/protocol';
import { DropForgeError, ERROR_CODES, type SourceFile } from '@dropforge/app-core';
import {
  PeerSession,
  TransferReceiver,
  TransferSender,
  buildManifest,
  hashManifest,
  receiveTransfer,
  sendTransfer,
  type ReceiverOutcome,
  type SenderOutcome,
} from '@dropforge/transfer-engine';
import {
  TEST_CAPABILITIES,
  connect,
  sessionsFrom,
  settle,
  testLogger,
  type LoopbackOptions,
  type TestLogger,
} from './loopback.js';
import { MemoryFileSystem } from './memory-fs.js';

export interface RigOptions extends LoopbackOptions {
  seed?: Record<string, Uint8Array | string>;
  clock?: Clock;
}

type Peer = Awaited<ReturnType<typeof connect>>;

export interface Rig {
  alice: Peer['alice'];
  bob: Peer['bob'];
  outcomeA: Peer['outcomeA'];
  outcomeB: Peer['outcomeB'];
  store: MemoryFileSystem;
  logger: TestLogger;
  sources: Map<number, SourceFile>;
  offer: TransferOffer;
  manifestHash: string;
  clock: Clock;
}

export async function rig(options: RigOptions = {}): Promise<Rig> {
  const { seed, clock = systemClock, ...connectOptions } = options;
  const logger: TestLogger = testLogger();
  const peer = await connect({ ...connectOptions, logger });
  sessionsFrom(peer, clock, logger);
  return {
    alice: peer.alice,
    bob: peer.bob,
    outcomeA: peer.outcomeA,
    outcomeB: peer.outcomeB,
    store: new MemoryFileSystem(seed ?? {}),
    logger,
    sources: new Map(),
    offer: undefined as never,
    manifestHash: '',
    clock,
  };
}

/**
 * Builds a `Rig` from two already-established sessions (e.g. produced by the
 * connection manager), so a test can run a real transfer over a connection whose
 * transport, handshake and identity verification all happened for real.
 */
export function rigFromSessions(options: {
  aliceSession: PeerSession;
  bobSession: PeerSession;
  store?: MemoryFileSystem;
  clock?: Clock;
  logger?: TestLogger;
  capabilitiesA?: Capability[];
  capabilitiesB?: Capability[];
}): Rig {
  const logger = options.logger ?? testLogger();
  const clock = options.clock ?? systemClock;
  const fake = (session: PeerSession, capabilities: Capability[]): Peer['alice'] =>
    ({
      deviceId: 'device',
      displayName: 'peer',
      identity: undefined,
      transport: undefined,
      session,
      outcome: {
        peer: {
          deviceId: 'device',
          displayName: 'peer',
          platform: 'web',
          sign: 'ed25519',
          agree: 'x25519',
          publicKey: '',
          fingerprint: '',
        },
        capabilities: new Set(capabilities),
        sas: '',
        transcriptHashHex: '',
        session: undefined as never,
        peerRequestedTrust: false,
        role: 'initiator',
      },
    }) as unknown as Peer['alice'];
  return {
    alice: fake(options.aliceSession, options.capabilitiesA ?? TEST_CAPABILITIES),
    bob: fake(options.bobSession, options.capabilitiesB ?? TEST_CAPABILITIES),
    outcomeA: undefined as never,
    outcomeB: undefined as never,
    store: options.store ?? new MemoryFileSystem(),
    logger,
    sources: new Map(),
    offer: undefined as never,
    manifestHash: '',
    clock,
  };
}

export function plan(r: Rig, files: SourceFile[], chunkBytes = 64 * 1024): { offer: TransferOffer; manifestHash: string } {
  const built = buildManifest({ files, chunkBytes });
  r.offer = built.offer;
  r.manifestHash = built.manifestHash;
  r.sources = new Map(files.map((file, index) => [index, file]));
  return { offer: built.offer, manifestHash: built.manifestHash };
}

export interface RunOptions {
  policy?: 'ask' | 'overwrite' | 'skip' | 'rename';
  decisions?: ConflictDecision['decisions'];
  /** Answers the incoming request; overrides `policy` when provided. */
  requestDecision?: (request: { conflicts: number; freeSpace: number | undefined }) => Promise<{
    accepted: boolean;
    decisions: ConflictDecision['decisions'];
  }>;
  resume?: { manifestHash: string; files: Array<{ index: number; ranges: Array<{ start: number; end: number }> }> };
  /**
   * Called on every progress event; may pause/cancel/interrupt the sender, or
   * stop the receiving side (used by interruption and resume scenarios).
   */
  onProgress?: (bytesDone: number, sender: TransferSender, receiver: TransferReceiver) => void;
  streamIndex?: number;
  progressIntervalMs?: number;
  /** 0 makes every chunk emit a progress event (used by cancel/interrupt tests). */
  progressThrottleMs?: number;
  timeoutMs?: number;
  /** Acknowledgement timeout of the sender (short in tests). */
  ackTimeoutMs?: number;
  /** How long the receiver waits for data before declaring the peer gone. */
  stallTimeoutMs?: number;
  /** Logs every control message exchanged (diagnostics only). */
  trace?: boolean;
}

export interface RunResult {
  sender: SenderOutcome;
  receiver: ReceiverOutcome;
  offered: TransferOffer;
  senderInstance: TransferSender;
  receiverInstance: TransferReceiver;
  /** Conflict decisions the receiver actually sent. */
  decisions: ConflictDecision['decisions'];
}

interface SessionLike {
  events: { on: (event: 'control', listener: (message: ControlMessage) => void) => () => void };
}

function nextControl(
  session: SessionLike,
  predicate: (message: ControlMessage) => boolean,
  timeoutMs: number,
): { promise: Promise<ControlMessage | undefined>; cancel: () => void } {
  let cancel: () => void = () => {};
  const promise = new Promise<ControlMessage | undefined>((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(undefined);
    }, timeoutMs);
    const unsubscribe = session.events.on('control', (message) => {
      if (!predicate(message)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(message);
    });
    cancel = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve(undefined);
    };
  });
  return { promise, cancel };
}

export async function runTransfer(r: Rig, options: RunOptions = {}): Promise<RunResult> {
  const aliceSession = r.alice.session;
  const bobSession = r.bob.session;
  if (!aliceSession || !bobSession) throw new Error('sessions are not established');
  const streamIndex = options.streamIndex ?? 1;

  const unsubscribers: Array<() => void> = [];
  if (options.trace) {
    unsubscribers.push(
      aliceSession.events.on('control', (message) =>
        r.logger.log('debug', 'sender-side control', { t: message.t }),
      ),
      bobSession.events.on('control', (message) =>
        r.logger.log('debug', 'receiver-side control', {
          t: message.t,
          detail:
            message.t === 'chunkAck'
              ? `${message.fileIndex}:${message.chunkIndex}`
              : message.t === 'transferReject'
                ? message.reason
                : undefined,
        }),
      ),
    );
  }

  // The instances are created inside the shared orchestration, which is exactly
  // what the applications use: these tests exercise the shipping code path.
  let sender: TransferSender | undefined;
  let receiver: TransferReceiver | undefined;

  try {
    const receiving = receiveTransfer({
      session: bobSession,
      clock: r.clock,
      logger: r.logger,
      streamIndex,
      store: r.store,
      policy: options.policy ?? 'ask',
      ...(options.resume ? { resume: options.resume } : {}),
      offerTimeoutMs: options.timeoutMs ?? 4000,
      progressIntervalMs: options.progressIntervalMs ?? 25,
      progressThrottleMs: options.progressThrottleMs ?? 250,
      stallTimeoutMs: options.stallTimeoutMs ?? 1200,
      requestDecision: async (request) => {
        if (!options.requestDecision) return { accepted: true, decisions: options.decisions ?? [] };
        const answer = await options.requestDecision({
          conflicts: request.conflicts.length,
          freeSpace: request.freeSpace,
        });
        return answer;
      },
      onReceiver: (instance) => {
        receiver = instance;
      },
    });

    const sent = await sendTransfer({
      session: aliceSession,
      offer: r.offer,
      sources: r.sources,
      clock: r.clock,
      logger: r.logger,
      streamIndex,
      acceptTimeoutMs: options.timeoutMs ?? 4000,
      ackTimeoutMs: options.ackTimeoutMs ?? 2000,
      progressThrottleMs: options.progressThrottleMs ?? 250,
      onProgress: (progress, running) => {
        sender = running;
        options.onProgress?.(progress.bytesDone, running, receiver as TransferReceiver);
      },
    });
    sender = sent.sender;
    const received = await receiving;
    receiver = received.receiver;

    return {
      offered: received.offer,
      sender: sent.outcome,
      receiver: received.outcome,
      senderInstance: (sender ?? (undefined as never)) as TransferSender,
      receiverInstance: receiver,
      decisions: sent.decisions.length > 0 ? sent.decisions : (options.decisions ?? []),
    };
  } finally {
    for (const off of unsubscribers) off();
  }
}

/** Digest-based comparison that avoids deep-diffing megabytes. */
export function digestOf(data: Uint8Array | undefined): string {
  return data ? sha256Hex(data) : 'missing';
}

export function assertStoreMatches(store: MemoryFileSystem, path: string, expected: Uint8Array): void {
  const actual = store.content(path);
  if (!actual) throw new DropForgeError(ERROR_CODES.READ_FAILED, `no file at ${path}`);
  if (digestOf(actual) !== digestOf(expected)) {
    throw new DropForgeError(ERROR_CODES.INTEGRITY_FAILED, `stored content of ${path} differs`);
  }
}

export { settle, hashManifest, systemClock };
