/**
 * Encoding, canonical-bytes and capability detection helpers.
 *
 * Cryptographic rule of the project: we never invent an algorithm. Only
 * primitives provided by the platform WebCrypto implementation (or an audited,
 * widely reviewed library) are used:
 *   - key agreement : X25519 (preferred) or ECDH P-256 (fallback)
 *   - signatures    : Ed25519 (preferred) or ECDSA P-256 (fallback)
 *   - AEAD          : AES-256-GCM
 *   - KDF           : HKDF-SHA-256
 *   - digests       : SHA-256 (@noble/hashes, streaming)
 */

export {
  canonicalJson,
  canonicalJsonUnsafe,
  canonicalBytes,
  utf8,
  fromUtf8,
  toBase64Url,
  fromBase64Url,
  randomBytes,
  type CanonicalValue,
} from '@dropforge/protocol';

export interface CryptoCapabilities {
  ed25519: boolean;
  x25519: boolean;
  p256Ecdh: boolean;
  p256Ecdsa: boolean;
  aesGcm256: boolean;
  hkdfSha256: boolean;
}

/**
 * Detects once, at startup, which algorithms really work in this runtime.
 * Results are cached: probing keys is not free and capabilities cannot change
 * during a session.
 */
let cached: CryptoCapabilities | undefined;

export async function detectCryptoCapabilities(subtle?: SubtleCrypto): Promise<CryptoCapabilities> {
  // A caller-provided implementation (tests, WebView bridges) bypasses the cache.
  const explicit = subtle !== undefined;
  if (!explicit && cached) return cached;
  const impl: SubtleCrypto | undefined = explicit ? subtle : globalThis.crypto?.subtle;
  const probe = async (fn: () => Promise<unknown>): Promise<boolean> => {
    if (!impl) return false;
    try {
      await fn();
      return true;
    } catch {
      return false;
    }
  };
  const caps: CryptoCapabilities = {
    ed25519: await probe(async () => {
      const kp = (await impl!.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
      const sig = await impl!.sign({ name: 'Ed25519' }, kp.privateKey, new Uint8Array([1]));
      if (!(await impl!.verify({ name: 'Ed25519' }, kp.publicKey, sig, new Uint8Array([1])))) {
        throw new Error('ed25519 verify failed');
      }
    }),
    x25519: await probe(async () => {
      const kp = (await impl!.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair;
      await impl!.exportKey('raw', kp.publicKey);
    }),
    p256Ecdh: await probe(async () => {
      await impl!.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    }),
    p256Ecdsa: await probe(async () => {
      await impl!.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    }),
    aesGcm256: await probe(async () => {
      await impl!.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    }),
    hkdfSha256: await probe(async () => {
      const key = await impl!.importKey('raw', new Uint8Array(32), 'HKDF', false, ['deriveBits']);
      await impl!.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new Uint8Array([1]) },
        key,
        256,
      );
    }),
  };
  // Only the runtime's own implementation is cached.
  if (!explicit) cached = caps;
  return caps;
}

/** Test-only: forget the probed capabilities. */
export function resetCryptoCapabilitiesCache(): void {
  cached = undefined;
}

export class CryptoUnavailableError extends Error {
  readonly code = 'CRYPTO_UNAVAILABLE';
  constructor(
    readonly missing: readonly string[],
    message = 'Required cryptographic functions are unavailable in this runtime',
  ) {
    super(message);
    this.name = 'CryptoUnavailableError';
  }
}

/**
 * Throws unless the runtime can perform what a secure session needs.
 * Callers surface a clear, non-technical message and refuse to transfer instead
 * of degrading silently to something insecure.
 */
export async function requireSecureCrypto(subtle?: SubtleCrypto): Promise<CryptoCapabilities> {
  const caps = await detectCryptoCapabilities(subtle);
  const missing: string[] = [];
  if (!caps.aesGcm256) missing.push('aes-256-gcm');
  if (!caps.hkdfSha256) missing.push('hkdf-sha-256');
  if (!(caps.x25519 || caps.p256Ecdh)) missing.push('key-agreement');
  if (!(caps.ed25519 || caps.p256Ecdsa)) missing.push('signatures');
  const runtime =
    typeof crypto === 'undefined'
      ? undefined
      : (crypto as { getRandomValues?: unknown; subtle?: unknown });
  if (
    !runtime ||
    typeof runtime.getRandomValues !== 'function' ||
    (subtle === undefined && typeof runtime.subtle === 'undefined')
  ) {
    missing.push('webcrypto');
  }
  if (missing.length > 0) throw new CryptoUnavailableError(missing);
  return caps;
}
