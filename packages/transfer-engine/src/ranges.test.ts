import { describe, expect, it } from 'vitest';
import {
  chunkCountFor,
  chunksToRange,
  coveredBytes,
  isComplete,
  missingRanges,
  normaliseRanges,
  rangeSummary,
} from './ranges.js';

describe('range arithmetic for resume', () => {
  it('normalises, sorts and merges ranges', () => {
    expect(normaliseRanges([{ start: 10, end: 20 }, { start: 0, end: 5 }], 100)).toEqual([
      { start: 0, end: 5 },
      { start: 10, end: 20 },
    ]);
    expect(normaliseRanges([{ start: 0, end: 10 }, { start: 5, end: 20 }], 100)).toEqual([{ start: 0, end: 20 }]);
  });

  it('clamps to the file size and drops empty or out-of-bounds ranges', () => {
    expect(normaliseRanges([{ start: 90, end: 200 }, { start: 5, end: 5 }, { start: 500, end: 600 }], 100)).toEqual([
      { start: 90, end: 100 },
    ]);
  });

  it('computes what is still missing', () => {
    expect(missingRanges(100, [{ start: 0, end: 40 }])).toEqual([{ start: 40, end: 100 }]);
    expect(missingRanges(100, [])).toEqual([{ start: 0, end: 100 }]);
    expect(missingRanges(100, [{ start: 0, end: 100 }])).toEqual([]);
    expect(missingRanges(100, [{ start: 20, end: 30 }])).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 100 },
    ]);
  });

  it('reports completion only when every byte is covered', () => {
    expect(isComplete(100, [{ start: 0, end: 60 }, { start: 60, end: 100 }])).toBe(true);
    expect(isComplete(100, [{ start: 0, end: 99 }])).toBe(false);
    expect(coveredBytes([{ start: 0, end: 10 }, { start: 20, end: 25 }])).toBe(15);
  });

  it('maps chunk indices to byte ranges, including the short final chunk', () => {
    expect(chunkCountFor(0, 256)).toBe(1);
    expect(chunkCountFor(1, 256)).toBe(1);
    expect(chunkCountFor(256, 256)).toBe(1);
    expect(chunkCountFor(257, 256)).toBe(2);
    expect(chunksToRange(0, 2, 256, 257)).toEqual({ start: 0, end: 256 });
    expect(chunksToRange(1, 2, 256, 257)).toEqual({ start: 256, end: 257 });
  });

  it('summarises a partial file for the resume message', () => {
    expect(rangeSummary(10, [{ start: 0, end: 4 }])).toEqual({ complete: false, ranges: [{ start: 0, end: 4 }] });
    expect(rangeSummary(10, [{ start: 0, end: 10 }]).complete).toBe(true);
    expect(rangeSummary(10, []).ranges).toEqual([]);
  });
});
