/**
 * Integrity helpers. Uses @noble/hashes (MIT, audited, constant-time design) so
 * the exact same implementation runs in the browser, in Node and inside tests.
 * Streaming matters: files may be tens of gigabytes and must never be buffered.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';

export type DigestAlgorithm = 'sha-256';

export class Sha256Stream {
  private inner = sha256.create();

  update(chunk: Uint8Array): this {
    this.inner.update(chunk);
    return this;
  }

  /** Finalises and returns the digest; the stream must not be reused after. */
  digest(): Uint8Array {
    return this.inner.digest();
  }
}

export function sha256Bytes(data: Uint8Array): Uint8Array {
  return sha256(data);
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
    throw new Error('Invalid hexadecimal input');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function sha256Hex(data: Uint8Array): string {
  return toHex(sha256(data));
}

export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  return hmac(sha256, key, message);
}

/**
 * Compares two byte strings in constant time (no early exit on the first
 * difference), used for digests and authentication tags.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

/**
 * Human-readable fingerprint of a public key: sha-256 shortened to 8 groups of
 * 4 hex characters, e.g. "9F2C 1A44 …". Never truncate below this length when
 * it is used for out-of-band comparison.
 */
export function shortFingerprint(hex: string, groups = 4): string {
  const cleaned = hex.replace(/[^0-9a-f]/gi, '').toUpperCase();
  const parts: string[] = [];
  for (let i = 0; i < groups * 4 && i + 4 <= cleaned.length; i += 4) parts.push(cleaned.slice(i, i + 4));
  return parts.join(' ');
}
