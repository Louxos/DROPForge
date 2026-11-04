#!/usr/bin/env node
/**
 * Génère les pages **statiques** du site GitHub Pages : la page d'archive et la page
 * 404. L'application elle-même est construite par Vite (voir `scripts/build-pages.mjs`,
 * qui assemble les deux dans `_site/`).
 *
 * Pourquoi un générateur, et pas des fichiers écrits à la main :
 *  - les pages doivent être **autonomes** : le CSS est inséré dans le fichier, le logo
 *    est un SVG dans le document, et il n'existe aucune ressource distante. Une page
 *    publiée sur un dépôt doit aussi s'ouvrir depuis un dossier local, sans réseau ;
 *  - l'adresse de l'application est un **chemin relatif** (`app/`), décidé ici et nulle
 *    part ailleurs : le site fonctionne donc aussi bien sur
 *    `https://louxos.github.io/DROPForge/` que sur une fourche, un aperçu ou un dossier
 *    local, sans qu'aucune adresse absolue n'ait à être tenue à jour ;
 *  - la page 404 est produite de la même façon, avec les mêmes jetons : elle doit
 *    ressembler au site, pas à une page blanche du serveur.
 *
 * Usage :
 *   node scripts/build-site.mjs --out _site        # écrit index.html, 404.html, favicon.svg
 *   node scripts/build-site.mjs --check            # ne modifie rien, échoue si un rendu est invalide
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** Dépôt public : toutes les pages de documentation y renvoient. */
export const REPO_URL = 'https://github.com/Louxos/DROPForge';

/**
 * Adresse publique du site, utilisée pour les métadonnées de partage (`og:url`).
 * Surchargée par `DROPFORGE_SITE_URL` à la construction : une fourche publie la sienne.
 */
export const SITE_URL = 'https://louxos.github.io/DROPForge/';

/**
 * Date officielle de l'archivage du projet, en toutes lettres.
 *
 * Une seule source de vérité : la page publiée, la page 404, le README et les notes de
 * version annoncent la même date. La changer ici oblige à la changer partout ailleurs,
 * ce qui est exactement le but.
 */
export const ARCHIVED_ON = '4 novembre 2026';

/** Où vit l'application à l'intérieur du site. Relatif, et jamais absolu. */
export const APP_PATH = 'app/';

export const SOURCES = {
  template: 'site/index.html',
  notFound: 'site/404.html',
  styles: 'site/site.css',
  mark: 'apps/web/public/icons/icon.svg',
};

export const OUTPUTS = {
  page: 'index.html',
  notFound: '404.html',
  favicon: 'favicon.svg',
};

/**
 * Vérifie l'adresse de l'application avant de la publier.
 *
 * Une adresse relative (`app/`) est le cas normal. Une adresse absolue reste acceptée
 * pour un déploiement séparé (l'application ailleurs, la page ici) : elle doit être en
 * HTTPS, et ne pas renvoyer à cette page elle-même — un lien vers soi n'est pas une
 * application.
 */
export function checkAppUrl(appUrl, siteUrl = SITE_URL) {
  if (appUrl === '') return { ok: false, reason: 'aucune adresse : la page d’accueil ne peut pas pointer dans le vide' };

  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(appUrl);
  if (!absolute) {
    if (appUrl.startsWith('/')) {
      return {
        ok: false,
        reason: `« ${appUrl} » est absolu : sur GitHub Pages le site vit sous un chemin (/DROPForge/), et un « / » renverrait à la racine du domaine`,
      };
    }
    if (appUrl.split('/').includes('..')) {
      return { ok: false, reason: `« ${appUrl} » sort du dossier publié (« .. »)` };
    }
    return { ok: true, relative: true, reason: 'chemin relatif accepté' };
  }

  let url;
  try {
    url = new URL(appUrl);
  } catch {
    return { ok: false, reason: `« ${appUrl} » n'est pas une adresse absolue lisible` };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: `le schéma « ${url.protocol} » ne convient pas : une page publiée en HTTPS n'ouvre pas une adresse non sécurisée` };
  }
  const site = new URL(siteUrl);
  if (url.href === site.href) {
    return { ok: false, reason: `« ${appUrl} » est cette page elle-même, pas l'application` };
  }
  return { ok: true, relative: false, reason: 'adresse absolue acceptée' };
}

