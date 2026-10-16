/**
 * Settings screen.
 *
 * Every control here is wired to a preference the code actually reads, and every
 * capability is displayed as the platform really behaves — including the cases
 * where the answer is "the browser cannot do this", which is stated instead of
 * being hidden behind a switch that would do nothing.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SPACE, formatBytes } from '@dropforge/design-system';
import { SIGNALING_AUTO, SIGNALING_OFF } from '@dropforge/settings';
import { signalingUrlFor } from '../platform/signaling.js';
import type { AppController, AppState } from '../app/controller.js';
import { PageHeader } from '../components/atoms.js';

export function SettingsScreen({ controller, state }: { controller: AppController; state: AppState }): React.ReactElement {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === 'en' ? 'en' : 'fr';
  const settings = state.settings;
  const capabilities = state.capabilities;

  return (
    <section>
      <PageHeader titleKey="settings.title" subtitleKey="settings.subtitle" />

      <Card titleKey="settings.general">
        <Field labelKey="settings.language">
          <select
            className="df-input"
            value={settings.language}
            onChange={(event) => void controller.updateSettings({ language: event.target.value as 'fr' | 'en' })}
          >
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
        </Field>

        <Field labelKey="settings.theme">
          <select
            className="df-input"
            value={settings.theme}
            onChange={(event) => void controller.updateSettings({ theme: event.target.value as 'system' | 'dark' | 'light' })}
          >
            <option value="system">{t('settings.themeSystem')}</option>
            <option value="dark">{t('settings.themeDark')}</option>
            <option value="light">{t('settings.themeLight')}</option>
          </select>
        </Field>

        <Field labelKey="settings.notifications">
          <div className="df-row">
            <label className="df-switch">
              <input
                type="checkbox"
                checked={settings.notifications}
                disabled={!capabilities.notifications}
                onChange={(event) => void controller.updateSettings({ notifications: event.target.checked })}
              />
              {capabilities.notifications ? t('common.yes') : t('capabilities.unavailable')}
            </label>
            {capabilities.notifications && state.notifications.permission !== 'granted' ? (
              <button type="button" className="df-button df-button--small" onClick={() => void controller.requestNotificationPermission()}>
                {t('settings.enableNotifications')}
              </button>
            ) : null}
          </div>
          {!capabilities.notifications ? <p className="df-faint">{t('settings.notificationsUnsupported')}</p> : null}
        </Field>

      </Card>

      <Card titleKey="settings.transfers">
        <Field labelKey="settings.receiveFolder">
          <div className="df-row" style={{ flexWrap: 'wrap' }}>
            <span className="df-faint" style={{ flex: 1, minWidth: 160 }}>
              {state.receiveFolder.name ?? t('settings.receiveFolderNone')}
            </span>
            {capabilities.directoryPicker ? (
              <>
                <button type="button" className="df-button df-button--small" onClick={() => void controller.chooseReceiveFolder()}>
                  {t('settings.receiveFolderChoose')}
                </button>
                {state.receiveFolder.needsPermission ? (
                  <button type="button" className="df-button df-button--primary df-button--small" onClick={() => void controller.grantReceiveFolderAccess()}>
                    {t('settings.receiveFolderAllow')}
                  </button>
                ) : null}
                {state.receiveFolder.name ? (
                  <button type="button" className="df-button df-button--ghost df-button--small" onClick={() => void controller.forgetReceiveFolder()}>
                    {t('settings.receiveFolderNone')}
                  </button>
                ) : null}
              </>
            ) : (
              <span className="df-badge df-badge--warn">{t('settings.receiveFolderUnsupported')}</span>
            )}
          </div>
          {state.receiveFolder.needsPermission ? <p className="df-faint">{t('settings.receiveFolderNeedsPermission')}</p> : null}
        </Field>

        <Field labelKey="settings.conflictPolicy">
          <select
            className="df-input"
            value={settings.conflictPolicy}
            onChange={(event) => void controller.updateSettings({ conflictPolicy: event.target.value as 'ask' | 'rename' | 'skip' | 'overwrite' })}
          >
            <option value="ask">{t('settings.policyAsk')}</option>
            <option value="rename">{t('settings.policyRename')}</option>
            <option value="skip">{t('settings.policySkip')}</option>
            <option value="overwrite">{t('settings.policyOverwrite')}</option>
          </select>
        </Field>

        <Field labelKey="settings.trustedDevicesOnly">
          <label className="df-switch">
            <input
              type="checkbox"
              checked={settings.trustedDevicesOnly}
              onChange={(event) => void controller.updateSettings({ trustedDevicesOnly: event.target.checked })}
            />
            {settings.trustedDevicesOnly ? t('common.yes') : t('common.no')}
          </label>
        </Field>
      </Card>

      {/* Tout ce qui est rare, technique ou dangereux tient ici, replié : la personne
          qui ouvre les Réglages ne doit pas avoir à trier entre une dizaine de
          commandes de même poids. Rien n'est caché — c'est déplié d'un clic. */}
      <details className="df-details df-details--card">
        <summary>{t('settings.advanced')}</summary>

        <Card titleKey="settings.advancedDevice">
          <Field labelKey="settings.concurrency">
            <select
              className="df-input"
              value={settings.maxConcurrentTransfers}
              onChange={(event) => void controller.updateSettings({ maxConcurrentTransfers: Number(event.target.value) })}
            >
              {[1, 2, 3, 4, 6, 8].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>

          <Field labelKey="settings.maxTransferSize">
            <select
              className="df-input"
              value={settings.maxTransferBytes}
              onChange={(event) => void controller.updateSettings({ maxTransferBytes: Number(event.target.value) })}
            >
              <option value={0}>{t('settings.noLimit')}</option>
              {[1024 ** 3, 8 * 1024 ** 3, 64 * 1024 ** 3].map((bytes) => (
                <option key={bytes} value={bytes}>
                  {formatBytes(bytes, locale)}
                </option>
              ))}
            </select>
          </Field>

          <RelayField controller={controller} configured={settings.signalingUrl} />
        </Card>

        <Card titleKey="settings.privacy">
          {/* Ce qui est vrai de toute façon, dit une fois : aucun réglage ne change cette
              phrase, et elle n'est pas une option. */}
          <p>{t('settings.privacyText')}</p>

          <Field labelKey="settings.diagnostics">
            <label className="df-switch">
              <input
                type="checkbox"
                checked={settings.diagnostics}
                onChange={(event) => void controller.updateSettings({ diagnostics: event.target.checked })}
              />
              {settings.diagnostics ? t('common.yes') : t('common.no')}
            </label>
          </Field>
          <p className="df-faint">{t('settings.diagnosticsNote')}</p>

          <Field labelKey="settings.hostedSharing">
            <label className="df-switch">
              <input
                type="checkbox"
                checked={settings.allowHostedSharing && state.hostedSharingAvailable}
                disabled={!state.hostedSharingAvailable}
                onChange={(event) => void controller.updateSettings({ allowHostedSharing: event.target.checked })}
              />
              {state.hostedSharingAvailable
                ? settings.allowHostedSharing
                  ? t('common.yes')
                  : t('common.no')
                : t('capabilities.unavailable')}
            </label>
          </Field>
          <p className="df-faint">{t('settings.hostedSharingNote')}</p>
          {!state.hostedSharingAvailable ? (
            <p className="df-faint">{t('settings.hostedSharingUnavailable')}</p>
          ) : null}

          <Field labelKey="settings.historyRetention">
            <select
              className="df-input"
              value={settings.historyRetentionDays}
              onChange={(event) => void controller.updateSettings({ historyRetentionDays: Number(event.target.value) })}
            >
              <option value={0}>{t('settings.keepForever')}</option>
              {[7, 30, 90, 365].map((days) => (
                <option key={days} value={days}>
                  {t('settings.days', { count: days })}
                </option>
              ))}
            </select>
          </Field>

          {state.storageEstimate ? (
            <p className="df-faint">
              {t('settings.storageEstimate', {
                usage: formatBytes(state.storageEstimate.usage, locale),
                quota: formatBytes(state.storageEstimate.quota, locale),
              })}
            </p>
          ) : null}

          {/* Des actions irréversibles : petites, jamais au même poids que le reste, et
              jamais à côté du bouton principal d'un écran. */}
          <div className="df-row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="df-button df-button--small" onClick={() => void controller.exportHistory()}>
              {t('activity.export')}
            </button>
            <button type="button" className="df-button df-button--small" onClick={() => void controller.clearHistory()}>
              {t('activity.deleteAll')}
            </button>
            <button type="button" className="df-button df-button--small" onClick={() => void controller.resetSettings()}>
              {t('settings.reset')}
            </button>
            <button type="button" className="df-button df-button--danger df-button--small" onClick={() => void controller.resetIdentity()}>
              {t('settings.resetIdentity')}
            </button>
          </div>
          <p className="df-faint">{t('settings.resetIdentityNote')}</p>
        </Card>
      </details>

      <Card titleKey="capabilities.title">
        <ul className="df-list">
          <Capability ok={capabilities.webRtc} labelKey="capabilities.hasWebrtc" />
          <Capability ok={capabilities.directoryPicker} labelKey="capabilities.hasDirectoryPicker" />
          <Capability ok={capabilities.directoryRead} labelKey="capabilities.hasDirectoryRead" />
          <Capability ok={capabilities.notifications} labelKey="capabilities.hasNotifications" />
          <Capability ok={capabilities.storageEstimate} labelKey="capabilities.hasStorageEstimate" />
          <Capability ok={capabilities.serviceWorker} labelKey="capabilities.hasServiceWorker" />
          <Capability ok={capabilities.downloadStream} labelKey="capabilities.hasDownloadStream" reasonKey="capabilities.downloadFallbackNote" />
          <Capability ok={capabilities.backgroundTransfer} labelKey="capabilities.hasBackgroundReceive" reasonKey="capabilities.backgroundReceiveNote" />
        </ul>
        <p className="df-faint">{t('capabilities.disclaimer')}</p>
        <p className="df-faint">
          {capabilities.standalone ? t('settings.installed') : t('settings.notInstalled')}
          {capabilities.ios ? ` · ${t('capabilities.iosNote')}` : ''}
        </p>
      </Card>

      <Card titleKey="settings.about">
        <p className="df-faint">{t('settings.aboutText', { version: state.appVersion })}</p>
        <p className="df-faint">{t('settings.license')}</p>

        {state.updateState && state.updateState.kind !== 'idle' ? (
          <p className={state.updateState.kind === 'error' ? 'df-badge df-badge--error' : 'df-faint'} role="status">
            {t(state.updateState.messageKey as never, { version: state.updateState.version ?? '' })}
          </p>
        ) : null}

        <div className="df-row">
          {state.canCheckUpdate ? (
            <>
              <button
                type="button"
                className="df-button df-button--small"
                disabled={state.updateState?.kind === 'checking' || state.updateState?.kind === 'installing'}
                onClick={() => void controller.checkForUpdate()}
              >
                {t('settings.checkUpdate')}
              </button>
              {state.updateState?.kind === 'available' ? (
                <button type="button" className="df-button df-button--primary df-button--small" onClick={() => void controller.installUpdate()}>
                  {t('settings.installUpdate')}
                </button>
              ) : null}
              {state.updateState?.kind === 'ready' ? (
                <button type="button" className="df-button df-button--primary df-button--small" onClick={() => controller.relaunch()}>
                  {t('settings.relaunch')}
                </button>
              ) : null}
            </>
          ) : (
            <p className="df-faint">{t('settings.updateWebNote')}</p>
          )}
        </div>

      </Card>
    </section>
  );
}

