/**
 * Receiver side of a transfer.
 *
 * Guarantees:
 *  - every announced path is sanitised before it reaches the filesystem; entries
 *    that try to escape the receiving folder are refused and reported, never
 *    silently rewritten;
 *  - nothing is overwritten without an explicit decision (ignore / rename /
 *    replace); by default the engine asks the user through `requestDecision`;
 *  - bytes are written at their exact offset and a file is marked verified only
 *    after its sha-256 digest matches the sender's;
 *  - the sender is never told "ok" for bytes that were not written: an
 *    acknowledgement is sent only after the write call resolved;
 *  - partial data and the byte ranges that are already durable are exposed so
 *    an interrupted transfer can be resumed.
 *
 * This class never talks to the UI: it asks a question through a callback, so
 * the same engine works in the desktop app, the PWA, the CLI and the tests.
 */
import {
  DATA_CHUNK_BYTES,
  Sha256Stream,
  toHex,
  uniqueName,
  isSafeRelativePath,
  safeRelativePath,
  UnsafePathError,
  type Clock,
  type ConflictDecision,
  type ControlMessage,
  type FileDigest,
  type InnerDataHeader,
  type Logger,
  type ManifestEntry,
  type TransferOffer,
} from '@dropforge/protocol';
import {
  DropForgeError,
  ERROR_CODES,
  SpeedMeter,
  fromPlatformError,
  type BlobSink,
  type FileSystemPort,
  type TransferState,
} from '@dropforge/app-core';
import { chunkCountFor, normaliseRanges, type ByteRange } from './ranges.js';
import { hashManifest } from './manifest.js';
import type { PeerSession } from './session.js';
import type { TransferProgress } from './sender.js';

export type ConflictAction = 'ask' | 'overwrite' | 'skip' | 'rename';

export interface Conflict {
  index: number;
  path: string;
  kind: 'file' | 'directory';
  incomingSize: number;
  existingSize: number;
  existingModified?: number;
}

export interface DecisionRequest {
  offer: TransferOffer;
  conflicts: Conflict[];
  /** Free space the destination reported, when known. */
  freeSpace: number | undefined;
}

export interface DecisionAnswer {
  accepted: boolean;
  decisions: ConflictDecision['decisions'];
  rejectReason?: 'declined' | 'noSpace' | 'busy' | 'unsupported' | 'tooLarge';
}

export interface ReceiverOptions {
  session: PeerSession;
  offer: TransferOffer;
  store: FileSystemPort;
  clock: Clock;
  /** Stream index reserved for this transfer on the session. */
  streamIndex: number;
  policy: ConflictAction;
  /**
   * Called when the transfer needs a human answer (new peer, conflict policy
   * "ask"). The engine never decides on behalf of the user.
   */
  requestDecision: (request: DecisionRequest) => Promise<DecisionAnswer>;
  /** Ranges already durable from a previous session (resume). */
  resume?: { manifestHash: string; files: Array<{ index: number; ranges: ByteRange[] }> };
  logger?: Logger;
  onProgress?: (progress: TransferProgress) => void;
  /** Free space known by the platform, when it exposes it. */
  freeSpaceBytes?: number;
  progressIntervalMs?: number;
  /** Minimum delay between two progress events (0 in tests). */
  progressThrottleMs?: number;
  /** Abandon a transfer that produced no data for this long. */
  stallTimeoutMs?: number;
}

export interface ReceivedFile {
  index: number;
  path: string;
  size: number;
  verified: boolean;
  ranges: ByteRange[];
}

export interface ReceiverOutcome {
  outcome: 'completed' | 'partial' | 'failed' | 'cancelled' | 'declined' | 'interrupted';
  files: ReceivedFile[];
  verifiedFiles: number;
  failed: Array<{ index: number; reason: 'digestMismatch' | 'writeFailed' | 'noSpace' }>;
  bytesDone: number;
  errorCode?: string;
}

interface FileState {
  entry: ManifestEntry;
  path: string;
  sink: BlobSink | undefined;
  expectedChunk: number;
  hasher: Sha256Stream;
  bytesWritten: number;
  digestVerified: boolean;
  ranges: ByteRange[];
  open: boolean;
  overwrite: boolean;
  /** Bounded number of late-conflict renames for this file. */
  renameAttempts: number;
  /**
   * True while this file continues a partial file from a previous session: the
   * destination already holds a verified, chunk-aligned prefix, so it must be
   * opened in 'resume' mode and it must not be treated as a name conflict.
   */
  resumePrefix: boolean;
}

class TransferAborted extends Error {
  constructor(readonly dfError: DropForgeError) {
    super(dfError.message);
  }
}

