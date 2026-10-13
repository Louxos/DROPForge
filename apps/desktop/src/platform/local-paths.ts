/**
 * Pure helpers for the Windows filesystem layer.
 *
 * They live on their own so they can be unit tested without a running Tauri
 * runtime: everything here is a string operation, no I/O, no plugin import.
 */

/**
 * Joins a **already validated** relative path under a root, keeping the separator
 * style of the root: Windows paths get backslashes, POSIX paths slashes.
 *
 * Validation is not this function's job — `safeRelativePath` / `isSafeRelativePath`
 * from `@dropforge/protocol` do that, and the root is one the user picked themselves.
 */
export function joinUnder(root: string, relative: string): string {
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const cleanRoot = root.replace(/[\\/]+$/, '');
  const cleanRelative = relative.replace(/^[\\/]+/, '');
  if (cleanRelative === '') return cleanRoot;
  return `${cleanRoot}${separator}${cleanRelative.split(/[\\/]/).join(separator)}`;
}

/** The parent of an absolute path, or `undefined` when there is none. */
export function parentOf(absolute: string): string | undefined {
  const index = Math.max(absolute.lastIndexOf('/'), absolute.lastIndexOf('\\'));
  if (index <= 0) return undefined;
  const parent = absolute.slice(0, index);
  // `C:` is not a folder: creating under it would depend on the drive's current
  // directory, which is exactly the kind of surprise this layer must not have.
  if (/^[A-Za-z]:$/.test(parent)) return undefined;
  return parent;
}
