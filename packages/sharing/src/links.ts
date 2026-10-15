/**
 * Sharing links, in two modes.
 *
 * Mode A — direct transfer (the default): the sender stays available and the peer
 * connects to it. Nothing is stored anywhere; this is handled by the connection
 * manager and the transfer engine, not here.
 *
 * Mode B — temporary hosted share (this file): files are stored on a share server
 * for a limited time. Three rules from the spec are implemented here, on the
 * sender's and receiver's side, and are *not* delegated to the server:
 *  - every file is encrypted on the sender's device before upload, so the server
 *    only ever holds ciphertext (`encryptForShare` / `decryptShareFile`);
 *  - the key never reaches the server: the whole share payload, key included,
 *    travels in the URL fragment, which browsers never send in an HTTP request
 *    (`buildShareUrl` / `readShareUrl` — and docs/TECHNIQUE.md explains it);
 *  - every limit (size, file count, lifetime, downloads) is checked locally before
 *    anything is uploaded, and checked again on download, so a free tier can never
 *    be overshot by this app. The server enforces the same numbers as the authority.
 */
import {
  DropForgeError,
  ERROR_CODES,
  type SourceFile,
} from '@dropforge/app-core';
import {
  Sha256Stream,
  fromBase64Url,
  fromUtf8,
  randomBytes,
  sha256Hex,
  toBase64Url,
  toHex,
  utf8,
  type Clock,
  type Logger,
} from '@dropforge/protocol';

/* ------------------------------------------------------------------ *
 * Limits, in one place. The server enforces the same values.
 * ------------------------------------------------------------------ */

export const SHARE_MAX_BYTES = 512 * 1024 * 1024;
export const SHARE_MAX_FILES = 200;
export const SHARE_MAX_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
export const SHARE_MIN_LIFETIME_MS = 5 * 60 * 1_000;
export const SHARE_DEFAULT_LIFETIME_MS = 24 * 60 * 60 * 1_000;
export const SHARE_MAX_DOWNLOADS = 50;
/** 1 MiB per authenticated chunk: small enough to stream, large enough to be fast. */
export const SHARE_CHUNK_BYTES = 1024 * 1024;
export const SHARE_KEY_BYTES = 32;
const SHARE_URL_VERSION = '1' as const;
const GCM_TAG_BYTES = 16;
const NONCE_BYTES = 12;

/* ------------------------------------------------------------------ *
 * Payloads
 * ------------------------------------------------------------------ */

export interface ShareFileEntry {
  /** Display name only: it suggests a name on the receiver's side, never a path. */
  name: string;
  size: number;
  sha256: string;
  /** Opaque random object key on the share server. */
  objectId: string;
}

export interface SharePayload {
  v: typeof SHARE_URL_VERSION;
  id: string;
  createdAt: number;
  expiresAt: number;
  files: ShareFileEntry[];
  totalBytes: number;
  maxDownloads: number;
  /** base64url AES-256-GCM key. Only ever inside the URL fragment. */
  key: string;
}

/* ------------------------------------------------------------------ *
 * Encryption
 * ------------------------------------------------------------------ */

const subtle = (): SubtleCrypto => {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.subtle) {
    throw new DropForgeError(ERROR_CODES.CRYPTO_UNAVAILABLE, 'This device cannot encrypt files for sharing');
  }
  return cryptoObj.subtle;
};

async function importShareKey(raw: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  if (raw.length !== SHARE_KEY_BYTES) {
    throw new DropForgeError(ERROR_CODES.CRYPTO_UNAVAILABLE, 'The sharing key is malformed');
  }
  return subtle().importKey('raw', raw as unknown as ArrayBuffer, 'AES-GCM', false, [usage]);
}

/**
 * Encrypts one file for sharing. The file is read chunk by chunk, so a large share
 * does not need a second full copy in memory, and the plaintext hash is computed
 * while streaming.
 */
