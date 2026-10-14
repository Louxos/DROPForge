/**
 * Application shell: sidebar on desktop, fixed bottom bar on mobile, and the four
 * screens. It renders the controller's state; it never decides anything itself.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RADIUS, SPACE, TYPOGRAPHY, colorsFor, resolveTheme } from '@dropforge/design-system';
import type { AppController, AppState } from './controller.js';
import { TransferScreen } from '../screens/transfer.js';
import { DevicesScreen } from '../screens/devices.js';
import { ActivityScreen } from '../screens/activity.js';
import { SettingsScreen } from '../screens/settings.js';
import { BrandMark, NoticeStack } from '../components/atoms.js';
import type { InstallWatch } from '../platform/install.js';

export type Route = 'transfer' | 'devices' | 'activity' | 'settings';

export interface ShellProps {
  controller: AppController;
  state: AppState;
  /**
   * Installation watch, when the host has one (the browser does, the Windows shell
   * does not). Absent means: no install banner, which is the truth there.
   */
  install?: InstallWatch;
}

export function Shell({ controller, state, install }: ShellProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const [route, setRoute] = useState<Route>('transfer');
  const [systemDark, setSystemDark] = useState(true);

  // The theme follows the system when asked to, and the window is the source of
  // truth for "system": no guessing.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(query.matches);
    const listener = (event: MediaQueryListEvent): void => setSystemDark(event.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);

  const theme = resolveTheme(state.settings.theme, systemDark);
  const colors = colorsFor(theme);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--df-background', colors.background);
    root.style.setProperty('--df-surface', colors.surface);
    root.style.setProperty('--df-surface-elevated', colors.surfaceElevated);
    root.style.setProperty('--df-border', colors.border);
    root.style.setProperty('--df-border-strong', colors.borderStrong);
    root.style.setProperty('--df-text', colors.text);
    root.style.setProperty('--df-text-muted', colors.textMuted);
    root.style.setProperty('--df-text-faint', colors.textFaint);
    root.style.setProperty('--df-accent', colors.accent);
    root.style.setProperty('--df-accent-strong', colors.accentStrong);
    root.style.setProperty('--df-accent-soft', colors.accentSoft);
    root.style.setProperty('--df-blue', colors.blue);
    root.style.setProperty('--df-success', colors.success);
    root.style.setProperty('--df-warning', colors.warning);
    root.style.setProperty('--df-danger', colors.danger);
    root.style.setProperty('--df-on-accent', colors.onAccent);
    root.style.setProperty('--df-scrim', colors.scrim);
    root.dataset['theme'] = theme;
    root.style.colorScheme = theme;
  }, [theme, colors]);

  useEffect(() => {
    if (i18n.resolvedLanguage !== state.settings.language) {
      void i18n.changeLanguage(state.settings.language);
    }
    document.documentElement.lang = state.settings.language;
  }, [i18n, state.settings.language]);

  const navItems = useMemo(
    () =>
      [
        { route: 'transfer' as const, label: t('nav.transfer'), glyph: '⇄' },
        { route: 'devices' as const, label: t('nav.devices'), glyph: '▣' },
        { route: 'activity' as const, label: t('nav.activity'), glyph: '☰' },
        { route: 'settings' as const, label: t('nav.settings'), glyph: '⚙' },
      ],
    [t],
  );

  if (state.fatalError) {
    return (
      <div style={{ padding: SPACE.xxl, maxWidth: 640 }}>
        <BrandMark />
        <div className="df-error" role="alert" style={{ marginTop: SPACE.xl }}>
          <strong>{t(`errors.${state.fatalError.code}` as never, state.fatalError.message)}</strong>
          <span className="df-faint">{state.fatalError.code}</span>
        </div>
      </div>
    );
  }

  if (!state.ready) {
    return (
      <div className="df-app df-app--loading" data-dropforge-shell="" style={{ padding: SPACE.xxl }}>
        <BrandMark />
        <div className="df-loading" style={{ marginTop: SPACE.xl }} aria-live="polite">
          <div className="df-skeleton" style={{ width: 220 }} />
          <span>{t('app.loading')}</span>
        </div>
      </div>
    );
  }

  return (
    // `data-dropforge-shell` is how a host that cannot see the screen checks that the
    // interface really rendered — the Windows shell uses it to report a blank window
    // instead of leaving it unexplained.
    <div className="df-app" data-dropforge-shell="">
      <aside className="df-sidebar" aria-label={t('app.name')}>
        <BrandMark />
        <nav className="df-nav">
          {navItems.map((item) => (
            <button
              key={item.route}
              type="button"
              className="df-nav__item"
              aria-current={route === item.route ? 'page' : undefined}
              onClick={() => setRoute(item.route)}
            >
              <span aria-hidden="true" style={{ width: 18, textAlign: 'center' }}>
                {item.glyph}
              </span>
              {item.label}
            </button>
          ))}
        </nav>
        <div style={{ marginTop: 'auto' }}>
          <CapabilityBadge state={state} />
        </div>
      </aside>

      <main className="df-main" style={{ fontFamily: TYPOGRAPHY.fontFamily }}>
        <NoticeStack controller={controller} state={state} />
        <InstallBanner install={install} />
        {route === 'transfer' ? <TransferScreen controller={controller} state={state} /> : null}
        {route === 'devices' ? <DevicesScreen controller={controller} state={state} /> : null}
        {route === 'activity' ? <ActivityScreen controller={controller} state={state} /> : null}
        {route === 'settings' ? <SettingsScreen controller={controller} state={state} /> : null}
      </main>

      <nav className="df-bottom-nav" aria-label={t('app.name')}>
        {navItems.map((item) => (
          <button
            key={item.route}
            type="button"
            className="df-bottom-nav__item"
            aria-current={route === item.route ? 'page' : undefined}
            onClick={() => setRoute(item.route)}
          >
            <span aria-hidden="true">{item.glyph}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

/**
 * The install offer. It appears only when the browser really offers an install
 * prompt, or when the platform has a documented manual path (iOS). It is
 * dismissible and never comes back during the session once declined.
 */
function InstallBanner({ install }: { install?: InstallWatch | undefined }): React.ReactElement | null {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);

  // The prompt event arrives after the first render; watching for it here keeps the
  // banner honest (it never claims to be installable before it is).
  useEffect(() => {
    if (!install) return;
    const refresh = (): void => setShown(!install.installed() && (install.available() || install.platform() === 'ios'));
    refresh();
    return install.subscribe(refresh);
  }, [install]);

  if (!install || dismissed || !shown) return null;
  const canPrompt = install.available();
  return (
    <div className="df-card df-card--tight df-row df-row--between" style={{ marginBottom: SPACE.lg, flexWrap: 'wrap' }}>
      <span>{canPrompt ? t('app.installPrompt') : t('app.installIos')}</span>
      <span className="df-row">
        {canPrompt ? (
          <button
            type="button"
            className="df-button df-button--small df-button--primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void install
                .prompt()
                .then((outcome) => {
                  // Whatever the user chose, the offer has been made once.
                  if (outcome !== 'unavailable') setDismissed(true);
                })
                .finally(() => setBusy(false));
            }}
          >
            {t('app.installAction')}
          </button>
        ) : null}
        <button type="button" className="df-button df-button--small df-button--ghost" onClick={() => setDismissed(true)}>
          {t('app.installLater')}
        </button>
      </span>
    </div>
  );
}

function CapabilityBadge({ state }: { state: AppState }): React.ReactElement {
  const { t } = useTranslation();
  // The badge states the path that is actually available, never a vague "online".
  const label = state.capabilities.webRtc
    ? t('transfer.methodLan')
    : t('capabilities.unavailable');
  return (
    <div className="df-faint" style={{ borderTop: '1px solid var(--df-border)', paddingTop: SPACE.md }}>
      <div style={{ borderRadius: RADIUS.sm }}>{label}</div>
      {!state.capabilities.backgroundTransfer ? (
        <div style={{ marginTop: SPACE.xs }}>{t('capabilities.backgroundReceiveNote')}</div>
      ) : null}
    </div>
  );
}
