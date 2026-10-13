/**
 * Shared rig for the application-layer tests.
 *
 * Two `AppController` instances are wired to each other through a fake signaling
 * service that pairs them exactly like the real one does: one side hosts a room and
 * answers, the other dials the code. Everything between them is the shipping code —
 * the connection manager, the secure handshake, the transfer engine — so what the
 * controller tests and the rendered-interface test assert is what a user gets.
 *
 * This file is not a test: it has no `describe`, so the suite never collects it twice.
 */
import { expect } from 'vitest';
import { systemClock, type Transport } from '@dropforge/protocol';
import type { NotificationChannel, NotificationPermission } from '@dropforge/notifications';
import type { ConnectionTarget, TransportMethod } from '@dropforge/connection-manager';
import { DropForgeError, ERROR_CODES, type FileSystemPort, type MetaStore, type SourceFile } from '@dropforge/app-core';
import { DEFAULT_PREFERENCES, type Preferences } from '@dropforge/settings';
import type { StoredIdentity } from '@dropforge/security';
import { MemoryFileSystem, MemorySource } from '../../../../../tests/helpers/memory-fs.js';
import { MemoryStore } from '../../../../../tests/helpers/memory-store.js';
import { MemoryTransport } from '../../../../../tests/helpers/memory-transport.js';
import { detectCapabilities, type PlatformCapabilities } from '../../platform/capabilities.js';
import { UPDATE_IDLE, noUpdateSource, type UpdateSource } from '../../platform/updater.js';
import {
  AppController,
  newRoomCode,
  pairingLinkFor,
  type IdentityStore,
  type IncomingRequestState,
  type LinkFactory,
  type LinkPeerInfo,
} from '../controller.js';

/* ------------------------------------------------------------------ *
 * Fakes that behave like the real services
 * ------------------------------------------------------------------ */

export class MemoryIdentityStore implements IdentityStore {
  private identity: StoredIdentity | undefined;
  saves = 0;

  async load(): Promise<StoredIdentity | undefined> {
    return this.identity;
  }

  async save(identity: StoredIdentity): Promise<void> {
    this.identity = identity;
    this.saves += 1;
  }
}

/** A signaling service that pairs a hosting peer with the one that dials its code. */
export class FakeRelay {
  private readonly rooms = new Map<string, { resolve: (transport: Transport) => void; reject: (error: unknown) => void }>();
  readonly hostedCodes: string[] = [];

  host(code: string): { code: string; transport: Promise<Transport>; close(): Promise<void> } {
    this.hostedCodes.push(code);
    let settle: { resolve: (transport: Transport) => void; reject: (error: unknown) => void } = {
      resolve: () => {},
      reject: () => {},
    };
    const transport = new Promise<Transport>((resolve, reject) => {
      settle = { resolve, reject };
    });
    this.rooms.set(code, settle);
    return {
      code,
      transport,
      close: async () => {
        const room = this.rooms.get(code);
        this.rooms.delete(code);
        room?.reject(new Error('room closed'));
      },
    };
  }

  dial(code: string, info: LinkPeerInfo, ice: 'ok' | 'fails' = 'ok'): Transport {
    const room = this.rooms.get(code);
    if (!room) throw new Error('unknown room');
    this.rooms.delete(code);
    const [dialer, host] = MemoryTransport.pair();
    room.resolve(host);
    void info;
    void ice;
    return dialer;
  }
}

export class FakeLinkFactory implements LinkFactory {
  constructor(
    private readonly relay: FakeRelay,
    private readonly info: LinkPeerInfo,
    private readonly mode: 'dial' | 'host',
  ) {}

  async create(_method: TransportMethod, target: ConnectionTarget, _signal: AbortSignal): Promise<Transport> {
    if (!target.route) throw new Error('a route is required');
    return this.relay.dial(target.route, this.info);
  }

  async host(code: string): Promise<{ code: string; transport: Promise<Transport>; close(): Promise<void> }> {
    return this.relay.host(code);
  }
}

/** Records what would have been shown, without a browser notification API. */
export class RecordingChannel implements NotificationChannel {
  readonly shown: Array<{ title: string; body: string; tag?: string }> = [];
  readonly supported = true;

  async permission(): Promise<NotificationPermission> {
    return 'granted';
  }

  async requestPermission(): Promise<NotificationPermission> {
    return 'granted';
  }

  async show(request: { title: string; body: string; tag?: string }): Promise<void> {
    this.shown.push(request);
  }

  onActivated(): () => void {
    return () => {};
  }
}

/** Controllers started by a test, stopped afterwards so no timer keeps the suite alive. */
const started: AppController[] = [];

/** Called from `afterEach` in each test file: no timer keeps the suite alive. */
export function stopStartedControllers(): void {
  for (const controller of started.splice(0)) controller.stop();
}

