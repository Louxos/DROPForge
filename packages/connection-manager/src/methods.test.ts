import { describe, expect, it } from 'vitest';
import type { Capability } from '@dropforge/protocol';
import { explainChoice, selectTransportMethod, type MethodFacts } from './methods.js';

const ALL: Capability[] = [
  'webrtc.direct',
  'relay.blind',
  'fs.directory',
  'fs.download',
  'transfer.resume',
  'transfer.pause',
  'transfer.folders',
  'transfer.integrity',
];

const facts = (overrides: Partial<MethodFacts> = {}): MethodFacts => ({
  samePrivateNetwork: true,
  webRtcSupported: true,
  stunReachable: true,
  relayReachable: true,
  localCapabilities: ALL,
  peerCapabilities: ALL,
  ...overrides,
});

const reasonFor = (choice: ReturnType<typeof selectTransportMethod>, method: 'lan' | 'webrtc' | 'relay'): string =>
  choice.considered.find((entry) => entry.method === method)?.reason ?? 'missing';

describe('selectTransportMethod', () => {
  it('prefers the local network when both devices are on it', () => {
    const choice = selectTransportMethod(facts());
    expect(choice.method).toBe('lan');
    expect(choice.blocked).toBe(false);
    // A local transfer must not silently be routed over the internet.
    expect(reasonFor(choice, 'webrtc')).toBe('sameNetwork');
  });

  it('falls back to a direct WebRTC path when the devices are on different networks', () => {
    const choice = selectTransportMethod(facts({ samePrivateNetwork: false }));
    expect(choice.method).toBe('webrtc');
    expect(explainChoice(choice, 'fr')[0]).toContain('Connexion directe');
  });

  it('uses the blind relay only when a direct path is impossible', () => {
    const choice = selectTransportMethod(facts({ samePrivateNetwork: false, stunReachable: false }));
    expect(choice.method).toBe('relay');
    // The explanation has to say the relay cannot read the files.
    const [fr] = explainChoice(choice, 'fr');
    expect(fr).toContain('relais aveugle');
    expect(fr).toContain('ne peut pas les lire');
  });

  it('never claims a direct connection that is not there', () => {
    const choice = selectTransportMethod(
      facts({ samePrivateNetwork: false, stunReachable: false, relayReachable: false }),
    );
    expect(choice.method).toBeUndefined();
    expect(choice.blocked).toBe(true);
    expect(reasonFor(choice, 'relay')).toBe('relayMissing');
  });

  it('explains an honest dead end, method by method, in both languages', () => {
    const choice = selectTransportMethod(
      facts({ samePrivateNetwork: false, stunReachable: false, relayReachable: false }),
    );
    const fr = explainChoice(choice, 'fr');
    const en = explainChoice(choice, 'en');
    expect(fr[0]).toContain('Aucun chemin');
    expect(en[0]).toContain('No path');
    expect(fr.some((line) => line.includes('STUN'))).toBe(true);
    expect(en.some((line) => line.includes('STUN'))).toBe(true);
    // The fallback advice is present instead of a fake promise.
    expect(fr.some((line) => line.includes('clé USB'))).toBe(true);
  });

  it('respects the peer capabilities: an old peer cannot be reached directly', () => {
    const choice = selectTransportMethod(
      facts({ samePrivateNetwork: false, peerCapabilities: ['transfer.integrity'] }),
    );
    expect(choice.method).toBeUndefined();
    expect(reasonFor(choice, 'webrtc')).toBe('peerCannotWebrtc');
  });

  it('falls back to the relay when this platform has no WebRTC at all', () => {
    const choice = selectTransportMethod(facts({ samePrivateNetwork: false, webRtcSupported: false }));
    expect(choice.method).toBe('relay');
    // …and it says why a direct path was impossible, instead of blaming the network.
    expect(reasonFor(choice, 'lan')).toBe('platformCannotWebrtc');
    expect(reasonFor(choice, 'webrtc')).toBe('platformCannotWebrtc');
    expect(explainChoice(choice, 'en')[0]).toContain('blind relay');
  });
});
