/**
 * Small presentational pieces, in the app so the design-system package stays
 * framework-free. Every one of them renders *state it is given*: none of them
 * invents a progress value, a speed or a success.
 */
import { useTranslation } from 'react-i18next';
import {
  formatBytes,
  formatDuration,
  formatFilesProgress,
  formatProgress,
  formatSpeed,
  SPACE,
} from '@dropforge/design-system';
import type { AppController, AppState } from '../app/controller.js';

export function BrandMark(): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="df-brand">
      <span className="df-brand__mark" aria-hidden="true">
        DF
      </span>
      <span>{t('app.name')}</span>
    </div>
  );
}

export function PageHeader({ titleKey, subtitleKey }: { titleKey: string; subtitleKey: string }): React.ReactElement {
  const { t } = useTranslation();
  return (
    <header style={{ marginBottom: SPACE.xl }}>
      <h1 className="df-page-title">{t(titleKey as never)}</h1>
      <p className="df-page-subtitle">{t(subtitleKey as never)}</p>
    </header>
  );
}

export function NoticeStack({ controller, state }: { controller: AppController; state: AppState }): React.ReactElement {
  const { t } = useTranslation();
  if (state.notices.length === 0) return <></>;
  return (
    <div style={{ display: 'grid', gap: SPACE.sm, marginBottom: SPACE.lg }} aria-live="polite">
      {state.notices.map((notice) => (
        <div
          key={notice.id}
          className={`df-card df-card--tight df-badge--${notice.kind === 'error' ? 'error' : notice.kind === 'success' ? 'ok' : 'busy'}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: SPACE.md }}
        >
          <span>{t(notice.messageKey as never)}</span>
          <button type="button" className="df-button df-button--ghost df-button--small" onClick={() => controller.dismissNotice(notice.id)}>
            {t('common.close')}
          </button>
        </div>
      ))}
    </div>
  );
}

export interface ProgressViewProps {
  state: string;
  bytesDone: number;
  totalBytes: number;
  bytesPerSecond: number | undefined;
  etaSeconds: number | undefined;
  reliable: boolean;
  filesDone?: number;
  filesTotal?: number;
}

/**
 * Progress data. Speed and ETA are shown only when the engine says they are
 * reliable; otherwise the bar is indeterminate and no number is displayed.
 */
export function ProgressView(props: ProgressViewProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === 'en' ? 'en' : 'fr';
  const percent = formatProgress(props.bytesDone, props.totalBytes);
  const finished = props.state === 'completed';
  const indeterminate = props.totalBytes === 0 || !props.reliable;
  const speed = props.reliable ? formatSpeed(props.bytesPerSecond, locale) : undefined;
  const eta = props.reliable ? formatDuration(props.etaSeconds, locale) : undefined;

  return (
    <div style={{ display: 'grid', gap: SPACE.xs }}>
      <div
        className={`df-progress${indeterminate && !finished ? ' df-progress--indeterminate' : ''}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate && !finished ? undefined : finished ? 100 : percent}
        aria-label={t('states.' + props.state as never)}
      >
        <div className="df-progress__bar" style={{ width: finished ? '100%' : `${percent}%` }} />
      </div>
      <div className="df-row df-row--between df-faint">
        <span>
          {formatBytes(props.bytesDone, locale)} / {formatBytes(props.totalBytes, locale)}
          {props.filesTotal !== undefined && props.filesTotal > 1
            ? ` · ${formatFilesProgress(props.filesDone ?? 0, props.filesTotal, locale)}`
            : ''}
        </span>
        <span>
          {speed ? `${t('transfer.speed')} ${speed}` : ''}
          {speed && eta ? ' · ' : ''}
          {eta ? `${t('transfer.eta')} ${eta}` : ''}
        </span>
      </div>
    </div>
  );
}

export function StateBadge({ state, paused }: { state: string; paused?: boolean }): React.ReactElement {
  const { t } = useTranslation();
  const tone =
    state === 'completed'
      ? 'ok'
      : state === 'failed'
        ? 'error'
        : state === 'interrupted'
          ? 'warn'
          : state === 'queued'
            ? ''
            : 'busy';
  // A job the user paused is shown as paused even when the state machine still
  // says "connecting" (it has not moved a byte yet): the flag is the truth.
  const label = paused ? t('states.paused') : t(`states.${state}` as never);
  return <span className={`df-badge df-badge--${tone}`}>{label}</span>;
}

export function EmptyState({ messageKey, action }: { messageKey: string; action?: React.ReactNode }): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="df-empty">
      <span>{t(messageKey as never)}</span>
      {action}
    </div>
  );
}
