/**
 * Le chemin **direct** (WebRTC), vérifié avec du vrai WebRTC — sans navigateur.
 *
 * Pourquoi ce banc existe. Jusqu'ici, le canal direct était le seul maillon que rien ne
 * prouvait : les tests de navigateur (`e2e/`) le traversent, mais ils ne tournent pas
 * partout, et `tests/relay-fallback.test.ts` dit lui-même que WebRTC n'existe pas dans
 * Node. Autrement dit : la négociation SDP/ICE, l'ouverture du canal et le passage des
 * octets n'étaient couverts par rien d'exécutable ici.
 *
 * Ce que ce banc fait : il remplace `RTCPeerConnection` par l'implémentation de `werift`
 * (WebRTC en TypeScript, sans binaire natif), puis utilise **exactement le code du
 * dépôt** — `apps/web/src/platform/webrtc-link.ts` — avec le **vrai** service de
 * signalisation du dépôt (`apps/signaling`). Deux pairs se rencontrent par un code,
 * négocient, ouvrent un canal direct, et s'échangent 64 Kio puis quelques octets dans
 * l'autre sens. L'égalité des octets est vérifiée, et les deux chemins doivent être
 * `webrtc` : si l'un des deux bascule sur le relais, le banc échoue.
 *
 * Ce que ce banc ne prouve pas : le comportement d'un navigateur réel (glaciation ICE
 * derrière un NAT, STUN, TURN, politiques de sécurité). Cela reste la suite `e2e/` et un
 * essai humain. Il prouve le protocole du projet : offre/réponse/candidats, canal de
 * données, trames intactes dans les deux sens, sur une pile WebRTC indépendante.
 *
 * Lancement :
 *   npm i --no-save werift      # non déclaré en dépendance : ce banc est optionnel
 *   npm run check:direct
 */
import { createServer } from 'node:http';

const REPO = new URL('..', import.meta.url);

async function loadWerift(): Promise<{
  RTCPeerConnection: new (config?: Record<string, unknown>) => unknown;
  RTCSessionDescription: { prototype: Record<string, unknown> };
}> {
  try {
    return (await import('werift')) as never;
  } catch {
    process.stderr.write(
      [
        '',
        'werift n’est pas installé. Ce banc est optionnel — il ne fait pas partie de',
        '`npm test` pour ne pas alourdir la chaîne d’intégration — et s’installe sur demande :',
        '',
        '  npm i --no-save werift',
        '  npm run check:direct',
        '',
      ].join('\n'),
    );
    process.exit(2);
  }
}

const werift = await loadWerift();

/**
 * La pile WebRTC fournie en global, comme le navigateur la fournit.
 *
 * Seule concession à l'environnement : cette machine n'a pas d'interface réseau
 * utilisable (l'adresse n'est pas routable), donc l'adresse de bouclage est déclarée
 * comme adresse d'hôte ICE. Un navigateur annonce ses vraies adresses ; c'est un
 * réglage de bac à sable, pas une différence de protocole.
 */
class LoopbackPeerConnection extends werift.RTCPeerConnection {
  constructor(configuration?: Record<string, unknown>) {
    super({ ...(configuration ?? {}), iceAdditionalHostAddresses: ['127.0.0.1'] });
  }
}

(globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = LoopbackPeerConnection;

// Le navigateur donne un `toJSON()` à une description de session ; werift, non. Sans ce
// shim, le code du dépôt — qui appelle la méthode standard — ne peut rien publier.
const description = werift.RTCSessionDescription.prototype as unknown as {
  toJSON?: () => { type: string; sdp: string };
};
if (typeof description.toJSON !== 'function') {
  description.toJSON = function (this: { type: string; sdp: string }) {
    return { type: this.type, sdp: this.sdp };
  };
}

const { createSignalingServer } = (await import(new URL('apps/signaling/src/index.js', REPO).href)) as {
  createSignalingServer: (options: { port: number; host: string }) => {
    listen: () => Promise<number>;
    close: () => Promise<void>;
  };
};
const { WebRtcLinkFactory } = (await import(
  new URL('apps/web/src/platform/webrtc-link.js', REPO).href
)) as {
  WebRtcLinkFactory: new (options: Record<string, unknown>) => {
    host: (code: string) => Promise<{
      code: string;
      ready: Promise<void>;
      transport: Promise<Transport>;
      close: () => Promise<void>;
    }>;
    create: (method: string, target: Record<string, unknown>, signal: AbortSignal) => Promise<Transport>;
    close: () => Promise<void>;
  };
};

interface Transport {
  kind: string;
  send: (frame: Uint8Array) => void;
  onFrame: (listener: (frame: Uint8Array) => void) => () => void;
  close: (reason?: string) => Promise<void>;
}

const log = (line: string): void => process.stdout.write(`${line}\n`);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const server = createSignalingServer({ port: 0, host: '127.0.0.1' });
const url = `ws://127.0.0.1:${await server.listen()}`;
log(`service de signalisation : ${url}`);

const factory = (deviceId: string, displayName: string) =>
  new WebRtcLinkFactory({
    signalingUrl: url,
    deviceId,
    displayName,
    platform: 'werift',
    capabilities: ['webrtc.direct', 'relay.blind'],
    timeoutMs: 20_000,
    hostWaitMs: 20_000,
  });

const HOST_ID = 'device-host00000001';
const GUEST_ID = 'device-guest0000002';
const CODE = 'WT01-RTC2';

const host = factory(HOST_ID, 'Appareil hôte');
const guest = factory(GUEST_ID, 'Appareil invité');

const failures: string[] = [];
const check = (condition: boolean, description: string): void => {
  log(`  ${condition ? '✓' : '✗'} ${description}`);
  if (!condition) failures.push(description);
};

try {
  const hosted = await host.host(CODE);
  await hosted.ready;
  log(`salle ouverte avec le code ${hosted.code}`);

  const controller = new AbortController();
  const guestTransport = await guest.create(
    'webrtc',
    { deviceId: HOST_ID, displayName: 'Appareil hôte', methods: ['webrtc'], route: CODE },
    controller.signal,
  );
  const hostTransport = await hosted.transport;

  // Les deux côtés doivent être en direct : un repli sur le relais passerait les octets
  // aussi, et ne prouverait donc rien sur WebRTC.
  check(hostTransport.kind === 'webrtc', 'l’hôte obtient un canal direct (et non le relais)');
  check(guestTransport.kind === 'webrtc', 'l’invité obtient un canal direct (et non le relais)');

  const received: number[] = [];
  hostTransport.onFrame((frame) => received.push(...frame));
  const back: number[] = [];
  guestTransport.onFrame((frame) => back.push(...frame));

  // 64 Kio : assez pour dépasser une trame unique et faire travailler la segmentation.
  const payload = new Uint8Array(64 * 1024).map((_value, index) => index % 251);
  guestTransport.send(payload);
  await sleep(2_000);
  guestTransport.send(payload.subarray(0, 3));
  await sleep(2_000);
  hostTransport.send(new Uint8Array([7, 8, 9]));
  await sleep(2_000);

  const first = received.slice(0, payload.length);
  check(
    first.length === payload.length && first.every((byte, index) => byte === payload[index]),
    `l’hôte reçoit 64 Kio identiques (${received.length} octets reçus)`,
  );
  check(
    received.length === payload.length + 3,
    `la trame suivante arrive entière et dans l’ordre (${received.length} octets au total)`,
  );
  check(
    back.length === 3 && back[0] === 7 && back[1] === 8 && back[2] === 9,
    'l’invité reçoit dans l’autre sens',
  );

  await guestTransport.close().catch(() => undefined);
  await hostTransport.close().catch(() => undefined);
  await hosted.close().catch(() => undefined);
} catch (error) {
  failures.push(`exception : ${String(error)}`);
} finally {
  await guest.close().catch(() => undefined);
  await host.close().catch(() => undefined);
  await server.close().catch(() => undefined);
}

log('');
if (failures.length > 0) {
  log(`ÉCHEC — ${failures.join(' ; ')}`);
  process.exit(1);
}
log('le chemin direct fonctionne : canal direct des deux côtés, octets intacts dans les deux sens.');
process.exit(0);
