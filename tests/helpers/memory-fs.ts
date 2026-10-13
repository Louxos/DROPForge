/**
 * In-memory FileSystemPort + SourceFile helpers for the integration tests.
 * Behaves like the real ports: refuses unsafe paths, refuses to replace an
 * existing file unless asked, supports random access (so verified resume is
 * exercised) and can simulate a full disk.
 */
import {
  DropForgeError,
  ERROR_CODES,
  type BlobSink,
  type CreateMode,
  type FileStat,
  type FileSystemPort,
  type SourceFile,
} from '@dropforge/app-core';
import { isSafeRelativePath } from '@dropforge/protocol';

interface StoredFile {
  data: Uint8Array;
  lastModified: number;
}

class MemorySink implements BlobSink {
  private closed = false;
  private writtenBytes = 0;
  private readonly ranges: Array<{ start: number; end: number }> = [];

  constructor(
    private readonly fs: MemoryFileSystem,
    readonly path: string,
    private readonly file: StoredFile,
  ) {}

  get written(): number {
    return this.writtenBytes;
  }

  async write(offset: number, data: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('sink is closed');
    if (offset + data.length > this.file.data.length) {
      throw new DropForgeError(ERROR_CODES.WRITE_FAILED, 'Write past the end of the file');
    }
    this.fs.checkSpace(data.length);
    this.file.data.set(data, offset);
    this.ranges.push({ start: offset, end: offset + data.length });
    this.writtenBytes += data.length;
    this.fs.changed = true;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  async abort(): Promise<void> {
    this.closed = true;
    this.fs.deleteUnsafe(this.path);
  }

  get rangesWritten(): ReadonlyArray<{ start: number; end: number }> {
    return this.ranges;
  }
}

export class MemoryFileSystem implements FileSystemPort {
  readonly kind = 'memory' as const;
  readonly features = {
    persistentHandles: true,
    freeSpace: true,
    directories: true,
    randomAccess: true,
    folderRead: true,
  };
  private readonly files = new Map<string, StoredFile>();
  private readonly directories = new Set<string>();
  /** Simulated free space (undefined = unlimited). */
  freeSpaceBytes: number | undefined;
  changed = false;
  /** Set to make every create() fail with a permission error. */
  denyWrites = false;
  /** Bytes actually written through sinks (for "did we re-send everything?" checks). */
  bytesWritten = 0;

  constructor(seed: Record<string, Uint8Array | string> = {}) {
    for (const [path, value] of Object.entries(seed)) {
      const data = typeof value === 'string' ? new TextEncoder().encode(value) : value;
      this.files.set(path, { data: data.slice(), lastModified: Date.now() });
    }
  }

  checkSpace(bytes: number): void {
    if (this.freeSpaceBytes === undefined) return;
    if (bytes > this.freeSpaceBytes) {
      const error = new Error('out of space');
      error.name = 'QuotaExceededError';
      throw error;
    }
    this.freeSpaceBytes -= bytes;
  }

  private assertSafe(path: string): void {
    // '' denotes the root of the receiving folder: valid for list/stat.
    if (path === '') return;
    if (!isSafeRelativePath(path)) {
      throw new DropForgeError(ERROR_CODES.PATH_UNSAFE, 'Unsafe path', { context: { path: path.slice(0, 16) } });
    }
  }

  async stat(path: string): Promise<FileStat | undefined> {
    this.assertSafe(path);
    const file = this.files.get(path);
    if (file) return { path, kind: 'file', size: file.data.length, lastModified: file.lastModified };
    if (this.directories.has(path)) return { path, kind: 'directory', size: 0 };
    return undefined;
  }

  async list(directory: string): Promise<FileStat[]> {
    this.assertSafe(directory);
    const prefix = directory === '' ? '' : `${directory}/`;
    const out: FileStat[] = [];
    for (const [path, file] of this.files) {
      if (!path.startsWith(prefix)) continue;
      if (path.slice(prefix.length).includes('/')) continue;
      out.push({ path, kind: 'file', size: file.data.length, lastModified: file.lastModified });
    }
    for (const dir of this.directories) {
      if (!dir.startsWith(prefix) || dir.slice(prefix.length).includes('/')) continue;
      out.push({ path: dir, kind: 'directory', size: 0 });
    }
    return out;
  }

