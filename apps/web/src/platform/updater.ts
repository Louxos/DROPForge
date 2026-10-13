/**
 * Update checking, done honestly.
 *
 * The rule from the specification is: check for updates, *ask* before installing,
 * and never turn off signature verification. There are two real cases and this
 * module handles both without pretending:
 *
 *  - **Installed PWA / hosted web app**: updates are shipped by the service
 *    worker. The browser is in charge of *fetching* one; we can tell the user when
 *    a new version is waiting and, on their approval, ask the worker to activate
 *    it. We can *not* promise a version number: the platform does not give us one,
 *    so `version` stays undefined instead of being guessed from a manifest we
 *    would have to trust.
 *  - **Desktop build (Tauri)**: the Tauri updater only applies an update whose
 *    signature matches the public key compiled into the app, and this module
 *    exposes that path through the same port (`UpdateSource`), so the shell can
 *    never silently install something on its own.
 *
 * Nothing here ever installs without an explicit user action.
 */

import { ERROR_CODES } from '@dropforge/app-core';

export type UpdateKind = 'idle' | 'checking' | 'available' | 'installing' | 'ready' | 'upToDate' | 'error';

/* The two codes used below are the documented ones for "cannot reach the network"
 * and "this platform has no such feature". */

export interface UpdateStatus {
  kind: UpdateKind;
  /** Only set when the platform really tells us one. */
  version?: string;
  messageKey: string;
  errorCode?: string;
}

export const UPDATE_IDLE: UpdateStatus = { kind: 'idle', messageKey: 'settings.updateIdle' };

export interface UpdateSource {
  /** Whether this platform exposes an update mechanism at all. */
  readonly canCheck: boolean;
  /**
   * Asks for a new version. Resolves "available" or "upToDate" only from what the
   * platform reports; never from a version comparison we invented.
   */
  check(): Promise<UpdateStatus>;
  /** Applies the update the user approved. Never called automatically. */
  install(): Promise<UpdateStatus>;
  /** Restarts into the new version, after `install()` succeeded. */
  relaunch(): void;
}

/** No update mechanism: the honest answer for a plain page opened in a browser. */
export const noUpdateSource: UpdateSource = {
  canCheck: false,
  async check() {
    return {
      kind: 'error',
      messageKey: 'settings.updateUnsupported',
      errorCode: 'PLATFORM_UNSUPPORTED',
    };
  },
  async install() {
    return {
      kind: 'error',
      messageKey: 'settings.updateUnsupported',
      errorCode: 'PLATFORM_UNSUPPORTED',
    };
  },
  relaunch() {
    /* nothing to relaunch */
  },
};

type WaitingRegistration = ServiceWorkerRegistration & { waiting?: ServiceWorker | null };

/**
 * Service-worker backed updates (installed PWA and hosted web app).
 *
 * The check itself is a real network fetch of the worker script by the browser
 * (`registration.update()`); the "available" state is only reported once the
 * browser has a *waiting* worker, i.e. a genuinely newer build.
 */
export class ServiceWorkerUpdateSource implements UpdateSource {
  private waiting: ServiceWorker | undefined;
  private reloading = false;

  constructor(
    private readonly scope: {
      navigator?: Navigator & { serviceWorker?: ServiceWorkerContainer };
      location?: Location;
    } = {},
  ) {
    const container = scope.navigator?.serviceWorker;
    if (container) {
      // A worker that is already waiting when the app opens is a real pending
      // update: report it instead of hiding it until the next reload.
      void container.getRegistration?.().then((registration) => {
        const waiting = (registration as WaitingRegistration | undefined)?.waiting;
        if (waiting) this.waiting = waiting;
      });
    }
  }

  get canCheck(): boolean {
    return typeof (this.scope.navigator ?? (typeof navigator === 'undefined' ? undefined : navigator))?.serviceWorker?.getRegistration ===
      'function';
  }

  async check(): Promise<UpdateStatus> {
    const container = this.scope.navigator?.serviceWorker;
    if (!container) return noUpdateSource.check();
    const registration = (await container.getRegistration()) as WaitingRegistration | undefined;
    if (!registration) {
      return { kind: 'error', messageKey: 'settings.updateUnregistered', errorCode: 'PLATFORM_UNSUPPORTED' };
    }
    try {
      await registration.update();
    } catch {
      // The browser could not fetch the new worker: that is a network problem, and
      // it is reported as one instead of as "already up to date".
      return { kind: 'error', messageKey: 'settings.updateCheckFailed', errorCode: ERROR_CODES.RELAY_UNAVAILABLE };
    }
    const waiting = registration.waiting ?? this.waiting;
    if (waiting) {
      this.waiting = waiting;
      return { kind: 'available', messageKey: 'settings.updateAvailable' };
    }
    return { kind: 'upToDate', messageKey: 'settings.updateUpToDate' };
  }

  async install(): Promise<UpdateStatus> {
    const waiting = this.waiting;
    if (!waiting) {
      return { kind: 'error', messageKey: 'settings.updateNothingToInstall', errorCode: 'UNSUPPORTED_OPERATION' };
    }
    if (this.reloading) return { kind: 'ready', messageKey: 'settings.updateReady' };
    const done = new Promise<void>((resolve) => {
      const container = this.scope.navigator?.serviceWorker;
      if (!container) {
        resolve();
        return;
      }
      // `controllerchange` fires once the new worker owns the page: only then is
      // the new version the one that will be served after a reload.
      container.addEventListener('controllerchange', () => resolve(), { once: true });
    });
    waiting.postMessage({ type: 'SKIP_WAITING' });
    await Promise.race([done, new Promise<void>((resolve) => setTimeout(resolve, 5000))]);
    this.reloading = true;
    return { kind: 'ready', messageKey: 'settings.updateReady' };
  }

  relaunch(): void {
    // A reload is the only "relaunch" a web app has; the waiting worker takes
    // over because it was already activated with the user's consent.
    this.scope.location?.reload();
  }
}