/**
 * Where the relay is: this deployment's own, a self-hosted one, or none at all.
 *
 * The three cases are stated as they are, including the one with no relay — in which
 * case the screen says what still works (the local network) instead of leaving a
 * person to discover it from a failed transfer.
 */
function RelayField({ controller, configured }: { controller: AppController; configured: string }): React.ReactElement {
  const { t } = useTranslation();
  const custom = configured !== SIGNALING_AUTO && configured !== SIGNALING_OFF ? configured : '';
  const [draft, setDraft] = useState(custom);
  const resolved = signalingUrlFor(configured);
  const mode = custom.length > 0 ? 'custom' : configured === SIGNALING_OFF ? SIGNALING_OFF : SIGNALING_AUTO;

  const apply = (value: string): void => {
    // A refused address is reported by the controller with its own stable code; the
    // field keeps what was typed so it can be corrected.
    void controller.updateSettings({ signalingUrl: value }).catch(() => undefined);
  };

  return (
    <div className="df-field">
      <span className="df-label">{t('settings.relay')}</span>
      <select className="df-input" value={mode} onChange={(event) => {
        const next = event.target.value;
        if (next === SIGNALING_AUTO || next === SIGNALING_OFF) {
          setDraft('');
          apply(next);
          return;
        }
        apply(custom.length > 0 ? custom : 'wss://relais.example.org/ws');
      }}>
        <option value={SIGNALING_AUTO}>{t('settings.relayAuto')}</option>
        <option value={SIGNALING_OFF}>{t('settings.relayNone')}</option>
        <option value="custom">{t('settings.relayCustom')}</option>
      </select>
      {mode === 'custom' ? (
        <div className="df-row" style={{ marginTop: SPACE.sm }}>
          <input
            className="df-input"
            value={draft}
            spellCheck={false}
            autoComplete="off"
            placeholder="wss://relais.example.org/ws"
            onChange={(event) => setDraft(event.target.value)}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="df-button df-button--small"
            disabled={draft.trim().length === 0}
            onClick={() => apply(draft.trim())}
          >
            {t('settings.relayApply')}
          </button>
        </div>
      ) : null}
      <p className="df-faint" style={{ marginTop: SPACE.sm }}>
        {resolved.length > 0
          ? t('settings.relayResolved', { url: resolved })
          : t('settings.relayAbsent')}
      </p>
      <p className="df-faint">{t('settings.relayNote')}</p>
    </div>
  );
}

function Card({ titleKey, children }: { titleKey: string; children: React.ReactNode }): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="df-card" style={{ marginBottom: SPACE.lg }}>
      <h2 className="df-section-title">{t(titleKey as never)}</h2>
      <div style={{ display: 'grid', gap: SPACE.md }}>{children}</div>
    </div>
  );
}

function Field({ labelKey, children }: { labelKey: string; children: React.ReactNode }): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="df-field">
      <span className="df-label">{t(labelKey as never)}</span>
      {children}
    </div>
  );
}

function Capability({ ok, labelKey, reasonKey }: { ok: boolean; labelKey: string; reasonKey?: string }): React.ReactElement {
  const { t } = useTranslation();
  return (
    <li className="df-row df-row--between">
      <span>{t(labelKey as never)}</span>
      <span className={`df-badge df-badge--${ok ? 'ok' : 'warn'}`}>
        {ok ? t('capabilities.available') : t('capabilities.unavailable')}
        {!ok && reasonKey ? <span className="df-faint"> · {t(reasonKey as never)}</span> : null}
      </span>
    </li>
  );
}
