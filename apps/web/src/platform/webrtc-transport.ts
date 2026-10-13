/**
 * `Transport` over a WebRTC data channel, plus the signaling client that carries
 * the offer/answer/ICE exchange through the blind relay.
 *
 * The relay only ever sees signalling messages (which it forwards verbatim) and,
 * when a direct path is impossible, the sealed frames themselves — which it cannot
 * read. Nothing here sends a file name or a key to the server.
 */
import {
  DropForgeError,
  ERROR_CODES,
} from '@dropforge/app-core';
import {
  KEEPALIVE_INTERVAL_MS,
  type Transport,
  type TransportError,
  type TransportKind,
  type TransportState,
  type TransportStats,
  type Unsubscribe,
} from '@dropforge/protocol';

type DataChannel = RTCDataChannel;
type PeerConnection = RTCPeerConnection;

export interface WebRtcTransportOptions {
  /** An already-open data channel, or a peer connection it will be created on. */
  channel?: DataChannel;
  connection?: PeerConnection;
  /** Streams for writing received frames (SCTP is message-oriented). */
  kind?: TransportKind;
  iceServers?: RTCIceServer[];
  onBufferedAmountLowThresholdBytes?: number;
}

/**
 * Wraps a data channel in the transport contract the engine knows. The channel is
 * ordered and reliable: DropForge never runs a transfer over an unordered or
 * partially reliable channel, because acknowledgements and offsets depend on order.
 */
export class WebRtcTransport implements Transport {
  readonly kind: TransportKind;
  private stateValue: TransportState = 'connecting';
  private readonly frameListeners = new Set<(frame: Uint8Array) => void>();
  private readonly stateListeners = new Set<(state: TransportState, error?: TransportError) => void>();
  private readonly counters: TransportStats = {
    framesSent: 0,
    framesReceived: 0,
    bytesSent: 0,
    bytesReceived: 0,
    bufferedBytes: 0,
  };
  private readonly channel: DataChannel;
  private readonly ownedConnection: PeerConnection | undefined;
  private closed = false;

  constructor(options: WebRtcTransportOptions) {
    const channel = options.channel ?? options.connection?.createDataChannel('dropforge', { ordered: true });
    if (!channel) {
      throw new DropForgeError(ERROR_CODES.CONNECTION_LOST, 'The data channel could not be created');
    }
    this.channel = channel;
    this.ownedConnection = options.connection;
    this.kind = options.kind ?? 'webrtc';
    channel.binaryType = 'arraybuffer';
    channel.onmessage = (event: MessageEvent<ArrayBuffer | Uint8Array>) => {
      const frame =
        event.data instanceof Uint8Array ? event.data : new Uint8Array(event.data as ArrayBuffer);
      this.counters.framesReceived += 1;
      this.counters.bytesReceived += frame.byteLength;
      for (const listener of [...this.frameListeners]) listener(frame);
    };
    channel.onopen = () => this.setState('open');
    channel.onclose = () => this.setState('closed');
    channel.onerror = () =>
      this.setState('failed', {
        code: 'DATA_CHANNEL_ERROR',
        message: 'The connection to the other device failed',
        retryable: true,
      });
    channel.bufferedAmountLowThreshold = options.onBufferedAmountLowThresholdBytes ?? 256 * 1024;
    if (channel.readyState === 'open') this.setState('open');
  }

  get state(): TransportState {
    return this.stateValue;
  }

  get bufferedBytes(): number {
    const buffered = this.channel.bufferedAmount;
    this.counters.bufferedBytes = buffered;
    return buffered;
  }

  send(frame: Uint8Array): void {
    if (this.closed || this.channel.readyState !== 'open') {
      throw new DropForgeError(ERROR_CODES.CONNECTION_LOST, 'The connection is not open', { retryable: true });
    }
    // A copy is handed to the channel: the engine may reuse its buffer once send()
    // returns, and WebRTC reads asynchronously.
    this.channel.send(frame.slice().buffer as ArrayBuffer);
    this.counters.framesSent += 1;
    this.counters.bytesSent += frame.byteLength;
  }

