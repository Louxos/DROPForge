/**
 * Ports (seam contracts) shared by the engine, the connection manager and the
 * platform layers. Keeping them here avoids cyclic dependencies between
 * packages: everyone depends on @dropforge/protocol, nobody depends on
 * everyone.
 */

export type TransportKind = 'webrtc' | 'relay' | 'loopback';

export type TransportState = 'idle' | 'connecting' | 'open' | 'closing' | 'closed' | 'failed';

export interface TransportStats {
  /** Frames handed to the transport since it opened. */
  framesSent: number;
  framesReceived: number;
  /** Application bytes (excluding framing/encryption overhead). */
  bytesSent: number;
  bytesReceived: number;
  /** Bytes currently queued because the wire is slower than the source. */
  bufferedBytes: number;
  /** Round-trip time in ms when measured, otherwise undefined. */
  rttMs?: number;
}

export interface TransportError {
  code: string;
  message: string;
  /** Whether a retry on this or another transport can succeed. */
  retryable: boolean;
}

export type Unsubscribe = () => void;

/**
 * A bidirectional, ordered, framed channel to exactly one peer.
 * Implementations: WebRTC DataChannel, blind relay over WebSocket, in-memory loopback.
 */
export interface Transport {
  readonly kind: TransportKind;
  readonly state: TransportState;
  /** Number of bytes waiting in the send buffer (backpressure signal). */
  readonly bufferedBytes: number;
  send(frame: Uint8Array): void;
  onFrame(listener: (frame: Uint8Array) => void): Unsubscribe;
  onState(listener: (state: TransportState, error?: TransportError) => void): Unsubscribe;
  stats(): TransportStats;
  close(reason?: string): Promise<void>;
}

export interface Clock {
  now(): number;
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as never),
  setInterval: (handler, ms) => globalThis.setInterval(handler, ms),
  clearInterval: (handle) => globalThis.clearInterval(handle as never),
};

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured logger. Implementations must never receive secrets, keys, access
 * tokens or file contents: callers are responsible for redaction, and the
 * `redact` helper below is the only sanctioned way to log identifiers.
 */
export interface Logger {
  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void;
}

export const noopLogger: Logger = { log: () => {} };

export function consoleLogger(prefix = 'dropforge'): Logger {
  return {
    log(level, message, fields) {
      const line = fields ? `${message} ${JSON.stringify(fields)}` : message;
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      fn(`[${prefix}] ${level}: ${line}`);
    },
  };
}

/** Shows only a stable prefix of an identifier, never the whole secret. */
export function redact(value: string, keep = 6): string {
  if (value.length <= keep) return '…';
  return `${value.slice(0, keep)}…`;
}
