/**
 * The receiving folder: what a browser can and cannot remember.
 *
 * The rule this file protects is that DropForge never writes into a folder without
 * a permission the browser currently grants, and never pretends a folder can be
 * remembered on a platform that cannot do it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReceiveFolderService, type HandleStore } from './receive-folder.js';
import { DirectoryFileSystem } from './browser-fs.js';

class FakeHandleStore implements HandleStore {
  private readonly data = new Map<string, unknown>();
  readonly puts: string[] = [];

  async putHandle(key: string, handle: unknown): Promise<void> {
    this.data.set(key, handle);
    this.puts.push(key);
  }

  async getHandle<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }

  async deleteHandle(key: string): Promise<void> {
    this.data.delete(key);
  }

  seed(key: string, value: unknown): void {
    this.data.set(key, value);
  }
}

interface FakeHandle {
  kind: 'directory';
  name: string;
  queryPermission?: () => Promise<PermissionState>;
  requestPermission?: () => Promise<PermissionState>;
}

function handle(name: string, permission: PermissionState, grantOnRequest?: PermissionState): FakeHandle {
  const state = { value: permission };
  return {
    kind: 'directory',
    name,
    queryPermission: async () => state.value,
    requestPermission: async () => {
      state.value = grantOnRequest ?? state.value;
      return state.value;
    },
  };
}

const realPicker = (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;

beforeEach(() => {
  // Most tests here are about the picker; each test sets what it needs.
  (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => {};
});

afterEach(() => {
  if (realPicker === undefined) delete (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  else (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = realPicker;
});

describe('ReceiveFolderService', () => {
  it('reports nothing to do when no folder was ever chosen', async () => {
    const service = new ReceiveFolderService(new FakeHandleStore());
    const state = await service.load();
    expect(state).toEqual({ ready: false, needsPermission: false, unsupported: false });
    expect(await service.port()).toBeUndefined();
  });

  it('is ready when a remembered folder is still allowed', async () => {
    const store = new FakeHandleStore();
    store.seed('receive-folder', handle('Reçus', 'granted'));
    const service = new ReceiveFolderService(store);
    const state = await service.load();
    expect(state.ready).toBe(true);
    expect(state.name).toBe('Reçus');
    expect(await service.port()).toBeInstanceOf(DirectoryFileSystem);
  });

  it('asks for a permission the browser dropped, and never writes before it is given', async () => {
    const store = new FakeHandleStore();
    store.seed('receive-folder', handle('Reçus', 'prompt', 'granted'));
    const service = new ReceiveFolderService(store);

    const before = await service.load();
    expect(before.ready).toBe(false);
    expect(before.needsPermission).toBe(true);
    // No port means no transfer can silently start writing somewhere else.
    expect(await service.port()).toBeUndefined();

    const after = await service.requestAccess();
    expect(after.ready).toBe(true);
    expect(await service.port()).toBeInstanceOf(DirectoryFileSystem);
  });

  it('keeps the previous folder when the user cancels the picker', async () => {
    const store = new FakeHandleStore();
    store.seed('receive-folder', handle('Ancien', 'granted'));
    // The platform rejects the promise when the user closes the picker.
    (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = async () => {
      throw new DOMException('cancelled', 'AbortError');
    };
    const service = new ReceiveFolderService(store);
    await service.load();

    const state = await service.choose();
    expect(state.name).toBe('Ancien');
    expect(state.ready).toBe(true);
  });

  it('remembers a newly chosen folder', async () => {
    const store = new FakeHandleStore();
    const chosen = handle('Téléchargements', 'granted');
    (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = async () => chosen;
    const service = new ReceiveFolderService(store);

    const state = await service.choose();
    expect(state).toEqual({ ready: true, name: 'Téléchargements', needsPermission: false, unsupported: false });
    expect(store.puts).toEqual(['receive-folder']);
    expect(await service.port()).toBeInstanceOf(DirectoryFileSystem);
  });

  it('forgets the folder on request', async () => {
    const store = new FakeHandleStore();
    store.seed('receive-folder', handle('Reçus', 'granted'));
    const service = new ReceiveFolderService(store);
    await service.load();

    const state = await service.forget();
    expect(state.ready).toBe(false);
    expect(await service.port()).toBeUndefined();
    expect(await store.getHandle('receive-folder')).toBeUndefined();
  });

  it('says that a browser without a folder picker cannot remember one', async () => {
    delete (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    const service = new ReceiveFolderService(new FakeHandleStore());
    expect(await service.load()).toEqual({ ready: false, needsPermission: false, unsupported: true });
    expect((await service.choose()).unsupported).toBe(true);
  });

  it('offers the download path when no folder is available', async () => {
    const service = new ReceiveFolderService(new FakeHandleStore());
    await service.load();
    const downloads: string[] = [];
    const port = service.fallbackPort((name) => downloads.push(name));
    expect(port.kind).toBe('browser-download');
    expect(port.features.directories).toBe(false);
  });
});
