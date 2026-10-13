/**
 * `FileSystemPort` on the real filesystem, through the Tauri filesystem plugin.
 *
 * Differences with the browser, and why they are stated rather than hidden:
 *  - there is always a receiving folder: the one the user chose in the settings, or
 *    the system Downloads folder (so a transfer can never fail for "no folder");
 *  - the disk's free space is queried for real (`freeSpace`), which lets the
 *    receiving side refuse a transfer *before* writing anything;
 *  - streaming writes are random-access, so resume after an interruption works.
 */
import { SeekMode, exists, mkdir, open, readDir, remove, stat } from '@tauri-apps/plugin-fs';
import {
  DropForgeError,
  ERROR_CODES,
  fromPlatformError,
  type BlobSink,
  type CreateMode,
  type FileStat,
  type FileSystemPort,
  type SourceFile,
} from '@dropforge/app-core';
import { isSafeRelativePath, redactPath, safeRelativePath } from '@dropforge/protocol';
import { joinUnder, parentOf } from './local-paths.js';

export class TauriFileSystem implements FileSystemPort {
  readonly kind = 'tauri' as const;
  readonly features = {
    persistentHandles: true,
    freeSpace: true,
    directories: true,
    randomAccess: true,
    folderRead: true,
  } as const;

  constructor(
    /** Absolute path of the receiving folder, chosen by the user. */
    private readonly root: string,
    private readonly options: { freeSpace?: () => Promise<number | undefined> } = {},
  ) {}

  async stat(path: string): Promise<FileStat | undefined> {
    const absolute = this.absolute(path);
    try {
      const info = await stat(absolute);
      if (info.isDirectory) return { path: safeRelativePath(path), kind: 'directory', size: 0, lastModified: 0 };
      return {
        path: safeRelativePath(path),
        kind: 'file',
        size: info.size,
        lastModified: info.mtime ? new Date(info.mtime).getTime() : 0,
      };
    } catch {
      // "Does not exist" is a normal answer for a conflict check.
      return undefined;
    }
  }

  async list(directory: string): Promise<FileStat[]> {
    const absolute = this.absolute(directory === '' ? '.' : directory);
    const entries = await readDir(absolute).catch(() => []);
    return entries.map((entry) => ({
      path: directory === '' ? entry.name : `${safeRelativePath(directory)}/${entry.name}`,
      kind: entry.isDirectory ? ('directory' as const) : ('file' as const),
      size: 0,
      lastModified: 0,
    }));
  }

  async create(path: string, options: { size: number; mode: CreateMode }): Promise<BlobSink> {
    const safe = safeRelativePath(path);
    const absolute = this.absolute(safe);
    const existing = await this.stat(safe);
    if (existing && options.mode === 'create-new') {
      throw new DropForgeError(ERROR_CODES.NAME_CONFLICT, 'A file with this name already exists', {
        context: { path: safe },
      });
    }
    if (options.mode === 'resume' && (!existing || existing.size !== options.size)) {
      throw new DropForgeError(ERROR_CODES.RESUME_MISMATCH, 'The partial file cannot be resumed');
    }
    await this.ensureParent(absolute);
    try {
      // `resume` keeps the bytes already on disk (that is the point); every other
      // mode starts from an empty file.
      const handle = await open(
        absolute,
        options.mode === 'replace' ? { write: true, create: true, truncate: true } : { write: true, create: true },
      );
      const startAt = options.mode === 'resume' && existing ? existing.size : 0;
      return new TauriBlobSink(safe, handle, startAt);
    } catch (error) {
      throw fromPlatformError(error);
    }
  }

  async remove(path: string): Promise<void> {
    await remove(this.absolute(path));
  }

  async mkdir(path: string): Promise<void> {
    if (path === '' || path === '.') return;
    await mkdir(this.absolute(path), { recursive: true }).catch((error: unknown) => {
      throw fromPlatformError(error);
    });
  }

  async freeSpace(): Promise<number | undefined> {
    // Real free space of the volume holding the receiving folder, reported by the
    // Rust side. Undefined when it could not be measured: never a guess.
    return (await this.options.freeSpace?.()) ?? undefined;
  }

  /** Turns a relative, validated path into an absolute one inside the root. */
  private absolute(path: string): string {
    if (path === '' || path === '.') return this.root;
    if (!isSafeRelativePath(path)) {
      throw new DropForgeError(ERROR_CODES.PATH_UNSAFE, 'The path is not allowed', { context: { path: redactPath(path) } });
    }
    return joinUnder(this.root, safeRelativePath(path));
  }

  private async ensureParent(absolute: string): Promise<void> {
    const parent = parentOf(absolute);
    if (!parent) return;
    if (!(await exists(parent))) await mkdir(parent, { recursive: true });
  }
}

/** A sink backed by a real file handle; `abort()` closes without truncating. */
class TauriBlobSink implements BlobSink {
  private writtenBytes = 0;
  /** Position of the next byte to write in the destination file. */
  private cursor: number;
  private done = false;

  constructor(
    readonly path: string,
    private readonly handle: Awaited<ReturnType<typeof open>>,
    /** Offset the file starts at: the existing size when resuming, 0 otherwise. */
    startAt: number,
  ) {
    this.cursor = startAt;
  }

  /** Bytes written during this session, which is what progress must report. */
  get written(): number {
    return this.writtenBytes;
  }

  async write(offset: number, data: Uint8Array): Promise<void> {
    try {
      // The engine writes in order, so the common case is a plain append. The
      // seek covers the rest: a resumed file starts at its existing size, and a
      // re-ordered write must never land at the wrong position.
      if (offset !== this.cursor) await this.handle.seek(offset, SeekMode.Start);
      await this.handle.write(data);
      this.cursor = offset + data.length;
      this.writtenBytes += data.length;
    } catch (error) {
      throw fromPlatformError(error);
    }
  }

  async close(): Promise<void> {
    if (this.done) return;
    this.done = true;
    await this.handle.close();
  }

  async abort(): Promise<void> {
    // The partial file stays on disk on purpose: it is the resume point, and the
    // user was told the file is incomplete.
    this.done = true;
    await this.handle.close().catch(() => undefined);
  }
}

/** Lists the files of a picked folder, as sources the engine can read. */
export async function sourcesFromFolder(root: string): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  await walk(root, '', out, 0);
  return out;
}

async function walk(directory: string, prefix: string, out: SourceFile[], depth: number): Promise<void> {
  if (depth > 32) return;
  const entries = await readDir(directory).catch(() => []);
  for (const entry of entries) {
    const absolute = `${directory}/${entry.name}`;
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory) {
      out.push({
        path: safeRelativePath(path),
        kind: 'directory',
        size: 0,
        lastModified: 0,
        read: async () => new Uint8Array(0),
        revalidate: async () => 'unchanged',
      });
      await walk(absolute, path, out, depth + 1);
      continue;
    }
    const info = await stat(absolute).catch(() => undefined);
    out.push({
      path: safeRelativePath(path),
      kind: 'file',
      size: info?.size ?? 0,
      lastModified: info?.mtime ? new Date(info.mtime).getTime() : 0,
      read: async (offset: number, length: number) => {
        const handle = await open(absolute, { read: true });
        try {
          await handle.seek(offset, SeekMode.Start);
          const buffer = new Uint8Array(length);
          const read = await handle.read(buffer);
          return read === null ? undefined : buffer.subarray(0, read);
        } finally {
          await handle.close();
        }
      },
      revalidate: async () => {
        const again = await stat(absolute).catch(() => undefined);
        if (!again) return 'missing';
        return again.size === info?.size ? 'unchanged' : 'changed';
      },
    });
  }
}

