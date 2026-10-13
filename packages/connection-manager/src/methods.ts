/**
 * "Smart Transfer": pick the best path that is *actually* available.
 *
 * The spec forbids two things, and this module exists to enforce them:
 *  - never claim a direct connection when there is none. A method is usable only
 *    when every fact that method needs is known to be true (capability announced
 *    by the peer, the relevant probe answered, the platform able to run it);
 *  - never leave the user with a dead end. When nothing is usable the caller gets
 *    `blocked: true` plus one honest sentence per method explaining what failed
 *    and what the user can do about it.
 *
 * Ordering is deliberate: local network first (fastest, no internet, no server),
 * then a direct WebRTC path, then the blind relay last (it always costs the most
 * and is the least private of the three, even though it cannot read anything).
 */
import type { Capability } from '@dropforge/protocol';

export type TransportMethod = 'lan' | 'webrtc' | 'relay';

export const TRANSPORT_METHODS: readonly TransportMethod[] = ['lan', 'webrtc', 'relay'];

export type MethodReason =
  | 'sameNetwork'
  | 'differentNetwork'
  | 'platformCannotWebrtc'
  | 'peerCannotWebrtc'
  | 'stunReachable'
  | 'stunUnreachable'
  | 'relayConfigured'
  | 'relayMissing'
  | 'peerCannotRelay';

export interface MethodFacts {
  /** Discovery found the peer on the same private network (mDNS/host candidates). */
  samePrivateNetwork: boolean;
  /** A WebRTC stack exists here (browser or WebView2). Local transfer needs it too. */
  webRtcSupported: boolean;
  /** The configured STUN server answered during the last reachability check. */
  stunReachable: boolean;
  /** The configured blind relay accepted the last connection probe. */
  relayReachable: boolean;
  localCapabilities: readonly Capability[];
  peerCapabilities: readonly Capability[];
}

export interface ConsideredMethod {
  method: TransportMethod;
  usable: boolean;
  reason: MethodReason;
}

export interface MethodChoice {
  method: TransportMethod | undefined;
  considered: ConsideredMethod[];
  /** Nothing usable: the caller must explain, not invent a fallback. */
  blocked: boolean;
}

const has = (caps: readonly Capability[], capability: Capability): boolean => caps.includes(capability);

export function selectTransportMethod(facts: MethodFacts): MethodChoice {
  const localWebrtc = facts.webRtcSupported && has(facts.localCapabilities, 'webrtc.direct');
  const peerWebrtc = has(facts.peerCapabilities, 'webrtc.direct');
  const localRelay = has(facts.localCapabilities, 'relay.blind');
  const peerRelay = has(facts.peerCapabilities, 'relay.blind');

  const considered: ConsideredMethod[] = [];

  const lanUsable = facts.samePrivateNetwork && localWebrtc && peerWebrtc;
  considered.push({
    method: 'lan',
    usable: lanUsable,
    // Report the *real* blocker first: telling someone "different network" when
    // their platform simply has no WebRTC would send them after the wrong fix.
    reason: lanUsable
      ? 'sameNetwork'
      : !facts.webRtcSupported
        ? 'platformCannotWebrtc'
        : !peerWebrtc
          ? 'peerCannotWebrtc'
          : 'differentNetwork',
  });

  const webrtcUsable = !facts.samePrivateNetwork && localWebrtc && peerWebrtc && facts.stunReachable;
  considered.push({
    method: 'webrtc',
    usable: webrtcUsable,
    reason: webrtcUsable
      ? 'stunReachable'
      : !facts.webRtcSupported
        ? 'platformCannotWebrtc'
        : !peerWebrtc
          ? 'peerCannotWebrtc'
          : facts.samePrivateNetwork
            ? 'sameNetwork'
            : 'stunUnreachable',
  });

  const relayUsable = localRelay && peerRelay && facts.relayReachable;
  considered.push({
    method: 'relay',
    usable: relayUsable,
    reason: relayUsable
      ? 'relayConfigured'
      : !localRelay || !peerRelay
        ? 'peerCannotRelay'
        : 'relayMissing',
  });

  const chosen = considered.find((entry) => entry.usable);
  return { method: chosen?.method, considered, blocked: !chosen };
}

