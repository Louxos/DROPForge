/**
 * Half-open byte-range arithmetic ([start, end)) used for resume.
 * Ranges are always normalised: sorted, merged, non-overlapping, non-empty.
 */

export interface ByteRange {
  start: number;
  end: number;
}

export function normaliseRanges(ranges: readonly ByteRange[], limit: number): ByteRange[] {
  const clean = ranges
    .filter((r) => r.end > r.start && r.start < limit && r.start >= 0)
    .map((r) => ({ start: Math.max(0, r.start), end: Math.min(limit, r.end) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: ByteRange[] = [];
  for (const range of clean) {
    const last = out[out.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      out.push({ ...range });
    }
  }
  return out;
}

/** Parts of [0, limit) that are not yet covered by `done`. */
export function missingRanges(limit: number, done: readonly ByteRange[]): ByteRange[] {
  const covered = normaliseRanges(done, limit);
  const out: ByteRange[] = [];
  let cursor = 0;
  for (const range of covered) {
    if (range.start > cursor) out.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < limit) out.push({ start: cursor, end: limit });
  return out;
}

export function coveredBytes(ranges: readonly ByteRange[]): number {
  return ranges.reduce((sum, r) => sum + Math.max(0, r.end - r.start), 0);
}

export function isComplete(limit: number, done: readonly ByteRange[]): boolean {
  return coveredBytes(normaliseRanges(done, limit)) >= limit;
}

/** Converts chunk indices to a byte range, clamped to the file size. */
export function chunksToRange(
  chunkIndex: number,
  chunkCount: number,
  chunkBytes: number,
  fileSize: number,
): ByteRange {
  const start = Math.min(chunkIndex * chunkBytes, fileSize);
  const end = chunkIndex >= chunkCount - 1 ? fileSize : Math.min(start + chunkBytes, fileSize);
  return { start, end: Math.max(start, end) };
}

export function chunkCountFor(fileSize: number, chunkBytes: number): number {
  if (fileSize === 0) return 1; // one empty chunk carries the "file done" signal
  return Math.ceil(fileSize / chunkBytes);
}

/**
 * Describes a partially received file for the resume manifest, in the compact
 * shape accepted by `transferAccept.existing`.
 */
export function rangeSummary(limit: number, done: readonly ByteRange[]): { complete: boolean; ranges: ByteRange[] } {
  const normalised = normaliseRanges(done, limit);
  return { complete: coveredBytes(normalised) >= limit, ranges: normalised };
}
