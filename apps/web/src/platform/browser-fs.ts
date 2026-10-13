/**
 * `FileSystemPort` for the browser.
 *
 * Two modes, chosen from what the browser really offers (see capabilities.ts):
 *
 *  - **File System Access API** (Chromium): the user picks a receiving folder once
 *    and received bytes are streamed straight into it. Files are opened with an
 *    explicit mode (`create-new`/`replace`/`resume`), so DropForge itself can
 *    never silently overwrite something.
 *
 *  - **Download fallback** (Firefox, iOS, …): received files are buffered and then
 *    handed to the browser as a download. Nothing is written to the disk by this
 *    code, and the UI says so; the integrity check happens *before* the download,
 *    so a corrupted file is never offered.
 */
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
import { isSafeRelativePath, safeRelativePath } from '@dropforge/protocol';

type PickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle[]>;
};

/* ------------------------------------------------------------------ *
 * Picking sources to send
 * ------------------------------------------------------------------ */

/**
 * Turns picked files (and, when the browser can, a picked folder) into `SourceFile`
 * objects the transfer engine can read. Directory entries are announced in the
 * manifest and carry no bytes, as the protocol requires.
 */
export async function sourcesFromFileList(fileList: FileList | readonly File[]): Promise<SourceFile[]> {
  const files = [...fileList].filter((entry): entry is File => entry instanceof File);
  return files.map((file) => fileSource(file, relativePathOf(file)));
}

/**
 * Files and folders dropped onto the window.
 *
 * Drag and drop is the one way to pick a folder that every browser supports at
 * least partially (`webkitGetAsEntry` exists in Chromium, Firefox and Safari),
 * so it is used when available and the flat file list is used otherwise —
 * silently saving less than what was dropped would be worse than saying so.
 */
export async function sourcesFromDataTransfer(transfer: {
  items?: ArrayLike<DataTransferItem> | null;
  files?: ArrayLike<File> | null;
}): Promise<{ sources: SourceFile[]; foldersRead: boolean }> {
  const items = transfer.items ? Array.from(transfer.items) : [];
  const entries: FileSystemEntry[] = [];
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) {
    // No entry API (or nothing usable): the flat list still carries every dropped
    // *file*, but not the directories.
    return { sources: await sourcesFromFileList(Array.from(transfer.files ?? [])), foldersRead: false };
  }
  const sources: SourceFile[] = [];
  let foldersRead = false;
  for (const entry of entries) {
    if (entry.isDirectory) foldersRead = true;
    await collectEntry(entry, '', sources);
  }
  return { sources, foldersRead };
}

async function collectEntry(entry: FileSystemEntry, prefix: string, out: SourceFile[], depth = 0): Promise<void> {
  const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
  if (entry.isDirectory) {
    if (depth > 32) return; // A pathological tree must not hang the drop handler.
    out.push({
      path: safeRelativePath(path),
      kind: 'directory',
      size: 0,
      lastModified: Date.now(),
      read: async () => new Uint8Array(0),
      revalidate: async () => 'unchanged',
    });
    const directory = entry as FileSystemDirectoryEntry;
    for (const child of await readEntries(directory)) await collectEntry(child, path, out, depth + 1);
    return;
  }
  if (!entry.isFile) return; // A dropped socket or symlink is not a readable file.
  const file = await new Promise<File | null>((resolve) => (entry as FileSystemFileEntry).file(resolve, () => resolve(null)));
  if (!file) return;
  out.push(fileSource(file, path));
}

/** `readEntries` returns at most 100 entries per call: it must be drained. */
function readEntries(directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = directory.createReader();
  const all: FileSystemEntry[] = [];
  const next = async (): Promise<FileSystemEntry[]> => {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
    if (batch.length === 0) return all;
    all.push(...batch);
    return await next();
  };
  return next();
}

