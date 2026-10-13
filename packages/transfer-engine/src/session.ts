/**
 * PeerSession — the layer between the transport and a transfer.
 *
 * Responsibilities, and deliberately nothing else:
 *  - seal/open frames with the negotiated session keys (never plaintext);
 *  - validate every control message before dispatch;
 *  - route sealed data frames to the transfer that owns the stream index;
 *  - detect stalls (heartbeat), key/counter errors and protocol violations and
 *    close the session with a precise, user-safe reason;
 *  - measure the real round-trip time (used only for diagnostics, never to
 *    fabricate progress).
 */
import {
  DATA_CHUNK_BYTES,
  FRAME_SEALED_DATA,
  FRAME_SEALED_JSON,
  KEEPALIVE_INTERVAL_MS,
  MAX_CONTROL_FRAME_BYTES,
  PEER_IDLE_TIMEOUT_MS,
  decodeInnerData,
  encodeFrame,
  encodeInnerData,
  FRAME_PLAIN_JSON,
  parseControlMessage,
  fromUtf8,
  type ControlMessage,
  type InnerDataHeader,
  type Transport,
  type TransportError,
  type Clock,
  type Logger,
  type PongMessage,
  redact,
} from '@dropforge/protocol';
import { ReplayError, SessionCrypto, SessionCryptoError } from '@dropforge/security';
import { DropForgeError, Emitter, ERROR_CODES } from '@dropforge/app-core';

export type SessionCloseReason =
  | { kind: 'local'; code: string }
  | { kind: 'remote'; code: string; message: string }
  | { kind: 'transport'; error: TransportError }
  | { kind: 'timeout' }
  | { kind: 'protocol'; code: string; detail: string };

export interface PeerSessionEvents {
  control: ControlMessage;
  closed: SessionCloseReason;
  error: DropForgeError;
  /** Diagnostic only: never used for progress reporting. */
  rtt: number;
}

export interface PeerSessionOptions {
  clock: Clock;
  logger?: Logger;
  /** Called when the peer asks to end the session cleanly. */
  idleTimeoutMs?: number;
  keepaliveIntervalMs?: number;
}

interface DataStreamHandler {
  onChunk: (header: InnerDataHeader, chunk: Uint8Array) => void;
}

export class PeerSession {
  readonly events = new Emitter<PeerSessionEvents>();
  private readonly streams = new Map<number, DataStreamHandler>();
  private readonly options: PeerSessionOptions;
  private pingCounter = 0;
  private lastActivityAt: number;
  private keepaliveHandle: unknown;
  private timeoutHandle: unknown;
  private closed = false;
  private lastRtt: number | undefined;
  private pendingPings = new Map<number, number>();

  private constructor(
    readonly transport: Transport,
    private readonly crypto: SessionCrypto,
    options: PeerSessionOptions,
  ) {
    this.options = options;
    this.lastActivityAt = options.clock.now();
    transport.onFrame((frame) => {
      void this.onFrame(frame);
    });
    transport.onState((state, error) => {
      if (state === 'failed' && error) this.close({ kind: 'transport', error });
      else if (state === 'closed' && !this.closed) this.close({ kind: 'transport', error: error ?? { code: 'CONNECTION_LOST', message: 'The connection was closed', retryable: true } });
    });
  }

  static create(transport: Transport, crypto: SessionCrypto, options: PeerSessionOptions): PeerSession {
    return new PeerSession(transport, crypto, options);
  }

