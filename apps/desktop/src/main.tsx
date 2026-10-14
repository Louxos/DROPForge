/**
 * Entry point of the Windows application.
 *
 * It renders the *same* interface as the PWA (`@dropforge/web`) and gives it the
 * Windows platform layer: SQLite for local data, the real filesystem for receiving,
 * the system tray and autostart managed by Rust, and signed updates.
 *
 * This file is the whole difference between the two targets: no screen, no rule and
 * no protocol is duplicated.
 *
 * # Why boot is written the way it is
 *
 * The window is created hidden (to avoid a white flash) and revealed either by the
 * interface or — always — by a watchdog on the Rust side. Boot failures used to be
 * invisible: the window never appeared and launching DropForge looked like nothing
 * happened at all. Now:
 *
 * 1. the window is asked for *before* anything else, so a failure further down is
 *    visible on a real window rather than in silence;
 * 2. every step is run through `runBootSteps`, which names the step that failed;
 * 3. a failure shows a screen with the reason, the log path, and a Retry button;
 * 4. a React error boundary does the same for a rendering failure;
 * 5. the reason is written to `diagnostics.log` through the Rust side.
 */
import { Component, StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { downloadDir, join } from '@tauri-apps/api/path';
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
import { SPACE, RADIUS, colorsFor, TYPOGRAPHY } from '@dropforge/design-system';
import { SqliteMetaStore } from './platform/tauri-store.js';
import { SqliteIdentityStore } from './platform/tauri-identity-store.js';
import { TauriFileSystem } from './platform/tauri-fs.js';
import { TauriUpdateSource } from './platform/tauri-updater.js';
import {
  BOOT_STEP_LABELS,
  describeError,
  failureText,
  interfaceRendered,
  runBootSteps,
  type BootStepName,
} from './platform/boot.js';

/** Diagnostics are reported to the Rust side, which owns the log file. */
function report(scope: string, message: string): void {
  void invoke('report_problem', { scope, message }).catch(() => undefined);
}

/**
 * Boots everything the controller needs.
 *
 * Each step is separate on purpose: a failure must point at *what* failed, not at
 * "the application did not start".
 */
async function createController(): Promise<AppController> {
  // The language is needed before the first paint, so the local database is opened and
  // the interface is translated before anything is rendered. Each step returns what the
  // next one needs: nothing is fetched twice, and a failure names its own step.
  const [store, identities, , updateSource] = await runBootSteps([
    {
      name: 'data',
      run: async (): Promise<SqliteMetaStore> => {
        // The SQL plugin resolves a relative path inside the application config
        // directory — the same folder the Rust side uses for `system.json`, the
        // diagnostics log and the uninstaller's data question. No absolute path is
        // built here, so there is no path syntax to get wrong per platform.
        const created = new SqliteMetaStore('sqlite:dropforge.sqlite3');
        await created.init();
        return created;
      },
    },
    {
      name: 'identity',
      run: async (): Promise<SqliteIdentityStore> => new SqliteIdentityStore(store),
    },
    {
      name: 'settings',
      run: async (): Promise<'fr' | 'en'> => {
        const language = await readLanguage(store);
        await setupI18n(language);
        return language;
      },
    },
    {
      name: 'updates',
      run: async (): Promise<UpdateSource> =>
        (await isUpdaterConfigured()) ? new TauriUpdateSource() : noUpdateSource,
    },
  ]);

  return new AppController({
    store,
    identities,
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
}

/** Root component: it owns the boot state, so a failure always has somewhere to show. */
function WindowsApp(): React.ReactElement {
  const [controller, setController] = useState<AppController | undefined>();
  const [step, setStep] = useState<BootStepName | undefined>();
  const [failure, setFailure] = useState<unknown>(undefined);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailure(undefined);

    void (async () => {
      try {
        // Ask for the window first: whatever fails next is at least visible.
        await invoke('show_main_window').catch(() => undefined);

        // "interface" is reported here rather than as a step of its own: it is the
        // moment the controller exists and the shell can render.
        setStep('interface');
        const created = await createController();
        if (cancelled) return;
        setController(created);
        await created.start();
      } catch (error) {
        if (cancelled) return;
        setFailure(error);
        report('boot', describeError(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (failure !== undefined) {
    return (
      <RecoveryScreen
        failure={failure}
        onRetry={() => {
          setController(undefined);
          setAttempt((value) => value + 1);
        }}
      />
    );
  }

  if (!controller) return <BootScreen step={step} />;

  return <ReadyShell controller={controller} />;
}

/** The shell, once the controller exists; it also verifies that it really rendered. */
function ReadyShell({ controller }: { controller: AppController }): React.ReactElement {
  const state = useAppState(controller);
  const [rendered, setRendered] = useState(true);

  // The window is revealed as soon as there is something to look at. The Rust side has
  // its own watchdog: if this never runs, the window still appears.
  useEffect(() => {
    void invoke('show_main_window').catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!state.ready) return;
    // A mounted tree that produced nothing on screen would otherwise be a silent
    // white page; this turns it into a reported failure.
    const timer = window.setTimeout(() => {
      const ok = interfaceRendered(document.getElementById('root'));
      setRendered(ok);
      if (!ok) report('interface', 'l’interface est montée mais n’a rien rendu');
    }, 750);
    return () => window.clearTimeout(timer);
  }, [state.ready]);

  // The tray and the close button behaviour are preferences the Rust side reads, so
  // they are pushed there whenever they change. A refused autostart registration is
  // surfaced by the controller, never silently dropped.
  useEffect(() => {
    void invoke('apply_preferences', {
      autostart: state.settings.autostart,
      closeBehaviour: state.settings.closeBehaviour,
    }).catch((error) => {
      report('preferences', describeError(error));
    });
  }, [state.settings.autostart, state.settings.closeBehaviour]);

  if (!rendered) {
    return (
      <RecoveryScreen
        failure={new Error('l’interface n’a rien rendu / the interface rendered nothing')}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return <Shell controller={controller} state={state} />;
}

/** Shown while boot runs. It names the real step, never a decorative animation. */
function BootScreen({ step }: { step: BootStepName | undefined }): React.ReactElement {
  const colors = colorsFor('dark');
  const label = step ? BOOT_STEP_LABELS[step] : { fr: 'Démarrage', en: 'Starting' };
  return (
    <div
      className="df-app df-app--loading"
      data-dropforge-shell=""
      style={{ padding: SPACE.xxl, color: colors.text, fontFamily: TYPOGRAPHY.fontFamily }}
    >
      <BrandMark />
      <p aria-live="polite" style={{ marginTop: SPACE.lg, color: colors.textMuted }}>
        {label.fr}
        <span style={{ color: colors.textFaint }}> · {label.en}</span>
      </p>
    </div>
  );
}

/**
 * Shown when boot fails. It says what failed, where the log is, and offers a retry —
 * the three things someone needs instead of a window that never opens.
 */
function RecoveryScreen({ failure, onRetry }: { failure: unknown; onRetry: () => void }): React.ReactElement {
  const colors = colorsFor('dark');
  const { step, detail } = failureText(failure);
  const [logPath, setLogPath] = useState<string | undefined>();
  const label = step === 'unknown' ? undefined : BOOT_STEP_LABELS[step];

  useEffect(() => {
    void invoke<string | null>('diagnostics_path_command')
      .then((path) => setLogPath(path ?? undefined))
      .catch(() => undefined);
  }, []);

  return (
    <div
      data-dropforge-shell=""
      style={{
        padding: SPACE.xxl,
        color: colors.text,
        fontFamily: TYPOGRAPHY.fontFamily,
        display: 'grid',
        gap: SPACE.lg,
        maxWidth: 720,
      }}
    >
      <BrandMark />
      <h1 style={{ margin: 0, fontSize: 22 }}>DropForge n’a pas pu démarrer</h1>
      <p style={{ margin: 0, color: colors.textMuted }}>
        L’application a rencontré un problème au démarrage. Aucune donnée n’a été modifiée.
        <br />
        <span lang="en">DropForge could not start. Nothing was changed.</span>
      </p>
      <div
        style={{
          border: `1px solid ${colors.border}`,
          borderRadius: RADIUS.lg,
          padding: SPACE.lg,
          display: 'grid',
          gap: SPACE.sm,
          background: colors.surface,
        }}
      >
        <div style={{ color: colors.textMuted, fontSize: 13 }}>
          {label ? `${label.fr} · ${label.en}` : 'Étape inconnue · Unknown step'}
        </div>
        <code style={{ color: colors.danger, overflowWrap: 'anywhere' }}>{detail}</code>
        {logPath ? (
          <code style={{ color: colors.textFaint, fontSize: 12, overflowWrap: 'anywhere' }}>{logPath}</code>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: SPACE.md }}>
        <button
          type="button"
          className="df-button df-button--primary"
          onClick={onRetry}
          style={{ background: colors.accent, color: colors.onAccent, border: 'none', padding: '10px 18px', borderRadius: RADIUS.md, cursor: 'pointer' }}
        >
          Réessayer · Retry
        </button>
      </div>
      <p style={{ margin: 0, color: colors.textFaint, fontSize: 12 }}>
        Si le problème persiste, transmettez le fichier indiqué ci-dessus : il ne contient aucun
        contenu de fichier, aucune clé et aucun jeton.
      </p>
    </div>
  );
}

/** Any rendering error becomes the same recovery screen instead of a white window. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state: { error: unknown } = { error: undefined };

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error };
  }

  override componentDidCatch(error: unknown): void {
    report('render', describeError(error));
  }

  override render(): ReactNode {
    if (this.state.error !== undefined) {
      return <RecoveryScreen failure={this.state.error} onRetry={() => window.location.reload()} />;
    }
    return this.props.children;
  }
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

/* ------------------------------------------------------------------ *
 * Start-up: mount first, then boot. A failure always has a screen.
 * ------------------------------------------------------------------ */

const container = document.getElementById('root');
if (!container) {
  report('startup', "l’élément racine est introuvable dans index.html");
} else {
  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary>
        <WindowsApp />
      </ErrorBoundary>
    </StrictMode>,
  );

  // The loading text in `index.html` is replaced by the first React render. If that
  // never happens, the text stays on screen, which is itself a diagnosis — and the
  // Rust watchdog makes sure the window is not hidden while it does.
  window.setTimeout(() => {
    if (!interfaceRendered(document.getElementById('root'))) {
      report('startup', 'aucun rendu React après 5 s : l’écran de chargement est toujours affiché');
    }
  }, 5000);
}
