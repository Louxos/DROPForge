/**
 * Long-term device identity.
 *
 * The identity is a signature key pair generated on the device and never
 * exported in clear:
 *   - platform-tauri : stored in the OS keystore / app data directory, mode 0600
 *   - platform-web   : stored in IndexedDB, flagged as non-extractable where the
 *                      runtime allows it; the UI states that browser storage is
 *                      weaker than a desktop keystore (documented honestly)
 *
 * The identity fingerprint (SHA-256 of the public key) is what a user compares
 * out of band and what "trusted device" records bind to. A display name is
 * never trusted as an identity.
 */
import { sha256Bytes, toHex, timingSafeEqual } from '@dropforge/protocol';
import {
  CryptoUnavailableError,
  detectCryptoCapabilities,
  fromBase64Url,
  randomBytes,
  toBase64Url,
  utf8,
} from './crypto.js';
import type { KeyAgreementAlg, SignatureAlg } from '@dropforge/protocol';

export interface PublicIdentity {
  sign: SignatureAlg;
  /** base64url, raw public key. */
  publicKey: string;
  /** sha-256 hex of the raw public key bytes. */
  fingerprint: string;
}

export interface DeviceIdentity extends PublicIdentity {
  readonly agree: KeyAgreementAlg;
}

export interface StoredIdentity {
  /** Version of the persisted record, for migrations. */
  v: 1;
  agree: KeyAgreementAlg;
  sign: SignatureAlg;
  /** base64url of the raw public key. */
  publicKey: string;
  /** CryptoKey handles are platform objects; the storage layer decides how to persist. */
  privateKey: CryptoKey;
  publicKeyRef: CryptoKey;
}

export async function fingerprintOf(publicKeyBytes: Uint8Array): Promise<string> {
  return toHex(sha256Bytes(publicKeyBytes));
}

export async function exportPublicKey(key: CryptoKey): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(raw);
}

async function generateSignatureKeys(
  alg: SignatureAlg,
): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }> {
  if (alg === 'ed25519') {
    const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    return { publicKey: kp.publicKey, privateKey: kp.privateKey };
  }
  const kp = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

/**
 * Creates a device identity. Chooses the strongest algorithms the runtime
 * actually supports, never a weaker one silently: if neither Ed25519 nor ECDSA
 * is available, this throws and the caller refuses to create an identity.
 */
export async function createDeviceIdentity(): Promise<StoredIdentity> {
  const caps = await detectCryptoCapabilities();
  const sign: SignatureAlg = caps.ed25519 ? 'ed25519' : 'ecdsa-p256';
  const agree: KeyAgreementAlg = caps.x25519 ? 'x25519' : 'p256';
  if (!caps.ed25519 && !caps.p256Ecdsa) {
    throw new CryptoUnavailableError(['signatures']);
  }
  if (!caps.x25519 && !caps.p256Ecdh) {
    throw new CryptoUnavailableError(['key-agreement']);
  }
  const { publicKey, privateKey } = await generateSignatureKeys(sign);
  return {
    v: 1,
    agree,
    sign,
    publicKey: toBase64Url(await exportPublicKey(publicKey)),
    privateKey,
    publicKeyRef: publicKey,
  };
}

function importSignKey(alg: SignatureAlg, key: CryptoKey): void {
  // Guard against a corrupted or tampered persisted record.
  const expected = alg === 'ed25519' ? 'Ed25519' : 'ECDSA';
  if (key.algorithm.name !== expected) {
    throw new Error(`Stored identity key does not match its declared algorithm (${expected})`);
  }
}

export function identityFromStored(stored: StoredIdentity): DeviceIdentity {
  importSignKey(stored.sign, stored.privateKey);
  return {
    agree: stored.agree,
    sign: stored.sign,
    publicKey: stored.publicKey,
    fingerprint: '', // filled asynchronously by `hydrateIdentity`
  };
}

/** Recomputes the fingerprint from the public key and verifies consistency. */
export async function hydrateIdentity(stored: StoredIdentity): Promise<{
  identity: DeviceIdentity;
  stored: StoredIdentity;
}> {
  importSignKey(stored.sign, stored.privateKey);
  const raw = fromBase64Url(stored.publicKey);
  const derived = await fingerprintOf(raw);
  const fromKey = await fingerprintOf(await exportPublicKey(stored.publicKeyRef));
  if (derived !== fromKey) {
    throw new Error('Stored identity is inconsistent: public key and fingerprint do not match');
  }
  return {
    identity: { agree: stored.agree, sign: stored.sign, publicKey: stored.publicKey, fingerprint: derived },
    stored,
  };
}

export async function signBytes(stored: StoredIdentity, message: Uint8Array): Promise<Uint8Array> {
  if (stored.sign === 'ed25519') {
    const sig = await crypto.subtle.sign({ name: 'Ed25519' }, stored.privateKey, message as BufferSource);
    return new Uint8Array(sig);
  }
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    stored.privateKey,
    message as BufferSource,
  );
  return new Uint8Array(sig);
}

export async function importPublicKey(alg: SignatureAlg, raw: Uint8Array): Promise<CryptoKey> {
  if (alg === 'ed25519') {
    return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'Ed25519' }, true, ['verify']);
  }
  return crypto.subtle.importKey(
    'raw',
    raw as BufferSource,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify'],
  );
}

export async function verifySignature(
  alg: SignatureAlg,
  rawPublicKey: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array,
): Promise<boolean> {
  try {
    const key = await importPublicKey(alg, rawPublicKey);
    if (alg === 'ed25519') {
      return await crypto.subtle.verify({ name: 'Ed25519' }, key, signature as BufferSource, message as BufferSource);
    }
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signature as BufferSource,
      message as BufferSource,
    );
  } catch {
    return false;
  }
}

/** True when the announced fingerprint really is the digest of the announced key. */
export async function verifySelfConsistentIdentity(
  sign: SignatureAlg,
  publicKeyB64: string,
  fingerprintHex: string,
): Promise<boolean> {
  try {
    if (!/^[0-9a-fA-F]{64}$/.test(fingerprintHex)) return false;
    const raw = fromBase64Url(publicKeyB64);
    // Reject malformed key sizes early (Ed25519: 32 bytes, P-256 raw: 65 bytes).
    const expectedLength = sign === 'ed25519' ? 32 : 65;
    if (raw.length !== expectedLength) return false;
    return timingSafeEqual(utf8(await fingerprintOf(raw)), utf8(fingerprintHex.toLowerCase()));
  } catch {
    return false;
  }
}

/** Generates the device id: random, per installation, not tied to hardware. */
export function generateDeviceId(): string {
  return toBase64Url(randomBytes(16));
}

/** Human-typeable verification code derived from a signature (formatted only). */
export function formatFingerprint(fingerprintHex: string): string {
  const cleaned = fingerprintHex.replace(/[^0-9a-f]/gi, '').toUpperCase();
  return (cleaned.match(/.{1,4}/g) ?? []).slice(0, 8).join(' ');
}

/** Signs a human-readable challenge, used by the loopback/self test path. */
export async function signChallenge(stored: StoredIdentity, challenge: string): Promise<string> {
  const signature = await signBytes(stored, utf8(`DF-CHALLENGE-v1:${challenge}`));
  return toBase64Url(signature);
}
