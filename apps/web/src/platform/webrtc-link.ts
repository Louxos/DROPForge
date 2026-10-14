/**
 * Real peer connections for the web app.
 *
 * Two paths, both going through the signaling service, which only ever sees
 * signaling JSON and opaque sealed frames:
 *
 *  - **direct**: an SDP offer/answer plus ICE candidates are exchanged through the
 *    relay; once the data channel is open, the transfer never touches the server
 *    again (and works without any internet access on a local network);
 *  - **blind relay**: when a direct path is impossible (both peers behind strict
 *    NATs), both sides ask the service to switch the room to relay mode and the
 *    same sealed frames travel through it. The server cannot read them.
 *
 * The identity is never proven by the service: the handshake that runs on top of
 * this transport is what proves who the peer really is (see packages/security).
 */
import { DropForgeError, ERROR_CODES } from '@dropforge/app-core';
import { systemClock, type Transport } from '@dropforge/protocol';
import type { ConnectionTarget, TransportMethod } from '@dropforge/connection-manager';
import { RelayTransport, SignalingClient, WebRtcTransport } from './webrtc-transport.js';
import type { HostedRoom, LinkFactory } from '../app/controller.js';

export interface WebRtcLinkOptions {
  /** Signaling/relay endpoint, e.g. wss://relay.example.org. */
  signalingUrl: string;
  deviceId: string;
  displayName: string;
  platform: string;
  fingerprint?: string;
  capabilities: string[];
  /**
   * ICE servers (STUN/TURN), for connections that leave the local network.
   *
   * **None by default, and that is a decision, not an oversight.** The product's rule
   * is that the client contacts nothing but its own signaling service: a public STUN
   * server sees this device's address and learns when it connects, which is exactly the
   * kind of third party DropForge exists to avoid. On the local network — what this
   * version promises — no server is needed at all: the peers find each other directly.
   *
   * A deployment that needs to cross NATs (a friend's network, a mobile connection)
   * can configure one with `VITE_ICE_URLS`, and then says so to its users. The previous
   * default was a hard-coded Google STUN server, which both broke that rule and made
   * every connection attempt depend on a third party being reachable.
   */
  iceServers?: RTCIceServer[];
  /** How long one attempt may take before it is reported as failed. */
  timeoutMs?: number;
  /**
   * How long a *hosted room* may wait for the other device, in ms.
   *
   * Separate from `timeoutMs` on purpose: an attempt is machine-paced, while a room
   * waits for a person to read a code and type it in. Measuring both with the same
   * short timer is what made a device stop listening after twenty seconds — while it
   * was still showing its code.
   */
  hostWaitMs?: number;
  logger?: { log: (level: 'info' | 'warn', message: string, fields?: Record<string, unknown>) => void };
}

/** No ICE server unless one is configured: see `iceServers` above. */
const DEFAULT_ICE: RTCIceServer[] = [];

export class WebRtcLinkFactory implements LinkFactory {
  private session: PeerAttempt | undefined;
  private hosted: PeerAttempt | undefined;

  constructor(private readonly options: WebRtcLinkOptions) {}

  /**
   * Opens a room with a code the other device dials, and waits for it.
   *
   * The waiting side is the *responder* of the secure handshake: it answers the
   * offer it receives and never creates one, so a room cannot be used to push a
   * connection onto a device that is not looking.
   */
  async host(code: string): Promise<HostedRoom> {
    const attempt = new PeerAttempt(this.options, 'webrtc', code, { role: 'host' });
    this.hosted = attempt;
    return {
      code,
      transport: attempt.open(),
      // The room exists only once the service has answered `joined`, and that answer
      // is not instant. Publishing the code before it arrives hands the other device
      // a code that leads nowhere — its own connection is refused as "this room is
      // not available", which reads like the other person's problem when it is ours.
      ready: withDeadline(
        attempt.ready,
        this.options.timeoutMs ?? 20_000,
        'The signaling service did not open the room in time',
      ),
      close: async () => {
        this.hosted = undefined;
        await attempt.close();
      },
    };
  }

  async create(method: TransportMethod, target: ConnectionTarget, signal: AbortSignal): Promise<Transport> {
    const roomCode = target.route;
    if (!roomCode) {
      throw new DropForgeError(
        ERROR_CODES.PAIRING_CODE_INVALID,
        'A direct connection needs a pairing code or a link from the other device',
      );
    }
    const attempt = new PeerAttempt(this.options, method, roomCode);
    this.session = attempt;
    signal.addEventListener('abort', () => void attempt.close(), { once: true });
    return await attempt.open();
  }

