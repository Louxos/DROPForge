/**
 * Inner header of a sealed data frame. This header is *inside* the ciphertext:
 * the relay never sees it, and it never reveals file names or sizes by itself.
 *
 * Layout (big-endian):
 *
 *   flags(1) | streamIndex(u16) | fileIndex(u16) | chunkIndex(u32) | chunk bytes…
 *
 * - `streamIndex` lets several transfers share one peer session (concurrency is
 *   user-configurable). It is allocated per active transfer and released at the
 *   end of the transfer.
 * - `fileIndex` indexes the manifest entries of that transfer.
 * - `chunkIndex` is the zero-based chunk number inside that file.
 *
 * flags bit 0: LAST_CHUNK (last chunk of this file)
 * flags bit 1: EMPTY_FILE  (zero-length file, chunk bytes must be empty)
 */
import { FrameError } from './frames.js';

export const DATA_FLAG_LAST_CHUNK = 0b0000_0001;
export const DATA_FLAG_EMPTY_FILE = 0b0000_0010;

export const DATA_INNER_HEADER_BYTES = 9;
export const MAX_FILE_INDEX = 0xffff;
export const MAX_STREAM_INDEX = 0xffff;

export interface InnerDataHeader {
  streamIndex: number;
  fileIndex: number;
  chunkIndex: number;
  lastChunk: boolean;
  emptyFile: boolean;
}

const view = (buf: Uint8Array) => new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

export function encodeInnerData(header: InnerDataHeader, chunk: Uint8Array): Uint8Array {
  if (header.fileIndex < 0 || header.fileIndex > MAX_FILE_INDEX) {
    throw new FrameError('DATA_BAD_FILE_INDEX', `fileIndex out of range: ${header.fileIndex}`);
  }
  if (header.streamIndex < 0 || header.streamIndex > MAX_STREAM_INDEX) {
    throw new FrameError('DATA_BAD_STREAM_INDEX', `streamIndex out of range: ${header.streamIndex}`);
  }
  if (header.chunkIndex < 0 || header.chunkIndex > 0xffffffff) {
    throw new FrameError('DATA_BAD_CHUNK_INDEX', `chunkIndex out of range: ${header.chunkIndex}`);
  }
  const out = new Uint8Array(DATA_INNER_HEADER_BYTES + chunk.length);
  const dv = view(out);
  out[0] = (header.lastChunk ? DATA_FLAG_LAST_CHUNK : 0) | (header.emptyFile ? DATA_FLAG_EMPTY_FILE : 0);
  dv.setUint16(1, header.streamIndex);
  dv.setUint16(3, header.fileIndex);
  dv.setUint32(5, header.chunkIndex);
  out.set(chunk, DATA_INNER_HEADER_BYTES);
  return out;
}

export function decodeInnerData(bytes: Uint8Array): { header: InnerDataHeader; chunk: Uint8Array } {
  if (bytes.length < DATA_INNER_HEADER_BYTES) {
    throw new FrameError('DATA_TRUNCATED', 'Sealed data frame shorter than its inner header');
  }
  const flags = bytes[0] ?? 0;
  const dv = view(bytes);
  return {
    header: {
      streamIndex: dv.getUint16(1),
      fileIndex: dv.getUint16(3),
      chunkIndex: dv.getUint32(5),
      lastChunk: (flags & DATA_FLAG_LAST_CHUNK) !== 0,
      emptyFile: (flags & DATA_FLAG_EMPTY_FILE) !== 0,
    },
    chunk: bytes.slice(DATA_INNER_HEADER_BYTES),
  };
}
