import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@dropforge/app-core';
import {
  DEFAULT_PREFERENCES,
  SETTINGS_COLLECTION,
  SETTINGS_KEY,
  SETTINGS_VERSION,
  SIGNALING_AUTO,
  SIGNALING_OFF,
  SettingsService,
  migrateSettings,
  readSettings,
} from './settings.js';
import { MemoryStore } from '../../../tests/helpers/memory-store.js';

describe('defaults', () => {
  it('is private by default', () => {
    expect(DEFAULT_PREFERENCES.diagnostics).toBe(false);
    expect(DEFAULT_PREFERENCES.trustedDevicesOnly).toBe(false);
    expect(DEFAULT_PREFERENCES.conflictPolicy).toBe('ask');
    expect(DEFAULT_PREFERENCES.historyRetentionDays).toBe(0);
    expect(DEFAULT_PREFERENCES.theme).toBe('dark');
  });

  it('returns the defaults when nothing is stored yet', async () => {
    const service = new SettingsService(new MemoryStore());
    const result = await service.load();
    expect(result.preferences).toEqual(DEFAULT_PREFERENCES);
    expect(result.ignored).toEqual([]);
    expect(result.fromVersion).toBe(0);
  });
});

describe('validation', () => {
  it('falls back to the default for an unusable stored value and reports it', () => {
    const { value, ignored } = readSettings({
      v: SETTINGS_VERSION,
      theme: 'neon',
      language: 'de',
      maxConcurrentTransfers: 'many',
      notifications: 'yes',
    });
    expect(value.theme).toBe('dark');
    expect(value.language).toBe('fr');
    expect(value.maxConcurrentTransfers).toBe(2);
    expect(value.notifications).toBe(true);
    expect(ignored.sort()).toEqual(['language', 'maxConcurrentTransfers', 'notifications', 'theme']);
  });

  it('clamps numbers instead of failing, so a slider cannot break the engine', () => {
    const { value, clamped, ignored } = readSettings({
      v: SETTINGS_VERSION,
      maxConcurrentTransfers: 99,
      historyRetentionDays: -5,
      maxTransferBytes: 1.6,
    });
    expect(value.maxConcurrentTransfers).toBe(8);
    expect(value.historyRetentionDays).toBe(0);
    expect(value.maxTransferBytes).toBe(2);
    expect(clamped).toContain('maxConcurrentTransfers');
    expect(ignored).toEqual([]);
  });

  it('refuses a patch whose value the caller made up', async () => {
    const service = new SettingsService(new MemoryStore());
    await service.load();
    await expect(service.update({ theme: 'neon' as never })).rejects.toMatchObject({
      code: ERROR_CODES.UNSUPPORTED_OPERATION,
    });
    // Nothing was written on the way out.
    expect(service.get().theme).toBe('dark');
  });
});

