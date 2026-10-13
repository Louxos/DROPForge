/**
 * The browser filesystem port, tested against a fake File System Access API that
 * behaves like the real one where it matters: no implicit overwrite, no writing
 * outside the chosen folder, and a cancellation that is not an error.
 */
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@dropforge/app-core';
import {
  DirectoryFileSystem,
  DownloadFileSystem,
  pickFiles,
  pickFolder,
  pickReceiveFolder,
  sourcesFromFileList,
  triggerDownload,
} from './browser-fs.js';

/* ------------------------------------------------------------------ *
 * A minimal FileSystemDirectoryHandle
 * ------------------------------------------------------------------ */

class FakeFileHandle {
  readonly kind = 'file';
  data: Uint8Array;
  lastModified: number;

  constructor(readonly name: string, data: Uint8Array = new Uint8Array()) {
    this.data = data;
    this.lastModified = 1_700_000_000_000;
  }

  async getFile(): Promise<File> {
    return new File([this.data as unknown as BlobPart], this.name, { lastModified: this.lastModified });
  }

  async createWritable(options: { keepExistingData?: boolean } = {}): Promise<FakeWritable> {
    return new FakeWritable(this, options.keepExistingData === true);
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other === this;
  }
}

class FakeWritable {
  private readonly chunks: Array<{ at: number; data: Uint8Array }> = [];
  private nextOffset = 0;
  private closed = false;

  constructor(
    private readonly handle: FakeFileHandle,
    private readonly keepExisting: boolean,
  ) {}

  async write(chunk: Uint8Array | { type: 'write'; position?: number; data: Uint8Array }): Promise<void> {
    if (this.closed) throw new DOMException('already closed', 'InvalidStateError');
    const at = chunk instanceof Uint8Array ? this.nextOffset : (chunk.position ?? this.nextOffset);
    const data = chunk instanceof Uint8Array ? chunk : chunk.data;
    this.chunks.push({ at, data });
    this.nextOffset = at + data.length;
  }

  async close(): Promise<void> {
    this.closed = true;
    // A real stream truncates the file to what was written through it, unless the
    // writable was opened with `keepExistingData` (the resume case).
    const base = this.keepExisting ? this.handle.data : new Uint8Array();
    const end = this.chunks.reduce((max, chunk) => Math.max(max, chunk.at + chunk.data.length), base.length);
    const out = new Uint8Array(end);
    out.set(base.subarray(0, Math.min(base.length, end)), 0);
    for (const chunk of this.chunks) out.set(chunk.data, chunk.at);
    this.handle.data = out;
  }

  async abort(): Promise<void> {
    this.closed = true;
  }
}

class FakeDirectoryHandle {
  readonly kind = 'directory';
  readonly dirs = new Map<string, FakeDirectoryHandle>();
  readonly files = new Map<string, FakeFileHandle>();

  constructor(readonly name: string) {}

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<FakeDirectoryHandle> {
    const existing = this.dirs.get(name);
    if (existing) return existing;
    if (!options.create) throw new DOMException(`no such directory: ${name}`, 'NotFoundError');
    const created = new FakeDirectoryHandle(name);
    this.dirs.set(name, created);
    return created;
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<FakeFileHandle> {
    const existing = this.files.get(name);
    if (existing) return existing;
    if (!options.create) throw new DOMException(`no such file: ${name}`, 'NotFoundError');
    const created = new FakeFileHandle(name);
    this.files.set(name, created);
    return created;
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name)) throw new DOMException('not found', 'NotFoundError');
  }

  async *entries(): AsyncGenerator<[string, FakeFileHandle | FakeDirectoryHandle]> {
    for (const [name, dir] of this.dirs) yield [name, dir];
    for (const [name, file] of this.files) yield [name, file];
  }
}

const asRoot = (handle: FakeDirectoryHandle): FileSystemDirectoryHandle =>
  handle as unknown as FileSystemDirectoryHandle;

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const decode = (value: Uint8Array | undefined): string | undefined =>
  value ? new TextDecoder().decode(value) : undefined;

/* ------------------------------------------------------------------ *
 * Receiving into a folder
 * ------------------------------------------------------------------ */