  async create(path: string, options: { size: number; mode: CreateMode }): Promise<BlobSink> {
    this.assertSafe(path);
    if (this.denyWrites) {
      throw new DropForgeError(ERROR_CODES.PERMISSION_DENIED, 'Writing is not allowed here');
    }
    const existing = this.files.get(path);
    if (options.mode === 'resume') {
      if (!existing || existing.data.length !== options.size) {
        throw new DropForgeError(ERROR_CODES.RESUME_MISMATCH, 'The partial file cannot be resumed');
      }
      return new MemorySink(this, path, existing);
    }
    if (existing && options.mode === 'create-new') {
      throw new DropForgeError(ERROR_CODES.NAME_CONFLICT, 'A file with this name already exists');
    }
    this.checkSpace(options.size);
    const file: StoredFile = { data: new Uint8Array(options.size), lastModified: Date.now() };
    this.files.set(path, file);
    const sink = new MemorySink(this, path, file);
    const originalWrite = sink.write.bind(sink);
    sink.write = async (offset: number, data: Uint8Array): Promise<void> => {
      this.bytesWritten += data.length;
      await originalWrite(offset, data);
    };
    return sink;
  }

  async read(path: string, offset: number, length: number): Promise<Uint8Array | undefined> {
    this.assertSafe(path);
    const file = this.files.get(path);
    if (!file) return undefined;
    return file.data.slice(offset, offset + length);
  }

  async remove(path: string): Promise<void> {
    this.deleteUnsafe(path);
  }

  deleteUnsafe(path: string): void {
    this.files.delete(path);
  }

  async mkdir(path: string): Promise<void> {
    this.assertSafe(path);
    const parts = path.split('/');
    let current = '';
    for (const part of parts) {
      current = current === '' ? part : `${current}/${part}`;
      this.directories.add(current);
    }
  }

  async freeSpace(): Promise<number | undefined> {
    return this.freeSpaceBytes;
  }

  /** Test helper: compares a stored file with expected bytes. */
  content(path: string): Uint8Array | undefined {
    return this.files.get(path)?.data;
  }

  paths(): string[] {
    return [...this.files.keys()].sort();
  }

  setFile(path: string, data: Uint8Array): void {
    this.files.set(path, { data: data.slice(), lastModified: Date.now() });
  }
}

/** A SourceFile backed by a fixed byte buffer, with controllable corruption. */
export class MemorySource implements SourceFile {
  readonly kind = 'file';
  private tampered = false;

  constructor(
    readonly path: string,
    private data: Uint8Array,
    readonly lastModified = Date.now(),
    private readonly readDelayMs = 0,
  ) {}

  get size(): number {
    return this.data.length;
  }

  async read(offset: number, length: number): Promise<Uint8Array | undefined> {
    if (this.readDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.readDelayMs));
    if (offset > this.data.length) return undefined;
    const slice = this.data.slice(offset, offset + length);
    if (this.tampered && slice.length > 0) slice[0] = (slice[0]! + 1) % 256;
    return slice;
  }

  async revalidate(): Promise<'unchanged' | 'changed' | 'missing'> {
    if (this.revalidation) return this.revalidation;
    return 'unchanged';
  }

  private revalidation: 'unchanged' | 'changed' | 'missing' = 'unchanged';

  /** Test helper: makes the next reads return different bytes. */
  tamper(): void {
    this.tampered = true;
  }

  /** Test helper: simulates a file that was modified or deleted while sending. */
  markRevalidation(state: 'unchanged' | 'changed' | 'missing'): void {
    this.revalidation = state;
  }

  get original(): Uint8Array {
    return this.data;
  }

  setOriginal(data: Uint8Array): void {
    this.data = data;
  }
}

/** Directory entry source (no bytes). */
export class MemoryDirectory implements SourceFile {
  readonly kind = 'directory';
  readonly size = 0;
  readonly lastModified = Date.now();

  constructor(readonly path: string) {}

  async read(): Promise<Uint8Array | undefined> {
    return undefined;
  }

  async revalidate(): Promise<'unchanged'> {
    return 'unchanged';
  }
}
