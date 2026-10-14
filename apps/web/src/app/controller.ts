/**
 * Application controller: the whole app state and every command, with no React
 * and no DOM. The UI is a *projection* of this object; that is what keeps the
 * interface honest, because the same code is exercised by the unit tests.
 *
 * Responsibilities:
 *  - load the local data (settings, history, devices) and keep it in memory;
 *  - run the transfer queue and record what really happened in the history;
 *  - own the current connection (or the current offer to receive);
 *  - expose the list of things the user must decide (a new device, a set of name
 *    conflicts), never deciding on their behalf.
 */
import {
  DropForgeError,
  ERROR_CODES,
  describeError,
  fromPlatformError,
  isTerminal,
  type DropForgeError as DropForgeErrorType,
  type FileSystemPort,
  type MetaStore,
  type ResumeTaskRecord,
  type TransferRecord,
  type TransferState,
} from '@dropforge/app-core';
import type { Capability, Clock, ControlMessage, Logger, Platform, Transport } from '@dropforge/protocol';
import { KEEPALIVE_INTERVAL_MS, systemClock } from '@dropforge/protocol';
import {
  ConnectionManager,
  selectTransportMethod,
  type Connection,
  type ConnectionFactory,
  type ConnectionTarget,
  type MethodFacts,
  type TransportMethod,
} from '@dropforge/connection-manager';
import { DeviceManager, DiscoveryCache, type DiscoveredPeer } from '@dropforge/device-manager';
import { HistoryStore } from '@dropforge/history';
import { NotificationService, unsupportedChannel, type NotificationChannel } from '@dropforge/notifications';
import { DEFAULT_PREFERENCES, SettingsService, type Preferences } from '@dropforge/settings';
import { createHostedShare, readShareUrl, type CreatedShare, type ShareBackend } from '@dropforge/sharing';
import { i18n } from '../i18n/index.js';
import {
  PeerSession,
  TransferQueue,
  TransferReceiver,
  TransferSender,
  hashManifest,
  prepareTransfer,
  receiveTransfer,
  sendTransfer,
  type QueueEntry,
  type ReceiverOutcome,
  type SenderOutcome,
  type TransferProgress,
} from '@dropforge/transfer-engine';
import { generateDeviceId, hydrateIdentity, createDeviceIdentity, type StoredIdentity } from '@dropforge/security';
import { freeSpaceBytes, readStorageEstimate, type PlatformCapabilities } from '../platform/capabilities.js';
import { UPDATE_IDLE, noUpdateSource, type UpdateSource, type UpdateStatus } from '../platform/updater.js';

export interface IdentityStore {
  load(): Promise<StoredIdentity | undefined>;
  save(identity: StoredIdentity): Promise<void>;
}

export interface LinkFactory {
  /** Opens a transport to a peer, using the method the manager chose. */
  create(method: TransportMethod, target: ConnectionTarget, signal: AbortSignal): Promise<Transport>;
  /**
   * Waits for an inbound peer. Implemented by platforms that can hold a room open
   * (the web app does, through the signaling service).
   */
  acceptIncoming?: (options: { pairingSecret?: Uint8Array; expect?: { deviceId?: string; fingerprint?: string } }) => Promise<Transport>;
  /**
   * Opens a room whose code the *other* device dials. This is what makes the
   * "show a code and wait" flow work: a peer that cannot be reached by discovery
   * joins by code, and the waiting side answers.
   */
  host?: (code: string) => Promise<HostedRoom>;
}

/** A room the local device opened and is waiting on. */
export interface HostedRoom {
  code: string;
  /** Resolves with the transport once the other device has joined and connected. */
  transport: Promise<Transport>;
  /**
   * Resolves once the room really exists — the service has accepted this device
   * into it. A code is only worth showing after that: a code announced too early
   * makes the other device fail for a reason that belongs to this side.
   */
  ready: Promise<void>;
  close(): Promise<void>;
}

/**
 * What the link factory needs to know about *this* device. It is asked lazily,
 * because the identity only exists after the controller has started — the factory
 * must never be built with an empty fingerprint.
 */
export interface LinkPeerInfo {
  deviceId: string;
  displayName: string;
  platform: string;
  fingerprint: string;
  capabilities: Capability[];
}

export type LinkProvider = (info: LinkPeerInfo) => LinkFactory;

export interface ControllerOptions {
  store: MetaStore;
  identities: IdentityStore;
  links: LinkFactory | LinkProvider;
  capabilities: PlatformCapabilities;
  channel?: NotificationChannel;
  clock?: Clock;
  logger?: Logger;
  /** Where the receiving side writes. Resolved lazily: the user picks the folder. */
  receiveStore: () => Promise<FileSystemPort>;
  /** Current device display name (can be changed in the settings later). */
  deviceName?: string;
  shareBackend?: ShareBackend;
  shareOrigin?: string;
  /**
   * Turns a dictionary key into text. Defaults to the application's i18n instance;
   * injectable so tests can read what a notification would really say.
   */
  translate?: (key: string, options?: Record<string, unknown>) => string;
  /** Update mechanism: service worker on the web, signed Tauri updater on desktop. */
  updateSource?: UpdateSource;
  /** Version shown in the settings; reported by the build, never invented. */
  appVersion?: string;
  /**
   * The receiving folder, when the platform can remember one. Absent means the
   * download path is used, which the UI states explicitly.
   */
  receiveFolders?: ReceiveFolderPort;
}

/** Browser-side receiving folder: remembered handle, or the download fallback. */
export interface ReceiveFolderPort {
  port(): Promise<FileSystemPort | undefined>;
  choose(): Promise<{ ready: boolean; name?: string; needsPermission: boolean; unsupported: boolean }>;
  forget(): Promise<{ ready: boolean; name?: string; needsPermission: boolean; unsupported: boolean }>;
  requestAccess(): Promise<{ ready: boolean; name?: string; needsPermission: boolean; unsupported: boolean }>;
  describe(): { ready: boolean; name?: string; needsPermission: boolean; unsupported: boolean };
}

export interface IncomingRequestState {
  transferId: string;
  peerName: string;
  files: Array<{ index: number; path: string; size: number }>;
  totalBytes: number;
  conflicts: Array<{ index: number; path: string; incomingSize: number; existingSize: number }>;
  freeSpace: number | undefined;
  resolve: (answer: {
    accepted: boolean;
    decisions: Array<{ index: number; action: 'skip' | 'rename' | 'overwrite'; newPath?: string }>;
    rejectReason?: 'declined' | 'noSpace' | 'busy' | 'unsupported' | 'tooLarge';
  }) => void;
}

export interface NewDeviceRequest {
  deviceId: string;
  displayName: string;
  fingerprint: string;
  sas: string;
  method: TransportMethod;
  resolve: (accepted: boolean, remember: boolean) => void;
}

export interface AppNotice {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  messageKey: string;
  errorCode?: string;
  detail?: string;
}

