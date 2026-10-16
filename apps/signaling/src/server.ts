/**
 * DropForge signaling / blind relay server.
 *
 * Two jobs, and the boundary between them is the whole point of this file:
 *
 *  1. **Rendezvous.** Peers join a room with a pairing code, announce a device id,
 *     a name, an optional fingerprint and their capabilities, and exchange WebRTC
 *     offer/answer/ICE messages. The server forwards those messages verbatim and
 *     validates only their size and rate — it never interprets a session
 *     description.
 *
 *  2. **Blind relay.** When two peers agree to relay mode, the server switches the
 *     room to raw binary forwarding: every binary frame is copied to the other peer
 *     unchanged. What travels through it is already sealed by the peers
 *     (DF-HANDSHAKE / AES-256-GCM, see packages/security): the server sees a kind
 *     byte, a nonce and ciphertext. It cannot read a file name, a file path, a
 *     stream id or a single byte of file content, and it stores nothing.
 *
 * Abuse rules (a public free service must protect itself): rooms are limited to two
 * peers, every room expires, control messages are rate limited per socket, and a
 * frame larger than the agreed maximum closes the connection.
 */
import { createServer, type Server as HttpServer } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { DEFAULT_ROOM_LIMITS, RateLimiter, RoomRegistry, type RoomLimits } from './rooms.js';

export interface SignalingServerOptions {
  /** Where the HTTP/WebSocket server listens. */
  host?: string;
  port?: number;
  limits?: Partial<RoomLimits>;
  /** How often the sweep runs, in ms. */
  sweepIntervalMs?: number;
  /** Structured log sink. Never receives payloads, only counters and codes. */
  log?: (level: 'info' | 'warn', message: string, fields?: Record<string, unknown>) => void;
}

export interface SignalingServer {
  readonly httpServer: HttpServer;
  readonly wss: WebSocketServer;
  /** Resolves once listening; returns the actual port (useful with port 0). */
  listen(): Promise<number>;
  close(): Promise<void>;
  /** Live counters, for a health endpoint and for the tests. */
  stats(): {
    rooms: number;
    peers: number;
    relayedBytes: number;
    relayedFrames: number;
    refused: number;
  };
}

type ClientMessage =
  | { t: 'join'; code: string; peer: ClientPeer; create?: boolean }
  | { t: 'signal'; data: unknown }
  | { t: 'relay-ready' }
  | { t: 'leave' }
  | { t: 'ping' };

interface ClientPeer {
  id: string;
  deviceId: string;
  displayName: string;
  platform: string;
  fingerprint?: string;
  capabilities: string[];
}

const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

