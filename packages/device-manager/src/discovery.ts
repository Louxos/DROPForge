/**
 * Preferring a cached list of the devices that can be reached right now.
 *
 * Two honest constraints shape this module:
 *  - presence is a *hint*, never a promise: an entry that stopped announcing
 *    disappears by itself (`ttlMs`), so the UI cannot show a device that is gone;
 *  - the local network is not a trusted place. An announcement is unauthenticated
 *    data; it only tells the app where to *try*. The identity is proven during the
 *    handshake and checked against the announced fingerprint, so a spoofed name
 *    gets a connection attempt and then a hard refusal.
 */
import type { Capability, Platform } from '@dropforge/protocol';
import type { TransportMethod } from '@dropforge/connection-manager';

export type DiscoverySource = 'lan' | 'signaling' | 'manual' | 'qr' | 'trusted';

export interface DiscoveredPeer {
  deviceId: string;
  displayName: string;
  platform: Platform;
  /** Fingerprint the peer announced, when it announced one. */
  fingerprint?: string;
  /** Capabilities it announced; used by "Smart Transfer" to pick a path. */
  capabilities: Capability[];
  /** Rendezvous room / relay route, when one is needed. */
  route?: string;
  source: DiscoverySource;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface AnnouncementInput {
  deviceId?: unknown;
  displayName?: unknown;
  platform?: unknown;
  fingerprint?: unknown;
  capabilities?: unknown;
  route?: unknown;
}

export class DiscoveryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DiscoveryError';
    this.code = code;
  }
}

const PLATFORMS: readonly Platform[] = ['windows', 'macos', 'linux', 'android', 'ios', 'web', 'unknown'];

/**
 * Validates an announcement coming from the network. Everything is optional and
 * anything malformed is rejected: a discovery message must never be able to make
 * the app store junk or trust a name.
 */
export function parseAnnouncement(
  input: AnnouncementInput,
  options: { now: number; ownDeviceId?: string },
): Omit<DiscoveredPeer, 'source' | 'firstSeenAt'> {
  const deviceId = typeof input.deviceId === 'string' ? input.deviceId : '';
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) {
    throw new DiscoveryError('DISCOVERY_BAD_DEVICE_ID', 'The device identifier is malformed');
  }
  if (options.ownDeviceId && deviceId === options.ownDeviceId) {
    throw new DiscoveryError('DISCOVERY_SELF', 'This announcement comes from this very device');
  }
  const displayName = typeof input.displayName === 'string' ? input.displayName.slice(0, 64).trim() : '';
  const platform = PLATFORMS.includes(input.platform as Platform) ? (input.platform as Platform) : 'unknown';
  const fingerprint =
    typeof input.fingerprint === 'string' && /^[0-9a-f]{64}$/.test(input.fingerprint)
      ? input.fingerprint
      : undefined;
  const capabilities = Array.isArray(input.capabilities)
    ? (input.capabilities.filter((value): value is Capability => typeof value === 'string').slice(0, 32) as Capability[])
    : [];
  const route = typeof input.route === 'string' && input.route.length <= 128 ? input.route : undefined;
  return {
    deviceId,
    displayName: displayName.length > 0 ? displayName : 'Unknown device',
    platform,
    ...(fingerprint ? { fingerprint } : {}),
    capabilities,
    ...(route ? { route } : {}),
    lastSeenAt: options.now,
  };
}

export interface DiscoveryCacheOptions {
  ttlMs?: number;
  /** How many devices are kept at most (oldest entries are dropped first). */
  maxEntries?: number;
  now?: () => number;
}

const DEFAULT_TTL_MS = 20_000;
const DEFAULT_MAX_ENTRIES = 64;

export class DiscoveryCache {
  private readonly peers = new Map<string, DiscoveredPeer>();
  private readonly listeners = new Set<(peers: DiscoveredPeer[]) => void>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: DiscoveryCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? (() => Date.now());
  }

  onChanged(listener: (peers: DiscoveredPeer[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Adds or refreshes a peer. Returns the stored entry. */
  upsert(peer: Omit<DiscoveredPeer, 'firstSeenAt' | 'source'>, source: DiscoverySource = 'lan'): DiscoveredPeer {
    const existing = this.peers.get(peer.deviceId);
    const entry: DiscoveredPeer = {
      ...peer,
      source,
      firstSeenAt: existing?.firstSeenAt ?? peer.lastSeenAt,
      lastSeenAt: peer.lastSeenAt,
    };
    this.peers.set(entry.deviceId, entry);
    this.enforceLimit();
    this.publish();
    return entry;
  }

  /** Drops entries that stopped announcing. Returns true when something changed. */
  prune(): boolean {
    const cutoff = this.now() - this.ttlMs;
    let changed = false;
    for (const [deviceId, peer] of [...this.peers]) {
      if (peer.lastSeenAt < cutoff) {
        this.peers.delete(deviceId);
        changed = true;
      }
    }
    if (changed) this.publish();
    return changed;
  }

  remove(deviceId: string): void {
    if (this.peers.delete(deviceId)) this.publish();
  }

  /** Peers reachable now, freshest first. Prunes expired entries as a side effect. */
  list(): DiscoveredPeer[] {
    this.prune();
    return [...this.peers.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  get size(): number {
    return this.list().length;
  }

  private enforceLimit(): void {
    if (this.peers.size <= this.maxEntries) return;
    const ordered = [...this.peers.values()].sort((a, b) => a.lastSeenAt - b.lastSeenAt);
    for (const peer of ordered.slice(0, this.peers.size - this.maxEntries)) this.peers.delete(peer.deviceId);
  }

  private publish(): void {
    const snapshot = this.list();
    for (const listener of [...this.listeners]) listener(snapshot);
  }
}

/** Best methods to try for a discovered peer, given what it announced. */
export function methodsFor(peer: DiscoveredPeer, options: { samePrivateNetwork: boolean }): TransportMethod[] {
  const methods: TransportMethod[] = [];
  const hasWebrtc = peer.capabilities.includes('webrtc.direct');
  if (hasWebrtc && options.samePrivateNetwork) methods.push('lan');
  if (hasWebrtc) methods.push('webrtc');
  if (peer.capabilities.includes('relay.blind')) methods.push('relay');
  return methods;
}