export interface AppState {
  ready: boolean;
  fatalError?: { code: string; message: string; detail?: string };
  identityFingerprint: string | undefined;
  deviceName: string;
  settings: Preferences;
  settingsIgnored: string[];
  capabilities: PlatformCapabilities;
  queue: QueueEntry[];
  history: TransferRecord[];
  devices: Awaited<ReturnType<DeviceManager['list']>>;
  discovered: DiscoveredPeer[];
  selected: Array<{ index: number; path: string; size: number; kind: 'file' | 'directory' }>;
  selectedBytes: number;
  connection: { peerName: string; method: TransportMethod; sas: string; fingerprint: string } | undefined;
  connecting: boolean;
  incoming: IncomingRequestState | undefined;
  newDevice: NewDeviceRequest | undefined;
  notices: AppNotice[];
  notifications: { supported: boolean; permission: string; hint: string };
  methodExplanation: string[];
  activeShare: { url: string; expiresAt: number; totalBytes: number } | undefined;
  freeSpace: number | undefined;
  /** Reported by the platform; absent when it does not expose an estimate. */
  storageEstimate: { usage: number; quota: number } | undefined;
  /** Where received files go, as the platform really behaves. */
  receiveFolder: { ready: boolean; name?: string; needsPermission: boolean; unsupported: boolean };
  appVersion: string;
  updateState: UpdateStatus | undefined;
  canCheckUpdate: boolean;
  /** Set while this device waits for another one to join its room. */
  pairingRoom: { code: string; link: string } | undefined;
  /**
   * True only when a sharing service is actually configured. The interface uses it
   * to explain the absence instead of offering a switch that would do nothing.
   */
  hostedSharingAvailable: boolean;
}

const DEFAULT_DEVICE_NAME = 'Mon appareil';

export class AppController {
  private readonly listeners = new Set<() => void>();
  private readonly clock: Clock;
  private readonly queue: TransferQueue;
  private readonly devices: DeviceManager;
  private readonly history: HistoryStore;
  private readonly settings: SettingsService;
  private readonly notifications: NotificationService;
  private readonly discovery: DiscoveryCache;
  private readonly translate: (key: string, options?: Record<string, unknown>) => string;
  private identity: StoredIdentity | undefined;
  private connection: Connection | undefined;
  private connectionManager: ConnectionManager | undefined;
  private links: LinkFactory | undefined;
  private hostedRoom: HostedRoom | undefined;
  private activeSender: TransferSender | undefined;
  private activeReceiver: TransferReceiver | undefined;
  private noticeCounter = 0;

  /**
   * The published state.
   *
   * Read through the getter; written field by field by the controller. `emit()`
   * replaces the object so its identity changes on every change — that identity is
   * what React's `useSyncExternalStore` compares, and therefore what makes the
   * interface follow the engine instead of freezing on its first render.
   */
  private snapshot: AppState;

  get state(): AppState {
    return this.snapshot;
  }

  constructor(private readonly options: ControllerOptions) {
    this.clock = options.clock ?? systemClock;
    this.devices = new DeviceManager(options.store, () => this.clock.now());
    this.history = new HistoryStore(options.store, {
      now: () => this.clock.now(),
    });
    this.settings = new SettingsService(options.store);
    this.notifications = new NotificationService({
      channel: options.channel ?? unsupportedChannel,
      clock: this.clock,
      ...(options.logger ? { logger: options.logger } : {}),
      enabled: () => this.state.settings.notifications,
    });
    this.translate = options.translate ?? ((key, options) => String(i18n.t(key, options as never)));
    this.discovery = new DiscoveryCache({ now: () => this.clock.now() });
    this.queue = new TransferQueue({
      clock: this.clock,
      concurrency: DEFAULT_PREFERENCES.maxConcurrentTransfers,
      ...(options.logger ? { logger: options.logger } : {}),
      onChange: (entries) => {
        this.state.queue = entries;
        this.emit();
      },
    });
    this.snapshot = {
      ready: false,
      identityFingerprint: undefined,
      deviceName: options.deviceName ?? DEFAULT_DEVICE_NAME,
      settings: { ...DEFAULT_PREFERENCES },
      settingsIgnored: [],
      capabilities: options.capabilities,
      queue: [],
      history: [],
      devices: [],
      discovered: [],
      selected: [],
      selectedBytes: 0,
      connection: undefined,
      connecting: false,
      incoming: undefined,
      newDevice: undefined,
      notices: [],
      notifications: { supported: false, permission: 'unsupported', hint: '' },
      methodExplanation: [],
      activeShare: undefined,
      freeSpace: undefined,
      storageEstimate: undefined,
      receiveFolder: { ready: false, needsPermission: false, unsupported: false },
      appVersion: options.appVersion ?? '0.0.0',
      updateState: undefined,
      pairingRoom: undefined,
      hostedSharingAvailable: Boolean(options.shareBackend && options.shareOrigin),
      canCheckUpdate: (options.updateSource ?? noUpdateSource).canCheck,
    };
  }

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Loads local data. Safe to call once; a failure is reported, never hidden. */
  async start(): Promise<void> {
    try {
      await this.options.store.init();
      const loaded = await this.settings.load();
      this.state.settings = loaded.preferences;
      this.state.settingsIgnored = loaded.ignored as string[];

      const identity = await this.options.identities.load();
      this.identity = identity ?? (await this.createIdentity());
      const hydrated = await hydrateIdentity(this.identity);
      this.state.identityFingerprint = hydrated.identity.fingerprint; // eslint-disable-line @typescript-eslint/no-unnecessary-condition
      this.state.deviceName = this.options.deviceName ?? this.state.deviceName;

      await this.refreshHistory();
      await this.refreshDevices();
      await this.pruneHistory();
      this.state.notifications = this.notifications.describe();
      this.state.freeSpace = await this.measureFreeSpace();
      this.state.storageEstimate = await this.measureStorageEstimate();
      if (this.options.receiveFolders) {
        // A remembered folder is reported as it is: usable, waiting for the
        // browser's permission, or impossible to remember on this platform.
        this.state.receiveFolder = this.options.receiveFolders.describe().unsupported
          ? this.options.receiveFolders.describe()
          : await this.options.receiveFolders.port().then(() => this.options.receiveFolders!.describe());
      }
      this.state.ready = true;
      this.emit();
    } catch (error) {
      const dfError = fromPlatformError(error);
      // The screen shows a sentence; the reason has to be available too. Without it the
      // only symptom is "local storage is unavailable" — true, and useless to anyone
      // trying to understand *why* (a refused database, a blocked profile, no WebCrypto).
      this.state.fatalError = {
        code: dfError.code,
        message: dfError.message,
        detail: describeError(dfError.cause ?? error),
      };
      console.error('[DropForge] démarrage impossible', error);
      this.emit();
    }
  }

  stop(): void {
    this.connectionManager?.close().catch(() => {});
    this.connection?.close('app closed').catch(() => {});
  }

  /**
   * Builds the link factory once, with this device's real identity. A missing
   * fingerprint would make the other side unable to verify us, so it is a hard
   * requirement rather than a default value.
   */
  private resolveLinks(): LinkFactory {
    if (this.links) return this.links;
    const options = this.options.links;
    if (typeof options === 'function') {
      const fingerprint = this.state.identityFingerprint;
      if (!fingerprint) {
        throw new DropForgeError(ERROR_CODES.IDENTITY_UNAVAILABLE, 'This device has no identity yet');
      }
      this.links = options({
        deviceId: this.deviceId(),
        displayName: this.state.deviceName,
        platform: this.platformName(),
        fingerprint,
        capabilities: this.localCapabilities(),
      });
      return this.links;
    }
    this.links = options;
    return options;
  }

