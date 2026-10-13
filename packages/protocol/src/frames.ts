/**
 * Frame layer: the only thing the relay service ever sees.
 *
 * Layout of one frame (all integers big-endian):
 *
 *   0      1                    13                       ...
 *   +------+--------------------+-------------------------+
 *   | kind | nonce (12 bytes)   | ciphertext (optional)   |
 *   +------+--------------------+-------------------------+
 *
 * kind:
 *   0x00 PLAIN_JSON  – pre-key-exchange handshake JSON, never file data.
 *   0x01 SEALED_JSON – AEAD(control JSON) with the session key.
 *   0x02 SEALED_DATA – AEAD(file chunk) with the session key.
 *
 * The relay can therefore neither read file data nor control messages, and it
 * does not even learn stream ids: everything after the kind byte is opaque.
 * Nonces are never reused: see `NonceFactory` in @dropforge/security.
 */

export const FRAME_PLAIN_JSON = 0x00;
export const FRAME_SEALED_JSON = 0x01;
export const FRAME_SEALED_DATA = 0x02;

export const FRAME_NONCE_BYTES = 12;
export const FRAME_HEADER_BYTES = 1 + FRAME_NONCE_BYTES;

export type FrameKind =
  | typeof FRAME_PLAIN_JSON
  | typeof FRAME_SEALED_JSON
  | typeof FRAME_SEALED_DATA;

export class FrameError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'FrameError';
    this.code = code;
  }
}

export interface DecodedFrame {
  kind: FrameKind;
  /** 12 random bytes for sealed frames, empty for plain frames. */
  nonce: Uint8Array;
  /** JSON bytes (plain) or ciphertext (sealed). */
  body: Uint8Array;
}

export function encodeFrame(kind: FrameKind, nonce: Uint8Array, body: Uint8Array): Uint8Array {
  if (kind === FRAME_PLAIN_JSON) {
    if (nonce.length !== 0) {
      throw new FrameError('FRAME_BAD_NONCE', 'Plain frames must not carry a nonce');
    }
  } else if (nonce.length !== FRAME_NONCE_BYTES) {
    throw new FrameError('FRAME_BAD_NONCE', `Sealed frames need a ${FRAME_NONCE_BYTES}-byte nonce`);
  }
  const out = new Uint8Array(FRAME_HEADER_BYTES + body.length);
  out[0] = kind;
  out.set(nonce, 1);
  out.set(body, FRAME_HEADER_BYTES);
  return out;
}

export function decodeFrame(bytes: Uint8Array, maxBytes: number): DecodedFrame {
  if (bytes.length > maxBytes) {
    throw new FrameError('FRAME_TOO_LARGE', `Frame of ${bytes.length} bytes exceeds limit ${maxBytes}`);
  }
  if (bytes.length < FRAME_HEADER_BYTES) {
    throw new FrameError('FRAME_TRUNCATED', 'Frame shorter than its header');
  }
  const kind = bytes[0] as number;
  if (kind !== FRAME_PLAIN_JSON && kind !== FRAME_SEALED_JSON && kind !== FRAME_SEALED_DATA) {
    throw new FrameError('FRAME_UNKNOWN_KIND', `Unknown frame kind 0x${kind.toString(16)}`);
  }
  const frameKind = kind as FrameKind;
  const nonce = frameKind === FRAME_PLAIN_JSON ? new Uint8Array(0) : bytes.slice(1, 1 + FRAME_NONCE_BYTES);
  return { kind: frameKind, nonce, body: bytes.slice(FRAME_HEADER_BYTES) };
}

/** Cheap structural peek used by the relay: never decrypts, never parses. */
export function frameKindOf(bytes: Uint8Array): FrameKind | undefined {
  if (bytes.length < FRAME_HEADER_BYTES) return undefined;
  const kind = bytes[0];
  if (kind !== FRAME_PLAIN_JSON && kind !== FRAME_SEALED_JSON && kind !== FRAME_SEALED_DATA) {
    return undefined;
  }
  return kind;
}
