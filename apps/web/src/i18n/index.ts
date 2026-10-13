/**
 * Translation setup. French and English, no network fetch: the dictionaries are
 * bundled, so the interface works offline and in an installed PWA.
 *
 * A missing key is impossible: a test checks both dictionaries carry the same
 * keys, and every error code has a sentence of its own.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DICTIONARIES, type Dictionary, type Locale } from './dictionaries.js';

export type { Dictionary, Locale };

/** Flattens `{ a: { b: 'x' } }` into `{ 'a.b': 'x' }`, which is what i18next reads. */
export function flatten(dictionary: Dictionary): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (value: unknown, prefix: string): void => {
    if (typeof value === 'string') {
      out[prefix] = value;
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        walk(nested, prefix ? `${prefix}.${key}` : key);
      }
    }
  };
  walk(dictionary, '');
  return out;
}

export const RESOURCES = {
  fr: { translation: flatten(DICTIONARIES.fr) },
  en: { translation: flatten(DICTIONARIES.en) },
} as const;

export async function setupI18n(locale: Locale = 'fr'): Promise<typeof i18n> {
  await i18n.use(initReactI18next).init({
    resources: RESOURCES,
    lng: locale,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return i18n;
}

export function changeLanguage(locale: Locale): void {
  void i18n.changeLanguage(locale);
}

export { i18n };
