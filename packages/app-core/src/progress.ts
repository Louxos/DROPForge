/**
 * Speed and remaining-time estimation.
 *
 * The spec is explicit: never show a fake progress bar, and only show an
 * estimate when it is actually reliable. This meter therefore:
 *  - works on real acknowledged bytes, never on "sent to the socket";
 *  - reports `reliable: false` until enough time and samples have accumulated;
 *  - reports no ETA at all when the rate is unstable (variance too high), a
 *    stalled connection, or the remaining size is unknown.
 */

export interface SpeedSample {
  at: number;
  bytes: number;
}

export interface SpeedReading {
  bytesPerSecond: number | undefined;
  /** Seconds remaining, only when computed from a stable rate. */
  etaSeconds: number | undefined;
  reliable: boolean;
  /** Standard deviation divided by the mean rate (0 when no jitter). */
  variation: number;
}

export class SpeedMeter {
  private samples: SpeedSample[] = [];
  private totalBytes = 0;

  constructor(
    private readonly windowMs = 8_000,
    private readonly minSamples = 4,
    private readonly minElapsedMs = 3_000,
    private readonly maxVariation = 0.85,
  ) {}

  reset(): void {
    this.samples = [];
    this.totalBytes = 0;
  }

  /** Records durably acknowledged bytes (never optimistic estimates). */
  add(bytes: number, at: number): void {
    if (bytes <= 0) return;
    this.totalBytes += bytes;
    this.samples.push({ at, bytes });
    const cutoff = at - this.windowMs;
    while (this.samples.length > 0 && (this.samples[0] as SpeedSample).at < cutoff) this.samples.shift();
  }

  /** Bytes counted since the last reset. */
  get acknowledgedBytes(): number {
    return this.totalBytes;
  }

  read(now: number, remainingBytes?: number): SpeedReading {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last) return { bytesPerSecond: undefined, etaSeconds: undefined, reliable: false, variation: 1 };
    const elapsed = last.at - first.at;
    const bytes = this.samples.reduce((sum, s) => sum + s.bytes, 0);
    if (elapsed < this.minElapsedMs || this.samples.length < this.minSamples || bytes === 0) {
      return { bytesPerSecond: undefined, etaSeconds: undefined, reliable: false, variation: 1 };
    }
    const rate = (bytes / elapsed) * 1000;
    // Per-interval rates, to judge stability rather than instantaneous burstiness.
    const intervals: number[] = [];
    for (let i = 1; i < this.samples.length; i += 1) {
      const prev = this.samples[i - 1] as SpeedSample;
      const cur = this.samples[i] as SpeedSample;
      const dt = cur.at - prev.at;
      if (dt > 0) intervals.push((cur.bytes / dt) * 1000);
    }
    let variation = 1;
    if (intervals.length >= 2) {
      const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      if (mean > 0) {
        const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
        variation = Math.sqrt(variance) / mean;
      }
    }
    // A peer that stopped acknowledging bytes for a whole window is stalled.
    const stalled = now - last.at > this.windowMs;
    const reliable = !stalled && variation <= this.maxVariation;
    const etaSeconds =
      reliable && remainingBytes !== undefined && remainingBytes > 0 && rate > 0
        ? Math.ceil(remainingBytes / rate)
        : undefined;
    return { bytesPerSecond: rate, etaSeconds, reliable, variation };
  }
}

/** Formats a duration; shows "—" when the value is not reliable. */
export function formatEta(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours} h` : `${hours} h ${rem.toString().padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const decimals = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[unit]}`;
}

export function formatSpeed(bytesPerSecond: number | undefined): string {
  if (bytesPerSecond === undefined || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—';
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** Exponential backoff with jitter, capped. Used for reconnect and chunk retries. */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number, random = Math.random): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  // Full jitter avoids synchronised retries between peers.
  return Math.round(exponential * (0.5 + random() * 0.5));
}