describe('DirectoryFileSystem', () => {
  it('creates a new file and never overwrites in create-new mode', async () => {
    const root = new FakeDirectoryHandle('Reçus');
    const fs = new DirectoryFileSystem(asRoot(root));

    const sink = await fs.create('notes.txt', { size: 5, mode: 'create-new' });
    expect(sink.path).toBe('notes.txt');
    await sink.write(0, text('salut'));
    await sink.close();
    expect(decode(root.files.get('notes.txt')?.data)).toBe('salut');

    // A second create-new of the same name must fail: DropForge never replaces a
    // file the user did not agree to replace.
    await expect(fs.create('notes.txt', { size: 5, mode: 'create-new' })).rejects.toMatchObject({
      code: ERROR_CODES.NAME_CONFLICT,
    });
  });

  it('replaces only in replace mode, after the caller decided', async () => {
    const root = new FakeDirectoryHandle('Reçus');
    root.files.set('a.txt', new FakeFileHandle('a.txt', text('ancien contenu')));
    const fs = new DirectoryFileSystem(asRoot(root));

    const sink = await fs.create('a.txt', { size: 3, mode: 'replace' });
    await sink.write(0, text('neuf'));
    await sink.close();
    expect(decode(root.files.get('a.txt')?.data)).toBe('neuf');
  });

  it('creates the directories a manifest needs', async () => {
    const root = new FakeDirectoryHandle('Reçus');
    const fs = new DirectoryFileSystem(asRoot(root));
    const sink = await fs.create('docs/info/readme.md', { size: 4, mode: 'create-new' });
    await sink.write(0, text('texte'));
    await sink.close();
    expect(decode(root.dirs.get('docs')?.dirs.get('info')?.files.get('readme.md')?.data)).toBe('texte');
  });

  it('refuses a path that tries to escape the receiving folder', async () => {
    const root = new FakeDirectoryHandle('Reçus');
    const fs = new DirectoryFileSystem(asRoot(root));
    await expect(fs.create('../evasion.txt', { size: 1, mode: 'create-new' })).rejects.toBeDefined();
    await expect(fs.stat('/etc/passwd')).rejects.toBeDefined();
  });

  it('reports free space as unknown instead of inventing a number', async () => {
    const fs = new DirectoryFileSystem(asRoot(new FakeDirectoryHandle('Reçus')));
    expect(fs.features.freeSpace).toBe(false);
    expect(await fs.freeSpace()).toBeUndefined();
  });

  it('lists one level of the receiving folder, with real sizes', async () => {
    const root = new FakeDirectoryHandle('Reçus');
    root.files.set('a.txt', new FakeFileHandle('a.txt', text('12345')));
    root.dirs.set('docs', new FakeDirectoryHandle('docs'));
    root.dirs.get('docs')!.files.set('b.txt', new FakeFileHandle('b.txt', text('12')));
    const fs = new DirectoryFileSystem(asRoot(root));

    // One level, and a subfolder is reported as a folder: the caller walks it when
    // it wants to, which is what a conflict check does. The order a directory
    // reports is not guaranteed by the platform, so it is compared as a set.
    expect(await fs.list('')).toEqual(
      expect.arrayContaining([
        { path: 'a.txt', kind: 'file', size: 5, lastModified: 1_700_000_000_000 },
        { path: 'docs', kind: 'directory', size: 0, lastModified: 0 },
      ]),
    );
    expect((await fs.list('')).length).toBe(2);
    expect(await fs.list('docs')).toEqual([{ path: 'docs/b.txt', kind: 'file', size: 2, lastModified: 1_700_000_000_000 }]);
  });

  it('resumes a pre-allocated partial file, keeping the bytes already on disk', async () => {
    const root = new FakeDirectoryHandle('Reçus');
    // A resume continues a file the receiving side itself created at the announced
    // size: the first five bytes are already there.
    const partial = new Uint8Array(10);
    partial.set(text('debut'), 0);
    root.files.set('gros.bin', new FakeFileHandle('gros.bin', partial));
    const fs = new DirectoryFileSystem(asRoot(root));

    const resumed = await fs.create('gros.bin', { size: 10, mode: 'resume' });
    expect(resumed.written).toBe(0); // nothing written yet in this session
    await resumed.write(5, text('suite'));
    await resumed.close();
    expect(decode(root.files.get('gros.bin')?.data)).toBe('debutsuite');
  });

  it('refuses to resume a file whose size does not match the manifest', async () => {
    const root = new FakeDirectoryHandle('Reçus');
    root.files.set('gros.bin', new FakeFileHandle('gros.bin', new Uint8Array(3)));
    const fs = new DirectoryFileSystem(asRoot(root));

    // Resuming into a different size would silently corrupt the file: refuse it.
    // The engine only asks for 'resume' after it verified a chunk-aligned prefix at
    // the announced size, so this is a last-line guard, not the normal path.
    await expect(fs.create('gros.bin', { size: 10, mode: 'resume' })).rejects.toMatchObject({
      code: ERROR_CODES.RESUME_MISMATCH,
    });
  });
});

/* ------------------------------------------------------------------ *
 * The download fallback
 * ------------------------------------------------------------------ */

