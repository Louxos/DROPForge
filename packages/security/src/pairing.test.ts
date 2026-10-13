import { describe, expect, it } from 'vitest';
import {
  PAIRING_SECRET_BYTES,
  PairingError,
  createPairingSecret,
  encodePairingUrl,
  formatPairingCode,
  generatePairingCode,
  normalisePairingCode,
  pairingProofHex,
  parseManualCode,
  parsePairingUrl,
} from './pairing.js';

const APP = 'https://dropforge.example/app/';

describe('pairing codes', () => {
  it('generates unambiguous eight-character codes', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generatePairingCode();
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
      expect(code).not.toMatch(/[IO01]/);
    }
  });

  it('normalises and formats what a user types', () => {
    expect(normalisePairingCode('k7qp-2m4r')).toBe('K7QP2M4R');
    expect(formatPairingCode('k7qp2m4r')).toBe('K7QP-2M4R');
    expect(parseManualCode('k7qp 2m4r')).toEqual({ code: 'K7QP2M4R', hasSecret: false });
  });

  it('rejects codes of the wrong length or alphabet', () => {
    expect(() => parseManualCode('ABC')).toThrow(PairingError);
    expect(() => parseManualCode('K7QP2M4I')).toThrow(/not part of a code/);
  });
});

describe('pairing URLs', () => {
  it('keeps the secret in the fragment, never in the query', () => {
    const secret = createPairingSecret();
    const url = encodePairingUrl({ baseUrl: APP, code: 'K7QP2M4R', secret, signalUrl: 'wss://signal.example/relay' });
    expect(url.startsWith(APP)).toBe(true);
    const [path, fragment] = url.split('#');
    expect(path).not.toContain('K7QP');
    expect(fragment).toContain('c=K7QP2M4R');
    expect(new URL(url).search).toBe('');
  });

  it('round-trips a full payload', () => {
    const secret = createPairingSecret();
    const url = encodePairingUrl({
      baseUrl: APP,
      code: 'K7QP2M4R',
      secret,
      signalUrl: 'wss://signal.example/relay',
      deviceName: 'PC-Bureau',
    });
    const payload = parsePairingUrl(url);
    expect(payload.code).toBe('K7QP2M4R');
    expect([...payload.secret]).toEqual([...secret]);
    expect(payload.signalUrl).toBe('wss://signal.example/relay');
    expect(payload.deviceName).toBe('PC-Bureau');
    expect(payload.expiresAt).toBeGreaterThan(Date.now());
  });

  it('refuses a link whose secret has the wrong size', () => {
    const url = `${APP}#df=1&c=K7QP2M4R&x=${btoa('short').replace(/=+$/, '')}`;
    expect(() => parsePairingUrl(url)).toThrow(/malformed secret/);
  });

  it('refuses loopback signaling endpoints (a QR must not make a device talk to itself)', () => {
    const secret = createPairingSecret();
    for (const host of ['https://localhost/relay', 'wss://127.0.0.1/relay', 'https://[::1]/relay']) {
      const url = encodePairingUrl({ baseUrl: APP, code: 'K7QP2M4R', secret, signalUrl: host });
      expect(() => parsePairingUrl(url)).toThrow(/must not point at this device/);
    }
  });

  it('refuses insecure remote endpoints and credentials in the URL', () => {
    const secret = createPairingSecret();
    const insecure = encodePairingUrl({ baseUrl: APP, code: 'K7QP2M4R', secret, signalUrl: 'http://signal.example' });
    expect(() => parsePairingUrl(insecure)).toThrow(/must use/);
    const withCreds = encodePairingUrl({ baseUrl: APP, code: 'K7QP2M4R', secret, signalUrl: 'https://user:pass@signal.example' });
    expect(() => parsePairingUrl(withCreds)).toThrow(/credentials/);
  });

  it('rejects malformed or foreign links', () => {
    expect(() => parsePairingUrl('not a url')).toThrow(/not a valid/);
    expect(() => parsePairingUrl(`${APP}#df=2&c=K7QP2M4R&x=AAAA`)).toThrow(/incompatible version/);
    expect(() => parsePairingUrl(`${APP}#df=1&c=K7QP2M4R`)).toThrow(/incomplete/);
    expect(() => parsePairingUrl(`${APP}`)).toThrow(/pairing information/);
  });

  it('produces the same proof on both sides holding the same secret', () => {
    const secret = createPairingSecret();
    const hash = 'f'.repeat(64);
    expect(pairingProofHex(secret, hash)).toBe(pairingProofHex(secret, hash));
    expect(pairingProofHex(secret, hash)).not.toBe(pairingProofHex(createPairingSecret(), hash));
    expect(pairingProofHex(secret, hash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates 32-byte secrets', () => {
    expect(createPairingSecret().length).toBe(PAIRING_SECRET_BYTES);
  });
});
