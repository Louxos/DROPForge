/**
 * Transfer screen.
 *
 * The first thing it shows is a **choice of two**: send, or receive. Everything else —
 * picking files, choosing a destination, showing a pairing code, the queue — comes
 * after that choice, one step at a time. The previous version put all of it on one
 * page at once: a drop zone, a quick-send bar, a hosting code, a code input, the method
 * explanations and the queue. Nothing was hidden, and nothing was clear.
 *
 * What has not changed, and must not: every fact on screen comes from the controller.
 * An unreachable device is not offered, a code is only shown once the room really
 * exists, and a missing relay is stated plainly instead of turning into a red banner
 * that says nothing about what to do.
 */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SPACE } from '@dropforge/design-system';
import { formatBytes } from '@dropforge/design-system';
import { SIGNALING_OFF } from '@dropforge/settings';
import { pickFolder, sourcesFromDataTransfer, sourcesFromFileList } from '../platform/browser-fs.js';
import { signalingUrlFor } from '../platform/signaling.js';
import type { AppController, AppState } from '../app/controller.js';
import { EmptyState, PageHeader, ProgressView, StateBadge } from '../components/atoms.js';
import { QrCode } from '../components/qr.js';
import type { SourceFile } from '@dropforge/app-core';

/** The three faces of this screen. The first render is always the choice. */
type Step = 'choose' | 'send' | 'receive';