export async function pickFiles(
  scope: Window & PickerWindow = globalThis as unknown as Window & PickerWindow,
): Promise<SourceFile[]> {
  if (typeof scope.showOpenFilePicker === 'function') {
    const handles = await scope.showOpenFilePicker({ multiple: true }).catch(() => []);
    const sources: SourceFile[] = [];
    for (const handle of handles) {
      const file = await handle.getFile();
      sources.push(fileSource(file, file.name));
    }
    return sources;
  }
  // Falls back to the <input type="file"> element, which the UI renders.
  return [];
}

export async function pickFolder(
  scope: Window & PickerWindow = globalThis as unknown as Window & PickerWindow,
): Promise<SourceFile[]> {
  if (typeof scope.showDirectoryPicker !== 'function') {
    throw new DropForgeError(
      ERROR_CODES.PLATFORM_UNSUPPORTED,
      'This browser cannot read a folder: select its files instead',
    );
  }
  const directory = await scope.showDirectoryPicker({ mode: 'read' }).catch(() => undefined);
  if (!directory) return [];
  const out: SourceFile[] = [];
  await walkDirectory(directory, '', out);
  return out;
}

/**
 * Asks the user for a folder to *receive into* (`readwrite`), not to read.
 * Returns `undefined` when the user cancels: cancelling is a normal answer, not
 * an error, and it must never be treated as "no space" or as a failure.
 */
export async function pickReceiveFolder(
  scope: Window & PickerWindow = globalThis as unknown as Window & PickerWindow,
): Promise<DirectoryFileSystem | undefined> {
  if (typeof scope.showDirectoryPicker !== 'function') {
    throw new DropForgeError(
      ERROR_CODES.PLATFORM_UNSUPPORTED,
      'This browser cannot write into a folder: received files will be offered as downloads',
    );
  }
  const directory = await scope.showDirectoryPicker({ mode: 'readwrite', id: 'dropforge-receive' }).catch(() => undefined);
  return directory ? new DirectoryFileSystem(directory) : undefined;
}

async function walkDirectory(
  directory: FileSystemDirectoryHandle,
  prefix: string,
  out: SourceFile[],
  depth = 0,
): Promise<void> {
  if (depth > 32) return; // A pathological tree must not hang the picker.
  out.push({
    path: safeRelativePath(prefix === '' ? directory.name : prefix),
    kind: 'directory',
    size: 0,
    lastModified: Date.now(),
    read: async () => new Uint8Array(0),
    revalidate: async () => 'unchanged',
  });
  for await (const [name, handle] of directory.entries()) {
    const path = prefix === '' ? `${directory.name}/${name}` : `${prefix}/${name}`;
    if (handle.kind === 'directory') {
      await walkDirectory(handle as FileSystemDirectoryHandle, path, out, depth + 1);
      continue;
    }
    const file = await (handle as FileSystemFileHandle).getFile();
    out.push(fileSource(file, path));
  }
}

/** A `File` as a `SourceFile`, with random-access reads for resume. */
export function fileSource(file: File, path: string): SourceFile {
  const safe = isSafeRelativePath(path) ? path : safeRelativePath(file.name);
  return {
    path: safe,
    kind: 'file',
    size: file.size,
    lastModified: file.lastModified,
    read: async (offset, length) => {
      const slice = file.slice(offset, offset + length);
      return new Uint8Array(await slice.arrayBuffer());
    },
    revalidate: async () => 'unchanged',
  };
}

function relativePathOf(file: File): string {
  // `webkitRelativePath` is set when a folder was picked through an <input>.
  const withPath = file as File & { webkitRelativePath?: string };
  return withRelativePath(withPath);
}

function withRelativePath(file: File & { webkitRelativePath?: string }): string {
  return file.webkitRelativePath && file.webkitRelativePath.length > 0 ? file.webkitRelativePath : file.name;
}

/* ------------------------------------------------------------------ *
 * Receiving
 * ------------------------------------------------------------------ */

/**
 * Receives through a folder handle the user granted.
 *
 * A dropped grant (permission revoked while a transfer runs) is reported as a
 * permission error, never as a silent failure.
 */