/** Registers a controller built by a test, so it is stopped like the others. */
export function trackController(controller: AppController): AppController {
  started.push(controller);
  return controller;
}

export interface Rig {
  host: AppController;
  guest: AppController;
  channels: { host: RecordingChannel; guest: RecordingChannel };
  hostStore: MemoryStore;
  guestStore: MemoryStore;
  relay: FakeRelay;
  hostReceiveFolder: MemoryFileSystem;
  guestReceiveFolder: MemoryFileSystem;
  identities: { host: MemoryIdentityStore; guest: MemoryIdentityStore };
}

export async function makeRig(options: { capabilities?: Partial<PlatformCapabilities>; updateSource?: UpdateSource } = {}): Promise<Rig> {
  const relay = new FakeRelay();
  const hostStore = new MemoryStore();
  const guestStore = new MemoryStore();
  const identities = { host: new MemoryIdentityStore(), guest: new MemoryIdentityStore() };
  const hostReceiveFolder = new MemoryFileSystem();
  const guestReceiveFolder = new MemoryFileSystem();

  const capabilities = { ...detectCapabilities({ navigator: undefined, window: undefined }), ...options.capabilities };
  const channels = { host: new RecordingChannel(), guest: new RecordingChannel() };

  const controllerFor = (
    store: MetaStore,
    identity: MemoryIdentityStore,
    folder: FileSystemPort,
    mode: 'dial' | 'host',
  ): AppController =>
    new AppController({
      store,
      identities: identity,
      capabilities,
      links: (info) => new FakeLinkFactory(relay, info, mode),
      receiveStore: async () => folder,
      channel: mode === 'host' ? channels.host : channels.guest,
      // The real application translates through i18next; tests read the key back so
      // they assert *which* message is announced, not its wording.
      translate: (key, values) => `${key}${values ? ` ${JSON.stringify(values)}` : ''}`,
      updateSource: options.updateSource ?? noUpdateSource,
      appVersion: '9.9.9-test',
      deviceName: mode === 'host' ? 'Poste fixe' : 'Téléphone',
    });

  const host = controllerFor(hostStore, identities.host, hostReceiveFolder, 'host');
  const guest = controllerFor(guestStore, identities.guest, guestReceiveFolder, 'dial');
  started.push(host, guest);
  return { host, guest, channels, hostStore, guestStore, relay, hostReceiveFolder, guestReceiveFolder, identities };
}

/** Connects both sides and answers the two trust questions the way a user would. */
export async function connectPair(rig: Rig): Promise<void> {
  const room = await rig.host.hostRoom();
  expect(room).toBeDefined();
  const connecting = rig.guest.connectWithCode(room!.code);
  await settle();
  // Both sides are asked about the brand-new device; accepting without remembering
  // is the default and must be enough for the transfer to proceed.
  rig.host.answerNewDevice(true, false);
  await settle();
  rig.guest.answerNewDevice(true, false);
  expect(await connecting).toBe(true);
  await settle();
}

export const settle = async (turns = 24): Promise<void> => {
  for (let index = 0; index < turns; index += 1) {
    await new Promise<void>((resolve) => systemClock.setTimeout(() => resolve(), 0));
  }
};

/**
 * Answers the next incoming request the way the interface would: the decision is
 * taken from the state the controller published, never from a hidden hook.
 */
export function answerNextIncoming(
  controller: AppController,
  decide: (request: IncomingRequestState) => Parameters<AppController['answerIncoming']>[0],
): { answered: Promise<void> } {
  let resolveAnswered: () => void = () => {};
  const answered = new Promise<void>((resolve) => {
    resolveAnswered = resolve;
  });
  const stop = controller.subscribe(() => {
    const incoming = controller.state.incoming;
    if (!incoming) return;
    stop();
    controller.answerIncoming(decide(incoming));
    resolveAnswered();
  });
  return { answered };
}

/** Waits until the controller's own state satisfies a condition, or fails loudly. */
export async function waitFor(
  controller: AppController,
  predicate: () => boolean,
  what: string,
  timeoutMs = 4000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await settle(2);
  }
  const records = controller.state.history.map((record) => ({
    id: record.id,
    state: record.state,
    bytes: `${record.bytesDone}/${record.totalBytes}`,
    error: record.lastErrorCode,
  }));
  const queue = controller.state.queue.map((entry) => ({ id: entry.id, state: entry.state, done: entry.progress?.bytesDone }));
  throw new Error(
    `timed out waiting for ${what}; notices: ${JSON.stringify(controller.state.notices)}; records: ${JSON.stringify(records)}; queue: ${JSON.stringify(queue)}`,
  );
}

/** The record of one transfer, from the store, whatever the in-memory list says. */
export async function recordOf(store: MetaStore, id: string): Promise<Record<string, unknown> | undefined> {
  return await store.get<Record<string, unknown>>('transfers', id);
}