export type Locale = 'fr' | 'en';

/**
 * One plain sentence for the UI. Deliberately concrete: it says *why* a path was
 * chosen, and when nothing works it says what the user can do next instead of
 * pretending the transfer will "just work".
 */
export function explainChoice(choice: MethodChoice, locale: Locale = 'fr'): string[] {
  const lines: string[] = [];
  const push = (fr: string, en: string): void => {
    lines.push(locale === 'fr' ? fr : en);
  };

  if (choice.method === 'lan') {
    push(
      'Vos appareils sont sur le même réseau local : les fichiers passent directement, sans Internet.',
      'Both devices are on the same local network: files travel directly, without the internet.',
    );
    return lines;
  }
  if (choice.method === 'webrtc') {
    push(
      'Connexion directe entre les appareils (WebRTC). Aucun serveur ne voit le contenu des fichiers.',
      'Direct connection between the devices (WebRTC). No server ever sees the file contents.',
    );
    return lines;
  }
  if (choice.method === 'relay') {
    push(
      'Vos réseaux ne permettent pas de connexion directe : les fichiers passent par un relais aveugle, qui ne peut pas les lire (chiffrés de bout en bout).',
      'Your networks do not allow a direct connection: files go through a blind relay that cannot read them (end-to-end encrypted).',
    );
    if (choice.considered.some((entry) => entry.method === 'lan' && entry.reason === 'differentNetwork')) {
      push(
        'Pour aller plus vite, mettez les deux appareils sur le même réseau Wi‑Fi.',
        'To go faster, put both devices on the same Wi‑Fi network.',
      );
    }
    return lines;
  }

  // Nothing is usable: say why, method by method.
  push('Aucun chemin disponible pour le moment.', 'No path is available right now.');
  for (const entry of choice.considered) {
    const [fr, en] = reasonSentence(entry.reason);
    push(`• ${fr}`, `• ${en}`);
  }
  push(
    'Vous pouvez aussi exporter les fichiers sur une clé USB : DropForge ne prétendra jamais avoir réussi un envoi qu’il n’a pas pu faire.',
    'You can also copy the files to a USB drive: DropForge will never claim a transfer succeeded when it could not.',
  );
  return lines;
}

function reasonSentence(reason: MethodReason): [string, string] {
  switch (reason) {
    case 'differentNetwork':
      return [
        'Réseau local : les appareils ne sont pas sur le même réseau.',
        'Local network: the devices are not on the same network.',
      ];
    case 'sameNetwork':
      return ['Réseau local : indisponible pour cette étape.', 'Local network: not available at this step.'];
    case 'platformCannotWebrtc':
      return [
        'Connexion directe : ce navigateur ne fournit pas WebRTC.',
        'Direct connection: this browser does not provide WebRTC.',
      ];
    case 'peerCannotWebrtc':
      return [
        'Connexion directe : l’autre appareil ne l’annonce pas (version trop ancienne ?).',
        'Direct connection: the other device does not offer it (outdated version?).',
      ];
    case 'stunUnreachable':
      return [
        'Connexion directe : le serveur STUN est injoignable depuis ce réseau.',
        'Direct connection: the STUN server cannot be reached from this network.',
      ];
    case 'stunReachable':
      return ['Connexion directe : disponible.', 'Direct connection: available.'];
    case 'relayConfigured':
      return ['Relais aveugle : disponible.', 'Blind relay: available.'];
    case 'relayMissing':
      return [
        'Relais : aucun relais configuré ou joignable (option gratuite, à déployer).',
        'Relay: no relay configured or reachable (free option, to be deployed).',
      ];
    case 'peerCannotRelay':
      return [
        'Relais : l’autre appareil n’annonce pas le relais aveugle.',
        'Relay: the other device does not offer the blind relay.',
      ];
  }
}