export class DirectoryFileSystem implements FileSystemPort {
  readonly kind = 'browser-fs';
  readonly features = {
    persistentHandles: true,
    freeSpace: false,
    directories: true,
    randomAccess: true,
    folderRead: true,
  } as const;

  constructor(readonly root: FileSystemDirectoryHandle) {}

  async stat(path: string): Promise<FileStat | undefined> {
    const safe = safeRelativePath(path);
    try {
      const parts = safe.split('/');
      let directory = this.root;
      for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
      const file = await directory.getFileHandle(parts.at(-1) as string);
      const handle = await file.getFile();
      return { path: safe, kind: 'file', size: handle.size, lastModified: handle.lastModified };
    } catch {
      return undefined;
    }
  }

  async list(directory: string): Promise<FileStat[]> {
    const safe = directory === '' ? '' : safeRelativePath(directory);
    const out: FileStat[] = [];
    try {
      let target = this.root;
      for (const part of safe.split('/').filter((value) => value.length > 0)) {
        target = await target.getDirectoryHandle(part);
      }
      for await (const [name, handle] of target.entries()) {
        if (handle.kind === 'directory') {
          out.push({ path: safe === '' ? name : `${safe}/${name}`, kind: 'directory', size: 0, lastModified: 0 });
          continue;
        }
        const file = await (handle as FileSystemFileHandle).getFile();
        out.push({
          path: safe === '' ? name : `${safe}/${name}`,
          kind: 'file',
          size: file.size,
          lastModified: file.lastModified,
        });
      }
    } catch {
      // A missing directory simply has nothing to list.
    }
    return out;
  }

  async create(path: string, options: { size: number; mode: CreateMode }): Promise<BlobSink> {
    const safe = safeRelativePath(path);
    const parts = safe.split('/');
    let directory = this.root;
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create: true });
    try {
      const handle = await directory.getFileHandle(parts.at(-1) as string, { create: options.mode !== 'resume' });
      const file = await handle.getFile();
      if (options.mode === 'create-new' && file.size > 0) {
        throw new DropForgeError(ERROR_CODES.NAME_CONFLICT, 'A file with this name already exists');
      }
      if (options.mode === 'resume' && file.size !== options.size) {
        throw new DropForgeError(ERROR_CODES.RESUME_MISMATCH, 'The partial file cannot be resumed');
      }
      const writable = await handle.createWritable({ keepExistingData: options.mode === 'resume' });
      return new WritableSink(safe, writable);
    } catch (error) {
      throw fromPlatformError(error);
    }
  }

  async read(path: string, offset: number, length: number): Promise<Uint8Array | undefined> {
    const safe = safeRelativePath(path);
    try {
      const parts = safe.split('/');
      let directory = this.root;
      for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
      const handle = await directory.getFileHandle(parts.at(-1) as string);
      const file = await handle.getFile();
      return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
    } catch {
      return undefined;
    }
  }

  async remove(path: string): Promise<void> {
    const safe = safeRelativePath(path);
    try {
      const parts = safe.split('/');
      let directory = this.root;
      for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
      await directory.removeEntry(parts.at(-1) as string);
    } catch (error) {
      throw fromPlatformError(error);
    }
  }

  async mkdir(path: string): Promise<void> {
    const safe = safeRelativePath(path);
    let directory = this.root;
    for (const part of safe.split('/').filter((value) => value.length > 0)) {
      directory = await directory.getDirectoryHandle(part, { create: true });
    }
  }

  async freeSpace(): Promise<number | undefined> {
    // The browser does not expose the disk's free space for a folder handle.
    return undefined;
  }
}

class WritableSink implements BlobSink {
  private closed = false;
  private writtenBytes = 0;

  constructor(
    readonly path: string,
    private readonly writable: FileSystemWritableFileStream,
  ) {}

  get written(): number {
    return this.writtenBytes;
  }

