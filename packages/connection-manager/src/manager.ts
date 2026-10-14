/**
 * Connection manager: from "I want to reach this device" to a live, authenticated
 * session — or to an honest failure.
 *
 * It owns exactly four things:
 *  1. trying the available transport methods in order (see methods.ts), so a
 *     direct path is always preferred and a relay is only used when it really
 *     has to be;
 *  2. running the DF-HANDSHAKE over the raw transport (plain JSON frames before
 *     keys exist, sealed frames after) with a hard timeout;
 *  3. verifying the peer identity against what discovery announced, so a device
 *     claiming someone else's name is rejected instead of quietly accepted;
 *  4. handing the caller a `PeerSession` and a truthful description of the path
 *     that was used.
 *
 * It never touches files, never writes to the disk and never talks to the UI.
 */
import {
  FRAME_PLAIN_JSON,
  HANDSHAKE_TIMEOUT_MS,
  MAX_CONTROL_FRAME_BYTES,
  decodeFrame,
  encodeFrame,
  fromUtf8,
  utf8,
  type Capability,
  type Clock,
  type Logger,
  type Platform,
  type Transport,
  type TransportState,
  type Unsubscribe,
} from '@dropforge/protocol';
import {
  DropForgeError,
  ERROR_CODES,
  fromPlatformError,
  toDropForgeError,
} from '@dropforge/app-core';
import {
  Handshake,
  HandshakeError,
  type HandshakeOutcome,
  type PeerInfo,
  type StoredIdentity,
} from '@dropforge/security';
import { PeerSession } from '@dropforge/transfer-engine';
import {
  selectTransportMethod,
  type MethodChoice,
  type MethodFacts,
  type TransportMethod,
} from './methods.js';

export interface ConnectionTarget {
  deviceId: string;
  displayName: string;
  /**
   * Fingerprint announced by discovery / the QR code. When present it is checked
   * against the key the peer actually proved possession of: a mismatch aborts the
   * connection (anti-spoofing, spec §6).
   */
  fingerprint?: string;
  /** Methods to try, in preference order (usually the output of `selectTransportMethod`). */
  methods: readonly TransportMethod[];
  /** Facts used to explain the choice and to send to the factory. */
  facts?: MethodFacts;
  /** Route/room token for the rendezvous or relay service, when one is used. */
  route?: string;
}

export interface ConnectionFactory {
  /**
   * Opens a raw transport for `method`. Must reject with a DropForgeError when
   * the path is not usable, and must honour the abort signal (the manager gives
   * up after `connectTimeoutMs`).
   */
  create(method: TransportMethod, target: ConnectionTarget, signal: AbortSignal): Promise<Transport>;
}

export interface Connection {
  readonly peer: PeerInfo;
  readonly method: TransportMethod;
  readonly transport: Transport;
  readonly session: PeerSession;
  readonly outcome: HandshakeOutcome;
  readonly sas: string;
  close(reason?: string): Promise<void>;
}

export type ConnectionEvent =
  | { type: 'attempt'; target: ConnectionTarget; method: TransportMethod }
  | { type: 'attempt-failed'; target: ConnectionTarget; method: TransportMethod; code: string; message: string }
  | { type: 'handshaking'; method: TransportMethod }
  | { type: 'connected'; peer: PeerInfo; method: TransportMethod; sas: string }
  | { type: 'failed'; code: string; message: string; failures: ConnectionFailure[] }
  | { type: 'closed'; reason?: string };

export interface ConnectionFailure {
  method: TransportMethod;
  code: string;
  message: string;
}

export interface ConnectionManagerOptions {
  identity: StoredIdentity;
  deviceId: string;
  displayName: string;
  platform: Platform;
  capabilities: readonly Capability[];
  factory: ConnectionFactory;
  clock?: Clock;
  logger?: Logger;
  /**
   * Asks the user whether a new device may be remembered. Default: never ask.
   *
   * Its presence is also **announced** to the other device: a manager that can ask for a
   * decision tells the peer to ask for one too, so that neither side ends up connected to
   * a device it never approved. A manager without this callback announces nothing —
   * inventing a request nobody can answer would leave the other side waiting forever.
   */
  /**
   * Asks the user to approve a brand-new device. The comparison code travels with
   * the question: a dialog that cannot show it asks someone to approve a device they
   * have no way to check — which is exactly what happened when the code was left out
   * and both devices displayed a dash instead of six digits.
   */
  requestTrust?: (peer: PeerInfo, method: TransportMethod, sas: string) => Promise<boolean>;
  /** Secret from the QR code, when the devices were paired that way. */
  pairingSecret?: Uint8Array;
  /** Time allowed to open one transport. */
  connectTimeoutMs?: number;
  /** Time allowed for the whole handshake. */
  handshakeTimeoutMs?: number;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

export class ConnectionManager {
  private readonly listeners = new Set<(event: ConnectionEvent) => void>();
  private readonly clock: Clock;
  private readonly logger: Logger | undefined;
  private phase: 'idle' | 'connecting' | 'connected' | 'closed' = 'idle';
  private active: Connection | undefined;