export class TransferReceiver {
  private readonly meter = new SpeedMeter();
  private readonly files = new Map<number, FileState>();
  /** Directory entries: created once, never digested, never counted as files. */
  private readonly directories = new Map<number, string>();
  private readonly refused: Array<{ index: number; reason: string }> = [];
  private state: TransferState = 'connecting';
  private paused = false;
  private cancelRequested = false;
  private unsubscribeControl: (() => void) | undefined;
  private unsubscribeSession: (() => void) | undefined;
  private unregisterStream: (() => void) | undefined;
  private stallHandle: unknown;
  private readonly streamIndex: number;
  private bytesDone = 0;
  private lastProgressAt = 0;
  private lastProgressSentAt = 0;
  private lastActivityAt: number;
  private decisions: ConflictDecision['decisions'] = [];
  private readonly progressIntervalMs: number;
  private readonly progressThrottleMs: number;
  private readonly stallTimeoutMs: number;
  private accepted = false;
  private abortSent = false;
  private abort: TransferAborted | undefined;
  private rejectWaiter: ((error: DropForgeError) => void) | undefined;
  private completeWaiter: ((files: ReceivedFile[]) => void) | undefined;

  constructor(private readonly options: ReceiverOptions) {
    this.progressIntervalMs = options.progressIntervalMs ?? 1000;
    this.progressThrottleMs = options.progressThrottleMs ?? 250;
    this.stallTimeoutMs = options.stallTimeoutMs ?? 60_000;
    this.streamIndex = options.streamIndex;
    this.lastActivityAt = options.clock.now();
  }

  get currentState(): TransferState {
    return this.state;
  }

  get refusedEntries(): ReadonlyArray<{ index: number; reason: string }> {
    return this.refused;
  }

