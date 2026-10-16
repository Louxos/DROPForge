/**
 * Signaling / blind relay, tested over real WebSocket connections.
 *
 * The point of these tests is not "the server forwards bytes" (that is easy) but
 * "the server cannot do anything else": it must not need to parse a payload to
 * route it, must not keep anything, and must refuse to become a file host.
 */
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createSignalingServer, RoomRegistry, type SignalingServer } from './index.js';

const servers: SignalingServer[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) await server.close();
});

async function start(options: Parameters<typeof createSignalingServer>[0] = {}): Promise<{
  server: SignalingServer;
  url: string;
}> {
  const server = createSignalingServer({ port: 0, host: '127.0.0.1', ...options });
  servers.push(server);
  const port = await server.listen();
  return { server, url: `ws://127.0.0.1:${port}` };
}

interface Peer {
  socket: WebSocket;
  messages: Array<Record<string, unknown>>;
  binary: Uint8Array[];
  waitFor: (predicate: (message: Record<string, unknown>) => boolean, timeoutMs?: number) => Promise<Record<string, unknown>>;
  waitForBinary: (count: number, timeoutMs?: number) => Promise<void>;
  send: (message: unknown) => void;
  sendBinary: (bytes: Uint8Array) => void;
  closed: Promise<{ code: number }>;
}

function connect(url: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    sockets.push(socket);
    const messages: Array<Record<string, unknown>> = [];
    const binary: Uint8Array[] = [];
    let closeInfo: (info: { code: number }) => void = () => {};
    const closed = new Promise<{ code: number }>((res) => {
      closeInfo = res;
    });
    const waiters: Array<{ predicate: (m: Record<string, unknown>) => boolean; resolve: (m: Record<string, unknown>) => void }> = [];

    socket.on('message', (raw, isBinary) => {
      if (isBinary) {
        binary.push(new Uint8Array(raw as Buffer));
        return;
      }
      const message = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
      messages.push(message);
      for (const waiter of [...waiters]) {
        if (waiter.predicate(message)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      }
    });
    socket.on('close', (code) => closeInfo({ code }));
    socket.on('error', reject);
    socket.on('open', () =>
      resolve({
        socket,
        messages,
        binary,
        closed,
        send: (message) => socket.send(JSON.stringify(message)),
        sendBinary: (bytes) => socket.send(bytes, { binary: true }),
        waitForBinary: async (count, timeoutMs = 3_000) => {
          const deadline = Date.now() + timeoutMs;
          while (binary.length < count) {
            if (Date.now() > deadline) throw new Error('timed out waiting for binary frames');
            await new Promise((res) => setTimeout(res, 5));
          }
        },
        waitFor: (predicate, timeoutMs = 3_000) =>
          new Promise((res, rej) => {
            const found = messages.find(predicate);
            if (found) {
              res(found);
              return;
            }
            const timer = setTimeout(() => rej(new Error('timed out waiting for a message')), timeoutMs);
            waiters.push({
              predicate,
              resolve: (message) => {
                clearTimeout(timer);
                res(message);
              },
            });
          }),
      }),
    );
  });
}

const peerDescription = (id: string, deviceId: string, name: string) => ({
  id,
  deviceId,
  displayName: name,
  platform: 'windows',
  capabilities: ['webrtc.direct', 'relay.blind'],
});

async function joinedPair(url: string): Promise<{ a: Peer; b: Peer }> {
  const a = await connect(url);
  const b = await connect(url);
  a.send({ t: 'join', code: 'ROOM1234', create: true, peer: peerDescription('a', 'device-alice-0001', 'Alice') });
  await a.waitFor((m) => m['t'] === 'joined');
  b.send({ t: 'join', code: 'ROOM1234', peer: peerDescription('b', 'device-bob-000002', 'Bob') });
  await b.waitFor((m) => m['t'] === 'joined');
  await a.waitFor((m) => m['t'] === 'peer-joined');
  return { a, b };
}