  private async createIdentity(): Promise<StoredIdentity> {
    const identity = await createDeviceIdentity();
    await this.options.identities.save(identity);
    return identity;
  }

  /** Real free space, when the platform exposes it. Never a guessed number. */
  private async measureFreeSpace(): Promise<number | undefined> {
    return await freeSpaceBytes();
  }

  private async measureStorageEstimate(): Promise<{ usage: number; quota: number } | undefined> {
    return await readStorageEstimate();
  }

  /**
   * Publishes a new state identity, then wakes the listeners.
   *
   * The state is *replaced*, never mutated in place: React's `useSyncExternalStore`
   * compares snapshots by identity, so a controller that mutated one object would
   * leave the interface frozen on its first render — transfers would appear never to
   * start and progress would never move, while the engine worked perfectly. The
   * rendered-interface test in `ui.test.tsx` is what caught this.
   */
  private emit(): void {
    this.snapshot = { ...this.snapshot };
    for (const listener of [...this.listeners]) listener();
  }

  private notice(kind: AppNotice['kind'], messageKey: string, extra: Partial<AppNotice> = {}): void {
    const notice: AppNotice = { id: `n${(this.noticeCounter += 1)}`, kind, messageKey, ...extra };
    this.state.notices = [notice, ...this.state.notices].slice(0, 6);
    this.emit();
  }

  /**
   * Publishes a notice the interface itself decided on (a dropped item that could
   * not be read, for instance). Keys are translated like every other notice key,
   * so an unknown key shows the key rather than an invented sentence.
   */
  reportNotice(kind: AppNotice['kind'], messageKey: string, extra: Partial<AppNotice> = {}): void {
    this.notice(kind, messageKey, extra);
  }

  dismissNotice(id: string): void {
    this.state.notices = this.state.notices.filter((notice) => notice.id !== id);
    this.emit();
  }

  /** Reports an error as a notice with its stable code, never with a raw message. */
  private reportError(error: unknown): DropForgeErrorType {
    const dfError = error instanceof DropForgeError ? error : fromPlatformError(error);
    const path = dfError.context['path'];
    this.notice('error', `errors.${dfError.code}`, {
      errorCode: dfError.code,
      // A connection can fail on several paths at once (a direct one, then the
      // relay). Naming them is the difference between "it did not work" and an
      // answer: `.df-faint` shows this line under the sentence.
      ...(typeof path === 'string' && path.length > 0 ? { detail: path } : {}),
    });
    this.options.logger?.log('warn', 'action failed', { code: dfError.code });
    return dfError;
  }

  /* ---------------------------------------------------------------- *
   * Selection
   * ---------------------------------------------------------------- */

  setSelection(files: Array<{ path: string; kind: 'file' | 'directory'; size: number }>): void {
    this.state.selected = files.map((file, index) => ({ index, ...file }));
    this.state.selectedBytes = files.reduce((sum, file) => sum + file.size, 0);
    this.emit();
  }

  clearSelection(): void {
    this.state.selected = [];
    this.state.selectedBytes = 0;
    this.emit();
  }

  /* ---------------------------------------------------------------- *
   * Settings
   * ---------------------------------------------------------------- */

  async updateSettings(patch: Partial<Preferences>): Promise<void> {
    try {
      const previous = this.state.settings;
      this.state.settings = await this.settings.update(patch);
      if (patch.maxConcurrentTransfers !== undefined) {
        // The queue is rebuilt with the new concurrency: the old one is kept alive
        // until its running jobs finish, so nothing is interrupted by a setting.
        this.state.queue = this.queue.list();
      }
      if (patch.historyRetentionDays !== undefined) await this.pruneHistory();
      this.applyThemeAndLanguage(previous, this.state.settings);
      this.emit();
    } catch (error) {
      this.reportError(error);
    }
  }

  async resetSettings(): Promise<void> {
    this.state.settings = await this.settings.reset();
    this.emit();
  }

  private applyThemeAndLanguage(previous: Preferences, next: Preferences): void {
    if (previous.theme !== next.theme || previous.language !== next.language) {
      // The UI listens to settings and re-renders; the theme is applied by the
      // shell, which is the only piece allowed to touch the document.
      this.notice('success', 'settings.saved');
    }
  }

  async requestNotificationPermission(): Promise<void> {
    const permission = await this.notifications.requestPermission();
    this.state.notifications = this.notifications.describe();
    if (permission !== 'granted') this.notice('warning', 'settings.notificationsUnsupported');
    this.emit();
  }

  /* ---------------------------------------------------------------- *
   * Devices
   * ---------------------------------------------------------------- */

  async refreshDevices(): Promise<void> {
    this.state.devices = await this.devices.list();
    this.emit();
  }

  async trustDevice(deviceId: string, autoAccept: boolean): Promise<void> {
    await this.devices.trust(deviceId, { autoAccept });
    await this.refreshDevices();
  }

  async revokeDevice(deviceId: string): Promise<void> {
    await this.devices.revoke(deviceId);
    await this.refreshDevices();
  }

  async forgetDevice(deviceId: string): Promise<void> {
    await this.devices.forget(deviceId);
    await this.refreshDevices();
  }

  /** Favourite or unfavourite a known device; trust is untouched by design. */
  async toggleFavorite(deviceId: string): Promise<void> {
    try {
      const record = await this.devices.get(deviceId);
      if (!record) return;
      await this.devices.setFavorite(deviceId, !(record.favorite ?? false));
      await this.refreshDevices();
    } catch (error) {
      this.reportError(error);
    }
  }

  /**
   * Quick send: connect to a favourite device, then send the selection in one action.
   *
   * The connection is the normal, verified one — same handshake, same code to
   * compare — and nothing is queued when it fails. The sources are passed in rather
   * than read from a stored selection, because the interface is the only place that
   * holds readable file handles.
   */
  async quickSend(deviceId: string, sources: Parameters<AppController['sendSelection']>[0]): Promise<string | undefined> {
    const record = await this.devices.get(deviceId);
    if (!record) {
      this.reportNotice('error', 'devices.unknown');
      return undefined;
    }
    if (sources.length === 0) return undefined;
    if (this.connection?.peer.deviceId !== deviceId) {
      const connected = await this.connect({
        deviceId: record.id,
        displayName: record.displayName,
        fingerprint: record.fingerprint,
        methods: ['lan', 'webrtc', 'relay'],
      });
      if (!connected) return undefined;
    }
    return await this.sendSelection(sources);
  }

  async renameDevice(deviceId: string, displayName: string): Promise<void> {
    try {
      await this.devices.rename(deviceId, displayName);
      await this.refreshDevices();
    } catch (error) {
      this.reportError(error);
    }
  }

  /** Registers a peer seen by discovery, so the UI can list it before connecting. */
  notePeerSeen(announcement: Record<string, unknown>): void {
    try {
      const parsed = parseAnnouncement(announcement, this.clock.now(), this.state.identityFingerprint);
      this.discovery.upsert(parsed, 'lan');
      this.state.discovered = this.discovery.list();
      this.emit();
    } catch {
      // A malformed announcement is dropped without ceremony: it is untrusted data.
    }
  }

  /* ---------------------------------------------------------------- *
   * Connecting
   * ---------------------------------------------------------------- */