  /** Detects conflicts without touching anything: safe before answering. */
  static async detectConflicts(
    store: FileSystemPort,
    offer: TransferOffer,
    /** Paths that are deliberately continued (resume) and are not conflicts. */
    ignore: ReadonlySet<string> = new Set<string>(),
  ): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];
    for (const entry of offer.entries) {
      if (!isSafeRelativePath(entry.path)) continue;
      const path = safeRelativePath(entry.path);
      if (entry.kind !== 'directory' && ignore.has(path)) continue;
      const existing = await store.stat(path);
      if (!existing) continue;
      if (existing.kind === 'directory' && entry.kind === 'directory') continue;
      conflicts.push({
        index: entry.index,
        path,
        kind: entry.kind,
        incomingSize: entry.size,
        existingSize: existing.size,
        existingModified: existing.lastModified,
      });
    }
    return conflicts;
  }

  async run(): Promise<ReceiverOutcome> {
    try {
      await this.prepare();
      if (!this.accepted) {
        return { outcome: 'declined', files: [], verifiedFiles: 0, failed: [], bytesDone: 0 };
      }
      this.state = 'transferring';
      this.emitProgress(true);
      return await this.waitForCompletion();
    } catch (error) {
      const dfError =
        error instanceof TransferAborted
          ? error.dfError
          : error instanceof DropForgeError
            ? error
            : new DropForgeError(ERROR_CODES.WRITE_FAILED, 'The transfer could not be completed');
      await this.closeOpenSinks();
      const interrupted = dfError.code === ERROR_CODES.CONNECTION_LOST;
      if (!this.accepted && !interrupted) {
        // Keep the sender informed instead of letting it wait for an answer.
        await this.safeReject(rejectReasonFor(dfError.code));
      }
      this.state = interrupted ? 'interrupted' : 'failed';
      this.emitProgress(true);
      const files = this.snapshotFiles();
      return {
        outcome: this.cancelRequested ? 'cancelled' : interrupted ? 'interrupted' : 'failed',
        files,
        verifiedFiles: files.filter((f) => f.verified).length,
        failed: files
          .filter((f) => !f.verified && f.ranges.length > 0)
          .map((f) => ({ index: f.index, reason: 'writeFailed' as const })),
        bytesDone: this.bytesDone,
        errorCode: dfError.code,
      };
    } finally {
      this.options.clock.clearInterval(this.stallHandle);
      this.unsubscribeControl?.();
      this.unsubscribeSession?.();
      this.unregisterStream?.();
    }
  }

  /** Path validation, conflicts, user decision, accept/reject. */
  /**
   * Resume data is only usable for the very same manifest: a different manifest
   * hash means the checkpoint belongs to another file set (or another version of
   * the same file), and reusing it would write unrelated bytes into the file. The
   * whole-file digest would catch it, but the honest thing is not to try.
   */
  private resumeMatchesManifest(): boolean {
    const resume = this.options.resume;
    if (!resume) return false;
    const expected = hashManifest(this.options.offer);
    if (resume.manifestHash !== expected) {
      this.options.logger?.log('warn', 'resume data ignored: it belongs to another manifest', {
        expected,
        received: resume.manifestHash,
      });
      return false;
    }
    return true;
  }

  private async prepare(): Promise<void> {
    const { offer, store } = this.options;
    for (const entry of offer.entries) {
      try {
        const path = safeRelativePath(entry.path);
        if (entry.kind === 'directory') {
          // Directories are created after the conflict decisions are known.
          this.directories.set(entry.index, path);
          continue;
        }
        this.files.set(entry.index, {
          entry,
          path,
          sink: undefined,
          expectedChunk: 0,
          hasher: new Sha256Stream(),
          bytesWritten: 0,
          digestVerified: false,
          ranges: [],
          open: false,
          overwrite: false,
          renameAttempts: 0,
          resumePrefix: false,
        });
      } catch (error) {
        this.refused.push({
          index: entry.index,
          reason: error instanceof UnsafePathError ? 'pathUnsafe' : 'pathInvalid',
        });
      }
    }
    if (this.files.size === 0 && this.directories.size === 0) {
      await this.reject('unsupported');
      throw new DropForgeError(ERROR_CODES.PATH_UNSAFE, 'Every announced path was refused for security reasons', {
        context: { refused: this.refused.length },
      });
    }

    // A verified, chunk-aligned prefix of a file that belongs to this exact
    // manifest is adopted *before* conflicts are computed: continuing a partial
    // download is the whole point of resume, and it is not a name conflict (the
    // file on disk is the receiving side's own half-written file, see docs/SPEC.md).
    await this.adoptResumeState(store);
    const resumedPaths = new Set([...this.files.values()].filter((f) => f.resumePrefix).map((f) => f.path));
    const conflicts = await TransferReceiver.detectConflicts(store, offer, resumedPaths);
    const freeSpace = this.options.freeSpaceBytes ?? (await store.freeSpace());
    if (freeSpace !== undefined && offer.totalBytes > freeSpace) {
      await this.reject('noSpace');
      throw new DropForgeError(ERROR_CODES.NO_SPACE_LEFT, 'The destination device has no free space left', {
        context: { needed: offer.totalBytes, free: freeSpace },
      });
    }
    const decision = await this.options.requestDecision({ offer, conflicts, freeSpace });
    if (!decision.accepted) {
      await this.reject(decision.rejectReason ?? 'declined');
      return;
    }
    const occupied = await this.occupiedPaths(offer);
    this.decisions = this.resolveDecisions(decision.decisions, conflicts, occupied);
    const unanswered = conflicts.find((c) => !this.decisions.some((d) => d.index === c.index));
    if (unanswered) {
      throw new DropForgeError(ERROR_CODES.NAME_CONFLICT, 'Name conflicts must be resolved before receiving', {
        context: { index: unanswered.index },
      });
    }
    for (const conflict of conflicts) {
      const choice = this.decisions.find((d) => d.index === conflict.index);
      const directory = this.directories.get(conflict.index);
      if (directory !== undefined) {
        if (!choice) continue;
        if (choice.action === 'skip') {
          this.directories.delete(conflict.index);
          continue;
        }
        if (choice.action === 'rename') {
          const proposed = choice.newPath ?? '';
          if (proposed !== '' && isSafeRelativePath(proposed)) this.directories.set(conflict.index, safeRelativePath(proposed));
        }
        continue;
      }
      const state = this.files.get(conflict.index);
      if (!state || !choice) continue;
      if (choice.action === 'skip') {
        this.files.delete(conflict.index);
        continue;
      }
      if (choice.action === 'rename') {
        const proposed = choice.newPath ?? '';
        if (proposed === '' || !isSafeRelativePath(proposed)) {
          throw new DropForgeError(ERROR_CODES.NAME_CONFLICT, 'The proposed new name is not usable');
        }
        state.path = safeRelativePath(proposed);
        // Writing to another name means a whole new file: the partial prefix of
        // the original path is not reused.
        this.dropResumePrefix(state);
      }
      if (choice.action === 'overwrite') {
        state.overwrite = true;
        state.ranges = [];
        this.dropResumePrefix(state);
      }
    }
    if (this.decisions.length > 0) {
      await this.options.session.sendControl({
        t: 'conflictDecision',
        transferId: offer.transferId,
        decisions: this.decisions,
      });
    }
    for (const path of this.directories.values()) {
      try {
        await store.mkdir(path);
      } catch {
        // A directory that cannot be created is reported through the missing
        // files it should have contained, never as a silent success.
        this.options.logger?.log('warn', 'directory could not be created');
      }
    }

    await this.options.session.sendControl({
      t: 'transferAccept',
      transferId: offer.transferId,
      // Refused entries are announced so the sender skips them instead of
      // streaming data and waiting for acknowledgements forever.
      refused: this.refused.map((entry) => ({
        index: entry.index,
        reason: (entry.reason === 'pathUnsafe' ? 'pathUnsafe' : 'unsupported') as 'pathUnsafe' | 'unsupported',
      })),
      existing: this.existingRanges(),
      streamingToDisk: store.kind !== 'browser-download',
    });
    this.accepted = true;
    this.attachStream();
  }

  /**
   * Adopts the reusable prefix of every file, from a resume state whose manifest
   * hash matches this offer exactly. Only the contiguous, chunk-aligned prefix
   * is trusted, it is read back and hashed again (so the whole-file digest still
   * covers every byte), and anything unexpected simply starts that file again.
   */
  private async adoptResumeState(store: FileSystemPort): Promise<void> {
    const resume = this.options.resume;
    // Defence in depth: a resume state that does not belong to this exact
    // manifest is ignored, never trusted.
    if (!resume) return;
    if (resume.manifestHash !== hashManifest(this.options.offer)) {
      this.options.logger?.log('warn', 'resume state ignored: it belongs to another manifest');
      return;
    }
    for (const state of this.files.values()) {
      if (state.entry.kind === 'directory') continue;
      const stored = resume.files.find((f) => f.index === state.entry.index);
      if (!stored) continue;
      const prefixEnd = chunkAlignedPrefix(stored.ranges, state.entry.size, this.options.offer.chunkBytes);
      if (prefixEnd <= 0) continue;
      const read = store.read?.bind(store);
      if (!read) {
        this.options.logger?.log('info', 'resume refused: the destination cannot read back partial data');
        continue;
      }
      try {
        const stat = await store.stat(state.path);
        if (!stat || stat.kind !== 'file' || stat.size !== state.entry.size) throw new Error('size mismatch');
        for (let offset = 0; offset < prefixEnd; ) {
          const length = Math.min(this.options.offer.chunkBytes, prefixEnd - offset);
          const data = await read(state.path, offset, length);
          if (!data || data.length !== length) throw new Error('short read-back');
          state.hasher.update(data);
          offset += length;
        }
      } catch {
        // The partial data is not usable as expected: start that file again.
        this.options.logger?.log('warn', 'resume refused: partial data could not be hashed back');
        state.hasher = new Sha256Stream();
        continue;
      }
      state.resumePrefix = true;
      state.ranges = [{ start: 0, end: prefixEnd }];
      state.bytesWritten = prefixEnd;
      state.expectedChunk =
        prefixEnd >= state.entry.size
          ? chunkCountFor(state.entry.size, this.options.offer.chunkBytes)
          : prefixEnd / this.options.offer.chunkBytes;
      this.options.logger?.log('info', 'resuming a partial file', {
        index: state.entry.index,
        bytes: prefixEnd,
      });
    }
  }

  /** Ranges the receiver already holds, announced in `transferAccept`. */
  private existingRanges(): Array<{ index: number; ranges: ByteRange[] }> {
    const out: Array<{ index: number; ranges: ByteRange[] }> = [];
    for (const state of this.files.values()) {
      if (state.resumePrefix && !state.overwrite) out.push({ index: state.entry.index, ranges: state.ranges });
    }
    return out;
  }

  /**
   * Turns the caller's answers into a complete decision set.
   *
   * A rename answer may either propose a name (the user typed one) or ask for a
   * free one (the user pressed "rename"): the second case is resolved here, because
   * this is the only place that knows which paths are already taken.
   *
   * Policies fill in the gaps; "ask" without an answer stays unanswered on purpose
   * so the caller is forced to resolve it instead of guessing.
   */
  private resolveDecisions(
    answers: ConflictDecision['decisions'],
    conflicts: Conflict[],
    occupied: Set<string>,
  ): ConflictDecision['decisions'] {
    const policy = this.options.policy;
    const out: ConflictDecision['decisions'] = [];
    for (const answer of answers) {
      if ((answer.action as string) === 'ask') continue;
      if (answer.action === 'rename' && !answer.newPath) {
        // "Rename" with no proposed name means "give it a free name". Only the
        // receiving side can do that: it is the side that knows what is already
        // on its disk, and the answer travels over the wire where a name invented
        // by the sender would be worthless.
        const conflict = conflicts.find((candidate) => candidate.index === answer.index);
        const candidate = uniqueName(conflict?.path ?? '', (path) => occupied.has(path));
        occupied.add(candidate);
        out.push({ index: answer.index, action: 'rename', newPath: candidate });
        continue;
      }
      out.push(answer);
    }
    for (const conflict of conflicts) {
      if (out.some((d) => d.index === conflict.index)) continue;
      if (policy === 'overwrite') out.push({ index: conflict.index, action: 'overwrite' });
      else if (policy === 'skip') out.push({ index: conflict.index, action: 'skip' });
      else if (policy === 'rename') {
        // Propose a name that is really free: the occupied paths are known, and
        // names already handed out for this transfer count as occupied too.
        const candidate = uniqueName(conflict.path, (path) => occupied.has(path));
        occupied.add(candidate);
        out.push({ index: conflict.index, action: 'rename', newPath: candidate });
      }
      // policy === 'ask' with no answer: left out on purpose, which fails loudly.
    }
    return out;
  }

  /**
   * Snapshot of the paths that already exist, so a rename can be decided without
   * a second filesystem round-trip per candidate name.
   */
  private async occupiedPaths(offer: TransferOffer): Promise<Set<string>> {
    const occupied = new Set<string>();
    const directories = new Set<string>(['']);
    for (const entry of offer.entries) {
      const slash = entry.path.lastIndexOf('/');
      if (slash < 0) continue;
      try {
        // A hostile path must not make this helper throw: the entry itself is
        // refused a few lines above, and the collision snapshot simply ignores it.
        directories.add(safeRelativePath(entry.path.slice(0, slash)));
      } catch {
        continue;
      }
    }
    for (const directory of directories) {
      try {
        for (const item of await this.options.store.list(directory)) occupied.add(item.path);
      } catch {
        // A missing directory simply has nothing to collide with.
      }
    }
    return occupied;
  }

  private attachStream(): void {
    this.unregisterStream = this.options.session.registerStream(this.streamIndex, {
      onChunk: (header, chunk) => {
        void this.onChunk(header, chunk);
      },
    });
    this.unsubscribeControl = this.options.session.events.on('control', this.onControl);
    // Stall detection: a peer that stops sending must not leave the receiving
    // side waiting forever with a progress bar that never moves.
    this.stallHandle = this.options.clock.setInterval(() => {
      if (!this.checkStall()) return;
      this.fail(
        new DropForgeError(ERROR_CODES.CONNECTION_LOST, 'The sending device stopped responding', { retryable: true }),
      );
    }, Math.max(250, Math.min(5_000, Math.floor(this.stallTimeoutMs / 3))));
    this.unsubscribeSession = this.options.session.events.on('closed', () => {
      if (!this.completeWaiter) return;
      this.rejectWaiter?.(
        new DropForgeError(ERROR_CODES.CONNECTION_LOST, 'The connection to the sending device was lost', {
          retryable: true,
        }),
      );
    });
  }

  private onControl = (message: ControlMessage): void => {
    if (!('transferId' in message) || message.transferId !== this.options.offer.transferId) return;
    this.lastActivityAt = this.options.clock.now();
    switch (message.t) {
      case 'fileDigest':
        void this.onFileDigest(message).catch((error: unknown) => this.fail(error));
        break;
      case 'transferComplete':
        void this.onTransferComplete(message.unavailable).catch((error: unknown) => this.fail(error));
        break;
      case 'transferPause':
        if (this.state === 'transferring') {
          this.paused = true;
          this.state = 'paused';
          this.emitProgress(true);
        }
        break;
      case 'transferResume':
        if (this.state === 'paused') {
          this.paused = false;
          this.state = 'transferring';
          this.emitProgress(true);
        }
        break;
      case 'transferCancel':
        this.cancelRequested = true;
        this.fail(new DropForgeError(ERROR_CODES.TRANSFER_CANCELLED, 'The sending device cancelled the transfer'));
        break;
      default:
        break;
    }
  };

  private fail(error: unknown): void {
    const dfError =
      error instanceof TransferAborted
        ? error.dfError
        : error instanceof DropForgeError
          ? error
          : fromPlatformError(error);
    // Our own error text never contains secrets: it is safe to log for support.
    // For foreign exceptions only the type is logged (a message could carry a path).
    this.options.logger?.log('warn', 'receiving side failed', {
      code: dfError.code,
      detail: dfError.message,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    this.abort = new TransferAborted(dfError);
    if (this.accepted && !this.abortSent) {
      this.abortSent = true;
      // The sender must be told to stop: otherwise it keeps streaming into a
      // receiver that will never acknowledge anything again.
      void this.options.session
        .sendControl({
          t: 'transferAbort',
          transferId: this.options.offer.transferId,
          reason: abortReasonFor(dfError.code),
        })
        .catch(() => {
          /* the session may already be gone */
        });
    }
    this.rejectWaiter?.(dfError);
  }

  private async waitForCompletion(): Promise<ReceiverOutcome> {
    const outcome = await new Promise<ReceiverOutcome>((resolve, reject) => {
      this.completeWaiter = (files) => {
        const verified = files.filter((f) => f.verified);
        const failed = files
          .filter((f) => !f.verified)
          .map((f) => ({ index: f.index, reason: 'digestMismatch' as const }));
        resolve({
          outcome: failed.length === 0 ? 'completed' : verified.length > 0 ? 'partial' : 'failed',
          files,
          verifiedFiles: verified.length,
          failed,
          bytesDone: this.bytesDone,
        });
      };
      this.rejectWaiter = (error) => reject(new TransferAborted(error));
    }).catch(async (error: unknown) => {
      const dfError = error instanceof TransferAborted ? error.dfError : fromPlatformError(error);
      await this.closeOpenSinks();
      this.state = this.cancelRequested ? 'cancelled' : dfError.code === ERROR_CODES.CONNECTION_LOST ? 'interrupted' : 'failed';
      this.emitProgress(true);
      const files = this.snapshotFiles();
      return {
        outcome: this.cancelRequested
          ? ('cancelled' as const)
          : dfError.code === ERROR_CODES.CONNECTION_LOST
            ? ('interrupted' as const)
            : ('failed' as const),
        files,
        verifiedFiles: files.filter((f) => f.verified).length,
        failed: [] as Array<{ index: number; reason: 'digestMismatch' | 'writeFailed' | 'noSpace' }>,
        bytesDone: this.bytesDone,
        errorCode: dfError.code,
      };
    });
    return outcome;
  }

  private snapshotFiles(): ReceivedFile[] {
    return [...this.files.values()].map((state) => ({
      index: state.entry.index,
      path: state.path,
      size: state.entry.size,
      verified: state.digestVerified,
      ranges: state.ranges,
    }));
  }

  private async onChunk(header: InnerDataHeader, chunk: Uint8Array): Promise<void> {
    const state = this.files.get(header.fileIndex);
    if (!state) return; // refused or skipped entry: acknowledge nothing
    this.lastActivityAt = this.options.clock.now();
    if (header.chunkIndex < state.expectedChunk) {
      await this.ack(state, state.expectedChunk - 1);
      return;
    }
    if (header.chunkIndex > state.expectedChunk) {
      this.options.logger?.log('warn', 'out-of-order chunk refused', {
        index: header.fileIndex,
        expected: state.expectedChunk,
        got: header.chunkIndex,
      });
      await this.ack(state, state.expectedChunk - 1);
      return;
    }
    if (chunk.length > DATA_CHUNK_BYTES) {
      this.fail(new DropForgeError(ERROR_CODES.UNSUPPORTED_OPERATION, 'Received an oversized chunk'));
      return;
    }
    try {
      const sink = await this.openSink(state);
      const offset = header.chunkIndex * this.options.offer.chunkBytes;
      if (chunk.length > 0) {
        await sink.write(offset, chunk);
        state.hasher.update(chunk);
        this.meter.add(chunk.length, this.options.clock.now());
      }
      state.bytesWritten += chunk.length;
      state.expectedChunk = header.chunkIndex + 1;
      state.ranges = appendRange(state.ranges, { start: offset, end: offset + chunk.length }, state.entry.size);
      this.bytesDone = this.computeBytesDone();
      if (header.lastChunk && state.open) {
        await sink.close();
        state.open = false;
      }
      await this.ack(state, header.chunkIndex);
      this.emitProgress();
    } catch (error) {
      this.fail(error);
    }
  }

  private async openSink(state: FileState): Promise<BlobSink> {
    if (state.sink) return state.sink;
    try {
      state.sink = await this.options.store.create(state.path, {
        size: state.entry.size,
        mode: state.resumePrefix && !state.overwrite ? 'resume' : state.overwrite ? 'replace' : 'create-new',
      });
      state.open = true;
      return state.sink;
    } catch (error) {
      const dfError = fromPlatformError(error);
      if (dfError.code === ERROR_CODES.NO_SPACE_LEFT) {
        throw new DropForgeError(ERROR_CODES.NO_SPACE_LEFT, 'The destination device has no free space left', {
          context: { index: state.entry.index },
        });
      }
      if (dfError.code === ERROR_CODES.NAME_CONFLICT && !state.overwrite && state.renameAttempts < 5) {
        // A file appeared between the offer and the write. Overwriting is never
        // an option here: pick a free name and tell the truth in the history.
        state.renameAttempts += 1;
        const taken = new Set<string>([state.path]);
        const candidate = uniqueName(state.path, (path) => taken.has(path));
        taken.add(candidate);
        this.options.logger?.log('info', 'late name conflict resolved by renaming', {
          index: state.entry.index,
          attempt: state.renameAttempts,
        });
        state.path = candidate;
        return await this.openSink(state);
      }
      throw dfError;
    }
  }

  /**
   * Forgets an adopted prefix. The bytes on disk are kept, but the file is
   * treated as new again, so a renamed or replaced file is never half-resumed.
   */
  private dropResumePrefix(state: FileState): void {
    if (!state.resumePrefix) return;
    state.resumePrefix = false;
    state.hasher = new Sha256Stream();
    state.ranges = [];
    state.bytesWritten = 0;
    state.expectedChunk = 0;
  }

  private computeBytesDone(): number {
    let total = 0;
    for (const state of this.files.values()) {
      for (const range of state.ranges) total += Math.max(0, range.end - range.start);
    }
    return total;
  }

  private async ack(state: FileState, chunkIndex: number): Promise<void> {
    if (chunkIndex < 0) return;
    await this.options.session.sendControl({
      t: 'chunkAck',
      transferId: this.options.offer.transferId,
      fileIndex: state.entry.index,
      chunkIndex,
      receivedBytes: this.bytesDone,
    });
  }

  private async onFileDigest(message: FileDigest): Promise<void> {
    const state = this.files.get(message.index);
    if (!state) {
      // Skipped or refused entry: answer explicitly so the sender never waits
      // for a verdict that cannot come.
      await this.options.session.sendControl({
        t: 'fileDigestResult',
        transferId: this.options.offer.transferId,
        index: message.index,
        ok: false,
        action: 'reject',
      });
      return;
    }
    const expectedChunks = chunkCountFor(state.entry.size, this.options.offer.chunkBytes);
    const complete = message.size === state.entry.size && state.expectedChunk >= expectedChunks;
    if (!complete) {
      await this.options.session.sendControl({
        t: 'fileDigestResult',
        transferId: this.options.offer.transferId,
        index: message.index,
        ok: false,
        action: 'reject',
      });
      return;
    }
    if (state.open && state.sink) {
      await state.sink.close();
      state.open = false;
    }
    const localDigest = toHex(state.hasher.digest());
    const ok = localDigest === message.digest;
    state.digestVerified = ok;
    await this.options.session.sendControl({
      t: 'fileDigestResult',
      transferId: this.options.offer.transferId,
      index: message.index,
      ok,
      action: ok ? 'accept' : 'reject',
    });
    if (!ok) this.options.logger?.log('warn', 'file digest mismatch', { index: message.index });
    this.emitProgress(true);
  }

  private async onTransferComplete(unavailable: Array<{ index: number; reason: string }>): Promise<void> {
    await this.closeOpenSinks();
    const files = this.snapshotFiles().filter((f) => !unavailable.some((u) => u.index === f.index));
    const verified = files.filter((f) => f.verified).length;
    const failed = files
      .filter((f) => !f.verified)
      .map((f) => ({ index: f.index, reason: 'digestMismatch' as const }));
    const outcome: 'completed' | 'partial' | 'failed' =
      failed.length === 0 ? 'completed' : verified > 0 ? 'partial' : 'failed';
    this.state = 'verifying';
    await this.options.session.sendControl({
      t: 'transferResult',
      transferId: this.options.offer.transferId,
      outcome,
      verifiedFiles: verified,
      failedFiles: failed,
    });
    this.state = outcome === 'completed' ? 'completed' : 'failed';
    this.emitProgress(true);
    this.completeWaiter?.(files);
    this.completeWaiter = undefined;
  }

  private async closeOpenSinks(): Promise<void> {
    for (const state of this.files.values()) {
      if (state.sink && state.open) {
        try {
          await state.sink.close();
        } catch {
          /* a partial file that cannot be closed must not hide the real error */
        }
        state.open = false;
      }
    }
  }

  /** Sends a rejection without ever masking the original error. */
  private async safeReject(reason: 'declined' | 'noSpace' | 'busy' | 'unsupported' | 'tooLarge'): Promise<void> {
    try {
      await this.reject(reason);
    } catch {
      /* the peer may already be gone */
    }
  }

  private async reject(reason: 'declined' | 'noSpace' | 'busy' | 'unsupported' | 'tooLarge'): Promise<void> {
    this.state = 'cancelled';
    await this.options.session.sendControl({
      t: 'transferReject',
      transferId: this.options.offer.transferId,
      reason,
    });
  }

  /** Local cancel: stops writing, keeps partial data for a later resume. */
  async cancel(): Promise<void> {
    this.cancelRequested = true;
    await this.closeOpenSinks();
    try {
      await this.options.session.sendControl({
        t: 'transferCancel',
        transferId: this.options.offer.transferId,
      });
    } catch {
      /* the peer may already be gone */
    }
    this.fail(new DropForgeError(ERROR_CODES.TRANSFER_CANCELLED, 'The transfer was cancelled'));
    this.state = 'cancelled';
    this.emitProgress(true);
  }

  /** True when the peer stopped sending data for too long. */
  checkStall(): boolean {
    if (!this.accepted || this.state === 'paused') return false;
    return this.options.clock.now() - this.lastActivityAt > this.stallTimeoutMs;
  }

  /** Data needed to persist a resume task after an interruption. */
  resumeState(manifestHash: string): { manifestHash: string; files: Array<{ index: number; ranges: ByteRange[] }> } {
    return {
      manifestHash,
      files: [...this.files.values()]
        .filter((f) => f.ranges.length > 0 && !f.digestVerified)
        .map((f) => ({ index: f.entry.index, ranges: f.ranges })),
    };
  }

  private emitProgress(force = false): void {
    const now = this.options.clock.now();
    if (force || now - this.lastProgressAt >= this.progressThrottleMs) {
      this.lastProgressAt = now;
      const remaining = Math.max(0, this.options.offer.totalBytes - this.bytesDone);
      const reading = this.meter.read(now, remaining);
      const current = [...this.files.values()].find((f) => f.open);
      this.options.onProgress?.({
        transferId: this.options.offer.transferId,
        state: this.state,
        direction: 'receive',
        bytesDone: this.bytesDone,
        totalBytes: this.options.offer.totalBytes,
        fileIndex: current?.entry.index ?? -1,
        path: current?.path ?? '',
        filesDone: [...this.files.values()].filter((f) => f.digestVerified).length,
        filesTotal: this.options.offer.entries.filter((e) => e.kind === 'file').length,
        bytesPerSecond: reading.bytesPerSecond,
        etaSeconds: reading.etaSeconds,
        reliable: reading.reliable,
        note: this.paused ? 'pausedByPeer' : undefined,
      });
    }
    if (now - this.lastProgressSentAt >= this.progressIntervalMs) {
      this.lastProgressSentAt = now;
      void this.options.session
        .sendControl({
          t: 'progress',
          transferId: this.options.offer.transferId,
          receivedBytes: this.bytesDone,
          verifiedFiles: [...this.files.values()].filter((f) => f.digestVerified).length,
        })
        .catch(() => {
          /* progress reporting is advisory: never fail a transfer for it */
        });
    }
  }
}

/** Appends a range, assuming in-order arrival (the normal case). */
function appendRange(ranges: ByteRange[], incoming: ByteRange, limit: number): ByteRange[] {
  if (incoming.end <= incoming.start) return ranges;
  const last = ranges[ranges.length - 1];
  if (!last || incoming.start >= last.end) {
    return [...ranges, { ...incoming }];
  }
  if (incoming.start <= last.end && incoming.end > last.end) {
    const merged = [...ranges];
    merged[merged.length - 1] = { start: last.start, end: Math.min(incoming.end, limit) };
    return merged;
  }
  // Out-of-order delivery (should not happen on an ordered transport): fall
  // back to a full normalisation so the resume state stays correct.
  return normaliseRanges([...ranges, incoming], limit);
}

/**
 * Longest chunk-aligned prefix of the stored ranges. Byte-range resume with
 * holes is deliberately not implemented: a hole would break the incremental
 * sha-256 of the incoming file, so only a contiguous prefix is reused.
 */
function chunkAlignedPrefix(
  ranges: readonly ByteRange[],
  size: number,
  chunkBytes: number,
): number {
  const valid = normaliseRanges(ranges, size);
  const first = valid[0];
  if (!first || first.start !== 0) return 0;
  const raw = Math.min(first.end, size);
  const aligned = Math.floor(raw / chunkBytes) * chunkBytes;
  if (aligned >= size) return size;
  return aligned;
}

/** Maps an internal error code to the reason the sender is allowed to see. */
function rejectReasonFor(code: string): 'declined' | 'noSpace' | 'busy' | 'unsupported' | 'tooLarge' {
  switch (code) {
    case ERROR_CODES.NO_SPACE_LEFT:
      return 'noSpace';
    case ERROR_CODES.TOO_LARGE:
    case ERROR_CODES.TOO_MANY_FILES:
      return 'tooLarge';
    case ERROR_CODES.PATH_UNSAFE:
    case ERROR_CODES.UNSUPPORTED_OPERATION:
      return 'unsupported';
    case ERROR_CODES.BUSY:
      return 'busy';
    default:
      return 'declined';
  }
}

/** Maps an internal error code to the abort reason the sender is allowed to see. */
function abortReasonFor(
  code: string,
): 'writeFailed' | 'noSpace' | 'permissionDenied' | 'conflict' | 'integrityFailed' | 'busy' {
  switch (code) {
    case ERROR_CODES.NO_SPACE_LEFT:
      return 'noSpace';
    case ERROR_CODES.PERMISSION_DENIED:
      return 'permissionDenied';
    case ERROR_CODES.NAME_CONFLICT:
    case ERROR_CODES.PATH_UNSAFE:
      return 'conflict';
    case ERROR_CODES.INTEGRITY_FAILED:
      return 'integrityFailed';
    case ERROR_CODES.BUSY:
      return 'busy';
    default:
      return 'writeFailed';
  }
}
