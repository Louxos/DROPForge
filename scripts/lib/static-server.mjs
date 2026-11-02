/**
 * A static file server that behaves like **GitHub Pages** for a project site.
 *
 * Why this exists: the way DropForge is now published — one directory, served under
 * `/NOM-DU-DEPOT/`, with a `404.html` for unknown paths and no server-side rewriting —
 * is a behaviour, and a behaviour that nothing here could check meant the published site
 * was only ever verified by hand. This server reproduces those three rules exactly:
 *
 *   1. everything lives under the base path (`/DROPForge/app/…`); a request outside it
 *      is not part of the site;
 *   2. a directory address without its trailing slash is redirected, as Pages does, so
 *      relative links inside the page keep working;
 *   3. an unknown path answers **404** with the site's own `404.html` — never with the
 *      application page. A host that quietly returns index.html for everything is how a
 *      broken link stays invisible for months.
 *
 * It is used by `scripts/check-pages.mjs` (before publishing) and by the release smoke
 * test (a downloaded archive, served from a folder).
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

/** The types GitHub Pages serves; anything else is served as bytes rather than guessed. */
export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const normalizeBase = (basePath) => {
  const trimmed = `/${basePath.replace(/^\/+|\/+$/g, '')}`;
  return trimmed === '/' ? '/' : `${trimmed}/`;
};

/**
 * Creates (but does not start) the server.
 *
 * `notFoundFile` is a path **relative to `directory`** (GitHub Pages uses `404.html`).
 * Without one, an unknown path answers with a plain 404 — which is what a downloaded
 * archive published from a folder would do.
 */
export function createStaticServer({ directory, basePath = '/', notFoundFile, redirectRootToBase = false } = {}) {
  if (!directory) throw new Error('createStaticServer: directory is required');
  const root = resolve(directory);
  const base = normalizeBase(basePath);
  const notFoundPath = notFoundFile ? join(root, notFoundFile) : undefined;

  const sendNotFound = (response) => {
    if (notFoundPath && existsSync(notFoundPath)) {
      response.writeHead(404, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      createReadStream(notFoundPath).pipe(response);
      return;
    }
    response.writeHead(404, { 'content-type': MIME['.txt'], 'cache-control': 'no-store' });
    response.end('not found');
  };

  const sendFile = (response, file, status = 200) => {
    response.writeHead(status, {
      'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      // The published site sets its own caching; in a check, a cached answer proves
      // nothing about what is on disk.
      'cache-control': 'no-store',
      'content-length': statSync(file).size,
    });
    createReadStream(file).pipe(response);
  };

  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      sendNotFound(response);
      return;
    }

    // A preview browses the root (`/`), while the site itself lives under its base
    // path. GitHub Pages never needs this (the root belongs to someone else), so it is
    // opt-in and only used by `npm run preview:pages`.
    if (redirectRootToBase && base !== '/' && (pathname === '/' || pathname === '')) {
      response.writeHead(302, { location: base });
      response.end();
      return;
    }

    if (!pathname.startsWith(base)) {
      sendNotFound(response);
      return;
    }

    const relative = pathname.slice(base.length);
    const target = normalize(join(root, relative));
    // Path traversal: the resolved target must stay inside the published directory.
    if (target !== root && !target.startsWith(root + sep)) {
      response.writeHead(403, { 'content-type': MIME['.txt'] });
      response.end('forbidden');
      return;
    }

    if (existsSync(target) && statSync(target).isDirectory()) {
      // Pages redirects `/app` to `/app/`; a page fetched without its slash would
      // resolve its relative links one directory too high.
      if (!pathname.endsWith('/')) {
        response.writeHead(301, { location: `${pathname}/${url.search}` });
        response.end();
        return;
      }
      const index = join(target, 'index.html');
      if (existsSync(index)) {
        sendFile(response, index);
        return;
      }
      sendNotFound(response);
      return;
    }

    if (existsSync(target) && statSync(target).isFile()) {
      sendFile(response, target);
      return;
    }

    sendNotFound(response);
  });
}

/** Starts the server on an ephemeral port and reports the origin to use. */
export function startStaticServer(options) {
  const server = createStaticServer(options);
  const base = normalizeBase(options.basePath ?? '/');
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  return new Promise((resolvePromise) => {
    server.listen(port, host, () => {
      const { port: listening } = server.address();
      resolvePromise({
        server,
        basePath: base,
        // The base path is part of the address, exactly like on GitHub Pages.
        baseUrl: `http://${host}:${listening}${base}`,
        origin: `http://${host}:${listening}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
