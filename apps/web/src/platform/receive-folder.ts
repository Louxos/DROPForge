/**
 * Where received files go, in a browser.
 *
 * Two platforms, two truths:
 *
 *  - **Chromium (File System Access API)**: the user picks a folder, its handle is
 *    remembered in the local database, and received bytes are streamed straight
 *    into it. The permission is asked again by the browser on a new session and
 *    only from a user gesture — so `resolve()` reports "needs the user to pick
 *    again" instead of silently failing mid-transfer.
 *  - **Everything else**: no folder can be remembered. The download path is used
 *    and the UI says so; claiming otherwise would be a lie about writing files.
 */
import type { FileSystemPort } from '@dropforge/app-core';
import { DirectoryFileSystem, DownloadFileSystem, pickReceiveFolder } from './browser-fs.js';
/**
 * The part of the local database this module needs. Typed structurally so the
 * service can be tested without a browser database.
 */
export interface HandleStore {
  putHandle(key: string, handle: unknown): Promise<void>;
  getHandle<T>(key: string): Promise<T | undefined>;
  deleteHandle(key: string): Promise<void>;
}

const KEY = 'receive-folder';

type PermissionCapableHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
};

export interface ReceiveFolderState {
  /** True when a folder is remembered *and* the browser currently allows writing. */
  ready: boolean;
  /** The folder's own name, as the browser reports it. Never a path we invented. */
  name?: string;
  /** The browser knows the folder but waits for the user to allow it again. */
  needsPermission: boolean;
  /** The platform cannot remember a folder at all (Firefox, iOS, …). */
  unsupported: boolean;
}

export class ReceiveFolderService {
  private handle: PermissionCapableHandle | undefined;
  private state: ReceiveFolderState = { ready: false, needsPermission: false, unsupported: false };

  constructor(private readonly store: HandleStore) {}

  /** Loads the remembered folder. Never throws: a missing folder is a normal case. */
  async load(): Promise<ReceiveFolderState> {
    if (typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker !== 'function') {
      this.state = { ready: false, needsPermission: false, unsupported: true };
      return this.state;
    }
    try {
      const handle = await this.store.getHandle<PermissionCapableHandle>(KEY);
      if (!handle) {
        this.state = { ready: false, needsPermission: false, unsupported: false };
        return this.state;
      }
      this.handle = handle;
      const permitted = await this.currentPermission(handle);
      this.state = {
        ready: permitted === 'granted',
        name: handle.name,
        needsPermission: permitted !== 'granted',
        unsupported: false,
      };
    } catch {
      this.state = { ready: false, needsPermission: false, unsupported: false };
    }
    return this.state;
  }

  describe(): ReceiveFolderState {
    return this.state;
  }

  /** True when a transfer can be received right now without asking anything. */
  async port(): Promise<FileSystemPort | undefined> {
    const handle = this.handle;
    if (!handle) return undefined;
    const permitted = await this.currentPermission(handle);
    if (permitted !== 'granted') return undefined;
    return new DirectoryFileSystem(handle);
  }

  /** Asks the browser to (re)grant access. Must be called from a user gesture. */
  async requestAccess(): Promise<ReceiveFolderState> {
    const handle = this.handle;
    if (!handle) return this.load();
    try {
      const result = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'prompt';
      this.state = { ready: result === 'granted', name: handle.name, needsPermission: result !== 'granted', unsupported: false };
    } catch {
      this.state = { ready: false, needsPermission: true, ...(handle.name ? { name: handle.name } : {}), unsupported: false };
    }
    return this.state;
  }

  /** Picks a new folder (user gesture) and remembers it. */
  async choose(): Promise<ReceiveFolderState> {
    if (typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker !== 'function') {
      // No folder can be remembered here; received files are offered as downloads.
      this.state = { ready: true, needsPermission: false, unsupported: true };
      return this.state;
    }
    const port = await pickReceiveFolder();
    if (!port) {
      // The user closed the picker: keep whatever was remembered before.
      return this.state;
    }
    const handle = port.root as PermissionCapableHandle;
    this.handle = handle;
    const result = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
    await this.store.putHandle(KEY, handle);
    this.state = { ready: result === 'granted', name: handle.name, needsPermission: result !== 'granted', unsupported: false };
    return this.state;
  }

  async forget(): Promise<ReceiveFolderState> {
    this.handle = undefined;
    try {
      await this.store.deleteHandle(KEY);
    } catch {
      /* the record may not exist: forgetting twice is not an error */
    }
    this.state = await this.load();
    return this.state;
  }

  /**
   * The port to use when no folder is available: received files are buffered and
   * handed to the browser as downloads. `triggerDownload` lives in browser-fs so
   * the sink and the download stay in one place.
   */
  fallbackPort(trigger: (name: string, data: Uint8Array) => void): FileSystemPort {
    return new DownloadFileSystem(trigger);
  }

  private async currentPermission(handle: PermissionCapableHandle): Promise<PermissionState> {
    try {
      return (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'prompt';
    } catch {
      return 'prompt';
    }
  }
}