describe('persistence and events', () => {
  it('persists an update and reloads it', async () => {
    const store = new MemoryStore();
    const service = new SettingsService(store);
    await service.load();
    await service.update({ theme: 'light', language: 'en', receiveFolder: 'D:\\Téléchargements' });

    const reloaded = new SettingsService(store);
    const { preferences } = await reloaded.load();
    expect(preferences.theme).toBe('light');
    expect(preferences.language).toBe('en');
    expect(preferences.receiveFolder).toBe('D:\\Téléchargements');
  });

  it('emits a change per modified key only', async () => {
    const service = new SettingsService(new MemoryStore());
    await service.load();
    const seen: string[] = [];
    service.onChange((change) => seen.push(change.key));
    await service.update({ theme: 'light' });
    await service.update({ theme: 'light' });
    await service.update({ notifications: false });

    expect(seen).toEqual(['theme', 'notifications']);
  });

  it('resets everything, including privacy switches', async () => {
    const service = new SettingsService(new MemoryStore());
    await service.load();
    await service.update({ diagnostics: true, trustedDevicesOnly: true, theme: 'light' });
    const reset = await service.reset();
    expect(reset).toEqual(DEFAULT_PREFERENCES);
    expect(reset.diagnostics).toBe(false);
  });

  it('does not rewrite the store when nothing changed', async () => {
    const store = new MemoryStore();
    const spy = vi.spyOn(store, 'put');
    const service = new SettingsService(store);
    await service.load();
    expect(spy).not.toHaveBeenCalled();
    await service.update({ theme: 'light' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await store.get(SETTINGS_COLLECTION, SETTINGS_KEY)).toMatchObject({
      theme: 'light',
      v: SETTINGS_VERSION,
    });
  });
});

describe('migrations', () => {
  it('migrates a version 1 file that used a separate rename flag', () => {
    const migrated = migrateSettings({
      v: 1,
      renameOnConflict: true,
      conflictPolicy: 'ask',
      maxConcurrentTransfers: 12,
      theme: 'light',
    });
    expect(migrated.changed).toBe(true);
    expect(migrated.value.conflictPolicy).toBe('rename');
    expect(migrated.value.renameOnConflict).toBeUndefined();
    // The old build allowed 12 parallel transfers; the queue never did.
    expect(migrated.value.maxConcurrentTransfers).toBe(8);
    expect(migrated.value.allowHostedSharing).toBe(true);
    expect(migrated.value.v).toBe(SETTINGS_VERSION);
    // Everything the user had chosen survives.
    expect(migrated.value.theme).toBe('light');
  });

  it('treats a file without a version as version 0 and keeps known keys', () => {
    const { value, fromVersion } = readSettings({ theme: 'light', language: 'en' });
    expect(fromVersion).toBe(0);
    expect(value.theme).toBe('light');
    expect(value.language).toBe('en');
    expect(value.v).toBe(SETTINGS_VERSION);
  });

  it('writes the migrated file back only when the schema changed', async () => {
    const store = new MemoryStore();
    await store.put(SETTINGS_COLLECTION, SETTINGS_KEY, {
      v: 1,
      renameOnConflict: true,
      conflictPolicy: 'ask',
    });
    const service = new SettingsService(store);
    const result = await service.load();
    expect(result.fromVersion).toBe(1);
    expect(result.preferences.conflictPolicy).toBe('rename');
    expect(await store.get(SETTINGS_COLLECTION, SETTINGS_KEY)).toMatchObject({
      v: SETTINGS_VERSION,
      conflictPolicy: 'rename',
    });
  });

  it('survives a garbage payload without throwing', () => {
    expect(() => readSettings('not an object')).not.toThrow();
    expect(readSettings('not an object').value).toEqual(DEFAULT_PREFERENCES);
    expect(readSettings(null).value).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('adresse du relais', () => {
  // Le défaut est « auto », et « auto » ne devine rien : c'est la règle qui a changé
  // ce que fait une application publiée (elle tentait `wss://<son propre hôte>/ws`).
  it('vaut « auto » par défaut, et survit à un aller-retour de stockage', async () => {
    const store = new MemoryStore();
    const service = new SettingsService(store);
    await service.load();
    expect(service.get().signalingUrl).toBe(SIGNALING_AUTO);

    await service.update({ signalingUrl: 'wss://relais.exemple.org/ws' });
    const reloaded = new SettingsService(store);
    await reloaded.load();
    expect(reloaded.get().signalingUrl).toBe('wss://relais.exemple.org/ws');
  });

  it('accepte « none » et une adresse WebSocket, refuse le reste', async () => {
    const service = new SettingsService(new MemoryStore());
    await service.load();
    await service.update({ signalingUrl: SIGNALING_OFF });
    expect(service.get().signalingUrl).toBe(SIGNALING_OFF);

    await service.update({ signalingUrl: '  ws://192.168.1.10:8080/ws  ' });
    expect(service.get().signalingUrl).toBe('ws://192.168.1.10:8080/ws');

    // Deux refus qui comptent : une adresse sans schéma (une faute de frappe) et une
    // valeur qui n'est pas du tout une adresse.
    await expect(service.update({ signalingUrl: 'relais.exemple.org' })).rejects.toThrow();
    await expect(service.update({ signalingUrl: 'https://relais.exemple.org' })).rejects.toThrow();
  });

  it('migre une version 2 sans perdre les préférences', () => {
    const migrated = migrateSettings({ v: 2, language: 'en', theme: 'light', conflictPolicy: 'rename' });
    expect(migrated.changed).toBe(true);
    expect(migrated.value['signalingUrl']).toBe(SIGNALING_AUTO);
    expect(migrated.value['language']).toBe('en');
    expect(migrated.value['theme']).toBe('light');
    expect(migrated.value['conflictPolicy']).toBe('rename');
    expect(migrated.value['v']).toBe(SETTINGS_VERSION);
  });

  it('remplace une adresse stockée invalide au lieu de la garder', () => {
    const read = readSettings({ v: 3, signalingUrl: 'pas-une-adresse' });
    expect(read.value.signalingUrl).toBe(SIGNALING_AUTO);
    expect(read.ignored).toContain('signalingUrl');
  });
});
