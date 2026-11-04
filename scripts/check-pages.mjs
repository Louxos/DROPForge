#!/usr/bin/env node
/**
 * Verifies the GitHub Pages site — **before** publishing it, and again **after**.
 *
 * Two modes, one set of checks:
 *
 *   node scripts/check-pages.mjs
 *       serves `_site/` on a local port, under the real base path (`/DROPForge/`), with
 *       the same rules as GitHub Pages (no rewriting, `404.html` for unknown paths),
 *       then checks what a browser would receive;
 *
 *   node scripts/check-pages.mjs --url https://louxos.github.io/DROPForge/
 *       runs the very same checks against the **deployed** site, which is what the
 *       publication workflow does after deploying.
 *
 * What is checked is what actually breaks on a static host, and nothing else:
 *
 *   - the home page is the **archive page**: it says the project is archived, gives the
 *     archiving date, and points at the source code, the commit history and the releases;
 *     it carries no external resource and does not read like a temporary page;
 *   - the application is still served for consultation, and is linked relatively;
 *   - the application page, its script, its stylesheet, its icons and its manifest are
 *     all reachable **through the base path** (`/NOM-DU-DEPOT/app/…`): a missing prefix
 *     is the classic failure, and it is invisible locally where the base is `/`;
 *   - the manifest's `scope` and `start_url` are the application's own directory, or the
 *     browser refuses to install it (`start_url` outside `scope`);
 *   - the service worker registers from the right address and every file it precaches
 *     is reachable — otherwise the "works offline" claim is false the first time;
 *   - an unknown address answers **404 with the site's page**, not with the application
 *     pretending everything is fine;
 *   - no source map is published, and nothing mentions Netlify any more.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVED_ON } from './build-site.mjs';
import { startStaticServer } from './lib/static-server.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(root, '_site');
const METADATA = join(root, '.pages-build.json');

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
  return ok;
};

/** Addresses written in an HTML page: absolute, relative, or not a fetch at all. */
function references(html) {
  const found = new Set();
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const value = match[1];
    if (value.startsWith('data:') || value.startsWith('#') || value.startsWith('mailto:')) continue;
    found.add(value);
  }
  return [...found];
}

