import { describe, expect, it } from 'vitest';
import {
  FRAME_PLAIN_JSON,
  FRAME_SEALED_DATA,
  FRAME_SEALED_JSON,
  FrameError,
  decodeFrame,
  encodeFrame,
  frameKindOf,
} from './frames.js';
import { encodeInnerData, decodeInnerData } from './data-frame.js';
import { MAX_SEALED_FRAME_BYTES } from './limits.js';

describe('frame layer', () => {
  it('round-trips a sealed frame', () => {
    const nonce = new Uint8Array(12).fill(7);
    const body = new Uint8Array([1, 2, 3, 4]);
    const frame = encodeFrame(FRAME_SEALED_DATA, nonce, body);
    const decoded = decodeFrame(frame, MAX_SEALED_FRAME_BYTES);
    expect(decoded.kind).toBe(FRAME_SEALED_DATA);
    expect([...decoded.nonce]).toEqual([...nonce]);
    expect([...decoded.body]).toEqual([...body]);
  });

  it('round-trips a plain handshake frame without a nonce', () => {
    const frame = encodeFrame(FRAME_PLAIN_JSON, new Uint8Array(0), new TextEncoder().encode('{"t":"hello"}'));
    const decoded = decodeFrame(frame, 1024);
    expect(decoded.kind).toBe(FRAME_PLAIN_JSON);
    expect(decoded.nonce.length).toBe(0);
  });

  it('refuses a plain frame that carries a nonce, and a sealed frame without one', () => {
    expect(() => encodeFrame(FRAME_PLAIN_JSON, new Uint8Array(12), new Uint8Array(1))).toThrow(FrameError);
    expect(() => encodeFrame(FRAME_SEALED_JSON, new Uint8Array(4), new Uint8Array(1))).toThrow(FrameError);
  });

  it('rejects oversized, truncated and unknown frames', () => {
    const big = encodeFrame(FRAME_SEALED_DATA, new Uint8Array(12), new Uint8Array(100));
    expect(() => decodeFrame(big, 10)).toThrow(/exceeds limit/);
    expect(() => decodeFrame(new Uint8Array([FRAME_SEALED_JSON]), 1024)).toThrow(/shorter than its header/);
    const unknown = new Uint8Array(13);
    unknown[0] = 0x7f;
    expect(() => decodeFrame(unknown, 1024)).toThrow(/Unknown frame kind/);
  });

  it('lets the relay peek at the kind without parsing anything', () => {
    const frame = encodeFrame(FRAME_SEALED_DATA, new Uint8Array(12), new Uint8Array(4));
    expect(frameKindOf(frame)).toBe(FRAME_SEALED_DATA);
    expect(frameKindOf(new Uint8Array(3))).toBeUndefined();
  });
});

describe('inner data header', () => {
  it('round-trips stream, file and chunk indices', () => {
    const chunk = new Uint8Array([9, 9, 9]);
    const encoded = encodeInnerData(
      { streamIndex: 3, fileIndex: 42, chunkIndex: 1234, lastChunk: true, emptyFile: false },
      chunk,
    );
    const { header, chunk: decodedChunk } = decodeInnerData(encoded);
    expect(header).toEqual({ streamIndex: 3, fileIndex: 42, chunkIndex: 1234, lastChunk: true, emptyFile: false });
    expect([...decodedChunk]).toEqual([9, 9, 9]);
  });

  it('marks empty files explicitly', () => {
    const encoded = encodeInnerData(
      { streamIndex: 0, fileIndex: 0, chunkIndex: 0, lastChunk: true, emptyFile: true },
      new Uint8Array(0),
    );
    const { header } = decodeInnerData(encoded);
    expect(header.emptyFile).toBe(true);
    expect(header.lastChunk).toBe(true);
  });

  it('rejects out-of-range indices instead of truncating them', () => {
    expect(() =>
      encodeInnerData({ streamIndex: 0, fileIndex: 70000, chunkIndex: 0, lastChunk: false, emptyFile: false }, new Uint8Array(0)),
    ).toThrow(/fileIndex/);
    expect(() => decodeInnerData(new Uint8Array(4))).toThrow(/shorter than its inner header/);
  });
});
