/**
 * Entry point of the web application.
 *
 * Everything the controller needs is built here, once, from what the platform
 * really offers: storage, identity, transports, receiving folder and the update
 * mechanism. Nothing is faked for a nicer demo: when a capability is missing, the
 * controller is told so and the interface explains it.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@dropforge/design-system/styles.css';
import './styles/app.css';
import { setupI18n } from './i18n/index.js';
import type { InstallWatch } from './platform/install.js';
import { detectCapabilities, type PlatformCapabilities } from './platform/capabilities.js';
import { triggerDownload } from './platform/browser-fs.js';
import { IndexedDbMetaStore } from './platform/indexed-db-store.js';
import { IndexedDbIdentityStore } from './platform/identity-store.js';
import { ReceiveFolderService } from './platform/receive-folder.js';
import { WebRtcLinkFactory } from './platform/webrtc-link.js';
import { ServiceWorkerUpdateSource, noUpdateSource, type UpdateSource } from './platform/updater.js';
import { createInstallWatch } from './platform/install.js';
import { describeError, fromPlatformError } from '@dropforge/app-core';
import { AppController } from './app/controller.js';
import { FatalScreen, Shell } from './app/shell.js';
import { useAppState } from './app/use-app-state.js';
import { BrandMark } from './components/atoms.js';
import { SPACE } from '@dropforge/design-system';

const APP_VERSION = import.meta.env['VITE_APP_VERSION'] ?? '0.0.0-dev';

async function boot(): Promise<void> {
  const capabilities = detectCapabilities();
  // Installation is offered by the browser, so the watch lives here and the shell
  // only displays what it reports.
  const install = createInstallWatch(globalThis as unknown as Window);
  const store = new IndexedDbMetaStore();
  const receiveFolders = new ReceiveFolderService(store);
  await setupI18n(preferredLocale());

  // The receiving folder is resolved lazily and per transfer: a remembered folder
  // whose permission was not granted yet leads to an explicit question, never to a
  // failed write in the middle of a transfer.
  await receiveFolders.load();

  const controller = new AppController({
    store,
    identities: new IndexedDbIdentityStore(store),
    capabilities,
    // Built lazily, once the identity exists: a factory without a fingerprint could
    // not prove this device's identity to the other side.
    links: (info) =>
      new WebRtcLinkFactory({
        signalingUrl: signalingUrlFor(),
        deviceId: info.deviceId,
        displayName: info.displayName,
        platform: info.platform,
        fingerprint: info.fingerprint,
        capabilities: info.capabilities,
      }),
    updateSource: updateSourceFor(capabilities),
    appVersion: APP_VERSION,
    receiveFolders,
    receiveStore: async () => (await receiveFolders.port()) ?? receiveFolders.fallbackPort(triggerDownload),
    deviceName: deviceNameFromDevice(),
    ...(import.meta.env['VITE_SHARE_ORIGIN'] ? { shareOrigin: import.meta.env['VITE_SHARE_ORIGIN'] } : {}),
  });

  const root = document.getElementById('root');
  if (!root) throw new Error('The application root element is missing');

  createRoot(root).render(
    <StrictMode>
      <App controller={controller} install={install} />
    </StrictMode>,
  );

  await controller.start();
  exposeForDiagnostics(controller);
}

/**
 * Shows why the application could not open, instead of nothing at all.
 *
 * The entry point used to end with a bare `void boot()`: any throw while building the
 * platform — local storage unavailable, no WebCrypto, a service worker that refuses to
 * register — rejected a promise nobody looked at and left the page **blank**. No
 * message, no way to tell "still loading" from "broken". That is the same failure the
 * Windows shell had, and it is the one thing an application should never do.
 */
function reportBootFailure(error: unknown): void {
  const dfError = fromPlatformError(error);
  console.error('[DropForge] démarrage impossible', error);
  const root = document.getElementById('root');
  if (!root) return;
  createRoot(root).render(
    <StrictMode>
      <FatalScreen code={dfError.code} message={dfError.message} detail={describeError(error)} />
    </StrictMode>,
  );
}

function App({ controller, install }: { controller: AppController; install: InstallWatch }): React.ReactElement {
  const state = useAppState(controller);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Asking the notification permission is only useful after the user turned
    // notifications on; the controller already tracks that preference.
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <div style={{ padding: SPACE.xxl }}>
        <BrandMark />
      </div>
    );
  }
  return <Shell controller={controller} state={state} install={install} />;
}

/**
 * The signaling endpoint. On the web app the relay is expected on the same origin
 * (``/ws``), which works behind a reverse proxy and in the dev server; a deployment
 * can point elsewhere with `VITE_SIGNALING_URL`.
 */
function signalingUrlFor(): string {
  const configured = import.meta.env['VITE_SIGNALING_URL'];
  if (configured) return configured;
  const location = globalThis.location;
  const secure = location?.protocol === 'https:';
  const host = location?.host ?? 'localhost:5173';
  return `${secure ? 'wss' : 'ws'}://${host}/ws`;
}

function updateSourceFor(capabilities: PlatformCapabilities): UpdateSource {
  // A page that is not installed has no worker to update; saying "unsupported" is
  // the truth there.
  return capabilities.serviceWorker ? new ServiceWorkerUpdateSource() : noUpdateSource;
}

function preferredLocale(): 'fr' | 'en' {
  const languages = globalThis.navigator?.languages ?? [];
  for (const language of languages) {
    if (language.toLowerCase().startsWith('fr')) return 'fr';
    if (language.toLowerCase().startsWith('en')) return 'en';
  }
  return 'fr';
}

function deviceNameFromDevice(): string | undefined {
  const nav = globalThis.navigator as (Navigator & { userAgentData?: { platform?: string } }) | undefined;
  const platform = nav?.userAgentData?.platform ?? nav?.platform;
  return platform ? `${platform}` : undefined;
}

/** A read-only handle for debugging, never used by the application logic. */
function exposeForDiagnostics(controller: AppController): void {
  (globalThis as { dropforge?: { controller: AppController } }).dropforge = { controller };
}

void boot().catch(reportBootFailure);