export function createSignalingServer(options: SignalingServerOptions = {}): SignalingServer {
  const limits: RoomLimits = { ...DEFAULT_ROOM_LIMITS, ...options.limits };
  const rooms = new RoomRegistry(limits);
  const log = options.log ?? (() => {});
  const stats = { relayedBytes: 0, relayedFrames: 0, refused: 0 };

  const httpServer = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          ok: true,
          rooms: rooms.size,
          limits: { maxPeers: limits.maxPeers, ttlMs: limits.ttlMs, maxFrameBytes: limits.maxFrameBytes },
        }),
      );
      return;
    }
    // No other route exists: this service is not a file host, and it must not look
    // like one. Note that a hosted share (mode B) is a *different* deployment.
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('DropForge signaling: see /health\n');
  });

  /** Socket ids are server-side identifiers; peers never see them. */
  const socketIds = new Map<WebSocket, string>();
  let socketCounter = 0;
  const nextSocketId = (): string => `s${(socketCounter += 1)}`;
  const clientSocketId = (client: WebSocket): string | undefined => socketIds.get(client);

  // The WebSocket limit must fit a sealed data frame (a chunk plus its AEAD
  // overhead), so it is the transport-level ceiling; the JSON control plane is
  // restricted further, in code, by `maxControlBytes`.
  const wss = new WebSocketServer({ server: httpServer, maxPayload: limits.maxFrameBytes });
  const limiters = new WeakMap<WebSocket, RateLimiter>();

  /** Touches the room this socket belongs to (keeps active rooms alive). */
  const touchRoom = (socket: WebSocket): ReturnType<RoomRegistry['touch']> => {
    const id = socketIds.get(socket);
    return id ? rooms.touch(id) : undefined;
  };

  /** The other peer of the same room, if it is still connected. */
  const partnerRoomMember = (socket: WebSocket): { socketId: string } | undefined => {
    const id = socketIds.get(socket);
    return id ? rooms.partnerOf(id) : undefined;
  };

  const socketFor = (socketId: string): WebSocket | undefined =>
    [...wss.clients].find((client) => socketIds.get(client) === socketId);

  wss.on('connection', (socket: WebSocket) => {
    let closed = false;
    limiters.set(socket, new RateLimiter(limits.maxMessagesPerSecond));

    const send = (message: unknown): void => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };
    const fail = (code: string, message: string): void => {
      stats.refused += 1;
      send({ t: 'error', code, message });
    };

    socket.on('message', (raw: RawData, isBinary: boolean) => {
      const limiter = limiters.get(socket);
      if (limiter && !limiter.allow()) {
        log('warn', 'rate limited a peer', {});
        fail('RATE_LIMITED', 'Too many messages: slow down');
        socket.close(1008, 'rate limited');
        return;
      }

      if (isBinary) {
        // ---- relay path: bytes are forwarded, never inspected ----
        const room = touchRoom(socket);
        if (!room || !room.relaying) {
          fail('RELAY_NOT_READY', 'Relay mode is not active for this room');
          return;
        }
        const partner = partnerRoomMember(socket);
        if (!partner) return;
        const target = socketFor(partner.socketId);
        if (!target || target.readyState !== target.OPEN) return;
        if (target.bufferedAmount > MAX_BUFFERED_BYTES) {
          // Backpressure: dropping the slow peer is better than growing forever on
          // a free tier. The peers' own protocol notices the closed connection.
          log('warn', 'relay target too slow, closing it', { buffered: target.bufferedAmount });
          target.close(1013, 'too slow');
          return;
        }
        const frame = toBuffer(raw);
        if (frame.byteLength > limits.maxFrameBytes) {
          fail('FRAME_TOO_LARGE', 'This relayed frame is too large');
          socket.close(1009, 'frame too large');
          return;
        }
        target.send(frame, { binary: true });
        stats.relayedFrames += 1;
        stats.relayedBytes += frame.byteLength;
        return;
      }

      const text = raw.toString('utf8');
      if (Buffer.byteLength(text, 'utf8') > limits.maxControlBytes) {
        fail('MESSAGE_TOO_LARGE', 'This control message is too large');
        socket.close(1009, 'message too large');
        return;
      }
      let message: ClientMessage;
      try {
        message = JSON.parse(text) as ClientMessage;
      } catch {
        fail('BAD_MESSAGE', 'Messages must be JSON');
        return;
      }

      switch (message.t) {
        case 'join': {
          const peer = normalisePeer(message.peer);
          if (!peer) {
            fail('BAD_PEER', 'The peer description is malformed');
            return;
          }
          const socketId = nextSocketId();
          socketIds.set(socket, socketId);
          const result = message.create
            ? rooms.create(message.code, socketId, peer)
            : rooms.join(message.code, socketId, peer);
          if (!result.ok) {
            socketIds.delete(socket);
            fail(result.reason === 'full' ? 'ROOM_FULL' : 'ROOM_UNAVAILABLE', `The room is not available (${result.reason})`);
            return;
          }
          send({
            t: 'joined',
            code: result.room.code,
            expiresAt: result.room.expiresAt,
            peer: peer.id,
            peers: result.room.members.map(toPublicMember),
          });
          for (const other of result.room.members) {
            if (other.socketId === socketId) continue;
            // Only the *other* peer learns about the newcomer, and only the public
            // part of its description.
            socketFor(other.socketId)?.send(JSON.stringify({ t: 'peer-joined', peer: toPublicMember(result.member) }));
          }
          log('info', 'peer joined a room', { peers: result.room.members.length });
          return;
        }
        case 'signal': {
          const room = touchRoom(socket);
          if (!room) {
            fail('NOT_IN_ROOM', 'Join a room first');
            return;
          }
          const partner = partnerRoomMember(socket);
          if (!partner) return;
          const target = socketFor(partner.socketId);
          if (!target || target.readyState !== target.OPEN) return;
          // Forwarded verbatim: the server does not look inside `data`.
          target.send(JSON.stringify({ t: 'signal', data: message.data }));
          return;
        }
        case 'relay-ready': {
          const room = touchRoom(socket);
          if (!room) {
            fail('NOT_IN_ROOM', 'Join a room first');
            return;
          }
          const self = socketIds.get(socket);
          const member = room.members.find((entry) => entry.socketId === self);
          const first = member !== undefined && !member.capabilities.includes('relay.ready');
          if (member) member.capabilities = [...new Set([...member.capabilities, 'relay.ready'])];
          if (first) {
            // The other peer is *asked*, never switched: the room only relays once both
            // sides said yes (`Room.relaying`), and a peer that does not answer simply
            // keeps its direct path. Asking once per peer is what keeps two clients
            // from answering each other forever.
            for (const other of room.members) {
              if (other.socketId === self) continue;
              socketFor(other.socketId)?.send(JSON.stringify({ t: 'relay-requested' }));
            }
          }
          if (rooms.markRelaying(room.code)) {
            for (const other of room.members) {
              // Both peers are told, including the one that asked second: the relay
              // is only usable once each side knows the other agreed.
              socketFor(other.socketId)?.send(JSON.stringify({ t: 'relay-open' }));
            }
            log('info', 'room switched to blind relay', {});
          }
          return;
        }
        case 'leave': {
          leaveRoom(socket);
          socket.close(1000, 'left');
          return;
        }
        case 'ping': {
          touchRoom(socket);
          send({ t: 'pong', now: Date.now() });
          return;
        }
        default: {
          fail('UNKNOWN_MESSAGE', 'Unsupported message');
        }
      }
    });

    socket.on('close', () => {
      closed = true;
      leaveRoom(socket);
    });

    socket.on('error', () => {
      log('warn', 'socket error', {});
    });

    void closed;
  });

  /**
   * Removes a socket from its room. When the *other* peer is still there, it is
   * told immediately: the UI shows "the other device left" instead of a transfer
   * that looks stalled. Nothing about the departed peer is broadcast (no names,
   * no ids beyond what the peer already knew).
   */
  function leaveRoom(socket: WebSocket): void {
    const socketId = socketIds.get(socket);
    if (!socketId) return;
    const outro = rooms.leave(socketId);
    socketIds.delete(socket);
    if (!outro || outro.empty) return;
    for (const client of wss.clients) {
      if (client === socket) continue;
      if (socketIds.get(client) === undefined) continue;
      const otherId = socketIds.get(client);
      if (!otherId || rooms.roomFor(otherId)?.code !== outro.code) continue;
      if (client.readyState === client.OPEN) client.send(JSON.stringify({ t: 'peer-left' }));
    }
  }

  const sweeper = setInterval(() => {
    const removed = rooms.sweep();
    if (removed.length > 0) log('info', 'expired rooms removed', { rooms: removed.length });
  }, options.sweepIntervalMs ?? 30_000);
  sweeper.unref?.();

  return {
    httpServer,
    wss,
    async listen(): Promise<number> {
      await new Promise<void>((resolve) => {
        httpServer.listen(options.port ?? 0, options.host ?? '0.0.0.0', () => resolve());
      });
      const address = httpServer.address();
      if (address === null || typeof address === 'string') throw new Error('the server has no port');
      return address.port;
    },
    async close(): Promise<void> {
      clearInterval(sweeper);
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
    stats() {
      return { rooms: rooms.size, peers: wss.clients.size, ...stats };
    },
  };
}

