/**
 * Settings screen.
 *
 * Every control here is wired to a preference the code actually reads, and every
 * capability is displayed as the platform really behaves — including the cases
 * where the answer is "the browser cannot do this", which is stated instead of
 * being hidden behind a switch that would do nothing.
 */
import { useTranslation } from 'react-i18next';
import { SPACE, formatBytes } from '@dropforge/design-system';
import type { AppController, AppState } from '../app/controller.js';
import { PageHeader } from '../components/atoms.js';

export function SettingsScreen({ controller, state }: { controller: AppController; state: AppState }): React.ReactElement {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === 'en' ? 'en' : 'fr';
  const settings = state.settings;
  const capabilities = state.capabilities;
  const isDesktop = capabilities.platform === 'windows' || capabilities.platform === 'macos' || capabilities.platform === 'linux';

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

        <Field labelKey="settings.autostart">
          <label className="df-switch">
            <input
              type="checkbox"
              checked={settings.autostart}
              disabled={!isDesktop}
              onChange={(event) => void controller.updateSettings({ autostart: event.target.checked })}
            />
            {isDesktop ? t('common.yes') : t('capabilities.unavailable')}
          </label>
          {!isDesktop ? <p className="df-faint">{t('settings.autostartWindowsOnly')}</p> : null}
        </Field>

        <Field labelKey="settings.closeBehaviour">
          <select
            className="df-input"
            value={settings.closeBehaviour}
            disabled={!isDesktop}
            onChange={(event) => void controller.updateSettings({ closeBehaviour: event.target.value as 'tray' | 'quit' })}
          >
            <option value="tray">{t('settings.closeTray')}</option>
            <option value="quit">{t('settings.closeQuit')}</option>
          </select>
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

      <Card titleKey="settings.privacy">
        <p>{t('settings.privacyText')}</p>
        <p className="df-faint">{t('settings.diagnosticsNote')}</p>

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

        <Field labelKey="settings.hostedSharing">
          <label className="df-switch">
            <input
              type="checkbox"
              checked={settings.allowHostedSharing}
              onChange={(event) => void controller.updateSettings({ allowHostedSharing: event.target.checked })}
            />
            {settings.allowHostedSharing ? t('common.yes') : t('common.no')}
          </label>
        </Field>
        <p className="df-faint">{t('settings.hostedSharingNote')}</p>

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
        </div>
      </Card>

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

        <div className="df-row" style={{ marginTop: SPACE.sm }}>
          <button type="button" className="df-button df-button--danger df-button--small" onClick={() => void controller.resetIdentity()}>
            {t('settings.resetIdentity')}
          </button>
        </div>
        <p className="df-faint">{t('settings.resetIdentityNote')}</p>
      </Card>
    </section>
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
