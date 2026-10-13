/**
 * Minimal ZIP reader — the counterpart of `zip.mjs`, with no dependency.
 *
 * It exists so the release archives can be verified from anywhere: the smoke test
 * extracts what will actually be downloaded, on any machine, without `unzip`,
 * PowerZip or a build tool. It reads the central directory (the table of contents a
 * real tool uses) and inflates each entry with `zlib`.
 *
 * Deliberately limited: methods `store` and `deflate` (what the writer emits), no
 * ZIP64, no encryption, no multi-disk. Anything else is reported as an error rather
 * than guessed at.
 */
import { inflateRawSync } from 'node:zlib';
import { crc32 } from './zip.mjs';

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;

// The checksum has to be the same on both sides: it comes from the writer, not from a
// second implementation that could drift.
export { crc32 };
/** Last position of a 4-byte signature, scanning backwards. */
function lastIndexOfSignature(buffer, signature) {
  for (let index = buffer.length - 4; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === signature) return index;
  }
  return -1;
}

/**
 * Reads every file of a ZIP archive.
 *
 * @param {Uint8Array} archive
 * @returns {Map<string, Buffer>} path (as stored, `/` separated) → content
 */
export function readZip(archive) {
  const buffer = Buffer.isBuffer(archive) ? archive : Buffer.from(archive);
  const end = lastIndexOfSignature(buffer, END_OF_CENTRAL);
  if (end < 0) throw new Error('not a ZIP archive: no end-of-central-directory record');

  const entryCount = buffer.readUInt16LE(end + 10);
  const centralSize = buffer.readUInt32LE(end + 12);
  const centralOffset = buffer.readUInt32LE(end + 16);
  if (centralOffset + centralSize !== end) {
    throw new Error('corrupt ZIP archive: the central directory does not end where it says');
  }
  if (centralOffset === 0xffffffff || entryCount === 0xffff) {
    throw new Error('ZIP64 archives are not supported by this reader');
  }

  const files = new Map();
  let cursor = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_HEADER) {
      throw new Error(`corrupt ZIP archive: entry ${index} has no central header`);
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const expectedCrc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue; // directory entry
    if (localOffset === 0xffffffff) throw new Error('ZIP64 archives are not supported by this reader');
    if (buffer.readUInt32LE(localOffset) !== LOCAL_HEADER) {
      throw new Error(`corrupt ZIP archive: ${name} has no local header`);
    }

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const body = buffer.subarray(start, start + compressedSize);

    let data;
    if (method === 0) data = Buffer.from(body);
    else if (method === 8) data = inflateRawSync(body);
    else throw new Error(`unsupported compression method ${method} for ${name}`);

    if (data.length !== uncompressedSize) {
      throw new Error(`${name}: expected ${uncompressedSize} bytes, got ${data.length}`);
    }
    if (crc32(data) !== expectedCrc) throw new Error(`${name}: checksum mismatch`);
    files.set(name, data);
  }

  return files;
}
