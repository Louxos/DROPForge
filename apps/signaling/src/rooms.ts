/**
 * Room registry: the rendezvous logic, with no socket in sight so it can be
 * tested on its own.
 *
 * What a room is for: two devices that exchanged a pairing code need to find each
 * other. That is all. A room holds peer descriptions (device id, name, announced
 * fingerprint, capabilities) and a small signal buffer; it is destroyed when both
 * peers leave or after its TTL, whichever comes first.
 *
 * What a room must never hold: file names, file contents, keys. The payload
 * exchanged after the handshake is opaque to the server (see server.ts).
 */

import { MAX_SEALED_FRAME_BYTES } from '@dropforge/protocol';

export interface RoomLimits {
  /** Maximum peers per room. Two: DropForge is a one-to-one transfer tool. */
  maxPeers: number;
  /** Room lifetime, refreshed while peers are active. */
  ttlMs: number;
  /** Maximum signal messages buffered for a peer that is not connected yet. */
  maxBufferedSignals: number;
  /** Maximum size of a single JSON control message, in bytes. */
  maxControlBytes: number;
  /**
   * Maximum size of a single relayed binary frame. It has to be at least one
   * sealed data frame of the transfer protocol (a chunk plus its overhead),
   * otherwise the relay would break big transfers while looking healthy.
   */
  maxFrameBytes: number;
  /** Control messages allowed per peer per second. */
  maxMessagesPerSecond: number;
}

export const DEFAULT_ROOM_LIMITS: RoomLimits = {
  maxPeers: 2,
  ttlMs: 10 * 60 * 1_000,
  maxBufferedSignals: 32,
  maxControlBytes: 64 * 1024,
  maxFrameBytes: MAX_SEALED_FRAME_BYTES,
  maxMessagesPerSecond: 20,
};

export interface RoomPeer {
  /** Peer id chosen by the client (opaque, short). */
  id: string;
  deviceId: string;
  displayName: string;
  platform: string;
  /** Announced fingerprint, when the peer has one to announce. */
  fingerprint?: string;
  capabilities: string[];
}

export interface RoomMember extends RoomPeer {
  joinedAt: number;
  lastSeenAt: number;
  /** Set once the connection is established; the socket is held by the server. */
  socketId: string;
}

export interface Room {
  code: string;
  createdAt: number;
  expiresAt: number;
  /** True once both peers agreed to switch to blind relay mode. */
  relaying: boolean;
  members: RoomMember[];
}

