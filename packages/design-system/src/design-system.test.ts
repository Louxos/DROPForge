import { describe, expect, it } from 'vitest';
import { DARK_COLORS, LIGHT_COLORS, colorsFor } from './tokens.js';
import { resolveTheme, themeStyleAttribute, themeVariables } from './theme.js';
import { formatBytes, formatDuration, formatProgress, formatSpeed, formatFilesProgress, shortFingerprint } from './format.js';

describe('theme', () => {
  it('follows the system only when asked to', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    // An explicit choice always wins, whatever the OS says.
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('exposes both themes as CSS variables with the product palette', () => {
    const dark = themeVariables('dark');
    expect(dark['--df-background']).toBe(DARK_COLORS.background);
    expect(dark['--df-accent']).toBe(DARK_COLORS.accent);
    expect(dark['--df-color-scheme']).toBeUndefined();
    expect(dark['color-scheme']).toBe('dark');
    // Layout values travel with the theme so the CSS never hard-codes them.
    expect(dark['--df-layout-sidebar-width']).toBe('236px');

    const light = themeVariables('light');
    expect(light['--df-surface']).toBe(LIGHT_COLORS.surface);
    expect(light['color-scheme']).toBe('light');
  });

  it('keeps the two palettes distinguishable and readable', () => {
    expect(DARK_COLORS.background).not.toBe(LIGHT_COLORS.background);
    for (const colors of [DARK_COLORS, LIGHT_COLORS]) {
      expect(colors.text).not.toBe(colors.background);
      expect(colors.border).not.toBe(colors.surface);
      // Accent colours are real values, never a placeholder.
      expect(colors.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(colors.danger).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('serialises a style attribute the app can apply directly', () => {
    const style = themeStyleAttribute('dark');
    expect(style).toContain('--df-background: #0b0b0f');
    expect(style.split(';').length).toBeGreaterThan(20);
  });

  it('picks the palette that matches the theme name', () => {
    expect(colorsFor('dark')).toBe(DARK_COLORS);
    expect(colorsFor('light')).toBe(LIGHT_COLORS);
  });
});

describe('formatting', () => {
  it('formats sizes with the right unit and separator per language', () => {
    expect(formatBytes(0, 'fr')).toBe('0 o');
    expect(formatBytes(512, 'en')).toBe('512 B');
    expect(formatBytes(1024, 'fr')).toBe('1,00 Ko');
    expect(formatBytes(1024 * 1024, 'en')).toBe('1.00 MB');
    expect(formatBytes(1024 ** 3 * 2.5, 'fr')).toBe('2,50 Go');
    // Nonsense input prints nothing instead of "NaN o".
    expect(formatBytes(-1)).toBe('');
    expect(formatBytes(Number.NaN)).toBe('');
  });

  it('never invents a speed or an ETA it does not have', () => {
    expect(formatSpeed(undefined)).toBeUndefined();
    expect(formatSpeed(0)).toBeUndefined();
    expect(formatSpeed(1024 * 1024)).toBe('1,00 Mo/s');
    expect(formatDuration(undefined)).toBeUndefined();
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(65)).toBe('1 min 05 s');
    expect(formatDuration(3 * 3600 + 5 * 60, 'en')).toBe('3 h 05 min');
  });

  it('never shows 100% before the transfer is finished', () => {
    expect(formatProgress(0, 100)).toBe(0);
    expect(formatProgress(999, 1000)).toBe(99);
    expect(formatProgress(100, 100)).toBe(99);
    expect(formatProgress(50, 0)).toBe(0);
  });

  it('counts files in the right language', () => {
    expect(formatFilesProgress(2, 5, 'fr')).toBe('2 sur 5 fichiers');
    expect(formatFilesProgress(1, 1, 'fr')).toBe('1 sur 1 fichier');
    expect(formatFilesProgress(1, 2, 'en')).toBe('1 of 2 files');
  });
});

describe('shortFingerprint', () => {
  it('groups the digits and keeps the last group visible', () => {
    // Truncating in the middle without showing the end would let two different
    // keys look identical; the last group is always displayed.
    expect(shortFingerprint('ABCD1234EF567890')).toBe('ABCD 1234 EF56 … 7890');
  });

  it('returns every group when the fingerprint is already short', () => {
    expect(shortFingerprint('AABBCC')).toBe('AABB CC');
  });

  it('is stable for one key and differs for another', () => {
    expect(shortFingerprint('00112233')).toBe(shortFingerprint('00112233'));
    expect(shortFingerprint('00112233')).not.toBe(shortFingerprint('00112234'));
  });
});
