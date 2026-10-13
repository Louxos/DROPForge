/**
 * In-memory implementation of the Transport port, used by the integration
 * tests. It models an ordered, reliable channel by default, and can be told to
 * lose frames, to stall or to cut the connection, so failure paths are tested
 * for real instead of being mocked away.
 */
import type { Transport, TransportError, TransportState, TransportStats, Unsubscribe } from '@dropforge/protocol';

export interface MemoryTransportOptions {
  /** Keep a copy of every frame this transport receives (tests only). */
  recordFrames?: boolean;
  /** Drop every outgoing frame for which this returns a reason. */
  dropWhen?: (frame: Uint8Array, direction: 'out') => string | undefined;
  /** Simulated one-way latency in ms (0 = deliver in a microtask). */
  latencyMs?: number;
}

export class MemoryTransport implements Transport {
  readonly kind = 'loopback' as const;
  private _state: TransportState = 'connecting';
  private readonly frameListeners = new Set<(frame: Uint8Array) => void>();
  private readonly stateListeners = new Set<(state: TransportState, error?: TransportError) => void>();
  private counters: TransportStats = {
    framesSent: 0,
    framesReceived: 0,
    bytesSent: 0,
    bytesReceived: 0,
    bufferedBytes: 0,
  };
  private dropped = 0;
  peer: MemoryTransport | undefined;
  /** Frames observed on this end, when `recordFrames` is enabled. */
  readonly observed: Uint8Array[] = [];

  constructor(private readonly options: MemoryTransportOptions = {}) {}

  get state(): TransportState {
    return this._state;
  }

  get bufferedBytes(): number {
    return this.counters.bufferedBytes;
  }

  get droppedFrames(): number {
    return this.dropped;
  }

  /** Links two transports and opens both ends. */
  static pair(options: MemoryTransportOptions = {}): [MemoryTransport, MemoryTransport] {
    const a = new MemoryTransport(options);
    const b = new MemoryTransport(options);
    a.peer = b;
    b.peer = a;
    a.open();
    b.open();
    return [a, b];
  }

  open(): void {
    this.setState('open');
  }

  send(frame: Uint8Array): void {
    if (this._state !== 'open') {
      throw new Error(`transport is ${this._state}`);
    }
    this.counters.framesSent += 1;
    this.counters.bytesSent += frame.length;
    const reason = this.options.dropWhen?.(frame, 'out');
    if (reason) {
      this.dropped += 1;
      return;
    }
    const peer = this.peer;
    if (!peer || peer._state !== 'open') {
      this.fail({ code: 'CONNECTION_LOST', message: 'The other side is no longer connected', retryable: true });
      return;
    }
    const deliver = (): void => {
      if (peer._state !== 'open') return;
      peer.counters.framesReceived += 1;
      peer.counters.bytesReceived += frame.length;
      // Copy the frame: a real transport never hands out a shared buffer.
      const copy = frame.slice();
      if (this.options.recordFrames) peer.observed.push(copy);
      for (const listener of [...peer.frameListeners]) listener(copy);
    };
    if (this.options.latencyMs && this.options.latencyMs > 0) setTimeout(deliver, this.options.latencyMs);
    else queueMicrotask(deliver);
  }

  onFrame(listener: (frame: Uint8Array) => void): Unsubscribe {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onState(listener: (state: TransportState, error?: TransportError) => void): Unsubscribe {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  statsSnapshot(): TransportStats {
    return { ...this.counters };
  }

  stats(): TransportStats {
    return { ...this.counters };
  }

  private setState(state: TransportState, error?: TransportError): void {
    this._state = state;
    for (const listener of [...this.stateListeners]) listener(state, error);
  }

  /** Simulates a network failure on both ends (no clean close handshake). */
  fail(error: TransportError = { code: 'CONNECTION_LOST', message: 'Network unreachable', retryable: true }): void {
    this.setState('failed', error);
    const peer = this.peer;
    if (peer && peer._state === 'open') peer.setState('failed', error);
  }

  async close(reason = 'closed'): Promise<void> {
    if (this._state === 'closed') return;
    this.setState('closed', { code: 'CLOSED', message: reason, retryable: false });
    const peer = this.peer;
    if (peer && peer._state !== 'closed' && peer._state !== 'failed') {
      peer.setState('closed', { code: 'CLOSED', message: 'peer closed', retryable: false });
    }
  }
}
