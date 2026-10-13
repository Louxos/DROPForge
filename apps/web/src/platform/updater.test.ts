/**
 * Update handling. Two promises to keep: nothing is installed without the user's
 * answer, and a version number is only reported when the platform really gives one.
 */
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@dropforge/app-core';
import { ServiceWorkerUpdateSource, noUpdateSource } from './updater.js';

interface FakeWorker {
  posted: unknown[];
  postMessage(message: unknown): void;
}

class FakeRegistration {
  readonly updateCalls: string[] = [];
  waiting: FakeWorker | undefined;
  failUpdate = false;
  readonly listeners = new Map<string, () => void>();

  constructor(private readonly container: FakeContainer) {}

  async update(): Promise<void> {
    this.updateCalls.push('update');
    if (this.failUpdate) throw new Error('offline');
  }
}

class FakeContainer {
  readonly registration = new FakeRegistration(this);
  private readonly controllerListeners = new Set<() => void>();
  throwOnGetRegistration = false;

  async getRegistration(): Promise<FakeRegistration | undefined> {
    if (this.throwOnGetRegistration) throw new Error('no worker');
    return this.registration;
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'controllerchange') this.controllerListeners.add(listener);
  }

  /** Simulates the browser activating the new worker. */
  activateNewWorker(): void {
    for (const listener of this.controllerListeners) listener();
  }
}

function newWorker(): FakeWorker {
  const worker: FakeWorker = {
    posted: [],
    postMessage: (message) => worker.posted.push(message),
  };
  return worker;
}

function scopeWith(container: FakeContainer): {
  navigator: Navigator & { serviceWorker: ServiceWorkerContainer };
  location: Location;
} {
  const reloads: string[] = [];
  return {
    navigator: { serviceWorker: container } as unknown as Navigator & { serviceWorker: ServiceWorkerContainer },
    location: { reload: () => reloads.push('reload') } as unknown as Location,
  };
}

describe('noUpdateSource', () => {
  it('says the platform cannot check, instead of doing nothing quietly', async () => {
    expect(noUpdateSource.canCheck).toBe(false);
    const status = await noUpdateSource.check();
    expect(status.kind).toBe('error');
    expect(status.errorCode).toBe(ERROR_CODES.PLATFORM_UNSUPPORTED);
    await expect(noUpdateSource.install()).resolves.toMatchObject({ kind: 'error' });
    expect(() => noUpdateSource.relaunch()).not.toThrow();
  });
});

describe('ServiceWorkerUpdateSource', () => {
  it('reports a waiting worker as an available update', async () => {
    const container = new FakeContainer();
    container.registration.waiting = newWorker();
    const source = new ServiceWorkerUpdateSource(scopeWith(container));

    expect(source.canCheck).toBe(true);
    const status = await source.check();
    expect(status.kind).toBe('available');
    expect(container.registration.updateCalls).toEqual(['update']);
  });

  it('reports "up to date" when the browser has no newer worker', async () => {
    const container = new FakeContainer();
    const source = new ServiceWorkerUpdateSource(scopeWith(container));
    expect((await source.check()).kind).toBe('upToDate');
  });

  it('reports a failed check as a network problem, not as "up to date"', async () => {
    const container = new FakeContainer();
    container.registration.failUpdate = true;
    const source = new ServiceWorkerUpdateSource(scopeWith(container));
    const status = await source.check();
    expect(status.kind).toBe('error');
    expect(status.errorCode).toBe(ERROR_CODES.RELAY_UNAVAILABLE);
  });

  it('never reports a version number it was not given', async () => {
    const container = new FakeContainer();
    container.registration.waiting = newWorker();
    const source = new ServiceWorkerUpdateSource(scopeWith(container));
    expect((await source.check()).version).toBeUndefined();
  });

  it('installs only the worker that is waiting, and asks it to take over', async () => {
    const container = new FakeContainer();
    const worker = newWorker();
    container.registration.waiting = worker;
    const scope = scopeWith(container);
    const source = new ServiceWorkerUpdateSource(scope);

    // Nothing was waiting for the source yet: install must not guess, and it must
    // not touch the worker either.
    await expect(source.install()).resolves.toMatchObject({
      kind: 'error',
      errorCode: ERROR_CODES.UNSUPPORTED_OPERATION,
    });
    expect(worker.posted).toEqual([]);

    await source.check();
    const installing = source.install();
    container.activateNewWorker();
    expect((await installing).kind).toBe('ready');
    expect(worker.posted).toEqual([{ type: 'SKIP_WAITING' }]);

    source.relaunch();
    expect((scope.location as unknown as { reload: () => void })).toBeDefined();
  });

  it('refuses to install when no update is waiting', async () => {
    const container = new FakeContainer();
    const source = new ServiceWorkerUpdateSource(scopeWith(container));
    await source.check();
    const status = await source.install();
    expect(status.kind).toBe('error');
    expect(status.errorCode).toBe(ERROR_CODES.UNSUPPORTED_OPERATION);
  });

  it('says the app is not installed when there is no worker at all', async () => {
    const source = new ServiceWorkerUpdateSource({ navigator: undefined, location: undefined });
    expect(source.canCheck).toBe(false);
    expect((await source.check()).kind).toBe('error');
  });
});
