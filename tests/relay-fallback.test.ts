/**
 * Le repli par relais aveugle, prouvé de bout en bout.
 *
 * Ce fichier existe à cause d'un défaut trouvé par les tests de navigateur : la tentative
 * en mode relais **ne se terminait jamais**. Le transport était bien marqué ouvert quand
 * le serveur confirmait le mode relais, mais il n'était jamais remis à la tentative en
 * cours — le repli annoncé attendait donc un canal WebRTC que personne n'ouvrirait, puis
 * échouait au délai. Une connexion qui avait besoin du relais échouait toujours, sans
 * que rien dans le code ne le laisse voir.
 *
 * Ce qui est prouvé ici, avec un **vrai serveur de signalisation** et de **vraies
 * connexions WebSocket** :
 *
 *  1. une tentative en mode relais aboutit (elle échouait au délai avant la correction) ;
 *  2. les trames traversent réellement le relais, dans les deux sens ;
 *  3. la moitié qui *reçoit* accepte le relais quand l'autre le demande — sans son
 *     accord, le mode relais n'est jamais activé, et le repli serait inutilisable de son
 *     côté.
 *
 * Ce qui n'est **pas** prouvé ici : WebRTC lui-même. Il n'existe pas dans Node, et c'est
 * dit plutôt que contourné — l'amorce (`RTCPeerConnection`) est remplacée par un objet
 * minimal, seulement pour laisser la tentative d'accueil se mettre en attente. Les tests
 * de navigateur restent la seule preuve d'un canal direct.
 */
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createSignalingServer, type SignalingServer } from '../apps/signaling/src/index.js';
import { WebRtcLinkFactory } from '../apps/web/src/platform/webrtc-link.js';

const servers: SignalingServer[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) await server.close();
  delete (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection;
});

/** Un pair brut : il parle le protocole du service, sans passer par l'application. */
interface RawPeer {
  send: (message: unknown) => void;
  sendBinary: (bytes: Uint8Array) => void;
  waitFor: (predicate: (message: Record<string, unknown>) => boolean, timeoutMs?: number) => Promise<Record<string, unknown>>;
  binaryFrames: () => Uint8Array[];
  waitForBinary: (count: number, timeoutMs?: number) => Promise<void>;
}

async function startServer(): Promise<string> {
  const server = createSignalingServer({ port: 0, host: '127.0.0.1' });
  servers.push(server);
  return `ws://127.0.0.1:${await server.listen()}`;
}

const peerDescription = (id: string, name: string) => ({
  id,
  deviceId: `device-${id}`,
  displayName: name,
  platform: 'test',
  capabilities: ['webrtc.direct', 'relay.blind'],
});

function connect(url: string): Promise<RawPeer> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    sockets.push(socket);
    const messages: Array<Record<string, unknown>> = [];
    const frames: Uint8Array[] = [];
    const waiters: Array<{ predicate: (m: Record<string, unknown>) => boolean; resolve: (m: Record<string, unknown>) => void }> = [];

    socket.on('message', (raw, isBinary) => {
      if (isBinary) {
        frames.push(new Uint8Array(raw as Buffer));
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
    socket.on('error', reject);
    socket.on('open', () =>
      resolve({
        send: (message) => socket.send(JSON.stringify(message)),
        sendBinary: (bytes) => socket.send(bytes, { binary: true }),
        binaryFrames: () => frames,
        waitFor: (predicate, timeoutMs = 5_000) =>
          new Promise((res, rej) => {
            const found = messages.find(predicate);
            if (found) {
              res(found);
              return;
            }
            const timer = setTimeout(() => rej(new Error('le pair brut attend un message qui n’arrive pas')), timeoutMs);
            waiters.push({
              predicate,
              resolve: (message) => {
                clearTimeout(timer);
                res(message);
              },
            });
          }),
        waitForBinary: async (count, timeoutMs = 5_000) => {
          const deadline = Date.now() + timeoutMs;
          while (frames.length < count) {
            if (Date.now() > deadline) throw new Error(`${frames.length}/${count} trame(s) reçue(s)`);
            await new Promise((res) => setTimeout(res, 5));
          }
        },
      }),
    );
  });
}

/** Rejoint une salle et attend la confirmation du service. */
async function join(url: string, code: string, options: { create?: boolean } = {}): Promise<RawPeer> {
  const peer = await connect(url);
  peer.send({ t: 'join', code, ...(options.create ? { create: true } : {}), peer: peerDescription('raw', 'Pair brut') });
  await peer.waitFor((message) => message['t'] === 'joined');
  return peer;
}

const factoryFor = (url: string): WebRtcLinkFactory =>
  new WebRtcLinkFactory({
    signalingUrl: url,
    deviceId: 'device-dialer',
    displayName: 'Appelant',
    platform: 'test',
    capabilities: ['webrtc.direct', 'relay.blind'],
  });

