/**
 * Design tokens. One source of truth for both themes, used by the CSS variables
 * and by the few places where TypeScript needs a colour (canvas, charts, QR code).
 *
 * The product direction: charcoal/black surfaces, controlled violet and electric
 * blue accents, restrained borders, generous spacing, and motion that never gets
 * in the way (`prefers-reduced-motion` is honoured in tokens.css).
 */

export interface ThemeColors {
  /** Deepest surface: the app background. */
  background: string;
  /** Slightly raised surface: cards, panels. */
  surface: string;
  /** Hover/selected surface. */
  surfaceElevated: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  blue: string;
  blueSoft: string;
  success: string;
  warning: string;
  danger: string;
  onAccent: string;
  /** Semi-transparent scrim behind dialogs. */
  scrim: string;
}

export const DARK_COLORS: ThemeColors = {
  background: '#0b0b0f',
  surface: '#14141b',
  surfaceElevated: '#1c1c26',
  border: '#26262f',
  borderStrong: '#3a3a48',
  text: '#f4f4f7',
  textMuted: '#a5a5b4',
  textFaint: '#6f6f80',
  accent: '#8b5cf6',
  accentStrong: '#7c3aed',
  accentSoft: 'rgba(139, 92, 246, 0.16)',
  blue: '#38bdf8',
  blueSoft: 'rgba(56, 189, 248, 0.16)',
  success: '#34d399',
  warning: '#fbbf24',
  danger: '#f87171',
  onAccent: '#0b0b0f',
  scrim: 'rgba(6, 6, 10, 0.72)',
};

export const LIGHT_COLORS: ThemeColors = {
  background: '#f7f7fa',
  surface: '#ffffff',
  surfaceElevated: '#f1f1f6',
  border: '#e2e2ea',
  borderStrong: '#c9c9d6',
  text: '#17171f',
  textMuted: '#55556a',
  textFaint: '#84849a',
  accent: '#6d28d9',
  accentStrong: '#5b21b6',
  accentSoft: 'rgba(109, 40, 217, 0.12)',
  blue: '#0284c7',
  blueSoft: 'rgba(2, 132, 199, 0.12)',
  success: '#047857',
  warning: '#b45309',
  danger: '#b91c1c',
  onAccent: '#ffffff',
  scrim: 'rgba(23, 23, 31, 0.45)',
};

/** 4px scale. Layouts use only these values, which is what makes them rhythmical. */
export const SPACE = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  xxl: '32px',
  xxxl: '48px',
} as const;

export const RADIUS = {
  sm: '6px',
  md: '10px',
  lg: '14px',
  pill: '999px',
} as const;

/**
 * Motion. Durations are short on purpose: a transfer UI must feel immediate, and
 * long animations on a progress list are actively annoying.
 */
export const MOTION = {
  fast: '120ms',
  base: '180ms',
  slow: '260ms',
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
} as const;

export const TYPOGRAPHY = {
  /** System UI stack: no web font download, so the app starts instantly offline. */
  fontFamily: "'Inter var', 'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', sans-serif",
  fontMono: "'JetBrains Mono', 'Cascadia Mono', ui-monospace, 'SF Mono', Menlo, monospace",
  size: {
    xs: '11px',
    sm: '12px',
    md: '13px',
    base: '14px',
    lg: '16px',
    xl: '20px',
    xxl: '26px',
    display: '34px',
  },
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
} as const;

export const LAYOUT = {
  /** Sidebar on desktop, fixed bottom bar on mobile. */
  sidebarWidth: '236px',
  bottomNavHeight: '58px',
  contentMaxWidth: '1180px',
} as const;

export type Locale = 'fr' | 'en';
export type ThemeName = 'dark' | 'light';
export type ThemePreference = ThemeName | 'system';

export function colorsFor(theme: ThemeName): ThemeColors {
  return theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
}