  async close(): Promise<void> {
    await this.session?.close();
    this.session = undefined;
  }
}

/** One connection attempt: a signaling socket plus either a channel or a relay. */
class PeerAttempt {
  private readonly role: 'dial' | 'host';
  private readonly client: SignalingClient;
  private readonly relay: RelayTransport;
  private connection: RTCPeerConnection | undefined;
  private channel: RTCDataChannel | undefined;
  private channelTransport: WebRtcTransport | undefined;
  private readonly pendingCandidates: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet = false;
  private closed = false;
  private settle: { resolve: (transport: Transport) => void; reject: (error: unknown) => void; timer: unknown } | undefined;
  /** Resolved once the service accepted this peer into its room (`joined`). */
  readonly ready: Promise<void>;
  private readonly readySettle: { resolve: () => void; reject: (error: unknown) => void };

  constructor(
    private readonly options: WebRtcLinkOptions,
    private readonly method: TransportMethod,
    roomCode: string,
    roleOptions: { role?: 'dial' | 'host' } = {},
  ) {
    this.role = roleOptions.role ?? 'dial';
    this.client = new SignalingClient({
      url: options.signalingUrl,
      roomCode,
      // The side that holds the code creates the room; the side that typed it joins.
      create: this.role === 'host',
      peer: {
        id: randomId(),
        deviceId: options.deviceId,
        displayName: options.displayName,
        platform: options.platform,
        ...(options.fingerprint ? { fingerprint: options.fingerprint } : {}),
        capabilities: options.capabilities,
      },
      onSignal: (data) => this.onSignal(data),
      // Asked by the other side, answered here: agreeing is the only way the relay can
      // ever be switched on, and it is always a deliberate act in code.
      onRelayRequested: () => this.client.requestRelay(),
      onRelayOpen: () => {
        // Both peers agreed to relay mode: the relay *is* this attempt's transport.
        // Marking it open without handing it to `settle` is what made the fallback a
        // dead end — the attempt looked alive, waited for a channel nobody would open,
        // and every connection that needed the relay failed with a timeout. The
        // comment on `open()` promised a fallback; this line is what makes it exist.
        this.relay.markOpen();
        this.succeed(this.relay);
      },
      onError: (code, message) => {
        this.settle?.reject(new DropForgeError(codeToErrorCode(code), message, { retryable: true }));
      },
    });
    this.relay = new RelayTransport(this.client);
    let settleReady: { resolve: () => void; reject: (error: unknown) => void } = {
      resolve: () => {},
      reject: () => {},
    };
    this.ready = new Promise<void>((resolve, reject) => {
      settleReady = { resolve, reject };
    });
    this.readySettle = settleReady;
    // A dialling attempt never reads `ready`; without a handler of its own, a failed
    // room would surface as an unhandled rejection instead of a reported failure.
    void this.ready.catch(() => undefined);
  }

  async open(): Promise<Transport> {
    // The waiting side is paced by a person; the dialling side by the network.
    const timeoutMs =
      this.role === 'host' ? (this.options.hostWaitMs ?? 5 * 60_000) : (this.options.timeoutMs ?? 20_000);
    const opened = new Promise<Transport>((resolve, reject) => {
      const timer = systemClock.setTimeout(() => {
        reject(
          new DropForgeError(ERROR_CODES.CONNECTION_TIMEOUT, 'The connection could not be established in time', {
            retryable: true,
          }),
        );
      }, timeoutMs);
      this.settle = { resolve, reject, timer };
    });

    try {
      await this.client.connect();
    } catch (error) {
      this.readySettle.reject(error);
      throw error;
    }
    this.readySettle.resolve();
    if (this.method === 'relay') {
      // Ask the service to switch the room to relay mode; both peers must agree.
      this.client.requestRelay();
    } else if (this.role === 'host') {
      // Answer whoever dials; never dial first.
      this.setupPeerConnection();
    } else {
      this.startWebRtc();
    }
    return await opened;
  }

  private setupPeerConnection(): RTCPeerConnection | undefined {
    if (typeof RTCPeerConnection !== 'function') {
      this.settle?.reject(
        new DropForgeError(ERROR_CODES.PLATFORM_UNSUPPORTED, 'This browser does not provide direct connections'),
      );
      return undefined;
    }
    const connection = new RTCPeerConnection({ iceServers: this.options.iceServers ?? DEFAULT_ICE });
    this.connection = connection;
    connection.onicecandidate = (event) => {
      if (event.candidate) this.client.signal({ candidate: event.candidate.toJSON() });
    };
    connection.ondatachannel = (event) => {
      this.channel = event.channel;
      this.watchChannel(event.channel);
    };
    return connection;
  }