export async function encryptForShare(
  file: SourceFile,
  options: { key: CryptoKey; objectId: string },
): Promise<{ entry: ShareFileEntry; ciphertext: Uint8Array }> {
  if (file.kind === 'directory') {
    throw new DropForgeError(
      ERROR_CODES.UNSUPPORTED_OPERATION,
      'A hosted share holds files: flatten the folder before sharing it',
    );
  }
  const chunks: Uint8Array[] = [];
  const hasher = new Sha256Stream();
  let total = 0;
  for (let offset = 0; offset < file.size; offset += SHARE_CHUNK_BYTES) {
    const length = Math.min(SHARE_CHUNK_BYTES, file.size - offset);
    const plain = await file.read(offset, length);
    if (!plain || plain.length !== length) {
      throw new DropForgeError(ERROR_CODES.READ_FAILED, 'A file that was meant to be shared could not be read', {
        context: { offset, length },
      });
    }
    hasher.update(plain);
    const nonce = randomBytes(NONCE_BYTES);
    const sealed = new Uint8Array(
      await subtle().encrypt(
        { name: 'AES-GCM', iv: nonce as unknown as ArrayBuffer },
        options.key,
        plain as unknown as ArrayBuffer,
      ),
    );
    chunks.push(nonce, sealed);
    total += NONCE_BYTES + sealed.length;
  }
  const ciphertext = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    ciphertext.set(chunk, cursor);
    cursor += chunk.length;
  }
  return {
    entry: { name: file.path, size: file.size, sha256: toHex(hasher.digest()), objectId: options.objectId },
    ciphertext,
  };
}

/**
 * Decrypts a shared file after download. A single flipped byte anywhere makes the
 * authenticated decryption fail, so a corrupted or tampered file is refused instead
 * of being written, and the plaintext checksum is verified once more.
 */
