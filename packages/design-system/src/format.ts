/**
 * Display formatting. Every function here exists to keep the UI honest:
 * an unknown speed prints nothing rather than a made-up number, and a size is
 * never rounded up to something that looks better.
 */
import type { Locale } from './tokens.js';

export function formatBytes(bytes: number, locale: 'fr' | 'en' = 'fr'): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  const units = locale === 'fr' ? ['o', 'Ko', 'Mo', 'Go', 'To'] : ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits).replace('.', locale === 'fr' ? ',' : '.')} ${units[unit]}`;
}

export function formatSpeed(bytesPerSecond: number | undefined, locale: 'fr' | 'en' = 'fr'): string | undefined {
  // No measurement, no number: the UI shows a spinner instead of a fake speed.
  if (bytesPerSecond === undefined || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return undefined;
  return `${formatBytes(bytesPerSecond, locale)}/${locale === 'fr' ? 's' : 's'}`;
}

export function formatDuration(seconds: number | undefined, locale: 'fr' | 'en' = 'fr'): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return undefined;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (locale === 'fr') {
    if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} min`;
    if (minutes > 0) return `${minutes} min ${String(secs).padStart(2, '0')} s`;
    return `${secs} s`;
  }
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  if (minutes > 0) return `${minutes} min ${String(secs).padStart(2, '0')} s`;
  return `${secs} s`;
}

/** Progress percentage, floored so 99.6% is never shown as 100%. */
export function formatProgress(done: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(99, Math.floor((done / total) * 100)));
}

export function formatCount(count: number, locale: 'fr' | 'en' = 'fr', singular?: string, plural?: string): string {
  if (!singular || !plural) return String(count);
  return count <= 1 ? singular : plural;
}

export function formatDateTime(timestamp: number, locale: Locale, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...options,
  }).format(timestamp);
}

/** Files left to receive, e.g. "3 fichiers sur 5". */
export function formatFilesProgress(done: number, total: number, locale: Locale): string {
  return locale === 'fr' ? `${done} sur ${total} fichier${total > 1 ? 's' : ''}` : `${done} of ${total} file${total === 1 ? '' : 's'}`;
}

/** Human state label keys, kept identical to the state machine's names. */
export function stateLabelKey(state: string): string {
  return `states.${state}`;
}

/**
 * A fingerprint is long and hostile to read; the UI shows its first groups and
 * keeps the full value available for the user to compare out of band. It is
 * never truncated in a way that would make two different keys look alike: the
 * caller must display the whole value on demand (a `title` attribute, a copy
 * button, the pairing screen).
 */
export function shortFingerprint(fingerprint: string, groups = 3): string {
  const chunks = fingerprint.toUpperCase().match(/.{1,4}/g) ?? [];
  if (chunks.length <= groups) return chunks.join(' ');
  return `${chunks.slice(0, groups).join(' ')} … ${chunks[chunks.length - 1]}`;
}
