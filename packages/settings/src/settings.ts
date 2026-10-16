/**
 * Settings: one versioned, validated preferences object.
 *
 * Design choices worth stating, because they are product decisions from the spec:
 *  - every default is the private one: no telemetry, history kept locally, a new
 *    device never auto-accepted, conflicts always asking the user;
 *  - a value coming from a file, an old migration or the UI is *validated and
 *    clamped*, never trusted. A malformed value falls back to the default and the
 *    caller is told which keys were ignored instead of silently changing them;
 *  - the schema is versioned and migrated in one place (`migrateSettings`), so an
 *    old installation upgrading the app does not lose its preferences.
 */
import { DropForgeError, ERROR_CODES, type MetaStore } from '@dropforge/app-core';

export const SETTINGS_COLLECTION = 'settings';
export const SETTINGS_KEY = 'preferences';
export const SETTINGS_VERSION = 4;

/**
 * Where the relay (the signaling service) is.
 *
 *  - `auto` — the deployment's own address when the build carries one, the page's own
 *    origin when the page is served locally (development and the test bench, where the
 *    dev server proxies `/ws`), and **nothing** anywhere else;
 *  - `none` — never contact one: only devices on the same local network can then reach
 *    each other, and the interface says so;
 *  - a `ws://` or `wss://` address — used as it is, for someone who hosts their own.
 *
 * « Nothing » is the case that matters: a published build used to assume the relay was
 * served from its own host. Nothing answered there, so every attempt to receive or to
 * join by code produced connection failures — an address that is invented rather than
 * configured turns into a screen full of errors for a user who did nothing wrong.
 */
export const SIGNALING_AUTO = 'auto';
export const SIGNALING_OFF = 'none';

export type Language = 'fr' | 'en';
export type Theme = 'dark' | 'light' | 'system';
export type ConflictPolicy = 'ask' | 'rename' | 'skip' | 'overwrite';

export interface Preferences {
  v: typeof SETTINGS_VERSION;
  language: Language;
  theme: Theme;
  notifications: boolean;
  /** Where received files go. Empty means "ask every time" in the browser. */
  receiveFolder: string;
  conflictPolicy: ConflictPolicy;
  /** 1..8, matching the queue's own bound. */
  maxConcurrentTransfers: number;
  /** Optional ceiling applied before anything is sent (0 = no local limit). */
  maxTransferBytes: number;
  /** Days of history to keep; 0 = keep everything. */
  historyRetentionDays: number;
  /** Only devices the user approved may start a transfer. */
  trustedDevicesOnly: boolean;
  /** Never on by default, and DropForge sends nothing anywhere either way. */
  diagnostics: boolean;
  /** Refuse hosted (server-stored) sharing links: the local-only guarantee. */
  allowHostedSharing: boolean;
  /** Where the relay is: `auto`, `none`, or a `ws://` / `wss://` address. */
  signalingUrl: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  v: SETTINGS_VERSION,
  language: 'fr',
  theme: 'dark',
  notifications: true,
  receiveFolder: '',
  conflictPolicy: 'ask',
  maxConcurrentTransfers: 2,
  maxTransferBytes: 0,
  historyRetentionDays: 0,
  trustedDevicesOnly: false,
  diagnostics: false,
  allowHostedSharing: true,
  signalingUrl: SIGNALING_AUTO,
};

export interface SettingsChange {
  key: keyof Preferences;
  previous: unknown;
  next: unknown;
}

export interface SettingsLoadResult {
  preferences: Preferences;
  /** Keys whose stored value was unusable and therefore replaced by the default. */
  ignored: Array<keyof Preferences>;
  /** Keys whose value was valid but out of range, and was clamped. */
  clamped: Array<keyof Preferences>;
  /** Schema version found in the store before migration. */
  fromVersion: number;
}

const LANGUAGES: readonly Language[] = ['fr', 'en'];
const THEMES: readonly Theme[] = ['dark', 'light', 'system'];
const POLICIES: readonly ConflictPolicy[] = ['ask', 'rename', 'skip', 'overwrite'];

export const MIN_CONCURRENT_TRANSFERS = 1;
export const MAX_CONCURRENT_TRANSFERS = 8;

export class SettingsService {
  private current: Preferences = { ...DEFAULT_PREFERENCES };
  private readonly listeners = new Set<(change: SettingsChange) => void>();

