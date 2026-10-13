/**
 * Capability detection decides what the interface is allowed to promise, so every
 * case here is about *not* promising something: absent APIs, iOS, a tab that is not
 * installed. A wrong `true` would show a user a button that fails later.
 */
import { describe, expect, it } from 'vitest';
import { canTransfer, capabilityNotes, detectCapabilities, freeSpaceBytes, readStorageEstimate } from './capabilities.js';

type FakeNavigator = Navigator & Record<string, unknown>;

interface FakeScopeOptions {
  userAgent?: string;
  platform?: string;
  ontouchend?: boolean;
  matchMedia?: boolean;
  navigator?: Record<string, unknown>;
  window?: Record<string, unknown>;
}

function fakeScope(options: FakeScopeOptions = {}): { navigator: FakeNavigator; window: Window & typeof globalThis } {
  const base: Record<string, unknown> = {
    userAgent: options.userAgent ?? 'Mozilla/5.0',
    languages: ['fr-FR'],
    ...(options.platform ? { userAgentData: { platform: options.platform } } : {}),
    ...(options.navigator ?? {}),
  };
  const win = {
    ...(options.window ?? {}),
    ...(options.ontouchend !== undefined ? { ontouchend: () => {} } : {}),
    ...(options.matchMedia
      ? { matchMedia: (query: string) => ({ matches: query.includes('standalone'), addEventListener() {}, removeEventListener() {} }) }
      : {}),
  } as unknown as Window & typeof globalThis;
  return { navigator: base as FakeNavigator, window: win };
}

describe('detectCapabilities', () => {
  it('reports nothing available when there is no browser at all', () => {
    const caps = detectCapabilities({ navigator: undefined, window: undefined });
    expect(caps.webRtc).toBe(false);
    expect(caps.directoryPicker).toBe(false);
    expect(caps.directoryRead).toBe(false);
    expect(caps.notifications).toBe(false);
    expect(caps.serviceWorker).toBe(false);
    expect(caps.storageEstimate).toBe(false);
    expect(caps.downloadStream).toBe(false);
    expect(caps.backgroundTransfer).toBe(false);
    expect(caps.platform).toBe('web');
  });

  it('reports what a Chromium desktop really offers', () => {
    const scope = fakeScope({
      platform: 'Windows',
      // RTCPeerConnection and Notification live on the window; the pickers and the
      // worker on the navigator. Both are what the browser actually exposes.
      window: {
        RTCPeerConnection: function () {},
        Notification: function () {},
      },
      navigator: {
        showDirectoryPicker: () => {},
        serviceWorker: {},
        storage: { estimate: async () => ({ usage: 1, quota: 2 }) },
      },
    });
    const caps = detectCapabilities(scope);
    expect(caps.webRtc).toBe(true);
    expect(caps.directoryPicker).toBe(true);
    expect(caps.directoryRead).toBe(true);
    expect(caps.notifications).toBe(true);
    expect(caps.serviceWorker).toBe(true);
    expect(caps.storageEstimate).toBe(true);
    expect(caps.platform).toBe('windows');
  });

  it('keeps backgroundTransfer false even on a fully capable platform', () => {
    const scope = fakeScope({
      window: { RTCPeerConnection: function () {} },
      navigator: { showDirectoryPicker: () => {} },
    });
    // A browser tab cannot be trusted to keep working off-screen; the product must
    // never claim otherwise.
    expect(detectCapabilities(scope).backgroundTransfer).toBe(false);
  });

  it('detects iOS, including an iPad that claims to be a Mac', () => {
    expect(detectCapabilities(fakeScope({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' })).ios).toBe(true);
    expect(detectCapabilities(fakeScope({ platform: 'macOS', ontouchend: true })).ios).toBe(true);
    // A real desktop Mac has no touch events.
    expect(detectCapabilities(fakeScope({ platform: 'macOS' })).ios).toBe(false);
  });

  it('detects Android and a standalone installation', () => {
    const android = detectCapabilities(fakeScope({ userAgent: 'Mozilla/5.0 (Linux; Android 14)' }));
    expect(android.platform).toBe('android');
    const installed = detectCapabilities(fakeScope({ matchMedia: true }));
    expect(installed.standalone).toBe(true);
  });

  it('refuses to offer a direct transfer without WebRTC', () => {
    const without = detectCapabilities(fakeScope({}));
    expect(canTransfer(without)).toBe(false);
    const with_ = detectCapabilities(fakeScope({ window: { RTCPeerConnection: function () {} } }));
    expect(canTransfer(with_)).toBe(true);
  });

  it('returns complete translation keys, so a note can never render as a blank line', () => {
    const notes = capabilityNotes(detectCapabilities(fakeScope({})));
    // Without a folder picker the only path is a download, and background receiving
    // is impossible in a browser tab: both are reported, with full keys.
    expect(notes).toContain('capabilities.downloadFallbackNote');
    expect(notes).toContain('capabilities.backgroundReceiveNote');
    for (const key of notes) expect(key.startsWith('capabilities.')).toBe(true);
  });

  it('mentions iOS only on iOS', () => {
    const ios = detectCapabilities(fakeScope({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' }));
    expect(capabilityNotes(ios)).toContain('capabilities.iosNote');
    const desktop = detectCapabilities(fakeScope({ window: { RTCPeerConnection: function () {} } }));
    expect(capabilityNotes(desktop)).not.toContain('capabilities.iosNote');
  });

  it('has nothing left to warn about on a platform that has everything but background work', () => {
    const scope = fakeScope({
      window: { RTCPeerConnection: function () {}, Notification: function () {} },
      navigator: {
        showDirectoryPicker: () => {},
        serviceWorker: {},
        storage: { estimate: async () => ({ usage: 1, quota: 2 }) },
      },
    });
    expect(capabilityNotes(detectCapabilities(scope))).toEqual(['capabilities.backgroundReceiveNote']);
  });
});

describe('readStorageEstimate', () => {
  it('returns the browser estimate when there is one', async () => {
    const scope = fakeScope({ navigator: { storage: { estimate: async () => ({ usage: 1024, quota: 4096 }) } } });
    expect(await readStorageEstimate(scope)).toEqual({ usage: 1024, quota: 4096 });
  });

  it('returns nothing rather than a guess when the API is absent or refuses', async () => {
    expect(await readStorageEstimate(fakeScope({}))).toBeUndefined();
    const refusing = fakeScope({ navigator: { storage: { estimate: async () => { throw new Error('denied'); } } } });
    expect(await readStorageEstimate(refusing)).toBeUndefined();
    const partial = fakeScope({ navigator: { storage: { estimate: async () => ({ usage: 1 }) } } });
    expect(await readStorageEstimate(partial)).toBeUndefined();
  });
});

describe('freeSpaceBytes', () => {
  it('uses the storage estimate and says nothing when there is none', async () => {
    const scope = fakeScope({ navigator: { storage: { estimate: async () => ({ usage: 100, quota: 1000 }) } } });
    expect(await freeSpaceBytes(scope)).toBe(900);
    expect(await freeSpaceBytes(fakeScope({}))).toBeUndefined();
  });
});