describe('repli par relais aveugle', () => {
  it('aboutit quand le relais est demandé, et fait passer les trames dans les deux sens', async () => {
    const url = await startServer();
    const host = await join(url, 'RELAIS0001', { create: true });
    // Le pair qui reçoit n'utilise pas le relais de lui-même : il répond à la demande,
    // exactement comme le fait l'application (voir `onRelayRequested`).
    host.waitFor((message) => message['t'] === 'relay-requested').then(() => host.send({ t: 'relay-ready' }));

    const factory = factoryFor(url);
    const transport = await factory.create(
      'relay',
      { deviceId: 'unknown', displayName: '', methods: ['relay'], route: 'RELAIS0001' },
      new AbortController().signal,
    );
    expect(transport.kind).toBe('relay');

    // Une trame envoyée par l'application arrive telle quelle chez l'autre pair…
    const outbound = new Uint8Array([0x02, 0x00, 0xff, 0x7f, 0x01]);
    transport.send(outbound);
    await host.waitForBinary(1);
    expect([...host.binaryFrames()[0]!]).toEqual([...outbound]);

    // …et ce que l'autre pair envoie arrive dans l'application.
    const received: Uint8Array[] = [];
    transport.onFrame((frame) => received.push(frame));
    const inbound = new Uint8Array([0x09, 0x08, 0x07]);
    host.sendBinary(inbound);
    const deadline = Date.now() + 5_000;
    while (received.length === 0 && Date.now() < deadline) await new Promise((res) => setTimeout(res, 5));
    expect(received.map((frame) => [...frame])).toEqual([[...inbound]]);

    await transport.close();
    await factory.close();
  });

  it('est accepté par la moitié qui attend, sans jamais être forcé par l’autre', async () => {
    const url = await startServer();

    /**
     * Le strict minimum pour que la tentative d'accueil se mette en attente : un canal
     * qui ne s'ouvre jamais. Aucune connexion directe ne peut donc aboutir ici, et le
     * seul chemin possible est le relais — c'est précisément ce qu'on veut prouver.
     */
    const channel = {
      readyState: 'connecting' as const,
      bufferedAmount: 0,
      bufferedAmountLowThreshold: 0,
      binaryType: 'arraybuffer',
      onmessage: null as unknown,
      onopen: null as unknown,
      onclose: null as unknown,
      onerror: null as unknown,
      close: () => {},
      send: () => {},
    };
    class NeverOpeningPeerConnection {
      onicecandidate: ((event: { candidate?: unknown }) => void) | undefined;
      ondatachannel: ((event: { channel: unknown }) => void) | undefined;
      createDataChannel(): unknown {
        return channel;
      }
      async createOffer(): Promise<unknown> {
        return { type: 'offer', sdp: '' };
      }
      async setLocalDescription(): Promise<void> {}
      async setRemoteDescription(): Promise<void> {}
      async addIceCandidate(): Promise<void> {}
      async createAnswer(): Promise<unknown> {
        return { type: 'answer', sdp: '' };
      }
      close(): void {}
    }
    (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = NeverOpeningPeerConnection;

    const factory = factoryFor(url);
    const room = await factory.host('RELAIS0002');
    // La salle est réelle avant que le code ne soit montré : c'est cette promesse que
    // l'interface attend avant d'afficher le moindre code.
    await room.ready;

    const dialer = await join(url, 'RELAIS0002');
    // L'appelant a besoin du relais et le demande : c'est la moitié qui attend qui doit
    // répondre, et c'est exactement ce que cette ligne met à l'épreuve.
    dialer.send({ t: 'relay-ready' });
    const transport = await room.transport;
    expect(transport.kind).toBe('relay');

    // Le pair qui attend a bien reçu la demande, et a répondu de lui-même.
    await dialer.waitFor((message) => message['t'] === 'relay-open');

    const received: Uint8Array[] = [];
    transport.onFrame((frame) => received.push(frame));
    dialer.sendBinary(new Uint8Array([0xab, 0xcd]));
    const deadline = Date.now() + 5_000;
    while (received.length === 0 && Date.now() < deadline) await new Promise((res) => setTimeout(res, 5));
    expect(received.map((frame) => [...frame])).toEqual([[0xab, 0xcd]]);

    await room.close();
    await factory.close();
  });

  it('ne bascule pas sur le relais tant que l’autre pair n’a pas répondu', async () => {
    const url = await startServer();
    const host = await join(url, 'RELAIS0003', { create: true });
    // Le pair brut reçoit la demande et l'ignore : rien ne doit basculer.
    host.waitFor((message) => message['t'] === 'relay-requested');

    const factory = factoryFor(url);
    const controller = new AbortController();
    const pending = factory.create(
      'relay',
      { deviceId: 'unknown', displayName: '', methods: ['relay'], route: 'RELAIS0003' },
      controller.signal,
    );
    // Court, exprès : la tentative ne doit pas aboutir d'elle-même en quelques dizaines
    // de millisecondes, et le test ne doit pas attendre le vrai délai d'échec.
    const outcome = await Promise.race([
      pending.then(
        () => 'aboutie',
        () => 'échouée',
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('en attente'), 400)),
    ]);
    expect(outcome).toBe('en attente');
    expect(host.binaryFrames()).toHaveLength(0);

    controller.abort();
    await factory.close();
  });

  // Sans adresse, il n'y a pas de relais — et il ne doit **rien** tenter. Avant, la
  // fabrique construisait un `WebSocket` avec une adresse vide : le navigateur levait
  // une erreur de syntaxe brute, illisible et impossible à traduire. La réponse est
  // maintenant un refus explicite, avec le code que l'interface sait expliquer.
  it('refuse une tentative sans adresse, au lieu de laisser le navigateur lever', async () => {
    const factory = factoryFor('');
    const attempt = factory.create(
      'relay',
      { deviceId: 'unknown', displayName: '', methods: ['relay'], route: 'SANSRELAIS' },
      new AbortController().signal,
    );
    await expect(attempt).rejects.toMatchObject({ code: 'RELAY_UNAVAILABLE' });
    await factory.close();
  });
});