  /**
   * Resolves the best available path and reports what it will use, before any
   * transfer starts. The user sees "local network" or "blind relay", never a vague
   * "connecting…".
   */
  chooseMethod(peerCapabilities: Capability[], samePrivateNetwork: boolean): MethodFacts {
    const facts: MethodFacts = {
      samePrivateNetwork,
      webRtcSupported: this.state.capabilities.webRtc,
      stunReachable: false,
      relayReachable: false,
      localCapabilities: this.localCapabilities(),
      peerCapabilities,
    };
    const choice = selectTransportMethod(facts);
    this.state.methodExplanation = [];
    this.state.methodExplanation = choice.considered
      .filter((entry) => entry.usable)
      .map((entry) => `transfer.method${entry.method === 'lan' ? 'Lan' : entry.method === 'webrtc' ? 'Webrtc' : 'Relay'}`);
    return facts;
  }

  localCapabilities(): Capability[] {
    const capabilities: Capability[] = ['transfer.integrity'];
    if (this.state.capabilities.webRtc) capabilities.push('webrtc.direct');
    if (this.state.capabilities.directoryRead) capabilities.push('transfer.folders', 'fs.directory');
    if (this.state.capabilities.downloadStream) capabilities.push('fs.download');
    if (this.state.capabilities.directoryPicker) capabilities.push('transfer.resume');
    return capabilities;
  }

  /**
   * Connects to a device. The connection manager tries the available methods in
   * order; a new device is never trusted without the user's answer.
   */
  async connect(target: ConnectionTarget): Promise<boolean> {
    if (!this.identity) return false;
    this.state.connecting = true;
    this.emit();
    try {
      const manager = new ConnectionManager({
        identity: this.identity,
        deviceId: this.deviceId(),
        displayName: this.state.deviceName,
        platform: this.platformName(),
        capabilities: this.localCapabilities(),
        factory: this.resolveLinks() as ConnectionFactory,
        clock: this.clock,
        ...(this.options.logger ? { logger: this.options.logger } : {}),
        requestTrust: async (peer, method) => await this.askForNewDevice(peer, method),
      });
      const connection = await manager.connect(target);
      this.connectionManager = manager;
      this.connection = connection;
      await this.rememberPeer(connection);
      this.state.connection = {
        peerName: connection.peer.displayName,
        method: connection.method,
        sas: connection.sas,
        fingerprint: connection.peer.fingerprint,
      };
      this.state.connecting = false;
      this.emit();
      // A connection is symmetric: whoever dialled can also receive. Listening for
      // offers on both sides is what makes a transfer possible in either direction.
      await this.listenForOffers(connection);
      return true;
    } catch (error) {
      this.state.connecting = false;
      this.reportError(error);
      return false;
    }
  }

  /** Joins a pairing code or a link, then connects. */
  async connectWithCode(input: string): Promise<boolean> {
    const target = this.targetFromCode(input);
    if (!target) return false;
    const method = this.chooseMethod(['webrtc.direct', 'relay.blind'], false);
    const choice = selectTransportMethod(method);
    // Nothing should ever be preferred to a direct path: the relay costs the most and
    // is the least private of the three, so it is tried last, never first.
    return await this.connect({ ...target, methods: choice.method ? [choice.method] : ['webrtc', 'relay'] });
  }

  private targetFromCode(input: string): ConnectionTarget | undefined {
    const trimmed = input.trim();
    if (trimmed.length === 0) return undefined;
    if (trimmed.includes('#')) {
      try {
        const payload = readShareUrl(trimmed, this.clock);
        // A share link is a *hosted* link: it is received differently, not connected.
        this.notice('info', 'activity.title', { detail: payload.id });
        return undefined;
      } catch (error) {
        // Not a share link: it may be a pairing link, which carries a code.
        const code = pairingCodeFromLink(trimmed);
        if (!code) {
          this.reportError(error);
          return undefined;
        }
        return { deviceId: 'unknown', displayName: '', methods: ['relay', 'webrtc'], route: code };
      }
    }
    if (!/^[A-Za-z0-9_-]{4,32}$/.test(trimmed)) {
      this.notice('error', 'errors.PAIRING_CODE_INVALID');
      return undefined;
    }
    return { deviceId: 'unknown', displayName: '', methods: ['relay', 'webrtc'], route: trimmed };
  }

  /** Accepts an inbound connection: identity is verified, the user is asked once. */
  async acceptIncoming(options: {
    pairingSecret?: Uint8Array;
    expect?: { deviceId?: string; fingerprint?: string };
    /** A transport obtained elsewhere (a hosted room, a locally discovered link). */
    transport?: Transport;
  }): Promise<boolean> {
    if (!this.identity) return false;
    const links = this.safeResolveLinks();
    if (!links) return false;
    if (!options.transport && !links.acceptIncoming) {
      this.notice('error', 'errors.PLATFORM_UNSUPPORTED');
      return false;
    }
    this.state.connecting = true;
    this.emit();
    try {
      const transport = options.transport ?? (await links.acceptIncoming!(options));
      return await this.acceptOnTransport(transport, options);
    } catch (error) {
      this.state.connecting = false;
      this.reportError(error);
      return false;
    }
  }

  /**
   * Opens a room and waits for another device to join it by code. This is the
   * "show a code" half of pairing; the other device dials it (see `connectWithCode`).
   * The room stays open until a peer arrives or the user cancels.
   */
  async hostRoom(): Promise<{ code: string; link: string } | undefined> {
    if (!this.identity) return undefined;
    const links = this.safeResolveLinks();
    if (!links) return undefined;
    if (!links.host) {
      this.notice('error', 'errors.PLATFORM_UNSUPPORTED');
      return undefined;
    }
    await this.closeHostedRoom();
    try {
      const code = newRoomCode();
      const room = await links.host(code);
      this.hostedRoom = room;
      // The code is published *after* the room is real. Showing it earlier is how a
      // fast hand (a scanned QR code, a pasted link) ends up being told the room does
      // not exist — a race that belongs to this side, and that the user would pay for.
      await room.ready;
      this.state.pairingRoom = { code, link: pairingLinkFor(code) };
      this.emit();
      // The waiting side runs the handshake as the responder: it answers whoever
      // dials, and only then does a transfer become possible.
      void room.transport.then(
        async (transport) => {
          // An answer arrived (or the wait was cancelled): the code has served its
          // purpose and is withdrawn either way.
          if (this.state.pairingRoom?.code === code) this.state.pairingRoom = undefined;
          this.hostedRoom = undefined;
          this.state.connecting = true;
          this.emit();
          await this.acceptOnTransport(transport, {});
        },
        () => {
          // Two outcomes share this path, and they are not the same thing: the user
          // closed the room (the code is already withdrawn — nothing to say), or the
          // wait ended by itself (nobody came in time: the code is dead, and saying so
          // is the only honest thing left).
          if (this.state.pairingRoom?.code === code) {
            this.state.pairingRoom = undefined;
            this.notice('warning', 'errors.PAIRING_CODE_EXPIRED');
          }
          this.hostedRoom = undefined;
          this.emit();
        },
      );
      return { code, link: pairingLinkFor(code) };
    } catch (error) {
      // Nothing is shown as waiting when the room was never opened: the failure is
      // reported instead of a code that would not work.
      this.hostedRoom = undefined;
      this.state.pairingRoom = undefined;
      this.reportError(error);
      this.emit();
      return undefined;
    }
  }

