import { describe, expect, it } from 'vitest';
import { Sha256Stream, fromHex, hmacSha256, sha256Bytes, sha256Hex, shortFingerprint, timingSafeEqual, toHex } from './checksum.js';
import { canonicalJson, canonicalJsonUnsafe, CanonicalJsonError } from './canonical.js';
import { fromBase64Url, toBase64Url, utf8 } from './encoding.js';

describe('sha-256 streaming', () => {
  it('matches the one-shot digest for the same content', () => {
    const data = new Uint8Array(4096);
    for (let i = 0; i < data.length; i += 1) data[i] = i % 251;
    const stream = new Sha256Stream();
    for (let offset = 0; offset < data.length; offset += 512) {
      stream.update(data.subarray(offset, offset + 512));
    }
    expect(toHex(stream.digest())).toBe(sha256Hex(data));
  });

  it('matches the well-known digest of the empty string', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('round-trips hex and detects malformed input', () => {
    const bytes = sha256Bytes(utf8('dropforge'));
    expect(fromHex(toHex(bytes))).toEqual(bytes);
    expect(() => fromHex('zz')).toThrow();
    expect(() => fromHex('abc')).toThrow();
  });
});

describe('constant-time comparison', () => {
  it('compares equal and different buffers without early exit', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it('computes hmac-sha256 with a known vector', () => {
    // RFC 4231 test case 1.
    const key = new Uint8Array(20).fill(0x0b);
    const mac = hmacSha256(key, utf8('Hi There'));
    expect(toHex(mac)).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  });

  it('formats short fingerprints in readable groups', () => {
    const hex = '9f2c1a44b8e1c0d3e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c';
    expect(shortFingerprint(hex)).toBe('9F2C 1A44 B8E1 C0D3');
  });
});

describe('canonical JSON', () => {
  it('sorts keys recursively so both peers hash identical bytes', () => {
    const a = canonicalJson({ b: 1, a: { d: [2, 1], c: 'x' } });
    const b = canonicalJson({ a: { c: 'x', d: [2, 1] }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":"x","d":[2,1]},"b":1}');
  });

  it('refuses values that cannot be canonicalised', () => {
    expect(() => canonicalJsonUnsafe({ a: Number.NaN })).toThrow(CanonicalJsonError);
    expect(() => canonicalJsonUnsafe({ a: undefined })).toThrow(CanonicalJsonError);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJsonUnsafe(cyclic)).toThrow(/Circular/);
  });

  it('treats -0 and 0 identically', () => {
    expect(canonicalJsonUnsafe({ v: -0 })).toBe('{"v":0}');
  });
});

describe('base64url encoding', () => {
  it('round-trips arbitrary bytes and rejects invalid input', () => {
    const bytes = new Uint8Array(300);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 7) % 256;
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    expect(() => fromBase64Url('a+b/c')).toThrow();
  });

  it('produces url-safe output without padding', () => {
    const encoded = toBase64Url(new Uint8Array([251, 255, 254, 1]));
    expect(encoded).not.toMatch(/[+/=]/);
  });
});