function replaceOnce(haystack, needle, replacement) {
  const index = haystack.indexOf(needle);
  if (index === -1) throw new Error(`la source ne contient plus « ${needle} »`);
  return haystack.slice(0, index) + replacement + haystack.slice(index + needle.length);
}

function replaceAll(haystack, needle, replacement) {
  return haystack.split(needle).join(replacement);
}

/**
 * Le logo est le même que celui de l'application : une seule source, `icon.svg`.
 * L'icône est insérée plusieurs fois (barre, pied de page) : chaque copie reçoit
 * un suffixe sur l'identifiant de son dégradé, pour qu'aucun `url(#…)` ne
 * désigne la mauvaise définition.
 */
export function inlineMark(iconSvg, suffix = '') {
  return iconSvg
    .replace(/<\?xml[^>]*?>\s*/g, '')
    .replace(/\swidth="[^"]*"/, '')
    .replace(/\sheight="[^"]*"/, '')
    .replace(/<svg /, '<svg aria-hidden="true" ')
    .replace(/id="df"/g, `id="df${suffix}"`)
    .replace(/url\(#df\)/g, `url(#df${suffix})`);
}

/** Remplace les jetons d'un gabarit et refuse tout jeton oublié. */
function fill(template, tokens) {
  let page = template;
  for (const [token, value] of Object.entries(tokens)) page = replaceAll(page, token, value);
  const leftover = /{{[A-Z_]+}}/.exec(page);
  if (leftover) throw new Error(`substitution incomplète : ${leftover[0]}`);
  return page;
}

/** Assemble la page d'accueil. Aucune ressource distante, aucun script externe. */
export function renderSite({
  template,
  styles,
  mark,
  version,
  appUrl = APP_PATH,
  repoUrl = REPO_URL,
  siteUrl = SITE_URL,
}) {
  const verdict = checkAppUrl(appUrl, siteUrl);
  if (!verdict.ok) throw new Error(verdict.reason);

  // La première copie du logo (en-tête) et les suivantes (pied de page) n'ont pas le
  // même identifiant de dégradé : sans cela, toutes les copies désigneraient la
  // première définition.
  const withHeaderMark = replaceOnce(template, '{{MARK_SVG}}', inlineMark(mark));
  const withFooterMarks = replaceAll(withHeaderMark, '{{MARK_SVG}}', inlineMark(mark, '-footer'));
  return fill(withFooterMarks, {
    '{{INLINE_CSS}}': styles.trimEnd(),
    '{{VERSION}}': version,
    '{{ARCHIVED_ON}}': ARCHIVED_ON,
    '{{REPO_URL}}': repoUrl,
    '{{SITE_URL}}': siteUrl,
    '{{WEB_APP_URL}}': appUrl,
  });
}

/**
 * Assemble la page 404.
 *
 * GitHub Pages sert le fichier `404.html` de la racine pour toute adresse inconnue. Il
 * est servi **à l'adresse demandée** (par exemple `/DROPForge/une/autre/page`), donc
 * ses liens doivent être absolus et préfixés par le chemin du site : un `app/` relatif
 * pointerait sous l'adresse fautive.
 */
export function renderNotFound({
  template,
  styles,
  mark,
  base = '/',
  appUrl,
  repoUrl = REPO_URL,
  siteUrl = SITE_URL,
}) {
  const effectiveApp = appUrl ?? `${base}${APP_PATH}`;
  // Deux copies du logo (en-tête, pied de page) : chacune reçoit son propre identifiant
  // de dégradé, pour qu'aucun `url(#…)` ne désigne la mauvaise définition.
  const withHeaderMark = replaceOnce(template, '{{MARK_SVG}}', inlineMark(mark));
  const withFooterMarks = replaceAll(withHeaderMark, '{{MARK_SVG}}', inlineMark(mark, '-footer'));
  return fill(withFooterMarks, {
    '{{INLINE_CSS}}': styles.trimEnd(),
    '{{ARCHIVED_ON}}': ARCHIVED_ON,
    '{{BASE_URL}}': base,
    '{{APP_URL}}': effectiveApp,
    '{{REPO_URL}}': repoUrl,
    '{{SITE_URL}}': siteUrl,
    '{{VERSION}}': '',
  });
}

/** Le manifeste du dépôt, lu à la source : la version affichée n'est jamais recopiée. */
async function readVersion(root) {
  return JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
}

/**
 * Produit les fichiers statiques du site (chemins relatifs → contenu), sans rien écrire.
 * `appUrl` est le chemin de l'application **tel qu'il sera écrit dans la page**.
 */
export async function buildSiteFiles({
  root = process.cwd(),
  appUrl = APP_PATH,
  base = '/',
  siteUrl = SITE_URL,
  repoUrl = REPO_URL,
} = {}) {
  const [template, notFound, styles, mark, version] = await Promise.all([
    readFile(path.join(root, SOURCES.template), 'utf8'),
    readFile(path.join(root, SOURCES.notFound), 'utf8'),
    readFile(path.join(root, SOURCES.styles), 'utf8'),
    readFile(path.join(root, SOURCES.mark), 'utf8'),
    readVersion(root),
  ]);

  const files = new Map();
  files.set(OUTPUTS.page, renderSite({ template, styles, mark, version, appUrl, repoUrl, siteUrl }));
  files.set(
    OUTPUTS.notFound,
    renderNotFound({ template: notFound, styles, mark, base, appUrl: `${base}${APP_PATH}`, repoUrl, siteUrl }),
  );
  // Le favicon est l'icône de l'application, copiée telle quelle : ce qui apparaît dans
  // l'onglet est exactement ce qui apparaît dans la barre des tâches.
  files.set(OUTPUTS.favicon, mark);
  return files;
}

export async function main(argv = process.argv.slice(2), root = process.cwd()) {
  const outIndex = argv.indexOf('--out');
  const out = outIndex === -1 ? '' : (argv[outIndex + 1] ?? '');
  const check = argv.includes('--check');
  if (!check && out === '') {
    console.error('usage : node scripts/build-site.mjs --out <dossier> | --check');
    return 2;
  }

  const base = process.env['DROPFORGE_PAGES_BASE'] ?? '/DROPForge/';
  const siteUrl = process.env['DROPFORGE_SITE_URL'] ?? SITE_URL;
  const files = await buildSiteFiles({ root, appUrl: APP_PATH, base, siteUrl });

  if (check) {
    // Rendues sans erreur : les jetons sont tous remplacés et l'adresse de
    // l'application est utilisable. C'est ce que la chaîne vérifie.
    for (const [name, content] of files) console.log(`ok : ${name} (${Buffer.byteLength(content, 'utf8')} octets)`);
    return 0;
  }

  const directory = path.isAbsolute(out) ? out : path.join(root, out);
  await mkdir(directory, { recursive: true });
  for (const [name, content] of files) {
    const target = path.join(directory, name);
    await writeFile(target, content, 'utf8');
    console.log(`écrit : ${path.join(out, name)} (${Buffer.byteLength(content, 'utf8')} octets)`);
  }
  return 0;
}

// Le module est importable par les tests : la génération ne se déclenche que
// lorsque le fichier est exécuté lui-même.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`pages statiques non générées : ${error.message}`);
      process.exitCode = 1;
    });
}

/** Vrai lorsque le site contient réellement l'application (utilisé par les contrôles). */
export async function appIsPresent(directory) {
  return existsSync(path.join(directory, APP_PATH, 'index.html'));
}