/** The URLs Workbox precaches, in the order the service worker lists them. */
function precachedUrls(serviceWorker) {
  return [...serviceWorker.matchAll(/\{url:"([^"]+)",revision:/g)].map((match) => match[1]);
}

/**
 * Runs every check against `siteUrl` (which ends with the site's base path and a slash,
 * exactly like a GitHub Pages project site).
 */
async function runChecks(siteUrl, { local }) {
  // The base path is the part GitHub Pages adds for a project site (`/DROPForge/`).
  // Everything the application references must carry it — that is the whole point.
  const basePath = new URL(siteUrl).pathname;
  const appPath = `${basePath}app/`;
  const appUrl = `${siteUrl}app/`;
  console.log(`\n[pages] ${siteUrl}`);

  /* --- the archive page ------------------------------------------------ */
  const home = await fetch(siteUrl);
  const homeHtml = await home.text();
  check(home.status === 200, 'la page d’archive répond', `HTTP ${home.status}`);
  check(
    (home.headers.get('content-type') ?? '').startsWith('text/html'),
    'la page d’archive est servie en HTML',
    home.headers.get('content-type') ?? 'sans type',
  );
  // What makes it an archive page, and not a 404 or a placeholder: the sentence, the
  // date, and the fact that development is over.
  check(
    homeHtml.includes('Ce projet est désormais archivé.'),
    'la page annonce l’archivage en clair',
  );
  check(homeHtml.includes(ARCHIVED_ON), 'la page porte la date d’archivage', ARCHIVED_ON);
  check(
    /développement (est )?(définitivement )?arrêté/i.test(homeHtml),
    'la page dit que le développement est arrêté',
  );
  check(!/arrive bientôt|reviens bientôt|temporaire/i.test(homeHtml), 'la page ne se lit pas comme une page temporaire');
  // Access to the code, its history and its releases: the three things a closed project
  // must still offer.
  check(homeHtml.includes('https://github.com/Louxos/DROPForge'), 'la page renvoie au code source');
  check(homeHtml.includes('/commits/main'), 'la page renvoie à l’historique des commits');
  check(homeHtml.includes('/releases'), 'la page renvoie aux versions publiées');
  check(homeHtml.includes('href="app/"'), 'l’application restée en ligne est liée en relatif (aucun domaine écrit en dur)');
  check(!/\{\{[A-Z_]+\}\}/.test(homeHtml), 'aucun jeton de gabarit non remplacé');
  // Nothing is loaded from anywhere else: the pages work offline, from a folder, and
  // without a third party seeing who reads them.
  const external = references(homeHtml).filter((value) => /^(https?:)?\/\//.test(value) && !value.startsWith('https://github.com/'));
  check(external.length === 0, 'aucune ressource distante sur la page d’archive', external.join(', ') || 'aucune');
  check(!/netlify/i.test(homeHtml), 'la page ne mentionne plus Netlify');

  /* --- the application ------------------------------------------------ */
  const app = await fetch(appUrl);
  const appHtml = await app.text();
  check(app.status === 200, 'l’application répond sous son chemin', `HTTP ${app.status} — ${appUrl}`);
  check(appHtml.includes('<div id="root">'), 'c’est bien la page de l’application');
  check(
    appHtml.includes(`${appPath}manifest.webmanifest`),
    'le manifeste est référencé avec le chemin du site',
    `${appPath}manifest.webmanifest`,
  );

  // Every file the page points at must be there. A 404 here is a blank screen.
  const appReferences = references(appHtml).filter((value) => !value.startsWith('http'));
  check(appReferences.length >= 3, 'la page de l’application référence ses fichiers', `${appReferences.length} références`);
  for (const reference of appReferences) {
    // A page that references `/assets/…` instead of `/DROPForge/app/assets/…` is the
    // exact failure this check exists for.
    const resolved = new URL(reference, appUrl);
    const wanted = resolved.href;
    const response = await fetch(wanted);
    if (!check(response.ok, `fichier de l’application servi : ${reference}`, `HTTP ${response.status}`)) continue;
    const type = response.headers.get('content-type') ?? '';
    const expected = reference.endsWith('.css')
      ? 'text/css'
      : reference.endsWith('.js')
        ? 'javascript'
        : reference.endsWith('.webmanifest')
          ? 'manifest'
          : reference.endsWith('.png')
            ? 'image/png'
            : reference.endsWith('.svg')
              ? 'image/svg+xml'
              : '';
    if (expected !== '') check(type.includes(expected), `type de contenu : ${reference}`, type || 'sans type');
  }

  /* --- the manifest (what makes it installable) ----------------------- */
  const manifestResponse = await fetch(new URL('manifest.webmanifest', appUrl));
  const manifest = manifestResponse.ok ? await manifestResponse.json() : {};
  check(manifestResponse.ok, 'le manifeste est joignable', `HTTP ${manifestResponse.status}`);
  check(manifest.start_url === appPath, 'start_url = dossier de l’application', String(manifest.start_url));
  check(manifest.scope === appPath, 'scope = dossier de l’application', String(manifest.scope));
  check(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'le manifeste déclare ses icônes', `${manifest.icons?.length ?? 0}`);
  for (const icon of manifest.icons ?? []) {
    const response = await fetch(new URL(icon.src, appUrl));
    check(response.ok, `icône joignable : ${icon.src}`, `HTTP ${response.status}`);
  }
  for (const shortcut of manifest.shortcuts ?? []) {
    check(
      typeof shortcut.url === 'string' && shortcut.url.startsWith(appPath),
      `raccourci dans l’application : ${shortcut.name}`,
      shortcut.url,
    );
  }

  /* --- the service worker (offline, and updates) ---------------------- */
  const registration = await fetch(new URL('registerSW.js', appUrl));
  const registrationBody = registration.ok ? await registration.text() : '';
  check(registration.ok, 'le script d’enregistrement du service worker est servi', `HTTP ${registration.status}`);
  check(
    registrationBody.includes(`register('${appPath}sw.js'`) && registrationBody.includes(`scope: '${appPath}'`),
    'le service worker est enregistré sur le dossier de l’application',
    `${appPath}sw.js`,
  );

  const sw = await fetch(new URL('sw.js', appUrl));
  const swBody = sw.ok ? await sw.text() : '';
  check(sw.ok, 'le service worker est servi', `HTTP ${sw.status}`);
  const precached = precachedUrls(swBody);
  check(precached.length >= 5, 'le service worker liste les fichiers hors ligne', `${precached.length} fichiers`);
  const unreachable = [];
  for (const entry of precached) {
    const response = await fetch(new URL(entry, appUrl));
    if (!response.ok) unreachable.push(`${entry} (HTTP ${response.status})`);
  }
  check(unreachable.length === 0, 'chaque fichier hors ligne est joignable', unreachable.join(', ') || 'tous joignables');
  check(!swBody.includes('sourceMappingURL'), 'le service worker ne renvoie pas à une carte de sources');

  /* --- 404, and what a wrong address must not do ---------------------- */
  const missingAddress = `${siteUrl}une-page-qui-n-existe-pas-${Date.now()}`;
  const missing = await fetch(missingAddress);
  const missingBody = await missing.text();
  check(missing.status === 404, 'une adresse inconnue répond 404', `HTTP ${missing.status}`);
  check(/Page introuvable|adresse ne mène nulle part/i.test(missingBody), 'la page 404 est celle du site');
  check(
    missingBody.includes(`${appPath}`),
    'la page 404 renvoie à l’application par son chemin absolu',
    appPath,
  );
  check(missingBody.includes(ARCHIVED_ON), 'la page 404 rappelle la date d’archivage', ARCHIVED_ON);

  /* --- what must never be published ----------------------------------- */
  const map = await fetch(new URL('assets/index.js.map', appUrl));
  check(!map.ok, 'aucune carte de sources publiée', `HTTP ${map.status}`);
  check(appHtml.length > 200, 'la page de l’application n’est pas vide', `${appHtml.length} octets`);

  /* --- every file of the local build is reachable --------------------- */
  if (local) {
    const files = [];
    const walk = (directory, prefix = '') => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isDirectory()) walk(join(directory, entry.name), path);
        else files.push(path);
      }
    };
    walk(OUT);
    const unreachableFiles = [];
    for (const file of files) {
      const response = await fetch(new URL(file, siteUrl));
      if (!response.ok) unreachableFiles.push(`${file} (HTTP ${response.status})`);
    }
    check(unreachableFiles.length === 0, 'chaque fichier publié est servi', unreachableFiles.join(', ') || `${files.length} fichiers`);
    const total = files.reduce((sum, file) => sum + statSync(join(OUT, file)).size, 0);
    check(total < 4 * 1024 * 1024, 'taille du site sous le budget', `${(total / 1024).toFixed(0)} Kio`);
    check(files.every((file) => !file.endsWith('.map')), 'aucun fichier .map dans _site');

    /* --- la copie publiée depuis la branche ------------------------------ */
    // GitHub Pages sert ce dépôt **depuis une branche** : ce que les visiteurs reçoivent,
    // ce sont les fichiers du dépôt lui-même. Un dépôt archivé n'exécute plus ses
    // workflows : le site ne peut donc plus être un artefact, il doit être là. La copie
    // est comparée octet par octet, sinon elle dérive sans que personne ne le voie.
    check(existsSync(join(root, '.nojekyll')), '.nojekyll présent à la racine (Jekyll désactivé)');
    const missingAtRoot = files.filter((file) => !existsSync(join(root, file)));
    check(
      missingAtRoot.length === 0,
      'chaque fichier publié existe à la racine du dépôt',
      missingAtRoot.join(', ') || `${files.length} fichiers`,
    );
    const drifted = files.filter(
      (file) => existsSync(join(root, file)) && !readFileSync(join(OUT, file)).equals(readFileSync(join(root, file))),
    );
    check(
      drifted.length === 0,
      'la copie de la racine est identique au site construit',
      drifted.join(', ') || 'aucune dérive',
    );
    const committedApp = [];
    const walkApp = (directory, prefix) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = `${prefix}/${entry.name}`;
        if (entry.isDirectory()) walkApp(join(directory, entry.name), path);
        else committedApp.push(path);
      }
    };
    if (existsSync(join(root, 'app'))) walkApp(join(root, 'app'), 'app');
    const stale = committedApp.filter((file) => !files.includes(file));
    check(stale.length === 0, 'aucun fichier abandonné ne traîne à la racine', stale.join(', ') || `${committedApp.length} fichiers`);
  }

  return appUrl;
}

