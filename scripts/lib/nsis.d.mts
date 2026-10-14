/**
 * Types for the NSIS hooks reader — the small analysis behind `npm run check:desktop`,
 * kept apart so it can be tested on its own (see `tests/nsis.test.ts`).
 */

/** The only four hooks the official Tauri NSIS template actually calls. */
export declare const TAURI_HOOKS: readonly string[];

/** Prefix reserved for DropForge's own macros (inserted by the hooks above). */
export declare const LOCAL_PREFIX: string;

/**
 * Turns CRLF and lone CR into `\n`.
 *
 * A Windows checkout hands us CRLF by default; comparing sources before normalising is
 * what made the Windows CI job report a correct file as broken.
 */
export declare function normalizeNewlines(source: string): string;

/** The macros the file defines, in order of appearance, without duplicates. */
export declare function definedMacros(source: string): Set<string>;

/** The macros the file inserts, without duplicates. */
export declare function insertedMacros(source: string): Set<string>;

/**
 * Problems found in the hooks file, in French, ready to be shown to a human.
 * An empty list means the file is correct.
 */
export declare function analyseHooks(source: string): string[];
