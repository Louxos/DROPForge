import { describe, expect, it } from 'vitest';
import {
  createDeviceIdentity,
  exportPublicKey,
  fingerprintOf,
  formatFingerprint,
  generateDeviceId,
  hydrateIdentity,
  signBytes,
  signChallenge,
  verifySelfConsistentIdentity,
  verifySignature,
} from './identity.js';
import { fromBase64Url, utf8 } from './crypto.js';
import { detectCryptoCapabilities, requireSecureCrypto, resetCryptoCapabilitiesCache, CryptoUnavailableError } from './crypto.js';

describe('device identity', () => {
  it('creates an identity with a self-consistent fingerprint', async () => {
    const stored = await createDeviceIdentity();
    const { identity } = await hydrateIdentity(stored);
    const raw = fromBase64Url(identity.publicKey);
    expect(await fingerprintOf(raw)).toBe(identity.fingerprint);
    expect(identity.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // Preferred algorithms are the strongest available.
    const caps = await detectCryptoCapabilities();
    expect(identity.sign).toBe(caps.ed25519 ? 'ed25519' : 'ecdsa-p256');
    expect(identity.agree).toBe(caps.x25519 ? 'x25519' : 'p256');
  });

  it('signs and verifies, and rejects a tampered message', async () => {
    const stored = await createDeviceIdentity();
    const { identity } = await hydrateIdentity(stored);
    const message = utf8('transfer-1:file-0');
    const signature = await signBytes(stored, message);
    expect(await verifySignature(identity.sign, fromBase64Url(identity.publicKey), signature, message)).toBe(true);
    expect(await verifySignature(identity.sign, fromBase64Url(identity.publicKey), signature, utf8('transfer-1:file-1'))).toBe(false);
  });

  it('rejects a signature verified with someone else’s key', async () => {
    const a = await createDeviceIdentity();
    const b = await createDeviceIdentity();
    const { identity: identityB } = await hydrateIdentity(b);
    const message = utf8('hello');
    const signature = await signBytes(a, message);
    expect(await verifySignature(identityB.sign, fromBase64Url(identityB.publicKey), signature, message)).toBe(false);
  });

  it('detects an announced key that does not match its fingerprint', async () => {
    const stored = await createDeviceIdentity();
    const { identity } = await hydrateIdentity(stored);
    expect(await verifySelfConsistentIdentity(identity.sign, identity.publicKey, identity.fingerprint)).toBe(true);
    const other = await createDeviceIdentity();
    const otherRaw = await exportPublicKey(other.publicKeyRef);
    const otherFingerprint = await fingerprintOf(otherRaw);
    expect(await verifySelfConsistentIdentity(identity.sign, identity.publicKey, otherFingerprint)).toBe(false);
  });

  it('rejects malformed keys and fingerprints', async () => {
    const stored = await createDeviceIdentity();
    const { identity } = await hydrateIdentity(stored);
    expect(await verifySelfConsistentIdentity(identity.sign, 'AAAA', identity.fingerprint)).toBe(false);
    expect(await verifySelfConsistentIdentity(identity.sign, identity.publicKey, 'not-hex')).toBe(false);
    expect(await verifySelfConsistentIdentity(identity.sign, identity.publicKey, 'ab'.repeat(32))).toBe(false);
  });

  it('refuses a persisted record whose key does not match its declared algorithm', async () => {
    const stored = await createDeviceIdentity();
    const broken = { ...stored, sign: stored.sign === 'ed25519' ? ('ecdsa-p256' as const) : ('ed25519' as const) };
    await expect(hydrateIdentity(broken)).rejects.toThrow(/does not match/);
  });

  it('generates unique, url-safe device ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateDeviceId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('formats fingerprints for out-of-band comparison', () => {
    const formatted = formatFingerprint('9f2c1a44b8e1c0d3e5f60718293a4b5c');
    expect(formatted).toBe('9F2C 1A44 B8E1 C0D3 E5F6 0718 293A 4B5C');
  });

  it('signs a challenge deterministically enough to verify', async () => {
    const stored = await createDeviceIdentity();
    const { identity } = await hydrateIdentity(stored);
    const signature = await signChallenge(stored, 'challenge-1');
    expect(typeof signature).toBe('string');
    expect(fromBase64Url(signature).length).toBeGreaterThan(32);
    expect(identity.publicKey.length).toBeGreaterThan(10);
  });
});

describe('crypto capability detection', () => {
  it('finds the primitives this runtime provides', async () => {
    resetCryptoCapabilitiesCache();
    const caps = await detectCryptoCapabilities();
    expect(caps.aesGcm256).toBe(true);
    expect(caps.hkdfSha256).toBe(true);
    expect(caps.x25519 || caps.p256Ecdh).toBe(true);
    expect(caps.ed25519 || caps.p256Ecdsa).toBe(true);
    await expect(requireSecureCrypto()).resolves.toBeTruthy();
  });

  it('refuses to continue when WebCrypto is missing', async () => {
    resetCryptoCapabilitiesCache();
    await expect(requireSecureCrypto({} as SubtleCrypto)).rejects.toBeInstanceOf(CryptoUnavailableError);
    resetCryptoCapabilitiesCache();
  });
});
