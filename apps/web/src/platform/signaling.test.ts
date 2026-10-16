// @vitest-environment happy-dom
/**
 * The relay address: the decision that made a published build fail.
 *
 * These tests are written around the honest answer rather than the happy path. The
 * default is « auto », and « auto » on a real deployment is **no relay at all** — the
 * application must say so instead of calling an address that answers nothing.
 */
import { describe, expect, it } from 'vitest';
import { SIGNALING_AUTO, SIGNALING_OFF } from '@dropforge/settings';
import { isLocalHostname, resolveSignalingUrl, signalingUrlFor } from './signaling.js';

/** A page location, built the way `window.location` is: host with the port, and the
 * hostname without it. */
const page = (host: string, protocol = 'https:'): { protocol: string; hostname: string; host: string } => ({
  protocol,
  hostname: host.split(':')[0] ?? host,
  host,
});

describe('résolution de l’adresse du relais', () => {
  it('n’invente rien sur un site publié', () => {
    // Exactly the case that was broken: a real host, no address configured anywhere.
    expect(resolveSignalingUrl({ configured: SIGNALING_AUTO, location: page('dropforge-webapp.netlify.app') })).toBe(
      '',
    );
  });

  it('utilise le relais du déploiement quand le build en porte un', () => {
    expect(
      resolveSignalingUrl({
        configured: SIGNALING_AUTO,
        fromBuild: 'wss://relais.dropforge.example/ws',
        location: page('dropforge-webapp.netlify.app'),
      }),
    ).toBe('wss://relais.dropforge.example/ws');
  });

  it('utilise l’origine locale en développement, et seulement là', () => {
    expect(resolveSignalingUrl({ configured: SIGNALING_AUTO, location: page('localhost:5173', 'http:') })).toBe(
      'ws://localhost:5173/ws',
    );
    expect(resolveSignalingUrl({ configured: SIGNALING_AUTO, location: page('127.0.0.1:4173') })).toBe(
      'wss://127.0.0.1:4173/ws',
    );
  });

  it('respecte une adresse écrite et un refus explicite', () => {
    expect(
      resolveSignalingUrl({ configured: 'wss://mon-relais.example/ws', location: page('example.org') }),
    ).toBe('wss://mon-relais.example/ws');
    // `none` is the case that must never contact anything, not even locally.
    expect(
      resolveSignalingUrl({
        configured: SIGNALING_OFF,
        fromBuild: 'wss://relais.dropforge.example/ws',
        location: page('localhost:5173'),
      }),
    ).toBe('');
  });

  it('reconnaît les adresses privées, pas les noms publics', () => {
    for (const host of ['localhost', '127.0.0.1', '10.0.0.4', '192.168.1.20', '172.16.5.9', '172.31.9.9', 'mac.local']) {
      expect(isLocalHostname(host), host).toBe(true);
    }
    for (const host of ['172.32.0.1', '8.8.8.8', 'dropforge-webapp.netlify.app', 'example.com']) {
      expect(isLocalHostname(host), host).toBe(false);
    }
  });

  it('lit l’environnement du build, et retombe sur « aucun » sinon', () => {
    // The bench runs on `localhost`, so the same-origin relay is the expected answer
    // here — what matters is that the function consults the real page, not a guess.
    const resolved = signalingUrlFor(SIGNALING_AUTO);
    expect(resolved === '' || /^wss?:\/\/[^/]+\/ws$/.test(resolved)).toBe(true);
    expect(signalingUrlFor(SIGNALING_OFF)).toBe('');
  });
});