describe('rooms', () => {
  it('accepts two peers and refuses a third one', async () => {
    const { url } = await start();
    const { a } = await joinedPair(url);
    void a;

    const c = await connect(url);
    c.send({ t: 'join', code: 'ROOM1234', peer: peerDescription('c', 'device-eve-000003', 'Eve') });
    const error = await c.waitFor((m) => m['t'] === 'error');
    expect(error['code']).toBe('ROOM_FULL');
  });

  it('lets a reconnecting device take over its own stale slot', async () => {
    const { url } = await start();
    const a = await connect(url);
    a.send({ t: 'join', code: 'RECONNECT', create: true, peer: peerDescription('a', 'device-alice-0001', 'Alice') });
    await a.waitFor((m) => m['t'] === 'joined');

    const b = await connect(url);
    b.send({ t: 'join', code: 'RECONNECT', peer: peerDescription('b', 'device-bob-000002', 'Bob') });
    await b.waitFor((m) => m['t'] === 'joined');

    // Alice's browser was closed and reopened with a fresh socket, same device id.
    const a2 = await connect(url);
    a2.send({ t: 'join', code: 'RECONNECT', peer: peerDescription('a2', 'device-alice-0001', 'Alice') });
    const joined = await a2.waitFor((m) => m['t'] === 'joined');
    expect(joined['code']).toBe('RECONNECT');

    // Bob is told the new peer arrived and can carry on.
    const peerJoined = await b.waitFor((m) => m['t'] === 'peer-joined');
    expect((peerJoined['peer'] as { id: string }).id).toBe('a2');
  });

  it('tells the remaining peer when the other one leaves', async () => {
    const { url } = await start();
    const { a, b } = await joinedPair(url);
    a.send({ t: 'leave' });
    const left = await b.waitFor((m) => m['t'] === 'peer-left');
    expect(left['t']).toBe('peer-left');
  });

  it('expires an inactive room and refuses new joins', async () => {
    let now = 1_000;
    const registry = new RoomRegistry(
      { maxPeers: 2, ttlMs: 5_000, maxBufferedSignals: 4, maxControlBytes: 1024, maxFrameBytes: 4096, maxMessagesPerSecond: 10 },
      () => now,
    );
    const created = registry.create('EXPIRE01', 's1', {
      id: 'a',
      deviceId: 'device-alice-0001',
      displayName: 'Alice',
      platform: 'windows',
      capabilities: [],
    });
    expect(created.ok).toBe(true);
    expect(registry.size).toBe(1);

    now += 6_000;
    const late = registry.join('EXPIRE01', 's2', {
      id: 'b',
      deviceId: 'device-bob-000002',
      displayName: 'Bob',
      platform: 'web',
      capabilities: [],
    });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.reason).toBe('closed');
    expect(registry.size).toBe(0);
  });
});