/* ------------------------------------------------------------------ *\
 * Run
 * \* ------------------------------------------------------------------ */

const urlIndex = process.argv.indexOf('--url');
const deployed = urlIndex !== -1 ? process.argv[urlIndex + 1] : undefined;

if (deployed !== undefined) {
  if (!deployed || !/^https:\/\//.test(deployed)) {
    console.error('[pages] --url attend une adresse https:// complète');
    process.exit(2);
  }
  const siteUrl = deployed.endsWith('/') ? deployed : `${deployed}/`;
  try {
    await runChecks(siteUrl, { local: false });
  } catch (error) {
    check(false, 'les contrôles ont abouti', error instanceof Error ? error.message : String(error));
  }
} else {
  if (!existsSync(join(OUT, 'index.html'))) {
    console.error('[pages] _site/ est absent : lancez « npm run build:pages » d’abord.');
    process.exit(2);
  }
  const metadata = existsSync(METADATA)
    ? JSON.parse(readFileSync(METADATA, 'utf8'))
    : { base: '/DROPForge/', siteUrl: undefined };
  const server = await startStaticServer({ directory: OUT, basePath: metadata.base, notFoundFile: '404.html' });
  try {
    await runChecks(server.baseUrl, { local: true });
  } catch (error) {
    check(false, 'les contrôles ont abouti', error instanceof Error ? error.message : String(error));
  } finally {
    await server.close();
  }
}

console.log(failures === 0 ? '\n[pages] site conforme.' : `\n[pages] ${failures} échec(s).`);
process.exit(failures === 0 ? 0 : 1);
