/** Types for the dependency-free ZIP reader used to inspect the release archives. */
export { crc32 } from './zip.d.mts';

/**
 * Reads every file of a ZIP archive into memory, checking the CRC of each entry.
 * Throws when the archive is malformed, truncated, or uses a method this reader
 * does not implement (store and deflate are supported; ZIP64 is not).
 */
export declare function readZip(archive: Uint8Array): Map<string, Buffer>;
