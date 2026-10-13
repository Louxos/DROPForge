/**
 * The install banner must never offer something the browser cannot do: these tests
 * cover the three real situations (Chromium prompt, iOS instructions, installed).
 */
import { describe, expect, it } from 'vitest';
import { createInstallWatch, type InstallPromptEvent } from './install.js';

class FakeScope {
  readonly listeners = new Map<string, (event: Event) => void>();
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { userAgent?: string; maxTouchPoints?: number; standalone?: boolean };

  addEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string): void {
    this.listeners.delete(type);
  }

  fire(type: string, event: Event): void {
    this.listeners.get(type)?.(event);
  }
}

function promptEvent(outcome: 'accepted' | 'dismissed', calls?: { prompted: number }): InstallPromptEvent {
  const event = new Event('beforeinstallprompt') as InstallPromptEvent;
  event.prompt = async () => {
    if (calls) calls.prompted += 1;
  };
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

describe('createInstallWatch', () => {
  it('is unavailable until the browser says the application is installable', async () => {
    const scope = new FakeScope();
    const watch = createInstallWatch(scope);
    expect(watch.available()).toBe(false);
    expect(await watch.prompt()).toBe('unavailable');

    scope.fire('beforeinstallprompt', promptEvent('accepted'));
    expect(watch.available()).toBe(true);
    expect(watch.platform()).toBe('chromium');
  });

  it('reports the choice the user actually made, and consumes the prompt', async () => {
    const scope = new FakeScope();
    const watch = createInstallWatch(scope);
    const calls = { prompted: 0 };
    scope.fire('beforeinstallprompt', promptEvent('dismissed', calls));

    expect(await watch.prompt()).toBe('dismissed');
    expect(calls.prompted).toBe(1);
    // A prompt event can only be used once: the watch must not offer it again.
    expect(watch.available()).toBe(false);
    expect(await watch.prompt()).toBe('unavailable');
  });

  it('points iOS at the real path instead of a button that does nothing', () => {
    const scope = new FakeScope();
    scope.navigator = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', maxTouchPoints: 5 };
    const watch = createInstallWatch(scope);

    expect(watch.platform()).toBe('ios');
    expect(watch.available()).toBe(false);
  });

  it('recognises an iPad, which pretends to be a Mac', () => {
    const scope = new FakeScope();
    scope.navigator = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 };
    expect(createInstallWatch(scope).platform()).toBe('ios');

    const desktop = new FakeScope();
    desktop.navigator = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 };
    expect(createInstallWatch(desktop).platform()).toBe('other');
  });

  it('never shows the banner again once the application is installed', () => {
    const standalone = new FakeScope();
    standalone.matchMedia = (query) => ({ matches: query === '(display-mode: standalone)' });
    expect(createInstallWatch(standalone).installed()).toBe(true);

    const iosStandalone = new FakeScope();
    iosStandalone.navigator = { userAgent: 'iPhone', standalone: true };
    expect(createInstallWatch(iosStandalone).installed()).toBe(true);

    const browser = new FakeScope();
    browser.matchMedia = () => ({ matches: false });
    expect(createInstallWatch(browser).installed()).toBe(false);
  });

  it('tells the interface when installability changes, instead of being polled', () => {
    const scope = new FakeScope();
    const watch = createInstallWatch(scope);
    let notifications = 0;
    const unsubscribe = watch.subscribe(() => {
      notifications += 1;
    });

    scope.fire('beforeinstallprompt', promptEvent('accepted'));
    expect(notifications).toBe(1);

    unsubscribe();
    // The prompt is consumed: one more change, but nobody is listening any more.
    void watch.prompt();
    expect(notifications).toBe(1);
  });

  it('stops listening when disposed', () => {
    const scope = new FakeScope();
    const watch = createInstallWatch(scope);
    watch.dispose();
    scope.fire('beforeinstallprompt', promptEvent('accepted'));
    expect(watch.available()).toBe(false);
  });
});