function toBuffer(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return Buffer.from(raw as ArrayBuffer);
}

function normalisePeer(input: unknown): ClientPeer | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const peer = input as Record<string, unknown>;
  if (typeof peer.id !== 'string' || peer.id.length < 1 || peer.id.length > 32) return undefined;
  if (typeof peer.deviceId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(peer.deviceId)) return undefined;
  if (typeof peer.displayName !== 'string' || peer.displayName.length < 1 || peer.displayName.length > 64) {
    return undefined;
  }
  const platform = typeof peer.platform === 'string' ? peer.platform.slice(0, 16) : 'unknown';
  const fingerprint =
    typeof peer.fingerprint === 'string' && /^[0-9a-f]{64}$/.test(peer.fingerprint) ? peer.fingerprint : undefined;
  const capabilities = Array.isArray(peer.capabilities)
    ? peer.capabilities.filter((value): value is string => typeof value === 'string').slice(0, 32)
    : [];
  return {
    id: peer.id,
    deviceId: peer.deviceId,
    displayName: peer.displayName,
    platform,
    ...(fingerprint ? { fingerprint } : {}),
    capabilities,
  };
}

function toPublicMember(member: {
  id: string;
  deviceId: string;
  displayName: string;
  platform: string;
  fingerprint?: string;
  capabilities: string[];
  joinedAt: number;
}): Record<string, unknown> {
  return {
    id: member.id,
    deviceId: member.deviceId,
    displayName: member.displayName,
    platform: member.platform,
    ...(member.fingerprint ? { fingerprint: member.fingerprint } : {}),
    capabilities: member.capabilities,
    joinedAt: member.joinedAt,
  };
}
