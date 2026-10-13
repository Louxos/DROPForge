/**
 * Validated message catalogue. Every control message is parsed with zod before
 * it is trusted: an unknown, malformed or oversized message closes the session
 * with an explicit error instead of being partially honoured.
 *
 * Handshake messages travel as PLAIN_JSON (they carry public keys and
 * signatures only). Everything else travels sealed with the session keys.
 */
import { z } from 'zod';
import { CAPABILITIES } from './version.js';
import { MAX_FILES_PER_TRANSFER, MAX_PATH_BYTES, MAX_TRANSFER_TOTAL_BYTES } from './limits.js';

const b64 = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[A-Za-z0-9_-]+$/, 'expected base64url');

const hex32 = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'expected 32-byte sha-256 hex digest');

const fileIndex = z.number().int().min(0).max(0xffff);
const chunkIndex = z.number().int().min(0).max(0xffffffff);
const byteCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const capabilitySchema = z.enum(CAPABILITIES);

export const keyAgreementAlgSchema = z.enum(['x25519', 'p256']);
export const signatureAlgSchema = z.enum(['ed25519', 'ecdsa-p256']);
export type Platform = z.infer<typeof helloMessageSchema>['platform'];
export type KeyAgreementAlg = z.infer<typeof keyAgreementAlgSchema>;
export type SignatureAlg = z.infer<typeof signatureAlgSchema>;

/* ------------------------------------------------------------------ *
 * Handshake (plain JSON, pre-key)
 * ------------------------------------------------------------------ */

export const helloMessageSchema = z.object({
  t: z.literal('hello'),
  /** Protocol version, "MAJOR.MINOR". */
  v: z.string().regex(/^\d+\.\d+$/),
  caps: z.array(capabilitySchema).max(CAPABILITIES.length),
  /** Stable per-installation device identifier (random, not a hardware id). */
  deviceId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
  /** User-visible label, already normalised and length-capped. */
  displayName: z.string().min(1).max(64),
  role: z.enum(['sender', 'receiver']),
  /** 16 random bytes, binds this handshake instance (anti-replay). */
  sessionNonce: b64,
  platform: z.enum(['windows', 'macos', 'linux', 'android', 'ios', 'web', 'unknown']),
  /** Key-agreement algorithms this peer implements, most preferred first. */
  agreeAlgs: z.array(keyAgreementAlgSchema).min(1),
  /** Signature algorithms this peer implements, most preferred first. */
  signAlgs: z.array(signatureAlgSchema).min(1),
});

export const keyMessageSchema = z.object({
  t: z.literal('key'),
  agree: keyAgreementAlgSchema,
  /** Ephemeral public key (32 bytes X25519, or uncompressed P-256). */
  ephemeralPublicKey: b64,
  sign: signatureAlgSchema,
  /** Long-term identity public key (32 bytes Ed25519, or uncompressed P-256). */
  identityPublicKey: b64,
  /** Fingerprint of identityPublicKey: sha-256, hex. */
  identityFingerprint: hex32,
  /** Key material is only valid for this handshake, never reused. */
  expiresAt: z.number().int().positive(),
});

export const authMessageSchema = z.object({
  t: z.literal('auth'),
  /** Signature over the canonical transcript (see handshake.ts). */
  signature: b64,
});

export const pairProofMessageSchema = z.object({
  t: z.literal('pairProof'),
  /** HMAC-SHA256(pairingSecret, transcriptHash), base64url. */
  hmac: b64,
  /** Only sent when the user explicitly opted in to remember this device. */
  requestTrust: z.boolean(),
});

export const readyMessageSchema = z.object({
  t: z.literal('ready'),
  /**
   * Fingerprint of the key of the peer that sends this message, so the receiver
   * can compare it with the key it just accepted (defence in depth against
   * transcript confusion).
   */
  selfFingerprint: hex32,
  /** Short Authentication String: 6 digits both sides must compare. */
  sas: z.string().regex(/^\d{6}$/),
});

/* ------------------------------------------------------------------ *
 * Sealed control messages
 * ------------------------------------------------------------------ */

export const manifestEntrySchema = z.object({
  index: fileIndex,
  /** Relative path using "/" separators. Sanitised on the receiving side. */
  path: z.string().min(1).max(MAX_PATH_BYTES),
  kind: z.enum(['file', 'directory']),
  size: byteCount,
  mime: z.string().max(128).optional(),
  lastModified: z.number().int().min(0).optional(),
});

