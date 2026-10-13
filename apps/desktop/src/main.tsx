/**
 * Entry point of the Windows application.
 *
 * It renders the *same* interface as the PWA (`@dropforge/web`) and gives it the
 * Windows platform layer: SQLite for local data, the real filesystem for receiving,
 * the system tray and autostart managed by Rust, and signed updates.
 *
 * This file is the whole difference between the two targets: no screen, no rule and
 * no protocol is duplicated.
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { appDataDir, downloadDir, join } from '@tauri-apps/api/path';
import { getVersion } from '@tauri-apps/api/app';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import '@dropforge/design-system/styles.css';
import '@dropforge/web/styles/app.css';
import {
  AppController,
  BrandMark,
  Shell,
  detectCapabilities,
  noUpdateSource,
  setupI18n,
  useAppState,
  WebRtcLinkFactory,
  type NotificationChannel,
  type UpdateSource,
} from '@dropforge/web';
import { SPACE } from '@dropforge/design-system';
import { SqliteMetaStore } from './platform/tauri-store.js';
import { SqliteIdentityStore } from './platform/tauri-identity-store.js';
import { TauriFileSystem } from './platform/tauri-fs.js';
import { TauriUpdateSource } from './platform/tauri-updater.js';

/** Where the application data lives; the same folder the tray icon uses. */
async function boot(): Promise<void> {
  const dataDir = await appDataDir();
  const store = new SqliteMetaStore(`${dataDir.replace(/\/$/, '')}/dropforge.sqlite3`);

  // The settings (language, theme, …) are needed before the first render, so the
  // store is opened and the interface is translated first.
  await store.init();
  const language = await readLanguage(store);
  await setupI18n(language);

  const updateSource: UpdateSource = await isUpdaterConfigured() ? new TauriUpdateSource() : noUpdateSource;

  const controller = new AppController({
    store,
    identities: new SqliteIdentityStore(store),
    capabilities: detectCapabilities(),
    links: (info) =>
      new WebRtcLinkFactory({
        signalingUrl: import.meta.env['VITE_SIGNALING_URL'] ?? 'wss://localhost:8787',
        deviceId: info.deviceId,
        displayName: info.displayName,
        platform: info.platform,
        fingerprint: info.fingerprint,
        capabilities: info.capabilities,
      }),
    updateSource,
    appVersion: await getVersion().catch(() => '0.1.0'),
    channel: systemTrayNotifications(),
    deviceName: await invoke<string>('device_name').catch(() => undefined),
    // The receiving folder is chosen in the settings; the system Downloads folder is
    // the default so a transfer can never fail for "no folder chosen".
    receiveStore: async () => new TauriFileSystem(await receiveFolderPath(), {
      freeSpace: async () => await invoke<number | null>('free_space_bytes', { path: await receiveFolderPath() }).then((value) => value ?? undefined),
    }),
  });

  const root = document.getElementById('root');
  if (!root) throw new Error('The application root element is missing');

  createRoot(root).render(
    <StrictMode>
      <WindowsApp controller={controller} store={store} />
    </StrictMode>,
  );

  await controller.start();
}

function WindowsApp({ controller, store }: { controller: AppController; store: SqliteMetaStore }): React.ReactElement {
  const state = useAppState(controller);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // The window is only shown once the interface is usable: no flash of an empty
    // window, and no fake "loading" screen kept for show.
    void invoke('show_main_window').catch(() => undefined);
    setReady(true);
  }, []);

  // The tray and the close button behaviour are preferences the Rust side reads, so
  // they are pushed there whenever they change.
  useEffect(() => {
    void invoke('apply_preferences', {
      autostart: state.settings.autostart,
      closeBehaviour: state.settings.closeBehaviour,
    }).catch(() => undefined);
  }, [state.settings.autostart, state.settings.closeBehaviour]);

  void store;
  if (!ready) {
    return (
      <div style={{ padding: SPACE.xxl }}>
        <BrandMark />
      </div>
    );
  }
  return <Shell controller={controller} state={state} />;
}

/** Choosing the receiving folder asks the operating system, not a mock. */
async function receiveFolderPath(): Promise<string> {
  const configured = await invoke<string | null>('receive_folder').catch(() => null);
  if (configured && configured.length > 0) return configured;
  return await downloadDir();
}

async function isUpdaterConfigured(): Promise<boolean> {
  return await invoke<boolean>('updater_configured').catch(() => false);
}

async function readLanguage(store: SqliteMetaStore): Promise<'fr' | 'en'> {
  const record = await store.get<{ language?: string }>('settings', 'preferences').catch(() => undefined);
  return record?.language === 'en' ? 'en' : 'fr';
}

/**
 * Notifications through the operating system.
 *
 * Windows does not have a "denied" state the way browsers do: the permission is
 * granted by the system, and this channel reports what it can actually verify.
 */
function systemTrayNotifications(): NotificationChannel {
  return {
    supported: true,
    async permission() {
      return (await isPermissionGranted()) ? 'granted' : 'prompt';
    },
    async requestPermission() {
      return (await requestPermission()) === 'granted' ? 'granted' : 'denied';
    },
    async show(request) {
      // A notification is only ever shown once the system allows it: nothing is
      // "posted" and then silently dropped.
      if (!(await isPermissionGranted())) return;
      sendNotification({ title: request.title, body: request.body });
    },
    onActivated() {
      // The window is already the only surface: nothing to route.
      return () => {};
    },
  };
}

/** Picking files to send uses the operating system dialog. */
export async function pickSourceFolder(): Promise<string | undefined> {
  const picked = await openDialog({ directory: true, multiple: false, title: 'Dossier à envoyer' });
  return typeof picked === 'string' ? picked : undefined;
}

export { join };

void boot();
