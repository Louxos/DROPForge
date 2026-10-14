/// <reference types="vite/client" />

/**
 * Typed environment variables. Anything not listed here is undefined at runtime,
 * so the code cannot quietly depend on a variable nobody sets.
 */
interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
  /** Absolute wss URL of the signaling service; empty means "same origin /ws". */
  readonly VITE_SIGNALING_URL?: string;
  /** Origin of the optional hosted-sharing service. */
  readonly VITE_SHARE_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** CSS is imported for its side effects; Vite handles the bundling. */
declare module '*.css';

/**
 * `fake-indexeddb/auto` installs a compliant IndexedDB on `globalThis` when imported
 * for its side effects. `apps/web/src/entry.test.tsx` needs it: that test starts the
 * real entry point, outside a browser, and IndexedDB is part of what it exercises.
 *
 * The package does ship typings, but its `exports` map does not expose them, so the
 * import is declared here rather than left as an implicit `any`.
 */
declare module 'fake-indexeddb/auto';