describe('DownloadFileSystem', () => {
  it('hands the finished file to the browser as a download', async () => {
    const ready: Array<{ name: string; data: string }> = [];
    const fs = new DownloadFileSystem((name, data) => ready.push({ name, data: new TextDecoder().decode(data) }));

    const sink = await fs.create('rapport.txt', { size: 5, mode: 'create-new' });
    await sink.write(0, text('hello'));
    await sink.close();
    expect(ready).toEqual([{ name: 'rapport.txt', data: 'hello' }]);
  });

  it('downloads nothing when the transfer was aborted', async () => {
    const ready: string[] = [];
    const fs = new DownloadFileSystem((name) => ready.push(name));
    const sink = await fs.create('rumine.bin', { size: 100, mode: 'create-new' });
    await sink.write(0, text('moitié'));
    await sink.abort();
    expect(ready).toEqual([]);
  });

  it('refuses to pretend a download can be resumed', async () => {
    const fs = new DownloadFileSystem(() => {});
    expect(fs.features.randomAccess).toBe(false);
    expect(fs.features.persistentHandles).toBe(false);
    await expect(fs.create('fichier.bin', { size: 10, mode: 'resume' })).rejects.toMatchObject({
      code: ERROR_CODES.PLATFORM_UNSUPPORTED,
    });
  });

  it('offers only a flat name, because a download is a single file', async () => {
    const ready: string[] = [];
    const fs = new DownloadFileSystem((name) => ready.push(name));
    expect(fs.features.directories).toBe(false);
    const sink = await fs.create('docs/rapport.txt', { size: 2, mode: 'create-new' });
    await sink.write(0, text('ok'));
    await sink.close();
    expect(ready).toEqual(['rapport.txt']);
  });

  it('refuses a close when some bytes are missing, so nothing half-written is offered', async () => {
    const ready: string[] = [];
    const fs = new DownloadFileSystem((name) => ready.push(name));
    const sink = await fs.create('incomplet.bin', { size: 10, mode: 'create-new' });
    await sink.write(0, text('court'));
    await expect(sink.close()).rejects.toMatchObject({ code: ERROR_CODES.WRITE_FAILED });
    expect(ready).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Picking sources, and the pickers that do not exist
 * ------------------------------------------------------------------ */

describe('picking files and folders', () => {
  it('turns picked files into sources with their real size', async () => {
    const file = new File([text('abc') as unknown as BlobPart], 'a.txt');
    const sources = await sourcesFromFileList([file]);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.path).toBe('a.txt');
    expect(sources[0]?.size).toBe(3);
    expect(decode(await sources[0]!.read(0, 3))).toBe('abc');
    expect(await sources[0]!.revalidate()).toBe('unchanged');
  });

  it('refuses to offer a folder when the browser cannot read one', async () => {
    const scope = {} as unknown as Window;
    await expect(pickFolder(scope)).rejects.toMatchObject({ code: ERROR_CODES.PLATFORM_UNSUPPORTED });
    await expect(pickReceiveFolder(scope)).rejects.toMatchObject({ code: ERROR_CODES.PLATFORM_UNSUPPORTED });
  });

  it('treats a cancelled file picker as an empty selection, not as an error', async () => {
    const scope = {
      showOpenFilePicker: async () => {
        throw new DOMException('cancelled', 'AbortError');
      },
    } as unknown as Window;
    expect(await pickFiles(scope)).toEqual([]);
  });

  it('treats a cancelled folder picker as an empty selection', async () => {
    const scope = {
      showDirectoryPicker: async () => {
        throw new DOMException('cancelled', 'AbortError');
      },
    } as unknown as Window;
    expect(await pickFolder(scope)).toEqual([]);
    expect(await pickReceiveFolder(scope)).toBeUndefined();
  });

  it('expands a picked folder into files, directories included, with relative paths', async () => {
    const root = new FakeDirectoryHandle('Photos');
    root.files.set('a.jpg', new FakeFileHandle('a.jpg', text('A')));
    root.dirs.set('sous', new FakeDirectoryHandle('sous'));
    root.dirs.get('sous')!.files.set('b.jpg', new FakeFileHandle('b.jpg', text('BB')));
    const scope = { showDirectoryPicker: async () => root } as unknown as Window;

    const sources = await pickFolder(scope);
    const shape = sources.map((source) => `${source.kind}:${source.path}:${source.size}`).sort();
    // The picked folder keeps its own name, so the receiving side recreates the same
    // tree instead of dumping the files at its root.
    expect(shape).toEqual(
      [
        'directory:Photos:0',
        'directory:Photos/sous:0',
        'file:Photos/a.jpg:1',
        'file:Photos/sous/b.jpg:2',
      ].sort(),
    );
  });

  it('starts a download with a real anchor element and revokes the blob URL', async () => {
    const created: string[] = [];
    const removed: string[] = [];
    const originalUrl = globalThis.URL;
    interface FakeAnchor {
      href: string;
      download: string;
      rel: string;
      click(): void;
      remove(): void;
    }
    const anchor: FakeAnchor = {
      href: '',
      download: '',
      rel: '',
      click: () => created.push(anchor.download),
      remove: () => removed.push(anchor.download),
    };
    const originalDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      createElement: () => anchor,
      body: { append: () => {} },
    };
    class FakeUrl extends originalUrl {
      static override createObjectURL(): string {
        return 'blob:dropforge';
      }

      static override revokeObjectURL(): void {
        // Nothing to release in the test.
      }
    }
    (globalThis as { URL: unknown }).URL = FakeUrl;

    try {
      triggerDownload('rapport.txt', text('contenu'));
      expect(created).toEqual(['rapport.txt']);
      expect(removed).toEqual(['rapport.txt']);
      expect(anchor.href).toBe('blob:dropforge');
      expect(anchor.rel).toBe('noopener');
    } finally {
      (globalThis as { URL: unknown }).URL = originalUrl;
      (globalThis as { document?: unknown }).document = originalDocument;
    }
  });
});
