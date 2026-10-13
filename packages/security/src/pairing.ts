/**
 * Pairing material: the secret that travels *out of band* through a QR code.
 *
 * Design rules:
 *  - the secret lives in the URL **fragment** (`#…`), which browsers never send
 *    to a server: the static hosting provider cannot learn it;
 *  - the secret is 32 random bytes, it is not a password typed by a human;
 *  - a QR code carrying a secret authenticates the peer cryptographically
 *    (HMAC over the handshake transcript), so knowing a code is not enough to
 *    impersonate a paired device;
 *  - codes expire, and each code is single-use.
 */
import { fromBase64Url, randomBytes, toBase64Url, utf8 } from './crypto.js';
import { hmacSha256, toHex } from '@dropforge/protocol';

export const PAIRING_PARAM_VERSION = '1';
export const PAIRING_SECRET_BYTES = 32;
export const PAIRING_CODE_TTL_MS = 5 * 60_000;

export interface PairingPayload {
  v: typeof PAIRING_PARAM_VERSION;
  /** Short code both sides use to find the same rendezvous. */
  code: string;
  /** 32-byte out-of-band secret. */
  secret: Uint8Array;
  /** Optional: the signaling service to use (https/wss origin). */
  signalUrl?: string;
  /** Optional: a direct ws:// URL when the sender listens on the local network. */
  localUrl?: string;
  /** Optional: display name of the device that produced the code. */
  deviceName?: string;
  expiresAt: number;
}

export class PairingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PairingError';
    this.code = code;
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1

/** Human-friendly code: 8 chars in the unambiguous alphabet (~39 bits). */
export function generatePairingCode(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

export function normalisePairingCode(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function formatPairingCode(code: string): string {
  const c = normalisePairingCode(code);
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export function createPairingSecret(): Uint8Array {
  return randomBytes(PAIRING_SECRET_BYTES);
}

export interface EncodeOptions {
  /** Absolute URL of the app, e.g. https://dropforge.example/app/. */
  baseUrl: string;
  code: string;
  secret: Uint8Array;
  signalUrl?: string;
  localUrl?: string;
  deviceName?: string;
  now?: number;
}

/**
 * Builds a shareable URL. Everything sensitive stays in the fragment.
 * Example: https://…/app/#df=1&c=K7QP-2M4R&x=<secret>&s=wss%3A%2F%2F…&n=PC-Bureau
 */
export function encodePairingUrl(options: EncodeOptions): string {
  const code = normalisePairingCode(options.code);
  if (code.length < 8) throw new PairingError('PAIRING_BAD_CODE', 'Pairing code is too short');
  if (options.secret.length !== PAIRING_SECRET_BYTES) {
    throw new PairingError('PAIRING_BAD_SECRET', `Pairing secret must be ${PAIRING_SECRET_BYTES} bytes`);
  }
  const params = new URLSearchParams();
  params.set('df', PAIRING_PARAM_VERSION);
  params.set('c', code);
  params.set('x', toBase64Url(options.secret));
  if (options.signalUrl) params.set('s', options.signalUrl);
  if (options.localUrl) params.set('l', options.localUrl);
  if (options.deviceName) params.set('n', options.deviceName.slice(0, 64));
  const base = options.baseUrl.split('#')[0] ?? options.baseUrl;
  return `${base}#${params.toString()}`;
}

export function parsePairingUrl(url: string, now = Date.now()): PairingPayload {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PairingError('PAIRING_BAD_URL', 'This link is not a valid DropForge link');
  }
  const fragment = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
  if (!fragment) throw new PairingError('PAIRING_MISSING_PAYLOAD', 'The link does not contain pairing information');
  const params = new URLSearchParams(fragment);
  if (params.get('df') !== PAIRING_PARAM_VERSION) {
    throw new PairingError('PAIRING_VERSION', 'This link was created by an incompatible version');
  }
  const code = normalisePairingCode(params.get('c') ?? '');
  const secretRaw = params.get('x');
  if (code.length < 8 || !secretRaw) {
    throw new PairingError('PAIRING_INCOMPLETE', 'The link is incomplete');
  }
  let secret: Uint8Array;
  try {
    secret = fromBase64Url(secretRaw);
  } catch {
    throw new PairingError('PAIRING_BAD_SECRET', 'The link contains a malformed secret');
  }
  if (secret.length !== PAIRING_SECRET_BYTES) {
    throw new PairingError('PAIRING_BAD_SECRET', 'The link contains a malformed secret');
  }
  const signalUrl = params.get('s') ?? undefined;
  const localUrl = params.get('l') ?? undefined;
  validateEndpointUrls(signalUrl, localUrl);
  return {
    v: PAIRING_PARAM_VERSION,
    code,
    secret,
    signalUrl,
    localUrl,
    deviceName: params.get('n') ?? undefined,
    expiresAt: now + PAIRING_CODE_TTL_MS,
  };
}

/**
 * Only remote endpoints are accepted. Loopback and link-local addresses are
 * rejected for the *remote* transport: a QR code must never make a device
 * talk to itself or to a router admin page.
 */
function validateEndpointUrls(signalUrl: string | undefined, localUrl: string | undefined): void {
  const check = (value: string, allowed: string[], label: string, forbidLoopback: boolean): void => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new PairingError('PAIRING_BAD_ENDPOINT', `${label} is not a valid URL`);
    }
    if (!allowed.includes(url.protocol)) {
      throw new PairingError('PAIRING_BAD_ENDPOINT', `${label} must use ${allowed.join(' or ')}`);
    }
    if (url.username || url.password) {
      throw new PairingError('PAIRING_BAD_ENDPOINT', `${label} must not contain credentials`);
    }
    if (forbidLoopback && isLoopbackHost(url.hostname)) {
      throw new PairingError('PAIRING_BAD_ENDPOINT', `${label} must not point at this device`);
    }
  };
  if (signalUrl) check(signalUrl, ['https:', 'wss:'], 'The signaling endpoint', true);
  if (localUrl) check(localUrl, ['ws:', 'wss:'], 'The local endpoint', false);
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '0.0.0.0') return true;
  if (/^127\./.test(host)) return true;
  return false;
}

/** Manual connection: user types a code only (no secret → SAS confirmation required). */
export function parseManualCode(input: string): { code: string; hasSecret: false } {
  const code = normalisePairingCode(input);
  if (code.length !== 8) {
    throw new PairingError('PAIRING_BAD_CODE', 'A code contains exactly 8 characters');
  }
  for (const ch of code) {
    if (!CODE_ALPHABET.includes(ch)) {
      throw new PairingError('PAIRING_BAD_CODE', `Character "${ch}" is not part of a code`);
    }
  }
  return { code, hasSecret: false };
}

/** Proof that a device holds the pairing secret (used in tests and diagnostics). */
export function pairingProof(secret: Uint8Array, transcriptHashHex: string): Uint8Array {
  return hmacSha256(secret, utf8(`DF-HANDSHAKE-v1:pair:${transcriptHashHex}`));
}

export function pairingProofHex(secret: Uint8Array, transcriptHashHex: string): string {
  return toHex(pairingProof(secret, transcriptHashHex));
}