describe('blind relay', () => {
  it('forwards opaque frames byte for byte, without needing to parse them', async () => {
    const { server, url } = await start();
    const { a, b } = await joinedPair(url);
    a.send({ t: 'relay-ready' });
    b.send({ t: 'relay-ready' });
    await a.waitFor((m) => m['t'] === 'relay-open');
    await b.waitFor((m) => m['t'] === 'relay-open');

    // Not JSON, no valid UTF-8, no structure the server could make sense of: an
    // encrypted frame is exactly this, and it must arrive unchanged.
    const frame = new Uint8Array([0x02, 0x9f, 0x00, 0xff, 0xfe, 0x7b, 0x00, 0xc3, 0x28, 0x01, 0x02, 0x03, 0x04]);
    a.sendBinary(frame);
    await b.waitForBinary(1);
    expect([...b.binary[0]!]).toEqual([...frame]);

    // And the other way around, with a bigger payload that spans several frames.
    const big = new Uint8Array(200_000);
    for (let i = 0; i < big.length; i += 1) big[i] = (i * 97) % 256;
    b.sendBinary(big);
    // Wait until every byte arrived, not until "a first frame" arrived: a relay must
    // not lose the tail of a large payload.
    const deadline = Date.now() + 5_000;
    while (a.binary.reduce((sum, chunk) => sum + chunk.length, 0) < big.length) {
      if (Date.now() > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const total = a.binary.reduce((sum, chunk) => sum + chunk.length, 0);
    expect(total).toBe(big.length);
    const merged = new Uint8Array(total);
    let cursor = 0;
    for (const chunk of a.binary) {
      merged.set(chunk, cursor);
      cursor += chunk.length;
    }
    expect([...merged.slice(0, 16)]).toEqual([...big.slice(0, 16)]);
    expect([...merged.slice(-16)]).toEqual([...big.slice(-16)]);
    expect(merged.length).toBe(big.length);

    // The server counted bytes, and knows nothing else about them.
    const stats = server.stats();
    expect(stats.relayedBytes).toBeGreaterThanOrEqual(big.length);
    expect(stats.relayedFrames).toBeGreaterThanOrEqual(2);
  });

  it('asks the other peer before switching the room to relay mode', async () => {
    const { url } = await start();
    const { a, b } = await joinedPair(url);

    // One side asking is not enough, and it must not be: the room only relays once both
    // sides asked, so the peer that did not ask is *asked*, never switched.
    a.send({ t: 'relay-ready' });
    const asked = await b.waitFor((m) => m['t'] === 'relay-requested');
    expect(asked['t']).toBe('relay-requested');
    expect(a.messages.some((m) => m['t'] === 'relay-open')).toBe(false);
    expect(b.messages.some((m) => m['t'] === 'relay-open')).toBe(false);

    // Asking once per peer: the answer must not come back as a request, or two clients
    // would answer each other forever.
    a.send({ t: 'relay-ready' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(b.messages.filter((m) => m['t'] === 'relay-requested')).toHaveLength(1);

    // The second side agrees, and only then is the room relaying.
    b.send({ t: 'relay-ready' });
    await a.waitFor((m) => m['t'] === 'relay-open');
    await b.waitFor((m) => m['t'] === 'relay-open');
    expect(a.messages.filter((m) => m['t'] === 'relay-requested')).toHaveLength(1);
  });

  it('keeps the room on its direct path when the other peer never answers', async () => {
    const { server, url } = await start();
    const { a, b } = await joinedPair(url);
    a.send({ t: 'relay-ready' });
    await b.waitFor((m) => m['t'] === 'relay-requested');

    // Alice waits, and the service does nothing behind her back: no relay, no byte
    // forwarded, the room as it was.
    a.sendBinary(new Uint8Array([0x01, 0x02, 0x03]));
    const error = await a.waitFor((m) => m['t'] === 'error');
    expect(error['code']).toBe('RELAY_NOT_READY');
    expect(server.stats().relayedFrames).toBe(0);
  });

  it('refuses relayed bytes before both peers agreed to relay mode', async () => {
    const { url } = await start();
    const { a } = await joinedPair(url);
    a.sendBinary(new Uint8Array([0x01, 0x02, 0x03]));
    const error = await a.waitFor((m) => m['t'] === 'error');
    expect(error['code']).toBe('RELAY_NOT_READY');
  });

  it('forwards a session description verbatim, without interpreting it', async () => {
    const { url } = await start();
    const { a, b } = await joinedPair(url);
    const description = { type: 'offer', sdp: 'v=0\r\no=- 42 2 IN IP4 127.0.0.1\r\n…' };
    a.send({ t: 'signal', data: description });
    const signal = await b.waitFor((m) => m['t'] === 'signal');
    expect(signal['data']).toEqual(description);
  });

  it('rate limits a chatty peer instead of letting it burn the free tier', async () => {
    const { url } = await start({ limits: { maxMessagesPerSecond: 5 } });
    const a = await connect(url);
    a.send({ t: 'join', code: 'FASTROOM', create: true, peer: peerDescription('a', 'device-alice-0001', 'Alice') });
    await a.waitFor((m) => m['t'] === 'joined');
    for (let i = 0; i < 10; i += 1) a.send({ t: 'ping' });
    const error = await a.waitFor((m) => m['t'] === 'error' && m['code'] === 'RATE_LIMITED');
    expect(error['code']).toBe('RATE_LIMITED');
    const closed = await a.closed;
    expect(closed.code).toBe(1008);
  });

  it('closes a socket that sends a frame larger than the control limit', async () => {
    const { url } = await start({ limits: { maxControlBytes: 1024 } });
    const a = await connect(url);
    a.send({ t: 'join', code: 'BIGROOM1', create: true, peer: peerDescription('a', 'device-alice-0001', 'Alice') });
    await a.waitFor((m) => m['t'] === 'joined');
    a.send({ t: 'signal', data: { padding: 'x'.repeat(4_000) } });
    const closed = await a.closed;
    expect(closed.code).toBe(1009);
  });

  it('rejects a malformed peer description before creating a room', async () => {
    const { server, url } = await start();
    const a = await connect(url);
    a.send({ t: 'join', code: 'BADPEER1', create: true, peer: { id: 'a', deviceId: 'x' } });
    const error = await a.waitFor((m) => m['t'] === 'error');
    expect(error['code']).toBe('BAD_PEER');
    expect(server.stats().rooms).toBe(0);
  });

  it('answers a health check without exposing anything about the peers', async () => {
    const { server } = await start();
    const address = server.httpServer.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body['ok']).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/device-alice|Alice/);

    // Any other route is a 404: this service is not a file host.
    const other = await fetch(`http://127.0.0.1:${address.port}/files/secret`);
    expect(other.status).toBe(404);
  });
});