  async write(offset: number, data: Uint8Array): Promise<void> {
    if (this.closed) throw new DropForgeError(ERROR_CODES.WRITE_FAILED, 'The file is already closed');
    try {
      await this.writable.write({ type: 'write', position: offset, data: data as unknown as BufferSource });
      this.writtenBytes = Math.max(this.writtenBytes, offset + data.length);
    } catch (error) {
      throw fromPlatformError(error);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.writable.close();
  }

  async abort(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // The partial file is kept on purpose: it is what makes a resume possible.
    await this.writable.close();
  }
}

/**
 * The fallback: keep the file in memory, then hand it to the browser as a
 * download. Used only where the File System Access API is missing, and the UI
 * always says which mode is in use.
 */
export class DownloadFileSystem implements FileSystemPort {
  readonly kind = 'browser-download';
  readonly features = {
    persistentHandles: false,
    freeSpace: false,
    directories: false,
    randomAccess: false,
    folderRead: false,
  } as const;

  private readonly files = new Map<string, { data: Uint8Array; written: number }>();

  constructor(private readonly onReady: (name: string, data: Uint8Array) => void) {}

  async stat(path: string): Promise<FileStat | undefined> {
    const entry = this.files.get(path);
    return entry ? { path, kind: 'file', size: entry.data.length, lastModified: Date.now() } : undefined;
  }

  async list(): Promise<FileStat[]> {
    return [...this.files.entries()].map(([path, entry]) => ({
      path,
      kind: 'file' as const,
      size: entry.data.length,
      lastModified: Date.now(),
    }));
  }

  async create(path: string, options: { size: number; mode: CreateMode }): Promise<BlobSink> {
    if (options.mode === 'resume') {
      // Nothing survives a page reload in this mode: say it, do not pretend.
      throw new DropForgeError(
        ERROR_CODES.PLATFORM_UNSUPPORTED,
        'This browser cannot resume a received file: it will be sent again from the start',
      );
    }
    return new DownloadSink({
      files: this.files,
      path,
      size: options.size,
      closed: false,
      onReady: this.onReady,
    });
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async mkdir(): Promise<void> {
    // Flat names only: a directory entry cannot be created in a download.
  }

  async freeSpace(): Promise<number | undefined> {
    return undefined;
  }
}

class DownloadSink implements BlobSink {
  private readonly data: Uint8Array;
  private writtenBytes = 0;

  constructor(
    private readonly sink: {
      files: Map<string, { data: Uint8Array; written: number }>;
      path: string;
      size: number;
      closed: boolean;
      onReady: (name: string, data: Uint8Array) => void;
    },
  ) {
    this.data = new Uint8Array(sink.size);
  }

  get path(): string {
    return this.sink.path;
  }

  get written(): number {
    return this.writtenBytes;
  }

  async write(offset: number, data: Uint8Array): Promise<void> {
    if (offset + data.length > this.data.length) {
      throw new DropForgeError(ERROR_CODES.WRITE_FAILED, 'Received data does not fit the announced file size');
    }
    this.data.set(data, offset);
    this.writtenBytes += data.length;
    this.sink.files.set(this.sink.path, { data: this.data, written: this.writtenBytes });
  }

  async close(): Promise<void> {
    if (this.sink.closed) return;
    this.sink.closed = true;
    if (this.writtenBytes !== this.data.length) {
      throw new DropForgeError(ERROR_CODES.WRITE_FAILED, 'The file was not received completely');
    }
    // Only now, once every byte is there and verified by the engine, the browser
    // is asked to save the file.
    this.sink.onReady(this.sink.path.split('/').at(-1) as string, this.data);
  }

  async abort(): Promise<void> {
    // Nothing was handed to the browser yet, so dropping the buffer is enough.
    this.sink.files.delete(this.sink.path);
  }
}

/** Hands a verified file to the browser's download mechanism. */
export function triggerDownload(name: string, data: Uint8Array): void {
  const blob = new Blob([data as unknown as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // The blob is released once the browser has had a chance to read it.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
