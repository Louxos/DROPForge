/**
 * The four screens, and how their name travels in the URL.
 *
 * Why the fragment, and not `/reglages`: DropForge is served by a **static host**
 * (GitHub Pages) that does not rewrite paths. There is no process to answer
 * `/reglages` with the application page, so a path-based route would show the host's
 * 404 page — or require a redirect file the host may not honour. A fragment is never
 * sent to the server: every address serves the same page, the application reads the
 * fragment, and the address keeps working when the files are opened from a folder.
 *
 * It is also what the installed application already asks for: the shortcuts declared
 * in `vite.config.ts` point at `#route=transfer` and `#route=activity`.
 *
 * One rule, so the two halves cannot disagree: `hashForRoute` is the only writer, and
 * `routeFromHash` the only reader. A fragment that names no screen (`#c=CODE`, a share
 * link, anything else) is *left alone* — those fragments belong to other features.
 */

export type Route = 'transfer' | 'devices' | 'activity' | 'settings';

/** The screens, in the order the navigation shows them. */
export const ROUTES: readonly Route[] = ['transfer', 'devices', 'activity', 'settings'] as const;

/** What the application shows when the address names no screen. */
export const DEFAULT_ROUTE: Route = 'transfer';

const PREFIX = 'route=';

const isRoute = (value: string): value is Route => (ROUTES as readonly string[]).includes(value);

/**
 * The screen named by a fragment, if there is one.
 *
 * Accepted forms, because links written by hand end up in all of them:
 *   `#route=settings`, `#/settings`, `#settings`, and the same with other parameters
 *   (`#route=activity&from=notification`). Anything else returns `undefined` rather
 *   than a default: the caller decides what "no route" means, and a pairing fragment
 *   must not be mistaken for one.
 */
export function routeFromHash(hash: string): Route | undefined {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (fragment === '') return undefined;

  // A query-shaped fragment first: this is the documented form.
  const parameter = new URLSearchParams(fragment).get('route');
  if (parameter !== null) {
    // A trailing slash is what a browser adds to a path someone copied: `#route=devices/`
    // names the same screen as `#route=devices`.
    const name = parameter.replace(/\/+$/, '');
    return isRoute(name) ? name : undefined;
  }

  // Then the short forms a person types: `#/settings`, `#settings`.
  const path = fragment.startsWith('/') ? fragment.slice(1) : fragment;
  const name = path.split(/[/?&]/)[0] ?? '';
  return isRoute(name) ? name : undefined;
}

/** The fragment that names a screen. This is the only place that writes one. */
export function hashForRoute(route: Route): string {
  return `#${PREFIX}${route}`;
}
