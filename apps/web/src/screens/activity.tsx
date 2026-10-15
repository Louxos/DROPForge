/**
 * Activity screen: the real history, searchable and deletable. An entry shows the
 * state the engine actually reached, with the verified flag per file.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SPACE, formatBytes, formatDateTime, shortFingerprint } from '@dropforge/design-system';
import { transferLabel, type AppController, type AppState } from '../app/controller.js';
import { EmptyState, PageHeader, StateBadge } from '../components/atoms.js';

export function ActivityScreen({ controller, state }: { controller: AppController; state: AppState }): React.ReactElement {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === 'en' ? 'en' : 'fr';
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'send' | 'receive' | 'failed'>('all');
  const [expanded, setExpanded] = useState<string | undefined>(undefined);

  const sent = state.history.filter((entry) => entry.direction === 'send').length;
  const received = state.history.length - sent;

  const apply = (nextQuery: string, nextFilter: typeof filter): void => {
    setQuery(nextQuery);
    setFilter(nextFilter);
    void controller.searchHistory(
      nextQuery,
      nextFilter === 'send' || nextFilter === 'receive' ? nextFilter : undefined,
      nextFilter === 'failed',
    );
  };

  return (
    <section>
      <PageHeader titleKey="activity.title" subtitleKey="activity.subtitle" />

      {/* One search field and one filter list. The four filters used to be four buttons
          of the same size, three of which applied nothing most of the time: a list is one
          control, one action, and it says what is currently filtered. */}
      <div className="df-row" style={{ marginBottom: SPACE.lg, flexWrap: 'wrap' }}>
        <input
          className="df-input"
          placeholder={t('activity.search')}
          value={query}
          onChange={(event) => apply(event.target.value, filter)}
          style={{ flex: 1, minWidth: 220 }}
        />
        <label className="df-faint" htmlFor="df-activity-filter" style={{ display: 'none' }}>
          {t('activity.filter')}
        </label>
        <select
          id="df-activity-filter"
          className="df-input"
          value={filter}
          onChange={(event) => apply(query, event.target.value as typeof filter)}
        >
          <option value="all">{t('activity.filterAll')}</option>
          <option value="send">{t('activity.filterSend')}</option>
          <option value="receive">{t('activity.filterReceive')}</option>
          <option value="failed">{t('activity.filterFailed')}</option>
        </select>
      </div>

      <p className="df-faint" style={{ marginBottom: SPACE.lg }}>
        {t('activity.stats', {
          transfers: state.history.length,
          sent,
          received,
        })}
      </p>

      {state.history.length === 0 ? (
        <EmptyState messageKey={query.length > 0 || filter !== 'all' ? 'activity.emptyFiltered' : 'activity.empty'} />
      ) : (
        <ul className="df-list">
          {state.history.map((entry) => (
            <li key={entry.id} className="df-card df-card--tight">
              <div className="df-row df-row--between">
                <div>
                  <strong>
                    {entry.direction === 'send' ? t('activity.filterSend') : t('activity.filterReceive')}
                  </strong>{' '}
                  {/* Ce qui a été transféré, nommé : une entrée qui ne dit que
                      « Envoi · Windows · 2 · 3,0 Mio / 3,0 Mio » oblige à ouvrir les
                      détails pour savoir de quel fichier il s'agit — dans un écran
                      dont le seul but est de retrouver ce qu'on a envoyé. */}
                  <span>{transferLabel(entry.files)}</span>
                  <div className="df-faint">
                    {entry.peerName} · {formatDateTime(entry.updatedAt, locale)}
                  </div>
                  <div className="df-faint">
                    {formatBytes(entry.bytesDone, locale)} / {formatBytes(entry.totalBytes, locale)}
                    {entry.transport ? ` · ${entry.transport}` : ''}
                  </div>
                </div>
                <div className="df-row">
                  <StateBadge state={entry.state} />
                  <button
                    type="button"
                    className="df-button df-button--small"
                    onClick={() => setExpanded(expanded === entry.id ? undefined : entry.id)}
                  >
                    {expanded === entry.id ? t('common.hide') : t('common.details')}
                  </button>
                </div>
              </div>

              {entry.lastErrorCode ? (
                <p className="df-badge df-badge--error" style={{ marginTop: SPACE.sm }}>
                  {t(`errors.${entry.lastErrorCode}` as never)}
                </p>
              ) : null}

              {expanded === entry.id ? (
                <>
                <ul className="df-list" style={{ marginTop: SPACE.md }}>
                  {entry.files.map((file) => (
                    <li key={file.index} className="df-row df-row--between df-faint">
                      <span className="df-mono">{file.path}</span>
                      <span>
                        {formatBytes(file.bytesDone, locale)} / {formatBytes(file.size, locale)} ·{' '}
                        {file.verified === true ? t('activity.verified') : t('activity.notVerified')}
                      </span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="df-button df-button--danger df-button--small"
                  style={{ marginTop: SPACE.md }}
                  onClick={() => void controller.deleteHistoryEntry(entry.id)}
                >
                  {t('activity.deleteOne')}
                </button>
                </>
              ) : null}

              {entry.state === 'failed' && entry.bytesDone > 0 ? (
                <p className="df-faint">{t('activity.partialNotice')}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {state.history.length > 0 ? (
        <details className="df-details" style={{ marginTop: SPACE.xl }}>
          <summary>{t('transfer.moreOptions')}</summary>
          <div className="df-row" style={{ marginTop: SPACE.md, flexWrap: 'wrap' }}>
            <button type="button" className="df-button df-button--small" onClick={() => void controller.exportHistory()}>
              {t('activity.export')}
            </button>
            <button
              type="button"
              className="df-button df-button--danger df-button--small"
              onClick={() => {
                if (window.confirm(t('activity.deleteAllConfirm'))) void controller.clearHistory();
              }}
            >
              {t('activity.deleteAll')}
            </button>
          </div>
        </details>
      ) : null}

      {state.identityFingerprint ? (
        <p className="df-faint" style={{ marginTop: SPACE.xl }}>
          {t('devices.fingerprint')} {shortFingerprint(state.identityFingerprint)}
        </p>
      ) : null}
    </section>
  );
}