  onFrame(listener: (frame: Uint8Array) => void): Unsubscribe {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onState(listener: (state: TransportState, error?: TransportError) => void): Unsubscribe {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  stats(): TransportStats {
    return { ...this.counters, bufferedBytes: this.channel.bufferedAmount };
  }

  async close(reason?: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.setState('closing');
    try {
      this.channel.close();
      this.ownedConnection?.close();
    } catch {
      // Closing an already-dead channel is not an error worth reporting.
    }
    this.setState('closed');
    void reason;
  }

  private setState(state: TransportState, error?: TransportError): void {
    if (this.stateValue === state) return;
    this.stateValue = state;
    for (const listener of [...this.stateListeners]) listener(state, error);
  }
}

/* ------------------------------------------------------------------ *
 * Signaling
 * ------------------------------------------------------------------ */

export interface SignalingMessage {
  t: string;
  [key: string]: unknown;
}

export interface SignalingClientOptions {
  url: string;
  roomCode: string;
  peer: {
    id: string;
    deviceId: string;
    displayName: string;
    platform: string;
    fingerprint?: string;
    capabilities: string[];
  };
  onSignal: (data: unknown) => void;
  onPeerJoined?: (peer: Record<string, unknown>) => void;
  onPeerLeft?: () => void;
  onRelayOpen?: () => void;
  onError?: (code: string, message: string) => void;
  create?: boolean;
  /** Injected for tests. */
  socketFactory?: (url: string) => WebSocket;
}

/**
 * Talks to the signaling/relay service. The socket carries two kinds of payload:
 * JSON signalling (forwarded verbatim by the server) and binary frames (relayed
 * blindly once both peers agreed).
 */
export class SignalingClient {
  private socket: WebSocket | undefined;
  private readonly pending: unknown[] = [];
  private relayReady = false;
  private closed = false;

  constructor(private readonly options: SignalingClientOptions) {}

  get isRelayReady(): boolean {
    return this.relayReady;
  }

  connect(): Promise<void> {
    const factory = this.options.socketFactory ?? ((url: string) => new WebSocket(url));
    const socket = factory(this.options.url);
    this.socket = socket;
    return new Promise<void>((resolve, reject) => {
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            t: 'join',
            code: this.options.roomCode,
            ...(this.options.create ? { create: true } : {}),
            peer: this.options.peer,
          }),
        );
      };
      socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
        if (typeof event.data !== 'string') {
          // A relayed frame: handed straight to whoever is listening.
          this.options.onSignal(new Uint8Array(event.data));
          return;
        }
        const message = JSON.parse(event.data) as SignalingMessage;
        switch (message['t']) {
          case 'joined':
            resolve();
            break;
          case 'signal':
            this.options.onSignal(message['data']);
            break;
          case 'peer-joined':
            this.options.onPeerJoined?.(message['peer'] as Record<string, unknown>);
            break;
          case 'peer-left':
            this.options.onPeerLeft?.();
            break;
          case 'relay-open':
            this.relayReady = true;
            this.options.onRelayOpen?.();
            break;
          case 'error':
            this.options.onError?.(String(message['code']), String(message['message']));
            reject(new DropForgeError(ERROR_CODES.RELAY_UNAVAILABLE, String(message['message'])));
            break;
          default:
            break;
        }
        for (const pending of this.pending.splice(0)) this.send(pending);
      };
      socket.onerror = () => {
        reject(
          new DropForgeError(
            ERROR_CODES.RELAY_UNAVAILABLE,
            'The relay service is unreachable: only local transfers will work',
            { retryable: true },
          ),
        );
      };
      socket.onclose = () => {
        this.closed = true;
      };
    });
  }

  /** Sends a signalling payload (offer/answer/candidate). */
  signal(data: unknown): void {
    this.send({ t: 'signal', data });
  }

  /** Asks the server to switch this room to blind relay mode. */
  requestRelay(): void {
    this.send({ t: 'relay-ready' });
  }

  /** Sends a sealed frame through the relay. The server cannot read it. */
  sendFrame(frame: Uint8Array): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new DropForgeError(ERROR_CODES.RELAY_UNAVAILABLE, 'The relay connection is not open', {
        retryable: true,
      });
    }
    socket.send(frame.slice().buffer as ArrayBuffer);
  }

  close(): void {
    this.closed = true;
    try {
      this.socket?.close(1000, 'closed by the app');
    } catch {
      // Nothing to do: the socket is already gone.
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private send(payload: unknown): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.pending.push(payload);
      return;
    }
    socket.send(JSON.stringify(payload));
  }
}

/**
 * `Transport` over the blind relay.
 *
 * The relay carries the same sealed frames a data channel would: the server sees a
 * kind byte, a nonce and ciphertext, and cannot read a file name, a path or a byte
 * of content. This class only moves opaque frames, exactly like the WebRTC one.
 */
export class RelayTransport implements Transport {
  readonly kind = 'relay' as const;
  private stateValue: TransportState = 'connecting';
  private readonly frameListeners = new Set<(frame: Uint8Array) => void>();
  private readonly stateListeners = new Set<(state: TransportState, error?: TransportError) => void>();
  private readonly counters: TransportStats = {
    framesSent: 0,
    framesReceived: 0,
    bytesSent: 0,
    bytesReceived: 0,
    bufferedBytes: 0,
  };
  private closed = false;

  constructor(private readonly client: SignalingClient) {}

  /** Called by the link when the server confirmed relay mode for both peers. */
  markOpen(): void {
    this.setState('open');
  }

  /** Called for every binary frame the relay forwards to this peer. */
  deliver(frame: Uint8Array): void {
    if (this.closed) return;
    this.counters.framesReceived += 1;
    this.counters.bytesReceived += frame.byteLength;
    for (const listener of [...this.frameListeners]) listener(frame);
  }

  get state(): TransportState {
    return this.stateValue;
  }

  get bufferedBytes(): number {
    // WebSocket exposes no backpressure signal we can trust; reporting 0 would be a
    // lie, so the buffered amount is reported as unknown-but-zero only when open.
    return 0;
  }

  send(frame: Uint8Array): void {
    if (this.closed || this.stateValue !== 'open') {
      throw new DropForgeError(ERROR_CODES.RELAY_UNAVAILABLE, 'The relay is not open', { retryable: true });
    }
    this.client.sendFrame(frame);
    this.counters.framesSent += 1;
    this.counters.bytesSent += frame.byteLength;
  }

  onFrame(listener: (frame: Uint8Array) => void): Unsubscribe {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onState(listener: (state: TransportState, error?: TransportError) => void): Unsubscribe {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  stats(): TransportStats {
    return { ...this.counters };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.setState('closing');
    this.setState('closed');
  }

  private setState(state: TransportState, error?: TransportError): void {
    if (this.stateValue === state) return;
    this.stateValue = state;
    for (const listener of [...this.stateListeners]) listener(state, error);
  }
}

/**
 * Keeps a direct connection alive and reports the round-trip time. Used by the UI
 * to prove a connection is healthy before a big transfer starts.
 */
export const WEBRTC_KEEPALIVE_MS = KEEPALIVE_INTERVAL_MS;