  constructor(private readonly options: ConnectionManagerOptions) {
    this.clock = options.clock ?? systemClockLazy();
    this.logger = options.logger;
  }

  get state(): 'idle' | 'connecting' | 'connected' | 'closed' {
    return this.phase;
  }

  onEvent(listener: (event: ConnectionEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Methods that can be used with the given facts, best first. */
  plan(facts: MethodFacts): MethodChoice {
    return selectTransportMethod(facts);
  }

  /**
   * Dials a device. Every method in `target.methods` is tried in order; the first
   * one that opens a transport *and* completes the handshake wins. When nothing
   * works, the error lists every attempt so the UI can explain the situation.
   */
  async connect(target: ConnectionTarget): Promise<Connection> {
    const failures: ConnectionFailure[] = [];
    this.phase = 'connecting';

    for (const method of target.methods) {
      const controller = new AbortController();
      this.emit({ type: 'attempt', target, method });
      let transport: Transport | undefined;
      try {
        transport = await this.withTimeout(
          this.options.factory.create(method, target, controller.signal),
          this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
          () => controller.abort(),
          ERROR_CODES.CONNECTION_TIMEOUT,
          `Could not open a ${method} connection in time`,
        );
      } catch (error) {
        const dfError = fromPlatformError(error);
        controller.abort();
        failures.push({ method, code: dfError.code, message: dfError.message });
        this.emit({ type: 'attempt-failed', target, method, code: dfError.code, message: dfError.message });
        this.logger?.log('info', 'connection attempt failed', { method, code: dfError.code });
        continue;
      }

      try {
        this.emit({ type: 'handshaking', method });
        const outcome = await this.runHandshake(transport, 'initiator', target, {
          // The side that dials confirms the device it reached, exactly like the side
          // that answers. Both questions exist for the same reason: the comparison code
          // is only worth comparing if each person was actually shown it.
          requestTrust: this.options.requestTrust !== undefined,
        });
        const connection = await this.finish(transport, method, outcome);
        this.phase = 'connected';
        return connection;
      } catch (error) {
        const dfError = fromPlatformError(error);
        await transport.close('handshake failed').catch(() => {});
        failures.push({ method, code: dfError.code, message: dfError.message });
        this.emit({ type: 'attempt-failed', target, method, code: dfError.code, message: dfError.message });
        this.logger?.log('warn', 'handshake failed on this path', { method, code: dfError.code });
        if (isIdentityStop(dfError)) {
          // The peer proved a key that does not match the announced identity: this
          // is not a network problem, another transport must not be tried, and the
          // user has to be told plainly.
          this.phase = 'idle';
          this.emit({ type: 'failed', code: dfError.code, message: dfError.message, failures });
          throw dfError;
        }
      }
    }

    this.phase = 'idle';
    const error = new DropForgeError(
      failures.some((f) => f.code === ERROR_CODES.NO_COMMON_TRANSPORT)
        ? ERROR_CODES.NO_COMMON_TRANSPORT
        : ERROR_CODES.PEER_UNREACHABLE,
      failures.length === 1
        ? failures[0]!.message
        : 'No available path allowed a connection to this device',
      {
        retryable: true,
        // The per-path outcome travels with the error: a caller that only shows
        // "unreachable" throws away the one piece of information that explains it
        // ("webrtc: the other device did not answer · relay: this code has expired").
        context: {
          attempts: failures.length,
          path: failures.map((failure) => `${failure.method}:${failure.code}`).join(' · '),
        },
      },
    );
    this.emit({ type: 'failed', code: error.code, message: error.message, failures });
    throw error;
  }

  /**
   * Handles an inbound transport (LAN announcement, relay room, or a WebRTC
   * answer). The optional expectations are checked *after* the peer proved its
   * identity, never before.
   */
  async accept(
    transport: Transport,
    expectations: { deviceId?: string; fingerprint?: string } = {},
    options: { pairingSecret?: Uint8Array; requestTrust?: boolean } = {},
  ): Promise<Connection> {
    this.phase = 'connecting';
    try {
      const target: ConnectionTarget = {
        deviceId: expectations.deviceId ?? 'unknown',
        displayName: '',
        ...(expectations.fingerprint ? { fingerprint: expectations.fingerprint } : {}),
        methods: [methodOf(transport)],
      };
      const outcome = await this.runHandshake(transport, 'responder', target, options);
      verifyPeer(outcome, expectations);
      const connection = await this.finish(transport, methodOf(transport), outcome);
      this.phase = 'connected';
      return connection;
    } catch (error) {
      this.phase = 'idle';
      await transport.close('handshake failed').catch(() => {});
      throw fromPlatformError(error);
    }
  }

  async close(reason?: string): Promise<void> {
    const connection = this.active;
    this.active = undefined;
    this.phase = 'closed';
    if (connection) await connection.close(reason).catch(() => {});
    this.emit({ type: 'closed', ...(reason ? { reason } : {}) });
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  private async runHandshake(
    transport: Transport,
    role: 'initiator' | 'responder',
    target: ConnectionTarget,
    options: { pairingSecret?: Uint8Array; requestTrust?: boolean } = {},
  ): Promise<HandshakeOutcome> {
    const handshake = new Handshake({
      identity: this.options.identity,
      role,
      deviceId: this.options.deviceId,
      displayName: this.options.displayName,
      platform: this.options.platform,
      capabilities: [...this.options.capabilities],
      ...(options.pairingSecret ?? this.options.pairingSecret
        ? { pairingSecret: options.pairingSecret ?? this.options.pairingSecret }
        : {}),
      requestTrust: options.requestTrust ?? false,
      now: this.clock.now(),
    });

    /** Frames that arrived before the handshake loop could consume them. */
    const received: unknown[] = [];
    /** Waiters parked by the loop; a frame or a close wakes exactly one. */
    const waiters: Array<() => void> = [];
    let closed = false;
    const wakeOne = (): void => {
      const waiter = waiters.shift();
      waiter?.();
    };
    const offFrame = transport.onFrame((frame) => {
      try {
        received.push(decodePlainFrame(frame));
      } catch {
        // A frame that is not a handshake message before the handshake finished is
        // either an attack or a bug: answering it would be worse than stopping.
        closed = true;
      }
      wakeOne();
    });
    const offState = transport.onState((state: TransportState) => {
      if (state === 'closed' || state === 'failed') {
        closed = true;
        wakeOne();
      }
    });

    const sendAll = (messages: readonly unknown[]): void => {
      for (const message of messages) transport.send(encodePlainFrame(message));
    };

    /**
     * Waits for a frame, a close, or a short poll tick (the tick keeps the loop
     * honest under an injected clock, which never fires on its own).
     */
    const nextInput = async (deadline: number): Promise<unknown | undefined> => {
      if (received.length > 0) return received.shift();
      if (closed) return undefined;
      await new Promise<void>((resolve) => {
        const handle = this.clock.setTimeout(() => {
          const index = waiters.indexOf(wake);
          if (index >= 0) waiters.splice(index, 1);
          resolve();
        }, 50);
        const wake = (): void => {
          this.clock.clearTimeout(handle);
          resolve();
        };
        waiters.push(wake);
      });
      void deadline;
      return received.shift();
    };

    try {
      const deadline = this.clock.now() + (this.options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS);
      sendAll(await handshake.start());
      while (!handshake.outcome) {
        if (this.clock.now() > deadline) {
          throw new DropForgeError(ERROR_CODES.CONNECTION_TIMEOUT, 'The secure handshake timed out', {
            retryable: true,
          });
        }
        const message = await nextInput(deadline);
        if (message === undefined) {
          if (closed) {
            throw new DropForgeError(ERROR_CODES.CONNECTION_LOST, 'The connection closed during the handshake', {
              retryable: true,
            });
          }
          continue;
        }
        const response = await handshake.receive(message);
        sendAll(response.send);
      }
      const outcome = handshake.outcome;
      if (!outcome) throw new DropForgeError(ERROR_CODES.HANDSHAKE_FAILED, 'The secure handshake did not complete');
      verifyPeer(outcome, target);
      return outcome;
    } catch (error) {
      if (error instanceof HandshakeError) {
        throw new DropForgeError(ERROR_CODES.HANDSHAKE_FAILED, handshakeMessage(error), {
          retryable: error.code === 'HANDSHAKE_TIMEOUT',
          context: { handshake: error.code },
        });
      }
      throw toDropForgeError(error, {
        code: ERROR_CODES.HANDSHAKE_FAILED,
        message: 'The secure handshake failed',
      });
    } finally {
      offFrame();
      offState();
    }
  }

  private async finish(
    transport: Transport,
    method: TransportMethod,
    outcome: HandshakeOutcome,
  ): Promise<Connection> {
    if (outcome.peerRequestedTrust && this.options.requestTrust) {
      const approved = await this.options.requestTrust(outcome.peer, method, outcome.sas);
      if (!approved) {
        throw new DropForgeError(ERROR_CODES.DEVICE_NOT_TRUSTED, 'This device was not approved', {
          context: { method },
        });
      }
    }
    const session = PeerSession.create(transport, outcome.session, {
      clock: this.clock,
      ...(this.logger ? { logger: this.logger } : {}),
    });
    session.start();

    const connection: Connection = {
      peer: outcome.peer,
      method,
      transport,
      session,
      outcome,
      sas: outcome.sas,
      close: async (reason?: string) => {
        await session.close().catch(() => {});
        await transport.close(reason).catch(() => {});
        if (this.active === connection) this.active = undefined;
      },
    };
    this.active = connection;
    this.emit({ type: 'connected', peer: outcome.peer, method, sas: outcome.sas });
    this.logger?.log('info', 'connected', { method, peer: outcome.peer.deviceId });
    return connection;
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    onTimeout: () => void,
    code: string,
    message: string,
  ): Promise<T> {
    let handle: unknown;
    const timeout = new Promise<never>((_resolve, reject) => {
      handle = this.clock.setTimeout(() => {
        onTimeout();
        reject(new DropForgeError(code, message, { retryable: true }));
      }, ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (handle !== undefined) this.clock.clearTimeout(handle);
    }
  }

  private emit(event: ConnectionEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}

/**
 * A peer proves possession of a key, but that only means "some device with this
 * key". If discovery, a trusted-device record or a QR code told us which device we
 * expect, the identity must match or the connection is refused (anti-spoofing).
 */
function isIdentityStop(error: DropForgeError): boolean {
  return error.code === ERROR_CODES.DEVICE_IDENTITY_MISMATCH;
}

function verifyPeer(outcome: HandshakeOutcome, expected: { deviceId?: string; fingerprint?: string }): void {
  if (expected.deviceId && expected.deviceId !== 'unknown' && expected.deviceId !== outcome.peer.deviceId) {
    throw new DropForgeError(ERROR_CODES.DEVICE_IDENTITY_MISMATCH, 'This device is not the one that was announced', {
      context: { reason: 'deviceIdMismatch' },
    });
  }
  if (expected.fingerprint && expected.fingerprint !== outcome.peer.fingerprint) {
    throw new DropForgeError(
      ERROR_CODES.DEVICE_IDENTITY_MISMATCH,
      'This device is not the one that was announced (its key does not match)',
      { context: { reason: 'fingerprintMismatch' } },
    );
  }
}

function methodOf(transport: Transport): TransportMethod {
  if (transport.kind === 'relay') return 'relay';
  return 'lan';
}

function handshakeMessage(error: HandshakeError): string {
  switch (error.code) {
    case 'HANDSHAKE_VERSION_MISMATCH':
      return 'The devices do not run the same protocol version; update DropForge on both sides';
    case 'HANDSHAKE_SAS_MISMATCH':
    case 'HANDSHAKE_PAIRING_MISMATCH':
      return 'The secure codes did not match: the connection may have been intercepted';
    case 'HANDSHAKE_TIMEOUT':
      return 'The secure handshake took too long';
    case 'HANDSHAKE_CRYPTO_UNAVAILABLE':
      return 'This device cannot run the required encryption';
    default:
      return 'The secure handshake failed';
  }
}

function encodePlainFrame(message: unknown): Uint8Array {
  return encodeFrame(FRAME_PLAIN_JSON, new Uint8Array(0), utf8(JSON.stringify(message)));
}

function decodePlainFrame(frame: Uint8Array): unknown {
  const decoded = decodeFrame(frame, MAX_CONTROL_FRAME_BYTES);
  if (decoded.kind !== FRAME_PLAIN_JSON) {
    throw new DropForgeError(ERROR_CODES.HANDSHAKE_FAILED, 'Unexpected frame during the handshake');
  }
  return JSON.parse(fromUtf8(decoded.body)) as unknown;
}

/** Kept as a function so the module stays testable with an injected clock. */
function systemClockLazy(): Clock {
  return {
    now: () => Date.now(),
    setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as never),
    setInterval: (handler, ms) => globalThis.setInterval(handler, ms),
    clearInterval: (handle) => globalThis.clearInterval(handle as never),
  };
}
