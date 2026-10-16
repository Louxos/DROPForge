/**
 * Design system: tokens, theme resolution, display formatting and the base
 * stylesheet. React components live in the web app so this package stays usable
 * by any renderer (and unit-testable without a DOM).
 */
export * from './tokens.js';
// Le logo, décrit une fois (`brand-mark.mjs`), pour que l'interface, les icônes et
// la page publiée dessinent tous le même symbole.
export * from './brand-mark.mjs';
export * from './theme.js';
export * from './format.js';
