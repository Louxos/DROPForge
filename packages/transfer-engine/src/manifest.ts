/**
 * Manifests describe what is being sent, before any file byte moves.
 * The hash of the manifest is stored with the resume task, so a reconnect can
 * verify it is resuming the *same* content and not something else.
 */
import {
  MAX_FILES_PER_TRANSFER,
  MAX_TRANSFER_TOTAL_BYTES,
  PROTOCOL_VERSION,
  canonicalJsonUnsafe,
  manifestEntrySchema,
  sha256Hex,
  utf8,
  type ManifestEntry,
  type TransferOffer,
} from '@dropforge/protocol';
import { DropForgeError, ERROR_CODES } from '@dropforge/app-core';
import type { SourceFile } from '@dropforge/app-core';
import { toBase64Url, randomBytes } from '@dropforge/security';
import { chunkCountFor } from './ranges.js';

export interface BuildManifestInput {
  files: readonly SourceFile[];
  chunkBytes: number;
  ttlMs?: number;
  now?: number;
  sendsDigests?: boolean;
  resumable?: boolean;
}

export interface BuiltManifest {
  offer: TransferOffer;
  entries: ManifestEntry[];
  totalBytes: number;
  manifestHash: string;
}

/** Validates the user selection before anything is announced to the peer. */
export function buildManifest(input: BuildManifestInput): BuiltManifest {
  const { files, chunkBytes } = input;
  if (files.length === 0) {
    throw new DropForgeError(ERROR_CODES.UNSUPPORTED_OPERATION, 'No file was selected');
  }
  if (files.length > MAX_FILES_PER_TRANSFER) {
    throw new DropForgeError(ERROR_CODES.TOO_MANY_FILES, `A single transfer is limited to ${MAX_FILES_PER_TRANSFER} files`, {
      context: { count: files.length },
    });
  }
  let totalBytes = 0;
  const entries: ManifestEntry[] = files.map((file, index) => {
    totalBytes += file.size;
    return manifestEntrySchema.parse({
      index,
      path: file.path,
      kind: file.kind,
      size: file.kind === 'directory' ? 0 : file.size,
      lastModified: file.lastModified,
    }) as ManifestEntry;
  });
  if (totalBytes > MAX_TRANSFER_TOTAL_BYTES) {
    throw new DropForgeError(ERROR_CODES.TOO_LARGE, 'This selection is too large for one transfer', {
      context: { totalBytes },
    });
  }
  const now = input.now ?? Date.now();
  const offer: TransferOffer = {
    t: 'transferOffer',
    transferId: toBase64Url(randomBytes(16)),
    entries,
    totalBytes,
    chunkBytes,
    sendsDigests: input.sendsDigests ?? true,
    resumable: input.resumable ?? true,
    expiresAt: now + (input.ttlMs ?? 120_000),
  };
  return { offer, entries, totalBytes, manifestHash: hashManifest(offer) };
}

/**
 * Stable hash of the content-relevant parts of an offer. Excludes the transfer
 * id and the expiry so a re-offer after a reconnect matches the stored resume
 * task; includes every path and size so different content never collides.
 */
export function hashManifest(offer: TransferOffer): string {
  const canonical = canonicalJsonUnsafe({
    v: PROTOCOL_VERSION,
    entries: offer.entries.map((e) => ({ i: e.index, p: e.path, k: e.kind, s: e.size })),
    totalBytes: offer.totalBytes,
    chunkBytes: offer.chunkBytes,
  });
  return sha256Hex(utf8(canonical));
}

export function chunksFor(entry: ManifestEntry, chunkBytes: number): number {
  if (entry.kind === 'directory') return 0;
  return chunkCountFor(entry.size, chunkBytes);
}

/** Validates the *receiving* side view of an offer: sizes, counts, duplicates. */
export function validateOffer(offer: TransferOffer, now = Date.now()): void {
  if (offer.expiresAt < now) {
    throw new DropForgeError(ERROR_CODES.CONNECTION_TIMEOUT, 'This transfer offer has expired', { retryable: true });
  }
  const seen = new Set<string>();
  let total = 0;
  for (const entry of offer.entries) {
    if (seen.has(entry.path)) {
      throw new DropForgeError(ERROR_CODES.PATH_UNSAFE, 'The sender announced the same path twice', {
        context: { index: entry.index },
      });
    }
    seen.add(entry.path);
    total += entry.size;
  }
  if (total !== offer.totalBytes) {
    throw new DropForgeError(ERROR_CODES.UNSUPPORTED_OPERATION, 'The announced sizes do not add up');
  }
}