export function TransferScreen({ controller, state }: { controller: AppController; state: AppState }): React.ReactElement {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === 'en' ? 'en' : 'fr';
  const [step, setStep] = useState<Step>('choose');
  const [pending, setPending] = useState<SourceFile[]>([]);
  const [code, setCode] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<'files' | 'folder' | 'connect' | undefined>();
  /**
   * Whether a relay exists at all. The receiving step is where this decides something:
   * with no relay, two devices that are not on the same network cannot be introduced to
   * each other — so the screen says so *before* anyone waits for a code that will never
   * be answered.
   */
  const relay = signalingUrlFor(state.settings.signalingUrl);
  // The native picker lives in a hidden input; the visible control is a real button,
  // so it has a button's role, its keyboard behaviour and its press feedback.
  const fileInput = useRef<HTMLInputElement>(null);

  const adopt = (files: SourceFile[]): void => {
    setPending(files);
    controller.setSelection(files.map((file) => ({ path: file.path, kind: file.kind, size: file.size })));
  };

  const onFiles = async (list: FileList | null): Promise<void> => {
    if (!list || list.length === 0) return;
    setBusy('files');
    try {
      adopt(await sourcesFromFileList(list));
    } finally {
      setBusy(undefined);
    }
  };

  const onFolder = async (): Promise<void> => {
    setBusy('folder');
    try {
      const picked = await pickFolder();
      if (picked) adopt(picked);
    } catch {
      /* the picker was dismissed or refused: nothing to say, nothing broken */
    } finally {
      setBusy(undefined);
    }
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
    setBusy('connect');
    try {
      await controller.connectWithCode(code);
    } finally {
      setBusy(undefined);
    }
  };

  const clearSelection = (): void => {
    setPending([]);
    controller.clearSelection();
  };

  const sendToDevice = async (deviceId: string): Promise<void> => {
    setBusy('connect');
    try {
      const transferId = await controller.quickSend(deviceId, pending);
      if (transferId) {
        clearSelection();
        setStep('choose');
      }
    } finally {
      setBusy(undefined);
    }
  };

  // A live connection leaves nothing to choose: what remains to be done is to send,
  // so the screen is the send step with the peer panel above it — stated once, at the
  // top, instead of asking a question whose answer is already known.
  const connected = state.connection !== undefined;
  const activeStep: Step = connected ? 'send' : step;

  return (
    <section>
      <PageHeader titleKey="transfer.title" subtitleKey="transfer.chooseSubtitle" />

      {connected ? (
        <ConnectedPanel
          state={state}
          pending={pending}
          onSend={() => {
            void controller.sendSelection(pending).then(() => clearSelection());
          }}
          onDisconnect={() => controller.disconnect()}
        />
      ) : null}

      {!connected && step !== 'choose' ? (
        <button type="button" className="df-back" onClick={() => setStep('choose')}>
          <span aria-hidden="true">←</span> {t('transfer.back')}
        </button>
      ) : null}

      {!connected ? (
        <>
          {activeStep === 'choose' ? (
            <div className="df-choices">
              <button type="button" className="df-choice" onClick={() => setStep('send')}>
                <span className="df-choice__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                    <path d="M12 17V5m0 0-4.5 4.5M12 5l4.5 4.5M5 20h14" />
                  </svg>
                </span>
                <span className="df-choice__text">
                  <strong>{t('transfer.sendTitle')}</strong>
                  <span className="df-faint">{t('transfer.sendSubtitle')}</span>
                </span>
              </button>
              <button type="button" className="df-choice" onClick={() => setStep('receive')}>
                <span className="df-choice__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                    <path d="M12 4v12m0 0-4.5-4.5M12 16l4.5-4.5M5 20h14" />
                  </svg>
                </span>
                <span className="df-choice__text">
                  <strong>{t('transfer.receiveTitle')}</strong>
                  <span className="df-faint">{t('transfer.receiveSubtitle')}</span>
                </span>
              </button>
            </div>
          ) : null}

          {/* The entry screen also states the facts that decide which of the two is
              possible: with no device known, sending needs a code first — and with no
              relay configured, only devices on the same network can be reached. Said
              once, quietly: not as an error, and never as an invented destination. */}
          {activeStep === 'choose' && state.devices.length === 0 ? (
            <p className="df-faint">{t('transfer.noDevices')}</p>
          ) : null}
          {activeStep === 'choose' && relay.length === 0 ? (
            <p className="df-faint">
              {state.settings.signalingUrl === SIGNALING_OFF ? t('relay.disabled') : t('relay.none')}{' '}
              {t('relay.note')}
            </p>
          ) : null}

          {activeStep === 'send' ? (
            <section className="df-step" aria-label={t('transfer.sendTitle')}>
              <div
                className={`df-card df-dropzone${dragging ? ' df-dropzone--active' : ''}`}
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
                  <button
                    type="button"
                    className={`df-button df-button--primary${busy === 'files' ? ' df-button--busy' : ''}`}
                    onClick={() => fileInput.current?.click()}
                  >
                    {t('transfer.selectFiles')}
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    hidden
                    onChange={(event) => void onFiles(event.target.files)}
                  />
                  {state.capabilities.directoryRead ? (
                    <button
                      type="button"
                      className={`df-button${busy === 'folder' ? ' df-button--busy' : ''}`}
                      disabled={busy === 'folder'}
                      onClick={() => void onFolder()}
                    >
                      {t('transfer.selectFolder')}
                    </button>
                  ) : null}
                  {pending.length > 0 ? (
                    <button type="button" className="df-button df-button--ghost" onClick={clearSelection}>
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
              </div>

              {/* Nothing to choose while connected: the panel above carries the peer,
                  the method and the send button. */}
              {connected ? null : (
                <>
                  <h2 className="df-section-title" style={{ marginTop: SPACE.xl }}>
                    {t('transfer.toWhichDevice')}
                  </h2>

                  {/* An honest empty state: with nothing paired and nothing discovered,
                      the screen says so — it does not offer a destination that does not
                      exist. */}
                  {state.devices.length === 0 ? <p className="df-faint">{t('transfer.noDevices')}</p> : null}

                  {pending.length === 0 && state.devices.length > 0 ? (
                    <p className="df-faint">{t('transfer.pickFirst')}</p>
                  ) : null}

                  {state.devices.length > 0 ? (
                    <ul className="df-list">
                      {state.devices.map((device) => (
                        <li
                          key={device.id}
                          className="df-card df-card--tight df-row df-row--between"
                          style={{ alignItems: 'center' }}
                        >
                          <span>
                            <strong>{device.displayName}</strong>
                            {device.favorite ? (
                              <span className="df-badge" style={{ marginLeft: SPACE.sm }}>
                                {t('devices.favorite')}
                              </span>
                            ) : null}
                          </span>
                          <button
                            type="button"
                            className="df-button df-button--small df-button--primary"
                            disabled={pending.length === 0 || busy === 'connect' || state.connecting}
                            onClick={() => void sendToDevice(device.id)}
                          >
                            {t('transfer.sendTo')}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {/* A code also works from this side: the connection is symmetric, and
                      someone who was handed a code should not have to guess that it only
                      works from the « Recevoir » screen. */}
                  {pending.length > 0 ? (
                    <div className="df-field" style={{ marginTop: SPACE.lg }}>
                      <label className="df-label" htmlFor="df-send-code">
                        {t('transfer.orCode')}
                      </label>
                      <div className="df-row">
                        <input
                          id="df-send-code"
                          className="df-input"
                          value={code}
                          onChange={(event) => setCode(event.target.value)}
                          autoComplete="off"
                          spellCheck={false}
                          style={{ flex: 1 }}
                          placeholder={t('transfer.codePlaceholder')}
                        />
                        <button
                          type="button"
                          className={`df-button${busy === 'connect' ? ' df-button--busy' : ''}`}
                          disabled={state.connecting || code.trim().length === 0}
                          onClick={() => void connect()}
                        >
                          {t('transfer.connect')}
                        </button>
                      </div>
                      <p className="df-faint" style={{ marginTop: SPACE.sm }}>
                        {t('transfer.orCodeHint')}
                      </p>
                    </div>
                  ) : null}
                </>
              )}

            </section>
          ) : null}

          {activeStep === 'receive' ? (
            <section className="df-step" aria-label={t('transfer.receiveTitle')}>
              {state.pairingRoom ? (
                <div className="df-card df-pairing">
                  <div className="df-pairing__head">
                    <h2 className="df-section-title" style={{ margin: 0 }}>
                      {t('transfer.pairingCode')}
                    </h2>
                    <span className="df-faint">{t('transfer.hostingHint')}</span>
                  </div>
                  <div className="df-mono df-code">{state.pairingRoom.code}</div>
                  <div className="df-pairing__body">
                    <div style={{ flex: 1, minWidth: 240 }}>
                      <div className="df-row">
                        <input className="df-input" readOnly value={state.pairingRoom.link} style={{ flex: 1 }} />
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
                      <p className="df-faint" style={{ marginTop: SPACE.md }}>
                        {t('transfer.waitingPeer')}
                      </p>
                    </div>
                    <QrCode value={state.pairingRoom.link} label={t('transfer.qrAlt')} />
                  </div>
                </div>
              ) : (
                <div className="df-card">
                  <h2 className="df-section-title" style={{ marginTop: 0 }}>
                    {t('transfer.receiveTitle')}
                  </h2>
                  <p className="df-faint" style={{ marginTop: 0 }}>
                    {t('transfer.receiveDeviceHint')}
                  </p>
                  <button
                    type="button"
                    className="df-button df-button--primary"
                    onClick={() => void controller.hostRoom()}
                  >
                    {t('transfer.receiveDevice')}
                  </button>
                </div>
              )}

              {relay.length === 0 ? (
                <p className="df-badge df-badge--warn" style={{ marginTop: SPACE.lg }}>
                  {state.settings.signalingUrl === SIGNALING_OFF ? t('relay.disabled') : t('relay.none')}
                  {' '}
                  {t('relay.note')}
                </p>
              ) : null}

              <div className="df-field" style={{ marginTop: SPACE.xl }}>
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
                    placeholder={t('transfer.codePlaceholder')}
                  />
                  <button
                    type="button"
                    className={`df-button${busy === 'connect' ? ' df-button--busy' : ''}`}
                    disabled={state.connecting || code.trim().length === 0}
                    onClick={() => void connect()}
                  >
                    {t('transfer.connect')}
                  </button>
                </div>
                <p className="df-faint" style={{ marginTop: SPACE.sm }}>
                  {t('transfer.pasteCodeHint')}
                </p>
              </div>

              {state.methodExplanation.length > 0 ? (
                <p className="df-faint" style={{ marginTop: SPACE.md }}>
                  {state.methodExplanation.map((key) => t(key as never)).join(' · ')}
                </p>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}

      {state.newDevice ? (
        <div className="df-card df-dialog" role="dialog" aria-modal="true" style={{ marginTop: SPACE.xl }}>
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
        <div className="df-card df-dialog" role="dialog" aria-modal="true" style={{ marginTop: SPACE.xl }}>
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
                      {(['skip', 'rename', 'overwrite'] as const).map((action) => (
                        <button
                          key={action}
                          type="button"
                          className="df-button df-button--small"
                          onClick={() =>
                            controller.answerIncoming({
                              accepted: true,
                              decisions: decisionsFor(state, action),
                            })
                          }
                        >
                          {action === 'skip'
                            ? t('transfer.conflictAskSkip')
                            : action === 'rename'
                              ? t('transfer.conflictAskRename')
                              : t('transfer.conflictAskReplace')}
                        </button>
                      ))}
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

      <h2 className="df-section-title" style={{ marginTop: SPACE.xxl }}>
        {t('transfer.queue')}
      </h2>
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
              {/* Why it failed, in the row itself. A red « Échec » without a reason
                  leaves the person with nothing to act on — and the reason is already
                  known (the engine reported a stable code), so hiding it behind the
                  history screen is a choice, not a limitation. */}
              {entry.errorCode ? (
                <p className="df-badge df-badge--error" style={{ marginTop: SPACE.sm }}>
                  {t(`errors.${entry.errorCode}` as never)}
                </p>
              ) : null}
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
 * The connected panel: a device is on the line, so the only question left is whether
 * to send what is selected. It keeps the same facts as before — the peer, the method
 * actually chosen, and the code to compare — in one row.
 */
function ConnectedPanel({
  state,
  pending,
  onSend,
  onDisconnect,
}: {
  state: AppState;
  pending: SourceFile[];
  onSend: () => void;
  onDisconnect: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const connection = state.connection;
  const method =
    connection?.method === 'lan'
      ? t('transfer.methodLan')
      : connection?.method === 'webrtc'
        ? t('transfer.methodWebrtc')
        : t('transfer.methodRelay');
  return (
    <section className="df-card df-connected" aria-label={t('transfer.connected')}>
      <div className="df-connected__head">
        <div>
          <div className="df-connected__peer">{connection?.peerName}</div>
          <div className="df-faint">
            {t('transfer.method')} : {method} · {t('transfer.compareCode')}{' '}
            <span className="df-mono">{connection?.sas}</span>
          </div>
        </div>
        <button type="button" className="df-button df-button--ghost df-button--small" onClick={onDisconnect}>
          {t('common.close')}
        </button>
      </div>
      <div className="df-row" style={{ marginTop: SPACE.lg, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="df-button df-button--primary"
          disabled={pending.length === 0}
          onClick={onSend}
        >
          {t('transfer.sendTo')}
        </button>
        <span className="df-faint">
          {pending.length === 0 ? t('transfer.pickFirst') : t('transfer.selected', { count: pending.length, size: '' })}
        </span>
      </div>
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