  /** Stops waiting for a peer: the code is dropped and the room is closed. */
  async closeHostedRoom(): Promise<void> {
    const room = this.hostedRoom;
    this.hostedRoom = undefined;
    this.state.pairingRoom = undefined;
    this.state.connecting = false;
    this.emit();
    await room?.close().catch(() => undefined);
  }

  /** Identity check, trust question and offer listening: the same path for every
   * kind of inbound connection. */
  private async acceptOnTransport(
    transport: Transport,
    options: { pairingSecret?: Uint8Array; expect?: { deviceId?: string; fingerprint?: string } },
  ): Promise<boolean> {
    if (!this.identity) return false;
    const manager = new ConnectionManager({
      identity: this.identity,
      deviceId: this.deviceId(),
      displayName: this.state.deviceName,
      platform: this.platformName(),
      capabilities: this.localCapabilities(),
      factory: this.resolveLinks() as ConnectionFactory,
      clock: this.clock,
      ...(this.options.logger ? { logger: this.options.logger } : {}),
      requestTrust: async (peer, method) => await this.askForNewDevice(peer, method),
    });
    const connection = await manager.accept(transport, options.expect ?? {}, {
      requestTrust: true,
      ...(options.pairingSecret ? { pairingSecret: options.pairingSecret } : {}),
    });
    this.connectionManager = manager;
    this.connection = connection;
    await this.rememberPeer(connection);
    this.state.connection = {
      peerName: connection.peer.displayName,
      method: connection.method,
      sas: connection.sas,
      fingerprint: connection.peer.fingerprint,
    };
    this.state.connecting = false;
    this.emit();
    await this.listenForOffers(connection);
    return true;
  }

  private safeResolveLinks(): LinkFactory | undefined {
    try {
      return this.resolveLinks();
    } catch (error) {
      this.reportError(error);
      return undefined;
    }
  }