  get rttMs(): number | undefined {
    return this.lastRtt;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  start(): void {
    const interval = this.options.keepaliveIntervalMs ?? KEEPALIVE_INTERVAL_MS;
    const idle = this.options.idleTimeoutMs ?? PEER_IDLE_TIMEOUT_MS;
    this.keepaliveHandle = this.options.clock.setInterval(() => {
      void this.tick();
    }, Math.min(interval, Math.max(1000, Math.floor(idle / 3))));
  }

  private async tick(): Promise<void> {
    if (this.closed) return;
    const now = this.options.clock.now();
    if (now - this.lastActivityAt > (this.options.idleTimeoutMs ?? PEER_IDLE_TIMEOUT_MS)) {
      this.close({ kind: 'timeout' });
      return;
    }
    this.pingCounter += 1;
    this.pendingPings.set(this.pingCounter, now);
    try {
      await this.sendControl({ t: 'ping', id: this.pingCounter, at: now });
    } catch {
      // A failed keepalive is not fatal by itself: the idle timeout decides.
    }
  }

  /** Registers the handler that receives this transfer's chunks. */
  registerStream(streamIndex: number, handler: DataStreamHandler): () => void {
    if (this.streams.has(streamIndex)) {
      throw new DropForgeError(ERROR_CODES.BUSY, 'This transfer stream is already in use');
    }
    this.streams.set(streamIndex, handler);
    return () => this.streams.delete(streamIndex);
  }

  private async onFrame(frame: Uint8Array): Promise<void> {
    if (this.closed) return;
    this.lastActivityAt = this.options.clock.now();
    try {
      const { kind, plaintext } = await this.crypto.open(frame);
      if (kind === FRAME_SEALED_JSON) {
        if (plaintext.length > MAX_CONTROL_FRAME_BYTES) {
          throw new DropForgeError(ERROR_CODES.PEER_UNREACHABLE, 'Oversized control message rejected');
        }
        const message = parseControlMessage(JSON.parse(fromUtf8(plaintext)) as unknown);
        this.handleControl(message);
        return;
      }
      if (kind === FRAME_SEALED_DATA) {
        const { header, chunk } = decodeInnerData(plaintext);
        const stream = this.streams.get(header.streamIndex);
        if (!stream) {
          // Data for an unknown/finished stream: a protocol violation worth
          // reporting, but not worth dropping the whole session for.
          this.options.logger?.log('warn', 'data frame for unknown stream', { stream: header.streamIndex });
          return;
        }
        stream.onChunk(header, chunk);
        return;
      }
      if (kind === FRAME_PLAIN_JSON) {
        throw new DropForgeError(ERROR_CODES.PEER_UNREACHABLE, 'Plain frames are not accepted once the session is secured');
      }
    } catch (error) {
      if (error instanceof ReplayError) {
        this.close({ kind: 'protocol', code: 'REPLAY_DETECTED', detail: 'replayed frame' });
        return;
      }
      if (error instanceof SessionCryptoError) {
        this.close({ kind: 'protocol', code: error.code, detail: error.message });
        return;
      }
      const dfError =
        error instanceof DropForgeError
          ? error
          : new DropForgeError(ERROR_CODES.HANDSHAKE_FAILED, 'A message from the other device was rejected', {
              context: { detail: error instanceof Error ? error.name : 'unknown' },
            });
      this.events.emit('error', dfError);
      this.close({ kind: 'protocol', code: dfError.code, detail: dfError.message });
    }
  }

  private handleControl(message: ControlMessage): void {
    if (message.t === 'ping') {
      void this.sendControl({ t: 'pong', id: message.id, at: message.at });
      return;
    }
    if (message.t === 'pong') {
      this.onPong(message);
      return;
    }
    if (message.t === 'error' && message.fatal) {
      this.events.emit('error', new DropForgeError(message.code, message.message));
      this.close({ kind: 'remote', code: message.code, message: message.message });
      return;
    }
    this.events.emit('control', message);
  }

  private onPong(message: PongMessage): void {
    const sentAt = this.pendingPings.get(message.id);
    if (sentAt === undefined) return;
    this.pendingPings.delete(message.id);
    if (this.pendingPings.size > 32) {
      // Bounded memory: drop the oldest pending pings.
      const oldest = [...this.pendingPings.keys()].slice(0, this.pendingPings.size - 32);
      for (const key of oldest) this.pendingPings.delete(key);
    }
    this.lastRtt = this.options.clock.now() - sentAt;
    this.events.emit('rtt', this.lastRtt);
  }

  async sendControl(message: ControlMessage): Promise<void> {
    if (this.closed) throw new DropForgeError(ERROR_CODES.CONNECTION_LOST, 'The session is closed');
    const payload = new TextEncoder().encode(JSON.stringify(message));
    if (payload.length > MAX_CONTROL_FRAME_BYTES) {
      throw new DropForgeError(ERROR_CODES.UNSUPPORTED_OPERATION, 'Control message too large', { context: { size: payload.length } });
    }
    const sealed = await this.crypto.sealJson(payload);
    this.transport.send(sealed);
  }

  async sendData(header: InnerDataHeader, chunk: Uint8Array): Promise<void> {
    if (this.closed) throw new DropForgeError(ERROR_CODES.CONNECTION_LOST, 'The session is closed');
    if (chunk.length > DATA_CHUNK_BYTES) {
      throw new DropForgeError(ERROR_CODES.UNSUPPORTED_OPERATION, 'Chunk larger than the negotiated size', {
        context: { size: chunk.length },
      });
    }
    const sealed = await this.crypto.sealData(encodeInnerData(header, chunk));
    this.transport.send(sealed);
  }

  /** Sends a handshake-era plain frame (only used before the session exists). */
  static encodePlain(json: unknown): Uint8Array {
    return encodeFrame(FRAME_PLAIN_JSON, new Uint8Array(0), new TextEncoder().encode(JSON.stringify(json)));
  }

  get bufferedBytes(): number {
    return this.transport.bufferedBytes;
  }

  async close(reason: SessionCloseReason = { kind: 'local', code: 'CLOSED_BY_USER' }): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.options.clock.clearInterval(this.keepaliveHandle);
    this.options.clock.clearTimeout(this.timeoutHandle);
    this.streams.clear();
    this.pendingPings.clear();
    this.crypto.destroy();
    await this.transport.close('session closed');
    this.events.emit('closed', reason);
  }

  /** Logs a diagnostic line without ever touching secrets. */
  describe(): Record<string, string> {
    return { transport: this.transport.kind, session: redact(String(this.crypto.framesSent)) };
  }
}