  constructor(private readonly store: MetaStore) {}

  /** Loads the stored preferences, migrating older versions when needed. */
  async load(): Promise<SettingsLoadResult> {
    const stored = await this.store.get<unknown>(SETTINGS_COLLECTION, SETTINGS_KEY);
    const { value, ignored, clamped, fromVersion } = readSettings(stored);
    this.current = value;
    if (stored !== undefined) {
      // Nothing is written back unless the schema really changed: a read must not
      // silently rewrite the user's file.
      const migrated = migrateSettings(stored);
      if (migrated.changed) await this.store.put(SETTINGS_COLLECTION, SETTINGS_KEY, value);
    }
    return { preferences: value, ignored, clamped, fromVersion };
  }

  get(): Preferences {
    return { ...this.current };
  }

  onChange(listener: (change: SettingsChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Applies a patch. Invalid values are rejected with a code the UI can translate;
   * out-of-range numbers are clamped rather than rejected, because a slider must not
   * be able to break the transfer engine.
   */
  async update(patch: Partial<Preferences>): Promise<Preferences> {
    const previous = this.current;
    const next = applyPatch(previous, patch);
    await this.store.put(SETTINGS_COLLECTION, SETTINGS_KEY, next);
    this.current = next;
    for (const [key, value] of Object.entries(next) as Array<[keyof Preferences, unknown]>) {
      if (previous[key] !== value) this.emit({ key, previous: previous[key], next: value });
    }
    return { ...next };
  }

  async reset(): Promise<Preferences> {
    const previous = this.current;
    const next = { ...DEFAULT_PREFERENCES };
    await this.store.put(SETTINGS_COLLECTION, SETTINGS_KEY, next);
    this.current = next;
    for (const key of Object.keys(next) as Array<keyof Preferences>) {
      if (previous[key] !== next[key]) this.emit({ key, previous: previous[key], next: next[key] });
    }
    return next;
  }

  private emit(change: SettingsChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }
}

/** Reads any stored value into a complete, valid preferences object. */
export function readSettings(stored: unknown): {
  value: Preferences;
  ignored: Array<keyof Preferences>;
  clamped: Array<keyof Preferences>;
  fromVersion: number;
} {
  const ignored: Array<keyof Preferences> = [];
  const clamped: Array<keyof Preferences> = [];
  const source = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  const fromVersion = typeof source.v === 'number' ? source.v : 0;
  const migrated = migrateSettings(stored).value as Record<string, unknown>;

  const pickBoolean = (key: keyof Preferences): boolean => {
    const value = migrated[key];
    if (value === undefined) return DEFAULT_PREFERENCES[key] as boolean;
    if (typeof value === 'boolean') return value;
    ignored.push(key);
    return DEFAULT_PREFERENCES[key] as boolean;
  };
  const pickEnum = <T extends string>(key: keyof Preferences, allowed: readonly T[]): T => {
    const value = migrated[key];
    if (value === undefined) return DEFAULT_PREFERENCES[key] as T;
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
    ignored.push(key);
    return DEFAULT_PREFERENCES[key] as T;
  };
  const pickNumber = (key: keyof Preferences, min: number, max: number): number => {
    const value = migrated[key];
    if (value === undefined) return DEFAULT_PREFERENCES[key] as number;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const bounded = Math.min(max, Math.max(min, Math.round(value)));
      if (bounded !== value) clamped.push(key);
      return bounded;
    }
    ignored.push(key);
    return DEFAULT_PREFERENCES[key] as number;
  };
  const pickPath = (key: keyof Preferences): string => {
    const value = migrated[key];
    if (value === undefined) return '';
    if (typeof value === 'string' && value.length <= 1024) return value;
    ignored.push(key);
    return '';
  };
  /**
   * The relay address is either one of the two keywords or a WebSocket address.
   * « A WebSocket address » is checked here rather than at connection time: a typo must
   * be refused when it is written, not silently turned into a failed transfer later.
   */
  const pickSignaling = (): string => {
    const value = migrated.signalingUrl;
    if (value === undefined) return SIGNALING_AUTO;
    if (value === SIGNALING_AUTO || value === SIGNALING_OFF) return value;
    if (typeof value === 'string' && value.length <= 2048 && /^wss?:\/\/[^\s]+$/i.test(value.trim())) {
      return value.trim();
    }
    ignored.push('signalingUrl');
    return SIGNALING_AUTO;
  };

  const value: Preferences = {
    v: SETTINGS_VERSION,
    language: pickEnum('language', LANGUAGES),
    theme: pickEnum('theme', THEMES),
    notifications: pickBoolean('notifications'),
    receiveFolder: pickPath('receiveFolder'),
    conflictPolicy: pickEnum('conflictPolicy', POLICIES),
    maxConcurrentTransfers: pickNumber('maxConcurrentTransfers', MIN_CONCURRENT_TRANSFERS, MAX_CONCURRENT_TRANSFERS),
    maxTransferBytes: pickNumber('maxTransferBytes', 0, Number.MAX_SAFE_INTEGER),
    historyRetentionDays: pickNumber('historyRetentionDays', 0, 3_650),
    trustedDevicesOnly: pickBoolean('trustedDevicesOnly'),
    diagnostics: pickBoolean('diagnostics'),
    allowHostedSharing: pickBoolean('allowHostedSharing'),
    signalingUrl: pickSignaling(),
  };
  return { value, ignored, clamped, fromVersion };
}

/**
 * Schema migrations. Version 0 is a file written before the schema was versioned;
 * version 1 stored `conflictPolicy: 'ask' | 'overwrite'` with a separate
 * `renameOnConflict` flag, which version 2 folded into the single policy enum;
 * version 3 added the relay address (`signalingUrl`) ; la version 4 retire les deux
 * réglages qui n'avaient de sens que dans l'application Windows (`autostart`,
 * `closeBehaviour`).
 */
export function migrateSettings(stored: unknown): { value: Record<string, unknown>; changed: boolean } {
  if (typeof stored !== 'object' || stored === null) return { value: {}, changed: false };
  const input = { ...(stored as Record<string, unknown>) };
  const version = typeof input.v === 'number' ? input.v : 0;
  if (version >= SETTINGS_VERSION) return { value: input, changed: false };

  if (version === 1) {
    if (input.renameOnConflict === true && input.conflictPolicy !== 'overwrite') input.conflictPolicy = 'rename';
    delete input.renameOnConflict;
  }
  if (version <= 1) {
    // Older builds accepted unlimited concurrency; the queue never ran more than 8.
    if (typeof input.maxConcurrentTransfers === 'number' && input.maxConcurrentTransfers > MAX_CONCURRENT_TRANSFERS) {
      input.maxConcurrentTransfers = MAX_CONCURRENT_TRANSFERS;
    }
    // Hosted sharing was implicit before it became an explicit switch.
    if (input.allowHostedSharing === undefined) input.allowHostedSharing = true;
  }
  if (version <= 3) {
    // Version 4: the Windows application is gone, and with it these two settings. They
    // are dropped rather than ignored, so a stored file never carries a preference that
    // nothing can apply — and nothing in the interface refers to a feature that does not
    // exist any more.
    delete input.autostart;
    delete input.closeBehaviour;
  }
  if (version <= 2) {
    // Before version 3 the relay address was not a preference at all: the build
    // guessed it (`VITE_SIGNALING_URL`, otherwise the page's own host). An existing
    // installation keeps working without a new question: « auto » is exactly that old
    // behaviour, minus the guess that failed on a published site.
    if (input.signalingUrl === undefined) input.signalingUrl = SIGNALING_AUTO;
  }
  input.v = SETTINGS_VERSION;
  return { value: input, changed: true };
}

function applyPatch(current: Preferences, patch: Partial<Preferences>): Preferences {
  const read = readSettings({ ...current, ...patch });
  // Keys the caller explicitly set must never be silently ignored: an invalid
  // theme or language is a programming error, not something to swallow. Values
  // that are simply out of range were clamped by `readSettings` above.
  const explicitlyInvalid = read.ignored.filter((key) => patch[key] !== undefined);
  if (explicitlyInvalid.length > 0) {
    throw new DropForgeError(
      ERROR_CODES.UNSUPPORTED_OPERATION,
      `These settings are not valid: ${explicitlyInvalid.join(', ')}`,
      { context: { keys: explicitlyInvalid.join(',') } },
    );
  }
  return read.value;
}