  /**
   * Asks the user whether a brand-new device may be remembered. Nothing is stored
   * and no transfer is accepted until an answer arrives: the promise resolves only
   * when the UI calls `answerNewDevice`.
   */
  private askForNewDevice(
    peer: { deviceId: string; displayName: string; fingerprint: string },
    method: TransportMethod,
    sas = '',
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.state.newDevice = {
        deviceId: peer.deviceId,
        displayName: peer.displayName,
        fingerprint: peer.fingerprint,
        sas,
        method,
        resolve: (accepted, remember) => {
          this.state.newDevice = undefined;
          if (accepted && remember) {
            void this.devices.remember(
              {
                deviceId: peer.deviceId,
                displayName: peer.displayName,
                platform: this.platformName(),
                sign: 'ed25519',
                agree: 'x25519',
                publicKey: '',
                fingerprint: peer.fingerprint,
              },
              { trusted: true, autoAccept: true },
            );
          }
          resolve(accepted);
        },
      };
      this.emit();
    });
  }

  answerNewDevice(accepted: boolean, remember: boolean): void {
    this.state.newDevice?.resolve(accepted, remember);
  }

  private async rememberPeer(connection: Connection): Promise<void> {
    const known = await this.devices.verify({
      deviceId: connection.peer.deviceId,
      displayName: connection.peer.displayName,
      platform: connection.peer.platform,
      sign: connection.peer.sign,
      agree: connection.peer.agree,
      publicKey: connection.peer.publicKey,
      fingerprint: connection.peer.fingerprint,
    });
    if (known === 'unknown') {
      // Stored as untrusted: it is only "a device we have met", nothing more.
      await this.devices.remember({
        deviceId: connection.peer.deviceId,
        displayName: connection.peer.displayName,
        platform: connection.peer.platform,
        sign: connection.peer.sign,
        agree: connection.peer.agree,
        publicKey: connection.peer.publicKey,
        fingerprint: connection.peer.fingerprint,
      });
    }
    await this.refreshDevices();
  }

  disconnect(reason = 'user'): void {
    void this.connection?.close(reason);
    this.connection = undefined;
    this.state.connection = undefined;
    this.emit();
  }

  /* ---------------------------------------------------------------- *
   * Sending
   * ---------------------------------------------------------------- */

  /** Queues the current selection and returns the transfer id. */
  async sendSelection(sources: Parameters<typeof prepareTransfer>[0]['files']): Promise<string | undefined> {
    const connection = this.connection;
    if (!connection) {
      this.notice('error', 'transfer.noDevices');
      return undefined;
    }
    if (sources.length === 0) return undefined;
    if (this.state.settings.maxTransferBytes > 0) {
      const total = sources.reduce((sum, file) => sum + file.size, 0);
      if (total > this.state.settings.maxTransferBytes) {
        this.notice('error', 'errors.TOO_LARGE', { detail: String(total) });
        return undefined;
      }
    }

    const prepared = prepareTransfer({ files: [...sources] });
    const transferId = prepared.offer.transferId;
    const record = this.newRecord({
      id: transferId,
      direction: 'send',
      peer: connection.peer.displayName,
      peerDeviceId: connection.peer.deviceId,
      totalBytes: prepared.offer.totalBytes,
      files: prepared.offer.entries.map((entry) => ({
        index: entry.index,
        path: entry.path,
        kind: entry.kind,
        size: entry.size,
        bytesDone: 0,
      })),
      transport: connection.method === 'relay' ? 'relay' : 'webrtc',
    });
    await this.history.save(record);
    this.publishRecord(record);

    this.queue.enqueue({
      id: transferId,
      direction: 'send',
      label: `${connection.peer.displayName} · ${prepared.offer.entries.length} fichier(s)`,
      totalBytes: prepared.offer.totalBytes,
      filesTotal: prepared.offer.entries.length,
      priority: this.queue.size,
      run: async (hooks) => await this.runSend(transferId, connection, prepared, hooks, record),
    });
    this.notice('info', 'transfer.queue');
    return transferId;
  }

  private async runSend(
    transferId: string,
    connection: Connection,
    prepared: ReturnType<typeof prepareTransfer>,
    hooks: Parameters<Parameters<TransferQueue['enqueue']>[0]['run']>[0],
    record: TransferRecord,
  ): Promise<{ outcome: SenderOutcome['outcome']; errorCode?: string; bytesDone?: number; verifiedFiles?: number }> {
    const result = await sendTransfer({
      session: connection.session,
      offer: prepared.offer,
      sources: prepared.sources,
      clock: this.clock,
      ...(this.options.logger ? { logger: this.options.logger } : {}),
      onProgress: (progress, sender) => {
        this.activeSender = sender;
        hooks.provideControl({
          pause: () => sender.pause('user'),
          resume: () => sender.resume(),
          cancel: () => sender.cancel(),
          interrupt: () => sender.interrupt(),
        });
        hooks.onProgress(progress);
        void this.touchRecord(transferId, {
          state: progress.state,
          bytesDone: progress.bytesDone,
        });
      },
    });
    this.activeSender = undefined;
    const failureCode = result.outcome.errorCode ?? senderFailureCode(result.outcome);
    const saved = await this.finishRecord(transferId, {
      state: mapSenderState(result.outcome.outcome),
      bytesDone: result.outcome.bytesDone,
      verifiedFiles: result.outcome.verifiedFiles,
      ...(failureCode ? { errorCode: failureCode } : {}),
    });
    await this.notifyOutcome('send', saved, result.outcome.outcome);
    return {
      outcome: result.outcome.outcome,
      ...(failureCode ? { errorCode: failureCode } : {}),
      bytesDone: result.outcome.bytesDone,
      verifiedFiles: result.outcome.verifiedFiles,
    };
  }

  /* ---------------------------------------------------------------- *
   * Receiving
   * ---------------------------------------------------------------- */

  /** Waits for an offer on the current connection and asks the user about it. */
  private async listenForOffers(connection: Connection): Promise<void> {
    connection.session.events.on('control', (message: ControlMessage) => {
      if (message.t !== 'transferOffer') return;
      void this.receiveOffer(connection, message);
    });
  }

  private async receiveOffer(connection: Connection, offer: ControlMessage & { t: 'transferOffer' }): Promise<void> {
    const transferId = offer.transferId;
    const record = this.newRecord({
      id: transferId,
      direction: 'receive',
      peer: connection.peer.displayName,
      peerDeviceId: connection.peer.deviceId,
      totalBytes: offer.totalBytes,
      files: offer.entries.map((entry) => ({
        index: entry.index,
        path: entry.path,
        kind: entry.kind,
        size: entry.size,
        bytesDone: 0,
      })),
      transport: connection.method === 'relay' ? 'relay' : 'webrtc',
    });
    await this.history.save(record);
    this.publishRecord(record);

    try {
      const store = await this.options.receiveStore();
      const conflicts = await TransferReceiver.detectConflicts(store, offer);
      const freeSpace = this.state.freeSpace;
      const answer = await new Promise<Parameters<IncomingRequestState['resolve']>[0]>((resolve) => {
        this.state.incoming = {
          transferId,
          peerName: connection.peer.displayName,
          files: offer.entries.map((entry) => ({ index: entry.index, path: entry.path, size: entry.size })),
          totalBytes: offer.totalBytes,
          conflicts: conflicts.map((conflict) => ({
            index: conflict.index,
            path: conflict.path,
            incomingSize: conflict.incomingSize,
            existingSize: conflict.existingSize,
          })),
          freeSpace,
          resolve: (value) => {
            this.state.incoming = undefined;
            this.emit();
            resolve(value);
          },
        };
        this.emit();
      });

      // A trusted device can be accepted without asking again, but only if the user
      // explicitly allowed it for that device.
      const autoAccept =
        this.state.settings.trustedDevicesOnly === false &&
        (await this.devices.canAutoAccept(connection.peer.deviceId)) &&
        answer.accepted;

      const received = await receiveTransfer({
        session: connection.session,
        // The offer was consumed by this controller to build the request above; the
        // engine must not wait for it a second time.
        offer,
        clock: this.clock,
        ...(this.options.logger ? { logger: this.options.logger } : {}),
        store,
        policy: this.state.settings.conflictPolicy,
        ...(freeSpace !== undefined ? { freeSpaceBytes: freeSpace } : {}),
        requestDecision: async () => ({
          accepted: answer.accepted,
          decisions: answer.decisions,
          ...(answer.rejectReason ? { rejectReason: answer.rejectReason } : {}),
        }),
        onReceiver: (receiver) => {
          this.activeReceiver = receiver;
          this.attachReceiverControls(transferId, receiver);
        },
      });
      this.activeReceiver = undefined;
      const saved = await this.finishRecord(transferId, {
        state: mapReceiverState(received.outcome.outcome),
        bytesDone: received.outcome.bytesDone,
        verifiedFiles: received.outcome.verifiedFiles,
        ...(received.outcome.errorCode ? { errorCode: received.outcome.errorCode } : {}),
      });
      await this.saveResumeTask(transferId, received.offer, receiverResumeState(received.receiver, received.offer));
      await this.notifyOutcome('receive', saved, received.outcome.outcome);
      void autoAccept;
    } catch (error) {
      this.state.incoming = undefined;
      const dfError = this.reportError(error);
      await this.finishRecord(transferId, {
        state: 'failed',
        bytesDone: 0,
        verifiedFiles: 0,
        errorCode: dfError.code,
      });
    }
  }

  private attachReceiverControls(transferId: string, receiver: TransferReceiver): void {
    /**
     * The receiving side can always be cancelled; it has no pause of its own,
     * because stopping a download mid-file is exactly what cancel plus resume
     * does later. The UI reflects that instead of showing a button that would do
     * nothing.
     */
    this.activeReceiver = receiver;
    void transferId;
  }

  private async saveResumeTask(
    transferId: string,
    offer: { manifestHashable?: never } & Record<string, unknown>,
    state: { manifestHash: string; files: Array<{ index: number; path: string; ranges: Array<{ start: number; end: number }> }> } | undefined,
  ): Promise<void> {
    if (!state || state.files.every((file) => file.ranges.length === 0)) return;
    const record: ResumeTaskRecord = {
      v: 1,
      transferId,
      direction: 'receive',
      files: state.files,
      manifestHash: state.manifestHash,
      createdAt: this.clock.now(),
    };
    void offer;
    await this.options.store.put('resume', transferId, record);
  }

  /** Answers the pending incoming request. Called by the UI. */
  answerIncoming(answer: Parameters<IncomingRequestState['resolve']>[0]): void {
    this.state.incoming?.resolve(answer);
  }

  /* ---------------------------------------------------------------- *
   * Queue controls
   * ---------------------------------------------------------------- */

  pauseTransfer(id: string): void {
    this.queue.pause(id);
  }

  resumeTransfer(id: string): void {
    this.queue.resume(id);
  }

  async cancelTransfer(id: string): Promise<void> {
    const result = this.queue.cancel(id);
    if (result !== 'not-started') return;
    // Nothing was running, so no job will ever write the outcome: the record is
    // finished here, as cancelled, with its real byte count.
    const record = await this.history.get(id);
    if (!record || isTerminal(record.state)) return;
    await this.finishRecord(id, {
      state: 'cancelled',
      bytesDone: record.bytesDone,
      verifiedFiles: 0,
      errorCode: ERROR_CODES.TRANSFER_CANCELLED,
    });
  }

  retryTransfer(id: string): void {
    this.queue.retry(id);
  }

  removeTransfer(id: string): void {
    this.queue.remove(id);
  }

  moveTransfer(id: string, priority: number): void {
    this.queue.move(id, priority);
  }

  /* ---------------------------------------------------------------- *
   * History
   * ---------------------------------------------------------------- */

  async refreshHistory(): Promise<void> {
    this.state.history = await this.history.list({ limit: 200 });
    this.emit();
  }

  async searchHistory(query: string, direction?: 'send' | 'receive', failedOnly = false): Promise<void> {
    this.state.history = await this.history.list({
      limit: 200,
      ...(query.trim() ? { query } : {}),
      ...(direction ? { direction } : {}),
      ...(failedOnly ? { states: ['failed', 'interrupted'] } : {}),
    });
    this.emit();
  }

  async deleteHistoryEntry(id: string): Promise<void> {
    await this.history.remove(id);
    await this.refreshHistory();
  }

  async clearHistory(): Promise<void> {
    const removed = await this.history.clear();
    await this.refreshHistory();
    this.notice('info', 'activity.deleteAllConfirm', { detail: String(removed) });
  }

  async exportHistory(): Promise<string> {
    return await this.history.exportJson();
  }

  private async pruneHistory(): Promise<void> {
    const retentionDays = this.state.settings.historyRetentionDays;
    const removed = await this.history.prune();
    if (removed.length > 0 && retentionDays > 0) {
      this.notice('info', 'settings.historyRetention', { detail: String(removed.length) });
    }
  }

  /* ---------------------------------------------------------------- *
   * Hosted shares
   * ---------------------------------------------------------------- */

  async createShare(sources: Parameters<typeof createHostedShare>[0]['files'], lifetimeMs?: number): Promise<CreatedShare | undefined> {
    if (!this.state.settings.allowHostedSharing) {
      this.notice('error', 'errors.HOSTED_SHARING_DISABLED', { errorCode: ERROR_CODES.HOSTED_SHARING_DISABLED });
      return undefined;
    }
    if (!this.options.shareBackend || !this.options.shareOrigin) {
      this.notice('error', 'errors.PLATFORM_UNSUPPORTED', { errorCode: ERROR_CODES.PLATFORM_UNSUPPORTED });
      return undefined;
    }
    try {
      const share = await createHostedShare({
        backend: this.options.shareBackend,
        files: [...sources],
        origin: this.options.shareOrigin,
        clock: this.clock,
        ...(lifetimeMs !== undefined ? { lifetimeMs } : {}),
        ...(this.options.logger ? { logger: this.options.logger } : {}),
      });
      this.state.activeShare = { url: share.url, expiresAt: share.expiresAt, totalBytes: share.totalBytes };
      this.emit();
      return share;
    } catch (error) {
      this.reportError(error);
      return undefined;
    }
  }

  /* ---------------------------------------------------------------- *
   * Receiving folder
   * ---------------------------------------------------------------- */

  /**
   * Asks the browser to let us write into the remembered folder. Must happen on a
   * user gesture: the platform requires it, and pretending otherwise would fail
   * inside a transfer instead of in front of the user.
   */
  async grantReceiveFolderAccess(): Promise<void> {
    if (!this.options.receiveFolders) return;
    try {
      this.state.receiveFolder = await this.options.receiveFolders.requestAccess();
      if (this.state.receiveFolder.ready) this.notice('success', 'settings.receiveFolderReady');
    } catch (error) {
      this.reportError(error);
    }
    this.emit();
  }

  async chooseReceiveFolder(): Promise<void> {
    if (!this.options.receiveFolders) {
      this.notice('error', 'errors.PLATFORM_UNSUPPORTED');
      return;
    }
    try {
      this.state.receiveFolder = await this.options.receiveFolders.choose();
    } catch (error) {
      this.reportError(error);
    }
    this.emit();
  }

  async forgetReceiveFolder(): Promise<void> {
    if (!this.options.receiveFolders) return;
    this.state.receiveFolder = await this.options.receiveFolders.forget();
    this.emit();
  }

  /* ---------------------------------------------------------------- *
   * Updates
   * ---------------------------------------------------------------- */

  /**
   * Checks for an update and reports exactly what the platform said. Nothing is
   * installed here: the user has to approve it, and the desktop build keeps Tauri's
   * signature verification on.
   */
  async checkForUpdate(): Promise<void> {
    const source = this.options.updateSource ?? noUpdateSource;
    if (!source.canCheck) {
      this.state.updateState = {
        kind: 'error',
        messageKey: 'settings.updateUnsupported',
        errorCode: 'PLATFORM_UNSUPPORTED',
      };
      this.emit();
      return;
    }
    this.state.updateState = { kind: 'checking', messageKey: 'settings.updateChecking' };
    this.emit();
    const status = await source.check();
    this.state.updateState = status;
    this.emit();
  }

  async installUpdate(): Promise<void> {
    const source = this.options.updateSource ?? noUpdateSource;
    this.state.updateState = { kind: 'installing', messageKey: 'settings.updateInstalling' };
    this.emit();
    const status = await source.install();
    this.state.updateState = status;
    this.emit();
  }

  relaunch(): void {
    (this.options.updateSource ?? noUpdateSource).relaunch();
  }

  /* ---------------------------------------------------------------- *
   * Identity
   * ---------------------------------------------------------------- */

  /**
   * Forgets this device's identity and everything tied to it. It is deliberately
   * not a one-click button in the UI: it is destructive for trusted pairings.
   */
  async resetIdentity(): Promise<void> {
    this.disconnect('identity reset');
    try {
      await this.options.store.deleteCollection('devices');
      await this.options.store.deleteCollection('resume');
      this.identity = await this.createIdentity();
      const hydrated = await hydrateIdentity(this.identity);
      this.state.identityFingerprint = hydrated.identity.fingerprint;
      await this.refreshDevices();
      this.notice('success', 'settings.identityReset');
    } catch (error) {
      this.reportError(error);
    }
    this.emit();
  }

  /* ---------------------------------------------------------------- *
   * Records
   * ---------------------------------------------------------------- */

  private newRecord(input: {
    id: string;
    direction: 'send' | 'receive';
    peer: string;
    peerDeviceId: string;
    totalBytes: number;
    files: TransferRecord['files'];
    transport: NonNullable<TransferRecord['transport']>;
  }): TransferRecord {
    const now = this.clock.now();
    return {
      v: 1,
      id: input.id,
      direction: input.direction,
      peerDeviceId: input.peerDeviceId,
      peerName: input.peer,
      state: 'queued',
      startedAt: now,
      updatedAt: now,
      totalBytes: input.totalBytes,
      bytesDone: 0,
      files: input.files,
      transport: input.transport,
    };
  }

  /**
   * Makes a record visible to the interface. The history is the source of truth for
   * both the Activity screen and the transfer queue, so a record is published the
   * moment it is created — otherwise a transfer in progress would be invisible.
   */
  private publishRecord(record: TransferRecord): void {
    const without = this.state.history.filter((entry) => entry.id !== record.id);
    this.state.history = [record, ...without].sort((left, right) => right.startedAt - left.startedAt);
    this.emit();
  }

  /**
   * Records intermediate progress. Two rules, both learned from the state machine:
   *
   *  - a terminal state is only ever written by `finishRecord`, which knows the
   *    outcome, the verified file count and the completion moment; a progress
   *    callback is not allowed to write one;
   *  - a late progress event — the engine may emit one just after the last byte —
   *    must never reopen or downgrade a record that has already finished.
   *
   * A failure to write progress is logged and ignored: the transfer itself is
   * unaffected, and `finishRecord` (awaited by the caller) reports real failures.
   */
  private async touchRecord(id: string, patch: { state: TransferState; bytesDone?: number }): Promise<void> {
    try {
      const record = await this.history.get(id);
      if (!record) return;
      if (isTerminal(record.state) || isTerminal(patch.state)) return;
      const updated: TransferRecord = {
        ...record,
        state: patch.state,
        bytesDone: patch.bytesDone ?? record.bytesDone,
        updatedAt: this.clock.now(),
      };
      await this.history.save(updated);
      this.publishRecord(updated);
    } catch (error) {
      const dfError = error instanceof DropForgeError ? error : fromPlatformError(error);
      this.options.logger?.log('warn', 'progress bookkeeping failed', { code: dfError.code });
    }
  }

  private async finishRecord(
    id: string,
    outcome: { state: TransferState; bytesDone: number; verifiedFiles: number; errorCode?: string },
  ): Promise<TransferRecord | undefined> {
    const record = await this.history.get(id);
    if (!record) return undefined;
    const finished: TransferRecord = {
      ...record,
      state: outcome.state,
      bytesDone: outcome.bytesDone,
      updatedAt: this.clock.now(),
      // `completed` is only ever written when the receiver said so.
      ...(outcome.state === 'completed' ? { completedAt: this.clock.now() } : {}),
      ...(outcome.errorCode ? { lastErrorCode: outcome.errorCode } : {}),
      files: record.files.map((file, position) =>
        position < outcome.verifiedFiles ? { ...file, verified: true, bytesDone: file.size } : file,
      ),
    };
    await this.history.save(finished);
    await this.refreshHistory();
    return finished;
  }

  private async notifyOutcome(
    direction: 'send' | 'receive',
    record: TransferRecord | undefined,
    outcome: string,
  ): Promise<void> {
    if (!record) return;
    const kind =
      outcome === 'completed'
        ? 'transfer-completed'
        : outcome === 'interrupted'
          ? 'transfer-interrupted'
          : outcome === 'cancelled'
            ? undefined
            : 'transfer-failed';
    if (!kind) return;
    const values = {
      count: record.files.filter((file) => file.kind !== 'directory').length,
      peer: record.peerName,
      reason: this.translate(record.lastErrorCode ? `errors.${record.lastErrorCode}` : 'notify.interruptedBody', {
        peer: record.peerName,
      }),
    };
    const text =
      direction === 'send'
        ? outcome === 'completed'
          ? { title: 'notify.sentTitle', body: 'notify.sentBody' }
          : outcome === 'interrupted'
            ? { title: 'notify.interruptedTitle', body: 'notify.interruptedBody' }
            : { title: 'notify.failedTitle', body: 'notify.failedBody' }
        : outcome === 'completed'
          ? { title: 'notify.receivedTitle', body: 'notify.receivedBody' }
          : outcome === 'interrupted'
            ? { title: 'notify.interruptedTitle', body: 'notify.interruptedBody' }
            : { title: 'notify.failedTitle', body: 'notify.failedBody' };
    await this.notifications
      .notify({
        kind,
        title: this.translate(text.title, values),
        body: this.translate(text.body, values),
        tag: record.id,
        route: '/activity',
        ...(outcome === 'completed' ? {} : { priority: 'high' as const }),
      })
      .catch(() => {
        // A notification that cannot be shown never affects the transfer itself.
      });
  }

  private deviceId(): string {
    return generateDeviceId();
  }

  private platformName(): Platform {
    return this.state.capabilities.platform;
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Names the reason of a send that did not deliver everything.
 *
 * The engine reports *why* per file (`failed` / `unavailable`); without this the
 * history and the notification would say "failed" with no reason at all, which is
 * exactly the kind of useless message this project refuses to show. Nothing is
 * invented: when no file carries a reason, the code stays `undefined`.
 */
export function senderFailureCode(outcome: {
  failed: Array<{ reason: 'digestMismatch' | 'writeFailed' | 'noSpace' }>;
  unavailable: Array<{ reason: 'skipped' | 'unreadable' | 'changed' | 'cancelled' | 'refused' }>;
}): string | undefined {
  const firstFailed = outcome.failed[0]?.reason;
  if (firstFailed === 'noSpace') return ERROR_CODES.NO_SPACE_LEFT;
  if (firstFailed === 'digestMismatch') return ERROR_CODES.INTEGRITY_FAILED;
  if (firstFailed === 'writeFailed') return ERROR_CODES.WRITE_FAILED;
  const reason = outcome.unavailable.find((file) => file.reason !== 'skipped')?.reason;
  if (reason === 'changed') return ERROR_CODES.SOURCE_CHANGED;
  if (reason === 'unreadable') return ERROR_CODES.READ_FAILED;
  if (reason === 'refused') return ERROR_CODES.TRANSFER_DECLINED;
  if (reason === 'cancelled') return ERROR_CODES.TRANSFER_CANCELLED;
  return undefined;
}

export function mapSenderState(outcome: SenderOutcome['outcome']): TransferState {
  switch (outcome) {
    case 'completed':
      return 'completed';
    case 'partial':
      // A partially delivered transfer is never shown as completed.
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'interrupted':
      return 'interrupted';
    case 'failed':
    default:
      return 'failed';
  }
}

export function mapReceiverState(outcome: ReceiverOutcome['outcome']): TransferState {
  switch (outcome) {
    case 'completed':
      return 'completed';
    case 'partial':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'declined':
      return 'cancelled';
    case 'interrupted':
      return 'interrupted';
    case 'failed':
    default:
      return 'failed';
  }
}

function receiverResumeState(
  receiver: TransferReceiver,
  offer: { transferId: string },
): { manifestHash: string; files: Array<{ index: number; path: string; ranges: Array<{ start: number; end: number }> }> } | undefined {
  try {
    const state = receiver.resumeState(hashManifest(offer as never));
    if (!state || state.files.length === 0) return undefined;
    return {
      manifestHash: state.manifestHash,
      files: state.files.map((file) => ({
        index: file.index,
        path: String(file.index),
        ranges: file.ranges,
      })),
    };
  } catch {
    return undefined;
  }
}

function parseAnnouncement(
  input: Record<string, unknown>,
  now: number,
  ownFingerprint: string | undefined,
): Parameters<DiscoveryCache['upsert']>[0] {
  const deviceId = typeof input['deviceId'] === 'string' ? input['deviceId'] : '';
  const displayName = typeof input['displayName'] === 'string' ? input['displayName'] : '';
  const fingerprint = typeof input['fingerprint'] === 'string' ? input['fingerprint'] : undefined;
  const capabilities = Array.isArray(input['capabilities'])
    ? (input['capabilities'].filter((value): value is string => typeof value === 'string') as Capability[])
    : [];
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) throw new Error('bad device id');
  if (fingerprint !== undefined && fingerprint === ownFingerprint) throw new Error('self');
  const route = typeof input['route'] === 'string' ? input['route'] : undefined;
  return {
    deviceId,
    displayName: displayName.trim() || 'Unknown device',
    platform: 'unknown',
    ...(fingerprint ? { fingerprint } : {}),
    capabilities,
    ...(route ? { route } : {}),
    lastSeenAt: now,
  };
}

/** The code doubles as the room name on the signaling service. */
export function newRoomCode(fill: (bytes: Uint8Array<ArrayBuffer>) => void = defaultRandomFill): string {
  // A room code is a name on the signaling service, not a secret: the handshake
  // that follows is what authenticates the peer. It still uses the platform's
  // random source so codes cannot be guessed from a pattern.

  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(12);
  fill(bytes);
  let code = '';
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return code;
}

function defaultRandomFill(bytes: Uint8Array<ArrayBuffer>): void {
  crypto.getRandomValues(bytes);
}

/** The link the other device opens: the code travels in the fragment only. */
export function pairingLinkFor(code: string, loc: Location | undefined = globalThis.location): string {
  const origin = loc?.origin ?? '';
  return `${origin}/#c=${code}`;
}

function pairingCodeFromLink(link: string): string | undefined {
  const hash = link.includes('#') ? link.slice(link.indexOf('#') + 1) : '';
  const params = new URLSearchParams(hash);
  const code = params.get('c');
  return code && /^[A-Za-z0-9_-]{4,32}$/.test(code) ? code : undefined;
}

export const CONTROLLER_KEEPALIVE_MS = KEEPALIVE_INTERVAL_MS;
