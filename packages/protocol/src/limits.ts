/**
 * Hard limits of the protocol. These are safety rails, not product quotas:
 * they protect memory, the relay service and the receiving device.
 * Documented in docs/SPEC.md § Limits.
 */

/** Chunk size used for file data. 256 KiB keeps memory flat and relay-friendly. */
export const DATA_CHUNK_BYTES = 256 * 1024;

/** Largest plaintext frame we accept or emit (control JSON). */
export const MAX_CONTROL_FRAME_BYTES = 256 * 1024;

/** Largest sealed frame on the wire (chunk + AEAD + header overhead). */
export const MAX_SEALED_FRAME_BYTES = DATA_CHUNK_BYTES + 4096;

/** Maximum files described by a single transfer offer. */
export const MAX_FILES_PER_TRANSFER = 10_000;

/** Maximum total bytes described by a single transfer offer (2 TiB). */
export const MAX_TRANSFER_TOTAL_BYTES = 2 * 1024 ** 4;

/** Maximum entries (files + directories) in one folder offer. */
export const MAX_FOLDER_ENTRIES = 50_000;

/** Handshake must complete within this delay. */
export const HANDSHAKE_TIMEOUT_MS = 30_000;

/** A peer that stops sending keepalives for this long is considered gone. */
export const PEER_IDLE_TIMEOUT_MS = 45_000;

export const KEEPALIVE_INTERVAL_MS = 15_000;

/** Window of unacknowledged chunks per transfer (backpressure). */
export const CHUNK_WINDOW = 16;

/** Retry policy for a failed chunk (exponential backoff, capped). */
export const CHUNK_RETRY_BASE_MS = 500;
export const CHUNK_RETRY_MAX_MS = 15_000;
export const CHUNK_MAX_ATTEMPTS = 6;

/** Relay rooms expire after this delay without activity. */
export const ROOM_TTL_MS = 10 * 60_000;

/** Maximum peers in one relay room. */
export const MAX_ROOM_PEERS = 2;

/** Path length cap for received file names/directories. */
export const MAX_PATH_BYTES = 1024;
