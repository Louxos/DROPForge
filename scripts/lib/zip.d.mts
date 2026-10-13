/** Types for the dependency-free ZIP writer used to build the release archives. */
export interface ZipEntry {
  /** Path inside the archive; `\` is normalised to `/`. */
  path: string;
  data: Uint8Array | string;
  /** Modification time; defaults to now (clamped to the DOS range). */
  date?: Date;
}

/** CRC-32 (IEEE 802.3) of the given bytes, as required by the ZIP format. */
export declare function crc32(data: Uint8Array): number;

/**
 * Writes a ZIP archive in memory. Entries that would grow when deflated are stored.
 * Throws if an entry has no path, or if the result would need Zip64.
 */
export declare function createZip(entries: ZipEntry[]): Uint8Array;