export const transferOfferSchema = z.object({
  t: z.literal('transferOffer'),
  transferId: b64,
  /** Offered files, in send order. */
  entries: z.array(manifestEntrySchema).min(1).max(MAX_FILES_PER_TRANSFER),
  totalBytes: byteCount.max(MAX_TRANSFER_TOTAL_BYTES),
  chunkBytes: z.number().int().min(4096).max(1024 * 1024),
  /** The sender will send a sha-256 digest per file after its last chunk. */
  sendsDigests: z.boolean(),
  /** Resume is possible: the receiver may answer with already-complete ranges. */
  resumable: z.boolean(),
  expiresAt: z.number().int().positive(),
});

export const conflictDecisionSchema = z.object({
  t: z.literal('conflictDecision'),
  transferId: b64,
  decisions: z
    .array(
      z.object({
        index: fileIndex,
        action: z.enum(['overwrite', 'skip', 'rename']),
        /** Required for "rename": the receiver-proposed safe name. */
        newPath: z.string().min(1).max(MAX_PATH_BYTES).optional(),
      }),
    )
    .max(MAX_FILES_PER_TRANSFER),
});

export const transferAcceptSchema = z.object({
  t: z.literal('transferAccept'),
  transferId: b64,
  /**
   * Manifest entries the receiver refused before any byte moved (mostly unsafe
   * paths). The sender must not send those files at all.
   */
  refused: z
    .array(z.object({ index: fileIndex, reason: z.enum(['pathUnsafe', 'unsupported', 'unverified']) }))
    .max(MAX_FILES_PER_TRANSFER)
    .default([]),
  /** Files already fully present locally, as half-open [start, end) byte ranges. */
  existing: z
    .array(
      z.object({
        index: fileIndex,
        ranges: z
          .array(z.object({ start: byteCount, end: byteCount }))
          .max(1024),
      }),
    )
    .max(MAX_FILES_PER_TRANSFER)
    .default([]),
  /** Receiver can write directly to disk (no in-memory buffering). */
  streamingToDisk: z.boolean(),
});

/**
 * Sent by the receiver when a transfer that was accepted cannot continue
 * (write failure, disk full, permission lost, integrity failure). It replaces
 * silence: without it the sender would wait for acknowledgements that will
 * never come.
 */
export const transferAbortSchema = z.object({
  t: z.literal('transferAbort'),
  transferId: b64,
  reason: z.enum(['writeFailed', 'noSpace', 'permissionDenied', 'conflict', 'integrityFailed', 'busy']),
});

export const transferRejectSchema = z.object({
  t: z.literal('transferReject'),
  transferId: b64,
  reason: z.enum(['declined', 'noSpace', 'unsupported', 'busy', 'tooLarge', 'cancelled']),
});

export const transferControlSchema = z.object({
  t: z.enum(['transferPause', 'transferResume', 'transferCancel']),
  transferId: b64,
  /** Informational, never a technical requirement. */
  note: z.string().max(200).optional(),
});

export const chunkAckSchema = z.object({
  t: z.literal('chunkAck'),
  transferId: b64,
  fileIndex,
  /** Highest contiguous chunk index durably written locally. */
  chunkIndex,
  receivedBytes: byteCount,
});

export const progressReportSchema = z.object({
  t: z.literal('progress'),
  transferId: b64,
  receivedBytes: byteCount,
  verifiedFiles: z.number().int().min(0),
  /** Local free space estimate in bytes, when the platform exposes it. */
  freeSpace: byteCount.optional(),
});

export const fileDigestSchema = z.object({
  t: z.literal('fileDigest'),
  transferId: b64,
  index: fileIndex,
  algorithm: z.literal('sha-256'),
  digest: hex32,
  /** Bytes hashed, must match the manifest size. */
  size: byteCount,
});

export const fileDigestResultSchema = z.object({
  t: z.literal('fileDigestResult'),
  transferId: b64,
  index: fileIndex,
  ok: z.boolean(),
  /** Reject the file (corrupt) or request another attempt. */
  action: z.enum(['accept', 'retransmit', 'reject']),
});

export const transferCompleteSchema = z.object({
  t: z.literal('transferComplete'),
  transferId: b64,
  /** Files not sent, with the reason (skipped, refused, failed). */
  unavailable: z
    .array(z.object({ index: fileIndex, reason: z.enum(['skipped', 'unreadable', 'changed', 'cancelled', 'refused']) }))
    .max(MAX_FILES_PER_TRANSFER)
    .default([]),
});

