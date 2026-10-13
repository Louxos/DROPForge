/**
 * Storage ports.
 *
 * Two families of data, two different stores, on every platform:
 *  - structured metadata (devices, transfers, files, resume tasks, history,
 *    settings) → SQLite on Windows, IndexedDB on the PWA. Schema is versioned
 *    and migrated (see docs/DATA-MODEL.md).
 *  - file bytes → a real filesystem on Windows, the File System Access API or
 *    a Blob download in the browser. Never kept in the metadata store.
 *
 * The engine only talks to these interfaces, so the same transfer code runs on
 * desktop and in a browser without a single `if (isTauri)` inside the engine.
 */
import type { TransferState } from './state-machine.js';

export interface StoredRecord<T> {
  key: string;
  value: T;
}

/**
 * Key/value collections with prefix listing. Implementations must be crash-safe:
 * a write is either fully applied or not visible at all.
 */
export interface MetaStore {
  readonly kind: 'sqlite' | 'indexeddb' | 'memory';
  init(): Promise<void>;
  /** Schema version currently applied. */
  readonly schemaVersion: number;
  get<T>(collection: string, key: string): Promise<T | undefined>;
  put<T>(collection: string, key: string, value: T): Promise<void>;
  /** Applies many writes atomically where the platform allows it. */
  putMany(collection: string, records: StoredRecord<unknown>[]): Promise<void>;
  list<T>(collection: string, options?: { prefix?: string; limit?: number }): Promise<Array<StoredRecord<T>>>;
  delete(collection: string, key: string): Promise<void>;
  deleteCollection(collection: string): Promise<void>;
  /** Bytes are still handled by IndexedDB transactions for spooled chunks. */
  close(): Promise<void>;
}

/**
 * How a destination file is opened:
 *  - 'create-new': the file must not exist (a conflict is an error, never a silent replace);
 *  - 'replace'   : the user explicitly chose to overwrite: truncate and write;
 *  - 'resume'    : continue writing a partial file this port created earlier
 *                  (its bytes are kept, the size must match).
 */
export type CreateMode = 'create-new' | 'replace' | 'resume';

export interface BlobSink {
  readonly path: string;
  /** Bytes durably written so far (fsync boundaries only). */
  readonly written: number;
  /** Writes at an absolute offset; must be idempotent for the same range. */
  write(offset: number, data: Uint8Array): Promise<void>;
  /** Flushes to the platform (fsync) and closes. */
  close(): Promise<void>;
  /** Drops the partial file (used on cancel of a non-resumable transfer). */
  abort(): Promise<void>;
}

export interface FileStat {
  path: string;
  kind: 'file' | 'directory';
  size: number;
  lastModified?: number;
}

/**
 * Filesystem abstraction. Every method takes a *relative*, already sanitised
 * path ('' means the root of the receiving folder): the port decides where that
 * root is (chosen folder, Tauri scope, browser download). Implementations MUST
 * refuse paths that escape the root, and MUST NOT replace an existing file
 * unless `overwrite` is true.
 */
export interface FileSystemPort {
  readonly kind: 'tauri' | 'browser-fs' | 'browser-download' | 'memory';
  /** Capabilities actually available on this platform. */
  readonly features: {
    /** Directory handles can be kept between sessions. */
    persistentHandles: boolean;
    /** Free-space estimate is available. */
    freeSpace: boolean;
    /** Directories can be created. */
    directories: boolean;
    /** In-place writes at arbitrary offsets (needed for resume). */
    randomAccess: boolean;
    /** Selected folders can be read (sending a folder). */
    folderRead: boolean;
  };
  stat(path: string): Promise<FileStat | undefined>;
  list(directory: string): Promise<FileStat[]>;
  /**
   * Opens a destination file according to `mode`. Implementations MUST refuse to
   * replace an existing file for 'create-new', MUST keep existing bytes for
   * 'resume' (and fail when the size does not match), and MUST create parent
   * directories as needed.
   */
  create(path: string, options: { size: number; mode: CreateMode }): Promise<BlobSink>;
  /**
   * Reads back bytes this port wrote earlier. Required for a *verified* resume:
   * the receiving side re-hashes the prefix it already holds so the whole-file
   * digest still covers the complete file. When absent, a partially received
   * file is requested again from the beginning instead of being trusted.
   */
  read?(path: string, offset: number, length: number): Promise<Uint8Array | undefined>;
  remove(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  freeSpace(): Promise<number | undefined>;
}

/** Reads a local file to send it; supports random access for resume. */
export interface SourceFile {
  readonly path: string;
  /** Directories are announced in the manifest but carry no bytes. */
  readonly kind: 'file' | 'directory';
  readonly size: number;
  readonly lastModified: number;
  /** Resolves to undefined when the file disappeared or changed. */
  read(offset: number, length: number): Promise<Uint8Array | undefined>;
  /** Re-validates that the file still matches the manifest (size + mtime). */
  revalidate(): Promise<'unchanged' | 'changed' | 'missing'>;
}

export interface SourceProvider {
  /** Lists the files a user picked (already expanded for folders). */
  list(): Promise<SourceFile[]>;
}

/* ------------------------------------------------------------------ *
 * Persisted models (docs/DATA-MODEL.md, version 1)
 * ------------------------------------------------------------------ */

export interface DeviceRecord {
  v: 1;
  id: string;
  displayName: string;
  platform: string;
  /** base64url long-term public key of the peer. */
  publicKey: string;
  /** sha-256 hex of the public key: the real identity. */
  fingerprint: string;
  sign: string;
  agree: string;
  trusted: boolean;
  /** Whether the user allowed this device without asking again. */
  autoAccept: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
  /** Set when the device was revoked; kept for the history. */
  revokedAt?: number;
}

export interface TransferFileRecord {
  index: number;
  path: string;
  kind: 'file' | 'directory';
  size: number;
  /** Per-file integrity outcome. */
  digest?: string;
  verified?: boolean;
  bytesDone: number;
}

export interface TransferRecord {
  v: 1;
  id: string;
  direction: 'send' | 'receive';
  /** Peer device id, plus a cached label for display when the device is gone. */
  peerDeviceId: string;
  peerName: string;
  state: TransferState;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  totalBytes: number;
  bytesDone: number;
  files: TransferFileRecord[];
  /** Last error code, already displayable through i18n. */
  lastErrorCode?: string;
  /** Method actually used, for honest history entries. */
  transport?: 'webrtc' | 'relay' | 'download' | 'upload' | 'local';
}

export interface ResumeTaskRecord {
  v: 1;
  transferId: string;
  direction: 'send' | 'receive';
  /** Ranges already durable on this side. */
  files: Array<{ index: number; path: string; ranges: Array<{ start: number; end: number }> }>;
  manifestHash: string;
  createdAt: number;
}
