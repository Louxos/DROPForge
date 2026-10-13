/**
 * Session keys and sealed frames.
 *
 * Key schedule (HKDF-SHA-256, salt = transcript hash, info = context label):
 *   ikm       = ECDH(initiatorEphemeral, responderEphemeral)   (32 bytes)
 *   i→r key   = HKDF(ikm, salt, "dropforge/v1/i2r")             (32 bytes AES-256)
 *   r→i key   = HKDF(ikm, salt, "dropforge/v1/r2i")             (32 bytes AES-256)
 *   sas       = HKDF(ikm, salt, "dropforge/v1/sas") → first 20 bits → 6 digits
 *
 * Nonces are 12 bytes: 4-byte direction prefix (from the derived key material)
 * followed by an 8-byte big-endian counter that only ever increases inside a
 * direction. A key/counter pair is therefore never reused, and a rekey happens
 * before the counter can wrap (2^40 frames is far beyond any campaign).
 */
import {
  MAX_SEALED_FRAME_BYTES,
  decodeFrame,
  encodeFrame,
  FRAME_PLAIN_JSON,
  FRAME_SEALED_DATA,
  FRAME_SEALED_JSON,
  type FrameKind,
} from '@dropforge/protocol';
import { utf8 } from './crypto.js';

export const SESSION_CONTEXT_PREFIX = 'dropforge/v1';

export interface SessionKeyMaterial {
  initiatorToResponder: Uint8Array;
  responderToInitiator: Uint8Array;
  /** 32 bytes of extra key material, only used to derive the 6-digit SAS. */
  sasMaterial: Uint8Array;
}

export function deriveSasCode(sasMaterial: Uint8Array): string {
  // 3 bytes → 24 bits → 6 digits, uniformly mapped (no modulo bias: 10^6 ≤ 2^24).
  const value = ((sasMaterial[0] as number) << 16) | ((sasMaterial[1] as number) << 8) | (sasMaterial[2] as number);
  return (value % 1_000_000).toString().padStart(6, '0');
}

/**
 * Display form of the SAS: "123 456". Users compare it between two screens, so
 * it is grouped and must never be re-hashed or compared in this form.
 */
export function formatSasCode(code: string): string {
  if (!/^\d{6}$/.test(code)) return code;
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export interface SealedEnvelope {
  kind: FrameKind;
  bytes: Uint8Array;
}

export class ReplayError extends Error {
  readonly code = 'SESSION_REPLAY_DETECTED';
  constructor(counter: number) {
    super(`Rejected a frame whose counter (${counter}) was already used`);
    this.name = 'ReplayError';
  }
}

export class SessionCryptoError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SessionCryptoError';
    this.code = code;
  }
}

const COUNTER_LIMIT = 2 ** 40;

export class SessionCrypto {
  private sendCounter = 0;
  private lastReceivedCounter = -1;
  private readonly sendPrefix: Uint8Array;
  private readonly receivePrefix: Uint8Array;
  private sendKey: CryptoKey | undefined;
  private receiveKey: CryptoKey | undefined;
  private closed = false;

  private constructor(
    private readonly sendKeyBytes: Uint8Array,
    private readonly receiveKeyBytes: Uint8Array,
    private readonly role: 'initiator' | 'responder',
  ) {
    this.sendPrefix = sendKeyBytes.slice(0, 4);
    this.receivePrefix = receiveKeyBytes.slice(0, 4);
  }

  static async create(
    material: SessionKeyMaterial,
    role: 'initiator' | 'responder',
  ): Promise<SessionCrypto> {
    const send = role === 'initiator' ? material.initiatorToResponder : material.responderToInitiator;
    const receive = role === 'initiator' ? material.responderToInitiator : material.initiatorToResponder;
    const session = new SessionCrypto(send, receive, role);
    session.sendKey = await crypto.subtle.importKey('raw', send as BufferSource, { name: 'AES-GCM' }, false, [
      'encrypt',
    ]);
    session.receiveKey = await crypto.subtle.importKey('raw', receive as BufferSource, { name: 'AES-GCM' }, false, [
      'decrypt',
    ]);
    return session;
  }

  get framesSent(): number {
    return this.sendCounter;
  }

  private buildNonce(prefix: Uint8Array, counter: number): Uint8Array {
    const nonce = new Uint8Array(12);
    nonce.set(prefix, 0);
    const view = new DataView(nonce.buffer);
    view.setBigUint64(4, BigInt(counter));
    return nonce;
  }

