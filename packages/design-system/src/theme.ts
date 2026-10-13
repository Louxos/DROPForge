/** Theme resolution and CSS variable generation. Pure logic, so it is testable. */
import { LAYOUT, MOTION, RADIUS, SPACE, TYPOGRAPHY, colorsFor, type ThemeName, type ThemePreference } from './tokens.js';

/**
 * Resolves the user's preference. `system` follows the OS, which is what most
 * people expect, and the result is always one of exactly two themes.
 */
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ThemeName {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

/** The CSS custom properties of a theme, ready to spread on a root element. */
export function themeVariables(theme: ThemeName): Record<string, string> {
  const colors = colorsFor(theme);
  const vars: Record<string, string> = { 'color-scheme': theme };
  for (const [key, value] of Object.entries(colors)) {
    vars[`--df-${kebab(key)}`] = value;
  }
  for (const [key, value] of Object.entries(SPACE)) vars[`--df-space-${key}`] = value;
  for (const [key, value] of Object.entries(RADIUS)) vars[`--df-radius-${key}`] = value;
  for (const [key, value] of Object.entries(MOTION)) vars[`--df-motion-${key}`] = value;
  for (const [key, value] of Object.entries(LAYOUT)) vars[`--df-layout-${kebab(key)}`] = value;
  vars['--df-font'] = TYPOGRAPHY.fontFamily;
  vars['--df-font-mono'] = TYPOGRAPHY.fontMono;
  for (const [key, value] of Object.entries(TYPOGRAPHY.size)) vars[`--df-text-${key}`] = value;
  return vars;
}

/** Serialises the variables as a `style` attribute value (no framework needed). */
export function themeStyleAttribute(theme: ThemeName): string {
  return Object.entries(themeVariables(theme))
    .map(([key, value]) => `${key}: ${value}`)
    .join('; ');
}

/**
 * Applies a theme to a document. Also sets `data-theme`, which is what the CSS
 * uses for theme-specific touches (shadows, images, scrollbars).
 */
export function applyTheme(document: Document, theme: ThemeName): void {
  const root = document.documentElement;
  root.dataset['theme'] = theme;
  for (const [key, value] of Object.entries(themeVariables(theme))) {
    root.style.setProperty(key, value);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', colorsFor(theme).background);
}

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
