import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@dropforge/app-core';
import { DICTIONARIES } from './dictionaries.js';
import { RESOURCES, flatten } from './index.js';

const FR_KEYS = Object.keys(flatten(DICTIONARIES.fr));
const EN_KEYS = Object.keys(flatten(DICTIONARIES.en));

describe('translations', () => {
  it('covers every error code with a sentence, in both languages', () => {
    const missingFr = Object.keys(ERROR_CODES).filter((code) => !(`errors.${code}` in RESOURCES.fr.translation));
    const missingEn = Object.keys(ERROR_CODES).filter((code) => !(`errors.${code}` in RESOURCES.en.translation));
    expect(missingFr).toEqual([]);
    expect(missingEn).toEqual([]);
  });

  it('has exactly the same keys in French and in English', () => {
    // A key present in one language only would show a raw identifier to the user.
    expect([...EN_KEYS].sort()).toEqual([...FR_KEYS].sort());
  });

  it('has no empty string and no leftover placeholder-looking text', () => {
    for (const [locale, dictionary] of Object.entries(RESOURCES)) {
      for (const [key, value] of Object.entries(dictionary.translation)) {
        expect(value.trim(), `${locale}:${key}`).not.toBe('');
        expect(value, `${locale}:${key}`).not.toMatch(/TODO|FIXME|XXX/);
      }
    }
  });

  it('keeps every state of the transfer machine translatable', () => {
    for (const state of ['queued', 'connecting', 'transferring', 'paused', 'interrupted', 'verifying', 'completed', 'cancelled', 'failed']) {
      expect(FR_KEYS).toContain(`states.${state}`);
      expect(EN_KEYS).toContain(`states.${state}`);
    }
  });
});