export const transferResultSchema = z.object({
  t: z.literal('transferResult'),
  transferId: b64,
  outcome: z.enum(['completed', 'partial', 'failed']),
  verifiedFiles: z.number().int().min(0),
  failedFiles: z
    .array(z.object({ index: fileIndex, reason: z.enum(['digestMismatch', 'writeFailed', 'noSpace']) }))
    .max(MAX_FILES_PER_TRANSFER)
    .default([]),
});

export const pingSchema = z.object({
  t: z.literal('ping'),
  id: z.number().int().min(0),
  at: z.number().int().positive(),
});

export const pongSchema = z.object({
  t: z.literal('pong'),
  id: z.number().int().min(0),
  at: z.number().int().positive(),
});

export const notifySchema = z.object({
  t: z.literal('notify'),
  level: z.enum(['info', 'warning', 'error']),
  /** Non-technical, already localised-by-sender text; never contains paths or secrets. */
  message: z.string().min(1).max(280),
});

/**
 * Error envelope. `code` is a stable machine-readable string; `message` must be
 * safe to display and must never contain paths, keys or file content.
 */
export const errorMessageSchema = z.object({
  t: z.literal('error'),
  code: z.string().min(3).max(64).regex(/^[A-Z][A-Z0-9_]*$/),
  message: z.string().min(1).max(280),
  fatal: z.boolean().default(false),
});

export const controlMessageSchema = z.union([
  transferOfferSchema,
  transferAcceptSchema,
  transferRejectSchema,
  transferAbortSchema,
  transferControlSchema,
  conflictDecisionSchema,
  chunkAckSchema,
  progressReportSchema,
  fileDigestSchema,
  fileDigestResultSchema,
  transferCompleteSchema,
  transferResultSchema,
  pingSchema,
  pongSchema,
  notifySchema,
  errorMessageSchema,
]);

export const handshakeMessageSchema = z.union([
  helloMessageSchema,
  keyMessageSchema,
  authMessageSchema,
  pairProofMessageSchema,
  readyMessageSchema,
]);

export type HelloMessage = z.infer<typeof helloMessageSchema>;
export type KeyMessage = z.infer<typeof keyMessageSchema>;
export type AuthMessage = z.infer<typeof authMessageSchema>;
export type PairProofMessage = z.infer<typeof pairProofMessageSchema>;
export type ReadyMessage = z.infer<typeof readyMessageSchema>;
export type ManifestEntry = z.infer<typeof manifestEntrySchema>;
export type TransferOffer = z.infer<typeof transferOfferSchema>;
export type TransferAccept = z.infer<typeof transferAcceptSchema>;
export type TransferReject = z.infer<typeof transferRejectSchema>;
export type TransferAbort = z.infer<typeof transferAbortSchema>;
export type TransferControl = z.infer<typeof transferControlSchema>;
export type ConflictDecision = z.infer<typeof conflictDecisionSchema>;
export type ChunkAck = z.infer<typeof chunkAckSchema>;
export type ProgressReport = z.infer<typeof progressReportSchema>;
export type FileDigest = z.infer<typeof fileDigestSchema>;
export type FileDigestResult = z.infer<typeof fileDigestResultSchema>;
export type TransferComplete = z.infer<typeof transferCompleteSchema>;
export type TransferResult = z.infer<typeof transferResultSchema>;
export type PingMessage = z.infer<typeof pingSchema>;
export type PongMessage = z.infer<typeof pongSchema>;
export type NotifyMessage = z.infer<typeof notifySchema>;
export type ErrorMessage = z.infer<typeof errorMessageSchema>;
export type ControlMessage = z.infer<typeof controlMessageSchema>;
export type HandshakeMessage = z.infer<typeof handshakeMessageSchema>;

export class MessageValidationError extends Error {
  readonly code = 'PROTOCOL_INVALID_MESSAGE';
  constructor(
    message: string,
    readonly issues: readonly string[] = [],
  ) {
    super(message);
    this.name = 'MessageValidationError';
  }
}

function parseWith<T>(schema: z.ZodType<T>, raw: unknown, label: string): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`);
    throw new MessageValidationError(`Invalid ${label}`, issues);
  }
  return result.data;
}

export const parseControlMessage = (raw: unknown): ControlMessage =>
  parseWith(controlMessageSchema, raw, 'control message');

export const parseHandshakeMessage = (raw: unknown): HandshakeMessage =>
  parseWith(handshakeMessageSchema, raw, 'handshake message');

/** Reject duplicate or unsafe capability claims coming from the wire. */
export function normaliseCapabilities(raw: readonly string[]): string[] {
  return [...new Set(raw)];
}
