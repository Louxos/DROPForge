/**
 * The address ↔ screen mapping.
 *
 * A static host (GitHub Pages) has no process to rewrite `/reglages` into the
 * application page, so the screen lives in the fragment. These tests pin the two
 * properties that make it safe: every screen round-trips, and a fragment that
 * belongs to another feature (`#c=CODE`, a share link) is *not* read as a screen.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTE, ROUTES, hashForRoute, routeFromHash } from './routes.js';

describe('routage par fragment', () => {
  it('fait l’aller-retour pour les quatre écrans', () => {
    for (const route of ROUTES) {
      expect(hashForRoute(route)).toBe(`#route=${route}`);
      expect(routeFromHash(hashForRoute(route))).toBe(route);
    }
    // The default is one of them, and it is the one the application opens on.
    expect(ROUTES).toContain(DEFAULT_ROUTE);
    expect(DEFAULT_ROUTE).toBe('transfer');
  });

  it('accepte les formes courtes qu’une personne écrit à la main', () => {
    expect(routeFromHash('#/settings')).toBe('settings');
    expect(routeFromHash('#settings')).toBe('settings');
    expect(routeFromHash('#route=activity&from=notification')).toBe('activity');
    expect(routeFromHash('#route=devices/')).toBe('devices');
  });

  it('ne devine rien quand le fragment ne nomme aucun écran', () => {
    expect(routeFromHash('')).toBeUndefined();
    expect(routeFromHash('#')).toBeUndefined();
    // A pairing code is a code, not a screen: reading it as one would hide the very
    // link the QR code carries.
    expect(routeFromHash('#c=abc123')).toBeUndefined();
    expect(routeFromHash('#reglages')).toBeUndefined();
    expect(routeFromHash('#route=historique')).toBeUndefined();
    expect(routeFromHash('#df=share&s=eyJpZCI6MX0')).toBeUndefined();
  });
});
