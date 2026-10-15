/**
 * Where the relay (the signaling service) is, decided in exactly one place.
 *
 * Why this file exists at all: the published web application used to build its relay
 * address from its own host (`wss://dropforge-webapp.netlify.app/ws`). Nothing answers
 * there, so « Recevoir » and « joindre par code » failed on the live site, and the
 * console filled with connection errors for someone who had done nothing wrong.
 *
 * The rule now:
 *   - the address written in the settings wins, verbatim;
 *   - `none` means **no relay at all** — no outgoing attempt, ever;
 *   - `auto` means the deployment's own address when the build carries one
 *     (`VITE_SIGNALING_URL`), the page's own origin when that page is served locally
 *     (development and the browser bench, where the dev server proxies `/ws`), and
 *     nothing otherwise.
 *
 * An empty result is a real answer, not a failure: it says « there is no relay here »,
 * and the interface has to say the same thing instead of letting people wait.
 */
import { SIGNALING_AUTO, SIGNALING_OFF } from '@dropforge/settings';

/** Hostnames that are this machine, so a same-origin relay is plausible there. */
export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0') return true;
  if (host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  // 172.16.0.0 – 172.31.255.255
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

export interface SignalingFacts {
  /** What the settings say: `auto`, `none`, or a `ws://` / `wss://` address. */
  configured: string;
  /** What the build itself was given, when the deployment knows its own relay. */
  fromBuild?: string | undefined;
  /** Where the page is served from; absent outside a browser. */
  location?: { protocol: string; hostname: string; host: string } | undefined;
}

/**
 * The address to use, or `''` when there is none.
 *
 * A custom address is returned as it is: it is the user's decision, and a typo in it is
 * refused by the settings before it gets here.
 */
export function resolveSignalingUrl(facts: SignalingFacts): string {
  const configured = facts.configured.trim();
  if (configured === SIGNALING_OFF) return '';
  if (configured !== '' && configured !== SIGNALING_AUTO) return configured;
  if (facts.fromBuild) return facts.fromBuild;
  const page = facts.location;
  if (!page) return '';
  // Same-origin only where a same-origin relay exists: the dev server and the bench
  // proxy `/ws`. On any other host, guessing would produce exactly the failure this
  // function exists to prevent.
  if (!isLocalHostname(page.hostname)) return '';
  const scheme = page.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${page.host}/ws`;
}

/** The same decision, read from the running application. */
export function signalingUrlFor(configured: string): string {
  const env = import.meta.env?.['VITE_SIGNALING_URL'];
  return resolveSignalingUrl({
    configured,
    fromBuild: env && env.length > 0 ? env : undefined,
    location:
      typeof globalThis.location === 'undefined'
        ? undefined
        : {
            protocol: globalThis.location.protocol,
            hostname: globalThis.location.hostname,
            host: globalThis.location.host,
          },
  });
}