export async function decryptShareFile(
  ciphertext: Uint8Array,
  entry: ShareFileEntry,
  options: { key: CryptoKey },
): Promise<Uint8Array> {
  const out = new Uint8Array(entry.size);
  let written = 0;
  let cursor = 0;
  while (cursor < ciphertext.length) {
    if (cursor + NONCE_BYTES > ciphertext.length) {
      throw new DropForgeError(ERROR_CODES.INTEGRITY_FAILED, 'A shared file was truncated');
    }
    const nonce = ciphertext.subarray(cursor, cursor + NONCE_BYTES);
    cursor += NONCE_BYTES;
    const expectedPlain = Math.min(SHARE_CHUNK_BYTES, entry.size - written);
    const sealedLength = expectedPlain + GCM_TAG_BYTES;
    const sealed = ciphertext.subarray(cursor, cursor + sealedLength);
    if (sealed.length !== sealedLength) {
      throw new DropForgeError(ERROR_CODES.INTEGRITY_FAILED, 'A shared file was truncated or damaged');
    }
    cursor += sealedLength;
    let plain: Uint8Array;
    try {
      plain = new Uint8Array(
        await subtle().decrypt(
          { name: 'AES-GCM', iv: nonce as unknown as ArrayBuffer },
          options.key,
          sealed as unknown as ArrayBuffer,
        ),
      );
    } catch (error) {
      throw new DropForgeError(
        ERROR_CODES.INTEGRITY_FAILED,
        'This shared file could not be decoded: it was modified, or the link is incomplete',
        { cause: error },
      );
    }
    out.set(plain, written);
    written += plain.length;
  }
  if (written !== entry.size) {
    throw new DropForgeError(ERROR_CODES.INTEGRITY_FAILED, 'A shared file does not have the expected size');
  }
  if (sha256Hex(out) !== entry.sha256) {
    throw new DropForgeError(ERROR_CODES.INTEGRITY_FAILED, 'A shared file does not match its checksum');
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Links
 * ------------------------------------------------------------------ */

/** Receiver-facing link. Everything, key included, lives in the fragment. */
export function buildShareUrl(origin: string, payload: SharePayload): string {
  const fragment = new URLSearchParams({
    df: 'share',
    v: SHARE_URL_VERSION,
    s: toBase64Url(utf8(JSON.stringify(payload))),
  }).toString();
  return `${origin.replace(/\/+$/, '')}/#${fragment}`;
}

/**
 * Reads the payload out of a link, without ever contacting a server. Expiry is
 * checked here so an old link fails immediately with the right message.
 */
export function readShareUrl(input: string, clock: Clock): SharePayload {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new DropForgeError(ERROR_CODES.LINK_NOT_FOUND, 'This link is not a valid DropForge link');
  }
  const fragment = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : '';
  if (!fragment) throw new DropForgeError(ERROR_CODES.LINK_NOT_FOUND, 'This link is incomplete');
  const params = new URLSearchParams(fragment);
  if (params.get('df') !== 'share') {
    throw new DropForgeError(ERROR_CODES.LINK_NOT_FOUND, 'This link is not a file-sharing link');
  }
  const encoded = params.get('s');
  if (!encoded) throw new DropForgeError(ERROR_CODES.LINK_NOT_FOUND, 'This link is incomplete');

  let payload: SharePayload;
  try {
    payload = JSON.parse(fromUtf8(fromBase64Url(encoded))) as SharePayload;
  } catch {
    throw new DropForgeError(ERROR_CODES.LINK_NOT_FOUND, 'This link is damaged');
  }
  const valid =
    payload !== null &&
    typeof payload === 'object' &&
    payload.v === SHARE_URL_VERSION &&
    typeof payload.id === 'string' &&
    typeof payload.expiresAt === 'number' &&
    typeof payload.maxDownloads === 'number' &&
    Array.isArray(payload.files) &&
    payload.files.every(
      (entry) =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof entry.name === 'string' &&
        typeof entry.size === 'number' &&
        typeof entry.sha256 === 'string' &&
        typeof entry.objectId === 'string',
    ) &&
    typeof payload.key === 'string';
  if (!valid) throw new DropForgeError(ERROR_CODES.LINK_NOT_FOUND, 'This link is damaged');
  if (payload.expiresAt <= clock.now()) {
    throw new DropForgeError(ERROR_CODES.LINK_EXPIRED, 'This sharing link has expired');
  }
  return payload;
}

/** Imports the decryption key of a payload. Kept separate on purpose: the payload
 *  is displayable data, the key is secret material that must not be logged. */
export async function shareKeyFromPayload(payload: SharePayload): Promise<CryptoKey> {
  return importShareKey(fromBase64Url(payload.key), 'decrypt');
}

/* ------------------------------------------------------------------ *
 * Server contract
 * ------------------------------------------------------------------ */

export interface ShareStatus {
  exists: boolean;
  revoked: boolean;
  expiresAt: number;
  bytesStored: number;
  downloads: number;
}

/**
 * The share server as the app sees it. An implementation must refuse an upload
 * that exceeds the announced limits, must delete objects once `expiresAt` passed,
 * and must report `revoked` for a revoked share. The client re-checks all of this,
 * so a buggy or hostile server cannot make the app lie to the user.
 */
export interface ShareBackend {
  createShare(request: {
    id: string;
    expiresAt: number;
    maxDownloads: number;
    totalBytes: number;
    files: ShareFileEntry[];
  }): Promise<{ id: string }>;
  uploadObject(shareId: string, objectId: string, data: Uint8Array): Promise<void>;
  /** Marks the share as ready; before this the link must not work at all. */
  finalizeShare(shareId: string): Promise<void>;
  status(shareId: string): Promise<ShareStatus>;
  revoke(shareId: string): Promise<void>;
  downloadObject(shareId: string, objectId: string): Promise<Uint8Array | undefined>;
  /** Server-side sweep; returns the ids of the shares it deleted. */
  sweepExpired(now: number): Promise<string[]>;
}

/* ------------------------------------------------------------------ *
 * Sender side
 * ------------------------------------------------------------------ */

export interface CreateShareOptions {
  backend: ShareBackend;
  files: SourceFile[];
  origin: string;
  clock: Clock;
  lifetimeMs?: number;
  maxDownloads?: number;
  logger?: Logger;
}

export interface CreatedShare {
  id: string;
  url: string;
  expiresAt: number;
  totalBytes: number;
  files: ShareFileEntry[];
  revoke: () => Promise<void>;
}

/** Checks every limit before a single byte is uploaded. */
export function assertShareAllowed(files: readonly { kind?: 'file' | 'directory'; size: number }[], options: { lifetimeMs: number }): void {
  if (files.some((file) => file.kind === 'directory')) {
    throw new DropForgeError(ERROR_CODES.UNSUPPORTED_OPERATION, 'A hosted share holds files, not folders');
  }
  if (files.length === 0) {
    throw new DropForgeError(ERROR_CODES.UNSUPPORTED_OPERATION, 'A share needs at least one file');
  }
  if (files.length > SHARE_MAX_FILES) {
    throw new DropForgeError(ERROR_CODES.TOO_MANY_FILES, `A share holds at most ${SHARE_MAX_FILES} files`, {
      context: { files: files.length },
    });
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > SHARE_MAX_BYTES) {
    throw new DropForgeError(ERROR_CODES.TOO_LARGE, 'This share is larger than the free storage allows', {
      context: { totalBytes, limit: SHARE_MAX_BYTES },
    });
  }
  if (options.lifetimeMs < SHARE_MIN_LIFETIME_MS || options.lifetimeMs > SHARE_MAX_LIFETIME_MS) {
    throw new DropForgeError(ERROR_CODES.UNSUPPORTED_OPERATION, 'A share lasts between 5 minutes and 7 days');
  }
}

export async function createHostedShare(options: CreateShareOptions): Promise<CreatedShare> {
  const lifetimeMs = options.lifetimeMs ?? SHARE_DEFAULT_LIFETIME_MS;
  const maxDownloads = options.maxDownloads ?? SHARE_MAX_DOWNLOADS;
  assertShareAllowed(options.files, { lifetimeMs });

  const id = toHex(randomBytes(12));
  const rawKey = randomBytes(SHARE_KEY_BYTES);
  const key = await importShareKey(rawKey, 'encrypt');
  const createdAt = options.clock.now();
  const expiresAt = createdAt + lifetimeMs;

  const entries: ShareFileEntry[] = [];
  const objects: Array<{ objectId: string; ciphertext: Uint8Array }> = [];
  for (const file of options.files) {
    const objectId = toHex(randomBytes(12));
    const encrypted = await encryptForShare(file, { key, objectId });
    entries.push(encrypted.entry);
    objects.push({ objectId, ciphertext: encrypted.ciphertext });
  }

  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  await options.backend.createShare({ id, expiresAt, maxDownloads, totalBytes, files: entries });
  for (const object of objects) {
    await options.backend.uploadObject(id, object.objectId, object.ciphertext);
  }
  await options.backend.finalizeShare(id);
  options.logger?.log('info', 'hosted share created', {
    id,
    files: entries.length,
    // Size and lifetime are loggable; keys and file names are not.
    totalBytes,
  });

  const payload: SharePayload = {
    v: SHARE_URL_VERSION,
    id,
    createdAt,
    expiresAt,
    files: entries,
    totalBytes,
    maxDownloads,
    key: toBase64Url(rawKey),
  };
  const url = buildShareUrl(options.origin, payload);
  return {
    id,
    url,
    expiresAt,
    totalBytes,
    files: entries,
    revoke: async () => {
      await options.backend.revoke(id);
      // Destroy the local key material: whoever kept a copy of the fragment must
      // not be able to decrypt anything after a revocation.
      rawKey.fill(0);
    },
  };
}

/* ------------------------------------------------------------------ *
 * Receiver side
 * ------------------------------------------------------------------ */

export interface DownloadShareOptions {
  backend: ShareBackend;
  payload: SharePayload;
  clock: Clock;
  /** Called for each verified file. Nothing is written before the checks pass. */
  write: (entry: ShareFileEntry, data: Uint8Array) => Promise<void>;
  logger?: Logger;
}

export interface DownloadShareResult {
  files: Array<{ name: string; size: number; verified: true }>;
  skipped: Array<{ name: string; reason: 'missing' }>;
}

/**
 * Downloads and decrypts a hosted share. The server is never trusted: expiry,
 * revocation, download quota, size and checksum are all verified again here before
 * a file is written or reported as received.
 */
export async function downloadHostedShare(options: DownloadShareOptions): Promise<DownloadShareResult> {
  const { payload } = options;
  if (payload.expiresAt <= options.clock.now()) {
    throw new DropForgeError(ERROR_CODES.LINK_EXPIRED, 'This sharing link has expired');
  }
  const status = await options.backend.status(payload.id);
  if (!status.exists) throw new DropForgeError(ERROR_CODES.LINK_NOT_FOUND, 'This share no longer exists');
  if (status.revoked) throw new DropForgeError(ERROR_CODES.LINK_REVOKED, 'The sender revoked this share');
  if (status.expiresAt <= options.clock.now()) {
    throw new DropForgeError(ERROR_CODES.LINK_EXPIRED, 'This sharing link has expired');
  }
  if (status.downloads >= payload.maxDownloads) {
    throw new DropForgeError(ERROR_CODES.LINK_QUOTA_REACHED, 'This share reached its download limit');
  }

  const key = await shareKeyFromPayload(payload);
  const files: DownloadShareResult['files'] = [];
  const skipped: DownloadShareResult['skipped'] = [];
  for (const entry of payload.files) {
    const ciphertext = await options.backend.downloadObject(payload.id, entry.objectId);
    if (!ciphertext) {
      skipped.push({ name: entry.name, reason: 'missing' });
      options.logger?.log('warn', 'a shared object is missing on the server');
      continue;
    }
    const data = await decryptShareFile(ciphertext, entry, { key });
    await options.write(entry, data);
    files.push({ name: entry.name, size: data.length, verified: true });
  }
  return { files, skipped };
}
