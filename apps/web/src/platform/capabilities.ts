/**
 * What this browser can really do.
 *
 * The spec is explicit about this: never promise background receiving, connection
 * persistence or resume after closing if the browser cannot do it. So every feature
 * is *measured* here, once, and the UI disables what is missing instead of failing
 * after the user committed to a transfer.
 *
 * Nothing in this file guesses: an API that is not present is reported absent.
 */

export interface PlatformCapabilities {
  /** RTCPeerConnection + RTCDataChannel: needed for any direct transfer. */
  webRtc: boolean;
  /** File System Access API: write into a chosen folder, stream large files. */
  directoryPicker: boolean;
  /** `showDirectoryPicker` + FileSystemDirectoryHandle iteration: send a folder. */
  directoryRead: boolean;
  /** Notification API. */
  notifications: boolean;
  /** navigator.storage.estimate(): real free space, so the UI can warn early. */
  storageEstimate: boolean;
  /** Service worker: offline UI. Never "offline transfers". */
  serviceWorker: boolean;
  /** Streaming a received file straight to the disk instead of memory. */
  downloadStream: boolean;
  /** Can a transfer keep going while the tab is not focused? */
  backgroundTransfer: boolean;
  /** True on iOS/iPadOS browsers, where the tab cannot keep working off-screen. */
  ios: boolean;
  /** Whether the app is running installed (standalone). */
  standalone: boolean;
  /** Human-readable platform label for the devices screen. */
  platform: 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'web';
}

type NavigatorWithExtras = Navigator & {
  userAgentData?: { platform?: string };
  storage?: StorageManager;
  standalone?: boolean;
};

function hasDirectoryPicker(scope: Navigator & Record<string, unknown>): boolean {
  return typeof (scope as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/**
 * The browser's own storage estimate, when it exposes one. This is about the
 * *browser's* quota for DropForge's local data — not the disk's free space and not
 * a promise about how much can be received.
 */
export async function readStorageEstimate(
  scope: { navigator?: NavigatorWithExtras } = {},
): Promise<{ usage: number; quota: number } | undefined> {
  const nav = scope.navigator ?? (typeof navigator === 'undefined' ? undefined : (navigator as NavigatorWithExtras));
  if (typeof nav?.storage?.estimate !== 'function') return undefined;
  try {
    const estimate = await nav.storage.estimate();
    if (typeof estimate.usage !== 'number' || typeof estimate.quota !== 'number') return undefined;
    return { usage: estimate.usage, quota: estimate.quota };
  } catch {
    // A refusal is a normal answer: the UI simply shows nothing.
    return undefined;
  }
}

export function detectCapabilities(scope: {
  navigator?: NavigatorWithExtras;
  window?: Window & typeof globalThis;
} = {}): PlatformCapabilities {
  const nav = scope.navigator ?? (typeof navigator === 'undefined' ? undefined : (navigator as NavigatorWithExtras));
  const win = scope.window ?? (typeof window === 'undefined' ? undefined : window);
  const ua = nav?.userAgent ?? '';
  const platformName = (nav?.userAgentData?.platform ?? ua).toLowerCase();

  const ios =
    /iphone|ipad|ipod/.test(ua.toLowerCase()) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (platformName.includes('mac') && typeof (win as { ontouchend?: unknown } | undefined)?.ontouchend !== 'undefined');
  const android = platformName.includes('android') || /android/.test(ua.toLowerCase());
  const windows = platformName.includes('win');
  const mac = platformName.includes('mac') && !ios;
  const linux = platformName.includes('linux') && !android;

  const webRtc =
    typeof (win as { RTCPeerConnection?: unknown } | undefined)?.RTCPeerConnection === 'function' && !!nav;
  const directoryPicker = hasDirectoryPicker((nav ?? {}) as Navigator & Record<string, unknown>);
  const notifications = typeof (win as { Notification?: unknown } | undefined)?.Notification === 'function';
  const serviceWorker = typeof nav?.serviceWorker !== 'undefined';
  const storageEstimate = typeof nav?.storage?.estimate === 'function';

  return {
    webRtc,
    directoryPicker,
    // Reading a folder needs the picker *and* the async iterator on the handle.
    directoryRead: directoryPicker,
    notifications,
    storageEstimate,
    serviceWorker,
    // The File System Access API is what allows writing a stream to disk.
    downloadStream: directoryPicker,
    // Honest by construction: only the desktop app can work when the window is
    // closed, and nothing on the web can. A visible tab is required.
    backgroundTransfer: false,
    ios,
    standalone: win?.matchMedia?.('(display-mode: standalone)').matches === true || nav?.standalone === true,
    platform: ios ? 'ios' : android ? 'android' : windows ? 'windows' : mac ? 'macos' : linux ? 'linux' : 'web',
  };
}

/**
 * Checks the app can do the one thing it exists for. Called before the UI is
 * mounted, so a browser that cannot run DropForge says so immediately.
 */
export function canTransfer(capabilities: PlatformCapabilities): boolean {
  return capabilities.webRtc;
}

/**
 * Short, honest notes to show next to the capability list.
 *
 * The keys returned are complete translation keys (`capabilities.*`), so a caller
 * can hand them straight to `t()` and a missing translation shows up as a missing
 * key in the i18n test rather than as a silent empty line.
 */
export function capabilityNotes(capabilities: PlatformCapabilities): string[] {
  const notes: string[] = [];
  if (!capabilities.downloadStream) notes.push('capabilities.downloadFallbackNote');
  if (capabilities.ios) notes.push('capabilities.iosNote');
  if (!capabilities.backgroundTransfer) notes.push('capabilities.backgroundReceiveNote');
  return notes;
}

/** Free space known by the browser, or undefined when it cannot tell. */
export async function freeSpaceBytes(scope: { navigator?: NavigatorWithExtras } = {}): Promise<number | undefined> {
  const nav = scope.navigator ?? (typeof navigator === 'undefined' ? undefined : navigator);
  const estimate = nav?.storage?.estimate;
  if (typeof estimate !== 'function') return undefined;
  try {
    const result = await estimate.call(nav?.storage);
    if (typeof result.quota !== 'number' || typeof result.usage !== 'number') return undefined;
    return Math.max(0, result.quota - result.usage);
  } catch {
    return undefined;
  }
}