export type JoinResult =
  | { ok: true; room: Room; member: RoomMember; self: boolean }
  | { ok: false; reason: 'full' | 'expired' | 'closed' | 'invalid' };

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private readonly bySocket = new Map<string, { code: string; peerId: string }>();

  constructor(
    private readonly limits: RoomLimits = DEFAULT_ROOM_LIMITS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get limitsSnapshot(): RoomLimits {
    return { ...this.limits };
  }

  create(code: string, socketId: string, peer: RoomPeer): JoinResult {
    if (!isValidRoomCode(code)) return { ok: false, reason: 'invalid' };
    this.sweep();
    const existing = this.rooms.get(code);
    if (existing && existing.expiresAt > this.now()) return { ok: false, reason: 'full' };
    const timestamp = this.now();
    const room: Room = {
      code,
      createdAt: timestamp,
      expiresAt: timestamp + this.limits.ttlMs,
      relaying: false,
      members: [],
    };
    this.rooms.set(code, room);
    return this.join(code, socketId, peer);
  }

  join(code: string, socketId: string, peer: RoomPeer): JoinResult {
    this.sweep();
    const room = this.rooms.get(code);
    if (!room) return { ok: false, reason: 'closed' };
    if (room.expiresAt <= this.now()) {
      this.rooms.delete(code);
      return { ok: false, reason: 'expired' };
    }
    if (room.members.length >= this.limits.maxPeers) {
      // Reconnecting with the same device id and a new socket replaces the stale
      // entry instead of filling the room with ghosts.
      const same = room.members.find((member) => member.deviceId === peer.deviceId);
      if (!same) return { ok: false, reason: 'full' };
      room.members = room.members.filter((member) => member !== same);
      this.bySocket.delete(same.socketId);
    }
    const timestamp = this.now();
    const member: RoomMember = {
      ...peer,
      joinedAt: timestamp,
      lastSeenAt: timestamp,
      socketId,
    };
    room.members.push(member);
    room.expiresAt = timestamp + this.limits.ttlMs;
    this.bySocket.set(socketId, { code, peerId: peer.id });
    return { ok: true, room, member, self: true };
  }

  leave(socketId: string): { code: string; peerId: string; empty: boolean } | undefined {
    const location = this.bySocket.get(socketId);
    if (!location) return undefined;
    this.bySocket.delete(socketId);
    const room = this.rooms.get(location.code);
    if (!room) return undefined;
    room.members = room.members.filter((member) => member.socketId !== socketId);
    if (room.members.length === 0) {
      this.rooms.delete(location.code);
      return { code: location.code, peerId: location.peerId, empty: true };
    }
    return { code: location.code, peerId: location.peerId, empty: false };
  }

  /** Touches a room so an active pair is not swept away mid-transfer. */
  touch(socketId: string): Room | undefined {
    const location = this.bySocket.get(socketId);
    if (!location) return undefined;
    const room = this.rooms.get(location.code);
    if (!room) return undefined;
    const member = room.members.find((entry) => entry.socketId === socketId);
    if (member) member.lastSeenAt = this.now();
    room.expiresAt = this.now() + this.limits.ttlMs;
    return room;
  }

  roomFor(socketId: string): Room | undefined {
    return this.rooms.get(this.bySocket.get(socketId)?.code ?? '');
  }

  partnerOf(socketId: string): RoomMember | undefined {
    const room = this.roomFor(socketId);
    return room?.members.find((member) => member.socketId !== socketId);
  }

  /**
   * Switches a room to blind relay mode once both peers asked for it.
   *
   * Two, not one: a single request must not be enough to move the other device onto a
   * path it did not choose. This is what the documentation promises to users, and the
   * `members.length < 2` guard alone did not keep it.
   */
  markRelaying(code: string): boolean {
    const room = this.rooms.get(code);
    if (!room || room.members.length < 2) return false;
    if (!room.members.every((member) => member.capabilities.includes('relay.ready'))) return false;
    room.relaying = true;
    return true;
  }

  /** Deletes expired rooms. Returns the codes that were removed. */
  sweep(): string[] {
    const timestamp = this.now();
    const removed: string[] = [];
    for (const [code, room] of this.rooms) {
      if (room.expiresAt <= timestamp) {
        for (const member of room.members) this.bySocket.delete(member.socketId);
        this.rooms.delete(code);
        removed.push(code);
      }
    }
    return removed;
  }

  get size(): number {
    this.sweep();
    return this.rooms.size;
  }

  /** A pairing code is 8 characters from the client alphabet, or an 8+ hex id. */
  static isRoomCode(code: string): boolean {
    return isValidRoomCode(code);
  }
}

function isValidRoomCode(code: string): boolean {
  return /^[A-Za-z0-9_-]{4,32}$/.test(code);
}

/**
 * Per-socket rate limiter. A public relay has to assume that anyone can open a
 * socket: without a limit, one client can exhaust the free tier for everybody.
 */
export class RateLimiter {
  private window = 0;
  private count = 0;

  constructor(
    private readonly perSecond: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** True when the message is allowed; false means "refuse and warn". */
  allow(): boolean {
    const second = Math.floor(this.now() / 1_000);
    if (second !== this.window) {
      this.window = second;
      this.count = 0;
    }
    this.count += 1;
    return this.count <= this.perSecond;
  }
}
