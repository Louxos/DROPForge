import { describe, expect, it } from 'vitest';
import { SpeedMeter, backoffDelay, formatBytes, formatEta, formatSpeed } from './progress.js';

describe('SpeedMeter', () => {
  it('reports nothing until enough real samples exist', () => {
    const meter = new SpeedMeter(8000, 4, 3000);
    meter.add(1000, 1000);
    const reading = meter.read(1000, 10_000);
    expect(reading.bytesPerSecond).toBeUndefined();
    expect(reading.etaSeconds).toBeUndefined();
    expect(reading.reliable).toBe(false);
  });

  it('computes a rate and a remaining time once the rate is stable', () => {
    const meter = new SpeedMeter(8000, 4, 1000);
    for (let i = 0; i < 10; i += 1) meter.add(100_000, i * 500);
    const reading = meter.read(4500, 500_000);
    expect(reading.reliable).toBe(true);
    expect(reading.bytesPerSecond).toBeGreaterThan(100_000);
    expect(reading.etaSeconds).toBeGreaterThan(0);
    expect(reading.variation).toBeLessThan(0.85);
  });

  it('refuses to display an estimate when the rate is erratic', () => {
    const meter = new SpeedMeter(8000, 4, 1000);
    const bursts = [0, 10_000_000, 1_000, 9_000_000, 500, 8_000_000];
    bursts.forEach((bytes, index) => meter.add(bytes, index * 500));
    const reading = meter.read(2500, 1_000_000);
    expect(reading.reliable).toBe(false);
    expect(reading.etaSeconds).toBeUndefined();
  });

  it('treats a stalled peer as unreliable instead of showing a stale speed', () => {
    const meter = new SpeedMeter(2000, 4, 1000);
    for (let i = 0; i < 6; i += 1) meter.add(50_000, i * 200);
    const reading = meter.read(20_000, 500_000);
    expect(reading.reliable).toBe(false);
    expect(reading.etaSeconds).toBeUndefined();
  });

  it('counts only positive acknowledgements', () => {
    const meter = new SpeedMeter();
    meter.add(0, 0);
    meter.add(-5, 10);
    expect(meter.acknowledgedBytes).toBe(0);
    meter.add(42, 20);
    expect(meter.acknowledgedBytes).toBe(42);
    meter.reset();
    expect(meter.acknowledgedBytes).toBe(0);
  });
});

describe('formatters', () => {
  it('formats bytes with sensible precision', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.00 KB');
    expect(formatBytes(1024 * 1024 * 3.5)).toBe('3.50 MB');
    expect(formatBytes(-1)).toBe('—');
  });

  it('never invents a remaining time', () => {
    expect(formatEta(undefined)).toBe('—');
    expect(formatEta(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatEta(30)).toBe('30 s');
    expect(formatEta(90)).toBe('1 min');
    expect(formatEta(3600 * 2 + 180)).toBe('2 h 03');
  });

  it('never invents a speed', () => {
    expect(formatSpeed(undefined)).toBe('—');
    expect(formatSpeed(0)).toBe('—');
    expect(formatSpeed(2048)).toBe('2.00 KB/s');
  });
});

describe('backoff', () => {
  it('grows exponentially and stays capped', () => {
    expect(backoffDelay(1, 500, 8000, () => 1)).toBe(500);
    expect(backoffDelay(2, 500, 8000, () => 1)).toBe(1000);
    expect(backoffDelay(10, 500, 8000, () => 1)).toBe(8000);
    // Jitter must stay inside [50%, 100%] of the exponential value.
    const jittered = backoffDelay(3, 500, 8000, () => 0);
    expect(jittered).toBe(1000);
  });
});