  private startWebRtc(): void {
    const connection = this.setupPeerConnection();
    if (!connection) return;
    const channel = connection.createDataChannel('dropforge', { ordered: true });
    this.channel = channel;
    this.watchChannel(channel);
    void (async () => {
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      this.client.signal({ description: connection.localDescription?.toJSON() });
    })().catch((error: unknown) => this.settle?.reject(error));
  }

  /**
   * A channel that does not open is reported as a failure: DropForge never leaves
   * the user staring at a connection that will not happen.
   */
  private watchChannel(channel: RTCDataChannel): void {
    const transport = new WebRtcTransport({ channel, kind: 'webrtc' });
    this.channelTransport = transport;
    const watcher = systemClock.setTimeout(() => {
      if (transport.state !== 'open') {
        this.settle?.reject(
          new DropForgeError(ERROR_CODES.PEER_UNREACHABLE, 'The other device did not answer', { retryable: true }),
        );
      }
    }, this.options.timeoutMs ?? 20_000);
    transport.onState((state) => {
      if (state !== 'open') return;
      systemClock.clearTimeout(watcher);
      this.succeed(transport);
    });
  }

  private onSignal(data: unknown): void {
    if (data instanceof Uint8Array) {
      // A relayed sealed frame: handed to the relay transport untouched.
      this.relay.deliver(data);
      return;
    }
    const connection = this.connection;
    if (!connection) return;
    const message = data as { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
    void (async () => {
      try {
        if (message.description) {
          await connection.setRemoteDescription(message.description);
          this.remoteDescriptionSet = true;
          for (const candidate of this.pendingCandidates.splice(0)) await connection.addIceCandidate(candidate);
          if (message.description.type === 'offer') {
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            this.client.signal({ description: connection.localDescription?.toJSON() });
          }
          return;
        }
        if (message.candidate) {
          if (!this.remoteDescriptionSet) {
            this.pendingCandidates.push(message.candidate);
            return;
          }
          await connection.addIceCandidate(message.candidate);
        }
      } catch (error) {
        this.settle?.reject(
          new DropForgeError(ERROR_CODES.CONNECTION_LOST, 'The connection negotiation failed', {
            retryable: true,
            cause: error,
          }),
        );
      }
    })();
  }

  private succeed(transport: Transport): void {
    if (!this.settle) return;
    systemClock.clearTimeout(this.settle.timer);
    this.settle.resolve(transport);
    this.settle = undefined;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.settle) {
      // A closed attempt must not wake up later to report a failure nobody is
      // waiting for any more (the caller has already moved on, or given up).
      systemClock.clearTimeout(this.settle.timer);
      this.settle = undefined;
    }
    this.client.close();
    this.channel?.close();
    this.connection?.close();
    await this.relay.close();
  }
}

function codeToErrorCode(code: string): string {
  switch (code) {
    case 'ROOM_UNAVAILABLE':
      // The service has no room under that code: nobody is waiting with it any more,
      // or the code never existed. Saying "the other device is unreachable" would
      // blame the network for what is a code problem.
      return ERROR_CODES.PAIRING_CODE_EXPIRED;
    case 'NOT_IN_ROOM':
      return ERROR_CODES.PAIRING_CODE_EXPIRED;
    case 'ROOM_FULL':
      return ERROR_CODES.BUSY;
    case 'RATE_LIMITED':
      return ERROR_CODES.RELAY_QUOTA_REACHED;
    case 'RELAY_NOT_READY':
      return ERROR_CODES.RELAY_UNAVAILABLE;
    default:
      return ERROR_CODES.RELAY_UNAVAILABLE;
  }
}

/**
 * A promise that has to settle within a delay.
 *
 * Used for the steps with no socket-level failure to report: a service that accepts
 * the connection and then says nothing would leave the interface waiting forever,
 * and silence is the one thing this product does not do.
 */
function withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = systemClock.setTimeout(() => {
      reject(new DropForgeError(ERROR_CODES.CONNECTION_TIMEOUT, message, { retryable: true }));
    }, timeoutMs);
    promise.then(
      (value) => {
        systemClock.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        systemClock.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function randomId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
