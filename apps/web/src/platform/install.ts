/**
 * Installing the application (PWA), said honestly.
 *
 * Three situations, three different answers — never a generic "install" button:
 *
 *  - **Chromium**: the browser fires `beforeinstallprompt` when (and only when) the
 *    application is installable. The event is kept and the button calls `prompt()`;
 *    the user's actual choice is what is reported back.
 *  - **iOS / iPadOS**: no such event exists. The banner therefore explains the real
 *    path (Share → Add to Home Screen) instead of showing a button that would do
 *    nothing.
 *  - **Already installed**: no banner at all.
 */

/** The subset of `BeforeInstallPromptEvent` this code relies on. */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallPlatform = 'chromium' | 'ios' | 'other';

export interface InstallWatch {
  /** The browser considers the application installable right now. */
  available: () => boolean;
  /** The application is already running as an installed one. */
  installed: () => boolean;
  platform: () => InstallPlatform;
  /** Shows the browser's own install dialog; reports what the user chose. */
  prompt: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  /** Called when installability changes (the browser fires the event late). */
  subscribe: (listener: () => void) => () => void;
  dispose: () => void;
}

interface InstallScope {
  addEventListener?: (type: string, listener: (event: Event) => void) => void;
  removeEventListener?: (type: string, listener: (event: Event) => void) => void;
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { userAgent?: string; maxTouchPoints?: number; standalone?: boolean };
}

export function createInstallWatch(scope: InstallScope): InstallWatch {
  let pending: InstallPromptEvent | undefined;
  const listeners = new Set<() => void>();

  const onPromptAvailable = (event: Event): void => {
    const promptEvent = event as InstallPromptEvent;
    // Letting the default happen would show the browser's own mini-infobar; the
    // application asks the user itself, so the event is captured instead.
    event.preventDefault?.();
    pending = promptEvent;
    for (const listener of [...listeners]) listener();
  };

  scope.addEventListener?.('beforeinstallprompt', onPromptAvailable);

  const navigatorLike = scope.navigator;
  const userAgent = navigatorLike?.userAgent ?? '';
  const touchPoints = navigatorLike?.maxTouchPoints ?? 0;
  // iPadOS reports itself as a Mac: the touch points are what give it away.
  const isIos = /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);

  return {
    available: () => pending !== undefined,
    installed: () =>
      navigatorLike?.standalone === true || scope.matchMedia?.('(display-mode: standalone)').matches === true,
    platform: () => (pending !== undefined ? 'chromium' : isIos ? 'ios' : 'other'),
    prompt: async () => {
      const event = pending;
      if (!event) return 'unavailable';
      // A prompt can only be used once: whatever the outcome, it is consumed.
      pending = undefined;
      for (const listener of [...listeners]) listener();
      await event.prompt();
      const choice = await event.userChoice?.catch(() => undefined);
      return choice?.outcome ?? 'dismissed';
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      listeners.clear();
      scope.removeEventListener?.('beforeinstallprompt', onPromptAvailable);
    },
  };
}
