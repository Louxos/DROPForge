/**
 * Transfer screen: pick files, pick a path, watch the queue, and answer the two
 * questions DropForge always asks (a new device, an incoming transfer).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SPACE } from '@dropforge/design-system';
import { formatBytes } from '@dropforge/design-system';
import { pickFolder, sourcesFromDataTransfer, sourcesFromFileList } from '../platform/browser-fs.js';
import type { AppController, AppState } from '../app/controller.js';
import { EmptyState, PageHeader, ProgressView, StateBadge } from '../components/atoms.js';
import { QrCode } from '../components/qr.js';
import type { SourceFile } from '@dropforge/app-core';

export function TransferScreen({ controller, state }: { controller: AppController; state: AppState }): React.ReactElement {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === 'en' ? 'en' : 'fr';
  const [pending, setPending] = useState<SourceFile[]>([]);
  const [code, setCode] = useState('');
  const [dragging, setDragging] = useState(false);

  const adopt = (files: SourceFile[]): void => {
    setPending(files);
    controller.setSelection(files.map((file) => ({ path: file.path, kind: file.kind, size: file.size })));
  };

  const onFiles = async (list: FileList | null): Promise<void> => {
    if (!list || list.length === 0) return;
    adopt(await sourcesFromFileList(list));
  };

  /**
   * Dropped content goes through the same checks as picked content: what the browser
   * could not read is reported, never silently replaced by something else.
   */
  const onDrop = async (drop: DataTransfer): Promise<void> => {
    setDragging(false);
    const { sources, foldersRead } = await sourcesFromDataTransfer(drop);
    if (sources.length === 0) {
      controller.reportNotice('warning', 'transfer.dropNothing');
      return;
    }
    // `foldersRead` is false when the browser has no entry API: the dropped *files*
    // are still complete, so nothing is announced for them.
    void foldersRead;
    adopt(sources);
  };

  const connect = async (): Promise<void> => {
    await controller.connectWithCode(code);
  };

  return (
    <section>
      <PageHeader titleKey="transfer.title" subtitleKey="transfer.subtitle" />

      <div
        className={`df-card df-dropzone${dragging ? ' df-dropzone--active' : ''}`}
        style={{ marginBottom: SPACE.xl }}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          // Leaving for a child element is not leaving the zone.
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          void onDrop(event.dataTransfer);
        }}
      >
        <div className="df-row" style={{ flexWrap: 'wrap' }}>
          <label className="df-button df-button--primary">
            {t('transfer.selectFiles')}
            <input
              type="file"
              multiple
              hidden
              onChange={(event) => void onFiles(event.target.files)}
            />
          </label>
          {state.capabilities.directoryRead ? (
            <button
              type="button"
              className="df-button"
              onClick={() => void pickFolder().then(adopt).catch(() => undefined)}
            >
              {t('transfer.selectFolder')}
            </button>
          ) : null}
          {pending.length > 0 ? (
            <button type="button" className="df-button df-button--ghost" onClick={() => { setPending([]); controller.clearSelection(); }}>
              {t('transfer.clear')}
            </button>
          ) : null}
        </div>

        <p className="df-faint" style={{ marginTop: SPACE.md }}>
          {t('transfer.dropHint')}
        </p>
        {pending.length > 0 ? (
          <p style={{ marginTop: SPACE.sm }}>
            {t('transfer.selected', {
              count: pending.length,
              size: formatBytes(pending.reduce((sum, file) => sum + file.size, 0), locale),
            })}
          </p>
        ) : null}

        {state.devices.some((device) => device.favorite) ? (
          <div style={{ marginTop: SPACE.lg }}>
            <div className="df-label">{t('transfer.quickSend')}</div>
            <div className="df-row" style={{ flexWrap: 'wrap', marginTop: SPACE.sm }}>
              {state.devices
                .filter((device) => device.favorite)
                .map((device) => (
                  <button
                    key={device.id}
                    type="button"
                    className="df-button df-button--small"
                    disabled={pending.length === 0 || state.connecting}
                    title={device.displayName}
                    onClick={() =>
                      void controller
                        .quickSend(device.id, pending)
                        .then((transferId) => {
                          if (!transferId) return;
                          setPending([]);
                          controller.clearSelection();
                        })
                        .catch(() => undefined)
                    }
                  >
                    {device.displayName}
                  </button>
                ))}
            </div>
            <p className="df-faint" style={{ marginTop: SPACE.sm }}>
              {t('transfer.quickSendHint')}
            </p>
          </div>
        ) : null}

        <div style={{ marginTop: SPACE.lg }}>
          {state.connection ? (
            <div className="df-row df-row--between">
              <div>
                <div style={{ fontWeight: 600 }}>{state.connection.peerName}</div>
                <div className="df-faint">
                  {t('transfer.method')} :{' '}
                  {state.connection.method === 'lan'
                    ? t('transfer.methodLan')
                    : state.connection.method === 'webrtc'
                      ? t('transfer.methodWebrtc')
                      : t('transfer.methodRelay')}{' '}
                  · {t('transfer.compareCode')} <span className="df-mono">{state.connection.sas}</span>
                </div>
              </div>
              <div className="df-row">
                <button
                  type="button"
                  className="df-button df-button--primary"
                  disabled={pending.length === 0}
                  onClick={() => void controller.sendSelection(pending).then(() => controller.clearSelection()).then(() => setPending([]))}
                >
                  {t('transfer.sendTo')}
                </button>
                <button type="button" className="df-button df-button--ghost" onClick={() => controller.disconnect()}>
                  {t('common.close')}
                </button>
              </div>
            </div>
          ) : (
            <div>
              {state.pairingRoom ? (
                <div>
                  <div className="df-label">{t('transfer.hosting')}</div>
              <p className="df-faint" style={{ marginTop: SPACE.xs }}>
                {t('transfer.hostingHint')}
              </p>
              <div className="df-row df-row--between" style={{ marginTop: SPACE.md, flexWrap: 'wrap', gap: SPACE.lg }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div className="df-label">{t('transfer.pairingCode')}</div>
                  <div className="df-mono df-code" style={{ fontSize: 28, letterSpacing: 4 }}>
                    {state.pairingRoom.code}
                  </div>
                  <div className="df-row" style={{ marginTop: SPACE.md, flexWrap: 'wrap' }}>
                    <input className="df-input" readOnly value={state.pairingRoom.link} style={{ flex: 1, minWidth: 180 }} />
                    <button
                      type="button"
                      className="df-button df-button--small"
                      onClick={() => {
                        // The clipboard is a permission the browser can refuse: a refusal
                        // is reported, never hidden behind a "copied" message.
                        void navigator.clipboard
                          ?.writeText(state.pairingRoom?.link ?? '')
                          .then(() => controller.reportNotice('success', 'transfer.linkCopied'))
                          .catch(() => controller.reportNotice('warning', 'transfer.copyLink'));
                      }}
                    >
                      {t('transfer.copyLink')}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="df-button df-button--ghost df-button--small"
                    style={{ marginTop: SPACE.md }}
                    onClick={() => void controller.closeHostedRoom()}
                  >
                    {t('transfer.closeRoom')}
                  </button>
                </div>
                  <QrCode value={state.pairingRoom.link} label={t('transfer.qrAlt')} />
                </div>
              </div>
              ) : (
                <div>
                  <button type="button" className="df-button" onClick={() => void controller.hostRoom()}>
                    {t('transfer.receiveDevice')}
                  </button>
                  <p className="df-faint" style={{ marginTop: SPACE.sm }}>
                    {t('transfer.receiveDeviceHint')}
                  </p>
                </div>
              )}
              <div className="df-field" style={{ marginTop: SPACE.lg }}>
                <label className="df-label" htmlFor="df-code">
                  {t('transfer.pasteCode')}
                </label>
                <div className="df-row">
                  <input
                    id="df-code"
                    className="df-input"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    style={{ flex: 1 }}
                  />
                  <button type="button" className="df-button" disabled={state.connecting || code.trim().length === 0} onClick={() => void connect()}>
                    {t('transfer.connect')}
                  </button>
                </div>
              </div>
              {state.methodExplanation.length > 0 ? (
                <p className="df-faint">{state.methodExplanation.map((key) => t(key as never)).join(' · ')}</p>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {state.newDevice ? (
        <div className="df-card" role="dialog" aria-modal="true">
          <h2 className="df-section-title">{t('transfer.confirmDevice')}</h2>
          <p>{t('transfer.confirmDeviceHint')}</p>
          <div className="df-sas" aria-label={t('transfer.compareCode')}>
            <span>{state.newDevice.sas || '–'}</span>
          </div>
          <p className="df-faint df-mono">{state.newDevice.fingerprint.slice(0, 32)}…</p>
          <div className="df-row" style={{ marginTop: SPACE.lg }}>
            <button type="button" className="df-button df-button--primary" onClick={() => controller.answerNewDevice(true, true)}>
              {t('transfer.accept')}
            </button>
            <button type="button" className="df-button df-button--danger" onClick={() => controller.answerNewDevice(false, false)}>
              {t('transfer.refuse')}
            </button>
          </div>
        </div>
      ) : null}

      {state.incoming ? (
        <div className="df-card" role="dialog" aria-modal="true" style={{ marginBottom: SPACE.xl }}>
          <h2 className="df-section-title">{t('transfer.incomingRequest')}</h2>
          <p>
            {state.incoming.peerName} ·{' '}
            {t('transfer.incomingFiles', {
              count: state.incoming.files.length,
              size: formatBytes(state.incoming.totalBytes, locale),
            })}
          </p>
          {state.incoming.conflicts.length > 0 ? (
            <div>
              <p className="df-badge df-badge--warn">{t('transfer.conflictsFound')}</p>
              <ul className="df-list" style={{ marginTop: SPACE.sm }}>
                {state.incoming.conflicts.slice(0, 5).map((conflict) => (
                  <li key={conflict.index} className="df-row df-row--between">
                    <span className="df-mono">{conflict.path}</span>
                    <span className="df-row">
                      <button
                        type="button"
                        className="df-button df-button--small"
                        onClick={() =>
                          controller.answerIncoming({
                            accepted: true,
                            decisions: decisionsFor(state, 'skip'),
                          })
                        }
                      >
                        {t('transfer.conflictAskSkip')}
                      </button>
                      <button
                        type="button"
                        className="df-button df-button--small"
                        onClick={() =>
                          controller.answerIncoming({
                            accepted: true,
                            decisions: decisionsFor(state, 'rename'),
                          })
                        }
                      >
                        {t('transfer.conflictAskRename')}
                      </button>
                      <button
                        type="button"
                        className="df-button df-button--small"
                        onClick={() =>
                          controller.answerIncoming({
                            accepted: true,
                            decisions: decisionsFor(state, 'overwrite'),
                          })
                        }
                      >
                        {t('transfer.conflictAskReplace')}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="df-faint">{formatBytes(state.incoming.totalBytes, locale)}</p>
          )}
          <div className="df-row" style={{ marginTop: SPACE.lg }}>
            <button
              type="button"
              className="df-button df-button--primary"
              onClick={() => controller.answerIncoming({ accepted: true, decisions: [] })}
            >
              {t('transfer.accept')}
            </button>
            <button
              type="button"
              className="df-button df-button--danger"
              onClick={() => controller.answerIncoming({ accepted: false, decisions: [], rejectReason: 'declined' })}
            >
              {t('transfer.refuse')}
            </button>
          </div>
        </div>
      ) : null}

      <h2 className="df-section-title">{t('transfer.queue')}</h2>
      {state.queue.length === 0 ? (
        <EmptyState messageKey="transfer.emptyQueue" />
      ) : (
        <ul className="df-list">
          {state.queue.map((entry, position) => (
            <li key={entry.id} className="df-card df-card--tight">
              <div className="df-row df-row--between">
                <span style={{ fontWeight: 600 }}>{entry.label}</span>
                <StateBadge state={entry.state} paused={entry.paused} />
              </div>
              <div style={{ marginTop: SPACE.sm }}>
                <ProgressView
                  state={entry.state}
                  bytesDone={entry.progress?.bytesDone ?? 0}
                  totalBytes={entry.totalBytes}
                  bytesPerSecond={entry.progress?.bytesPerSecond}
                  etaSeconds={entry.progress?.etaSeconds}
                  reliable={entry.progress?.reliable ?? false}
                  filesDone={entry.progress?.filesDone ?? 0}
                  filesTotal={entry.filesTotal}
                />
              </div>
              <div className="df-row" style={{ marginTop: SPACE.sm, flexWrap: 'wrap' }}>
                {entry.paused ? (
                  <button type="button" className="df-button df-button--small" onClick={() => controller.resumeTransfer(entry.id)}>
                    {t('transfer.resume')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="df-button df-button--small"
                    disabled={entry.state === 'completed' || entry.state === 'cancelled'}
                    onClick={() => controller.pauseTransfer(entry.id)}
                  >
                    {t('transfer.pause')}
                  </button>
                )}
                <button
                  type="button"
                  className="df-button df-button--small"
                  disabled={entry.state === 'completed' || entry.state === 'cancelled'}
                  onClick={() => void controller.cancelTransfer(entry.id)}
                >
                  {t('transfer.cancel')}
                </button>
                {entry.state === 'failed' || entry.state === 'interrupted' ? (
                  <button type="button" className="df-button df-button--small" onClick={() => controller.retryTransfer(entry.id)}>
                    {t('transfer.retry')}
                  </button>
                ) : null}
                <button type="button" className="df-button df-button--small" onClick={() => controller.moveTransfer(entry.id, Math.max(0, position - 1))}>
                  {t('transfer.moveUp')}
                </button>
                <button type="button" className="df-button df-button--small" onClick={() => controller.moveTransfer(entry.id, position + 1)}>
                  {t('transfer.moveDown')}
                </button>
                <button type="button" className="df-button df-button--ghost df-button--small" onClick={() => controller.removeTransfer(entry.id)}>
                  {t('transfer.remove')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Builds the answering decisions for every conflict at once: one button per
 * policy, applied to all of them, which is what the user sees in the dialog.
 */
function decisionsFor(
  state: AppState,
  action: 'skip' | 'rename' | 'overwrite',
): Array<{ index: number; action: 'skip' | 'rename' | 'overwrite' }> {
  return (state.incoming?.conflicts ?? []).map((conflict) => ({ index: conflict.index, action }));
}
