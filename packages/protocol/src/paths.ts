/**
 * Path handling shared by every platform. A peer is untrusted input: received
 * paths are sanitised before they ever reach a filesystem or a download.
 *
 * Threat model (docs/THREAT-MODEL.md, T-PATH-*):
 *  - ".." traversal, absolute paths, Windows drive letters, UNC paths
 *  - leading/trailing separators, NUL bytes and other control characters
 *  - reserved Windows device names (CON, PRN, AUX, NUL, COM1.., LPT1..)
 *  - names that differ only by trailing dots/spaces on Windows
 *  - overlong paths and empty path segments
 */
import { MAX_PATH_BYTES } from './limits.js';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export class UnsafePathError extends Error {
  readonly code = 'PATH_UNSAFE';
  constructor(
    readonly input: string,
    reason: string,
  ) {
    super(`Unsafe path rejected (${reason})`);
    this.name = 'UnsafePathError';
  }
}

/** Strips the Windows-specific suffix rules that hide the real extension. */
function normaliseSegment(segment: string): string {
  // Windows ignores trailing dots and spaces: "evil.exe." resolves to "evil.exe".
  return segment.replace(/[ .]+$/g, '');
}

/**
 * Sanitises a relative path from a peer and returns its safe segments.
 * Throws `UnsafePathError` instead of silently rewriting, so the UI can ask
 * the user what to do.
 */
export function sanitiseRelativePath(input: string): string[] {
  if (CONTROL_CHARS.test(input)) throw new UnsafePathError(input, 'control characters');
  if (input.length === 0) throw new UnsafePathError(input, 'empty');
  const bytes = new TextEncoder().encode(input).length;
  if (bytes > MAX_PATH_BYTES) throw new UnsafePathError(input, 'too long');

  // Reject absolute or drive-qualified paths before normalising separators.
  if (input.startsWith('/') || input.startsWith('\\')) throw new UnsafePathError(input, 'absolute path');
  if (/^[a-zA-Z]:/.test(input)) throw new UnsafePathError(input, 'drive qualifier');
  if (input.startsWith('\\\\') || input.includes('://')) throw new UnsafePathError(input, 'UNC or URL path');

  const rawSegments = input.split(/[/\\]+/);
  const segments: string[] = [];
  for (const raw of rawSegments) {
    if (raw === '' || raw === '.') continue;
    if (raw === '..') throw new UnsafePathError(input, 'parent traversal');
    const segment = normaliseSegment(raw);
    if (segment === '' || segment === '.' || segment === '..') {
      throw new UnsafePathError(input, 'degenerate segment');
    }
    if (WINDOWS_RESERVED.test(segment)) throw new UnsafePathError(input, 'reserved device name');
    segments.push(segment);
  }
  if (segments.length === 0) throw new UnsafePathError(input, 'no usable segment');
  if (segments.length > 64) throw new UnsafePathError(input, 'too many segments');
  return segments;
}

/** Safe, displayable path (segments joined with "/"). */
export function safeRelativePath(input: string): string {
  return sanitiseRelativePath(input).join('/');
}

export function isSafeRelativePath(input: string): boolean {
  try {
    sanitiseRelativePath(input);
    return true;
  } catch {
    return false;
  }
}

/** Splits "a/b/c.txt" into { dir: "a/b", base: "c.txt" }. */
export function splitPath(path: string): { dir: string; base: string } {
  const idx = path.lastIndexOf('/');
  if (idx < 0) return { dir: '', base: path };
  return { dir: path.slice(0, idx), base: path.slice(idx + 1) };
}

export function joinPath(dir: string, base: string): string {
  return dir === '' ? base : `${dir}/${base}`;
}

/**
 * Adds a " (n)" suffix before the extension until `taken` accepts it.
 * Used for the "rename" conflict policy and for never overwriting silently.
 */
export function uniqueName(
  desiredPath: string,
  taken: (candidate: string) => boolean,
  maxAttempts = 500,
): string {
  if (!taken(desiredPath)) return desiredPath;
  const { dir, base } = splitPath(desiredPath);
  const dot = base.lastIndexOf('.');
  const hasExt = dot > 0;
  const stem = hasExt ? base.slice(0, dot) : base;
  const ext = hasExt ? base.slice(dot) : '';
  for (let n = 1; n <= maxAttempts; n += 1) {
    const candidate = joinPath(dir, `${stem} (${n})${ext}`);
    if (!taken(candidate)) return candidate;
  }
  const stamp = Date.now().toString(36);
  return joinPath(dir, `${stem}-${stamp}${ext}`);
}

/** Redacts a user path for logs: keeps the extension only. */
export function redactPath(path: string): string {
  const { base } = splitPath(path);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? `…${base.slice(dot)}` : '…';
}
