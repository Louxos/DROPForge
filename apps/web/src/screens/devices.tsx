/**
 * Devices screen: what this installation knows, what it trusts, and how to take
 * that trust back. The fingerprint is shown for every device, because that — not
 * the name — is what identifies it.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SPACE, formatDateTime, shortFingerprint } from '@dropforge/design-system';
import type { AppController, AppState } from '../app/controller.js';
import { EmptyState, PageHeader } from '../components/atoms.js';

export function DevicesScreen({ controller, state }: { controller: AppController; state: AppState }): React.ReactElement {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === 'en' ? 'en' : 'fr';
  const [renaming, setRenaming] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState('');

  return (
    <section>
      <PageHeader titleKey="devices.title" subtitleKey="devices.subtitle" />

      {state.discovered.length > 0 ? (
        <>
          <h2 className="df-section-title">{t('transfer.waitingPeer')}</h2>
          <ul className="df-list" style={{ marginBottom: SPACE.xl }}>
            {state.discovered.map((peer) => (
              <li key={peer.deviceId} className="df-card df-card--tight df-row df-row--between">
                <span>
                  <strong>{peer.displayName}</strong>
                  <span className="df-faint"> · {peer.platform}</span>
                </span>
                <button
                  type="button"
                  className="df-button df-button--small"
                  onClick={() =>
                    void controller.connect({
                      deviceId: peer.deviceId,
                      displayName: peer.displayName,
                      ...(peer.fingerprint ? { fingerprint: peer.fingerprint } : {}),
                      // Presence is a hint: the local network is tried first, then
                      // the relay, and the manager reports what really happened.
                      methods: peer.capabilities.includes('webrtc.direct') ? ['lan', 'webrtc', 'relay'] : ['relay'],
                      ...(peer.route ? { route: peer.route } : {}),
                    })
                  }
                >
                  {t('transfer.connect')}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {state.devices.length === 0 ? (
        <EmptyState messageKey="devices.empty" />
      ) : (
        <ul className="df-list">
          {state.devices.map((device) => (
            <li key={device.id} className="df-card">
              <div className="df-row df-row--between">
                <div>
                  {renaming === device.id ? (
                    <div className="df-row">
                      <input className="df-input" value={draft} onChange={(event) => setDraft(event.target.value)} />
                      <button
                        type="button"
                        className="df-button df-button--small"
                        onClick={() => {
                          void controller.renameDevice(device.id, draft).then(() => setRenaming(undefined));
                        }}
                      >
                        {t('common.confirm')}
                      </button>
                      <button type="button" className="df-button df-button--ghost df-button--small" onClick={() => setRenaming(undefined)}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  ) : (
                    <strong>{device.displayName}</strong>
                  )}
                  <div className="df-faint">
                    <span className="df-mono" title={device.fingerprint}>
                      {t('devices.fingerprint')} {shortFingerprint(device.fingerprint)}
                    </span>
                    {' · '}
                    {t('devices.lastSeen', { when: formatDateTime(device.lastSeenAt, locale) })}
                  </div>
                </div>
                <span
                  className={`df-badge ${
                    device.revokedAt !== undefined ? 'df-badge--error' : device.trusted ? 'df-badge--ok' : ''
                  }`}
                >
                  {device.revokedAt !== undefined
                    ? t('devices.revoked')
                    : device.trusted
                      ? t('devices.trusted')
                      : t('devices.untrusted')}
                </span>
              </div>

              {device.revokedAt !== undefined ? <p className="df-faint">{t('devices.revokedNotice')}</p> : null}

              <div className="df-row" style={{ marginTop: SPACE.md, flexWrap: 'wrap' }}>
                {!device.trusted || device.revokedAt !== undefined ? (
                  <button
                    type="button"
                    className="df-button df-button--small"
                    onClick={() => void controller.trustDevice(device.id, device.autoAccept)}
                  >
                    {t('devices.trust')}
                  </button>
                ) : (
                  <button type="button" className="df-button df-button--small" onClick={() => void controller.revokeDevice(device.id)}>
                    {t('devices.revoke')}
                  </button>
                )}
                {device.trusted ? (
                  <label className="df-switch df-faint">
                    <input
                      type="checkbox"
                      checked={device.autoAccept}
                      onChange={(event) => void controller.trustDevice(device.id, event.target.checked)}
                    />
                    {t('devices.autoAccept')}
                  </label>
                ) : null}
                <button
                  type="button"
                  className="df-button df-button--small"
                  aria-pressed={device.favorite === true}
                  onClick={() => void controller.toggleFavorite(device.id)}
                >
                  {device.favorite === true ? `★ ${t('devices.unmarkFavorite')}` : `☆ ${t('devices.markFavorite')}`}
                </button>
                <button
                  type="button"
                  className="df-button df-button--small"
                  onClick={() => {
                    setRenaming(device.id);
                    setDraft(device.displayName);
                  }}
                >
                  {t('devices.rename')}
                </button>
                <button
                  type="button"
                  className="df-button df-button--danger df-button--small"
                  onClick={() => void controller.forgetDevice(device.id)}
                >
                  {t('devices.remove')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