  private parseCounter(nonce: Uint8Array): number {
    if (nonce.length !== 12) throw new SessionCryptoError('SESSION_BAD_NONCE', 'Nonce must be 12 bytes');
    for (let i = 0; i < 4; i += 1) {
      if (nonce[i] !== this.receivePrefix[i]) {
        throw new SessionCryptoError('SESSION_UNKNOWN_DIRECTION', 'Frame does not belong to this session direction');
      }
    }
    const view = new DataView(nonce.buffer, nonce.byteOffset, 12);
    const value = view.getBigUint64(4);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new SessionCryptoError('SESSION_COUNTER_OVERFLOW', 'Frame counter exceeds supported range');
    }
    return Number(value);
  }

  private assertOpen(): void {
    if (this.closed) throw new SessionCryptoError('SESSION_CLOSED', 'Session keys have been destroyed');
  }

  /** Encrypts and frames a control message (JSON bytes). */
  async sealJson(plaintext: Uint8Array): Promise<Uint8Array> {
    return this.seal(FRAME_SEALED_JSON, plaintext);
  }

  /** Encrypts and frames a data payload (inner data header + chunk). */
  async sealData(plaintext: Uint8Array): Promise<Uint8Array> {
    if (plaintext.length > MAX_SEALED_FRAME_BYTES) {
      throw new SessionCryptoError('SESSION_FRAME_TOO_LARGE', 'Payload exceeds the maximum sealed frame size');
    }
    return this.seal(FRAME_SEALED_DATA, plaintext);
  }

  private async seal(kind: FrameKind, plaintext: Uint8Array): Promise<Uint8Array> {
    this.assertOpen();
    if (this.sendCounter >= COUNTER_LIMIT) {
      // Refuse rather than reuse a nonce: the session must be renegotiated.
      throw new SessionCryptoError('SESSION_REKEY_REQUIRED', 'Frame counter limit reached; reconnect required');
    }
    const counter = this.sendCounter;
    this.sendCounter += 1;
    const nonce = this.buildNonce(this.sendPrefix, counter);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce as BufferSource, tagLength: 128 },
        this.sendKey as CryptoKey,
        plaintext as BufferSource,
      ),
    );
    return encodeFrame(kind, nonce, ciphertext);
  }

  /**
   * Opens a received frame. Plain (pre-handshake) frames are rejected here:
   * they must be handled by the handshake layer, never by the session.
   */
  async open(frame: Uint8Array): Promise<{ kind: FrameKind; plaintext: Uint8Array; counter: number }> {
    this.assertOpen();
    const decoded = decodeFrame(frame, MAX_SEALED_FRAME_BYTES);
    if (decoded.kind === FRAME_PLAIN_JSON) {
      throw new SessionCryptoError('SESSION_PLAINTEXT_AFTER_HANDSHAKE', 'Plain frames are not accepted after the handshake');
    }
    const counter = this.parseCounter(decoded.nonce);
    if (counter <= this.lastReceivedCounter) {
      throw new ReplayError(counter);
    }
    let plaintext: Uint8Array;
    try {
      plaintext = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: decoded.nonce as BufferSource, tagLength: 128 },
          this.receiveKey as CryptoKey,
          decoded.body as BufferSource,
        ),
      );
    } catch {
      // Never leak whether the tag or the padding failed.
      throw new SessionCryptoError('SESSION_DECRYPT_FAILED', 'Frame could not be authenticated');
    }
    // Only advance the replay window once authentication succeeded.
    this.lastReceivedCounter = counter;
    return { kind: decoded.kind, plaintext, counter };
  }

  get lastReceived(): number {
    return this.lastReceivedCounter;
  }

  /** Destroys key references. Called on session end, cancel and device revoke. */
  destroy(): void {
    this.closed = true;
    this.sendKey = undefined;
    this.receiveKey = undefined;
    this.sendKeyBytes.fill(0);
    this.receiveKeyBytes.fill(0);
  }
}

/** Wipes a key buffer in place; used for ephemeral secrets. */
export function wipe(bytes: Uint8Array | undefined): void {
  bytes?.fill(0);
}

export function transcriptSalt(transcriptHashHex: string): Uint8Array {
  return utf8(transcriptHashHex);
}
