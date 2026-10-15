#!/usr/bin/env node
/**
 * Génère la page d'accueil publiée par GitHub Pages (racine du dépôt).
 *
 * Pourquoi un générateur, et pas un fichier écrit à la main :
 *  - GitHub Pages publie la racine du dépôt en mode « legacy » : sans
 *    `index.html`, c'est le README qui est servi, et sans `.nojekyll` les
 *    fichiers passent par Jekyll. Les deux sont donc produits ici, jamais
 *    bricolés à la main ;
 *  - la page doit être **autonome** : une page publiée sur un dépôt peut aussi
 *    être ouverte depuis un dossier local ou un aperçu sans réseau. Le CSS est
 *    donc inséré dans le fichier, le logo est un SVG dans le document, et il
 *    n'existe aucune ressource distante ;
 *  - l'adresse de l'application web est un **unique** point d'entrée,
 *    `site/app-url.txt` : la page affiche soit le bouton « Ouvrir
 *    l'application web », soit l'état « bientôt », jamais un lien mort.
 *
 * Usage :
 *   node scripts/build-site.mjs           # régénère index.html, favicon.svg et .nojekyll
 *   node scripts/build-site.mjs --check   # ne modifie rien, échoue si les fichiers ont dérivé
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** Dépôt public : toutes les pages de documentation y renvoient. */
export const REPO_URL = 'https://github.com/Louxos/DROPForge';

/** Adresse de la page elle-même (Pages), utilisée pour les métadonnées de partage. */
export const SITE_URL = 'https://louxos.github.io/DROPForge/';

export const SOURCES = {
  template: 'site/index.html',
  styles: 'site/site.css',
  appUrl: 'site/app-url.txt',
  mark: 'apps/web/public/icons/icon.svg',
};

export const OUTPUTS = {
  page: 'index.html',
  favicon: 'favicon.svg',
  noJekyll: '.nojekyll',
};

const MARKERS = {
  live: ['<!--GATEWAY:LIVE-->', '<!--/GATEWAY:LIVE-->'],
  soon: ['<!--GATEWAY:SOON-->', '<!--/GATEWAY:SOON-->'],
};

/**
 * Lit le contenu de `site/app-url.txt` : les lignes vides et les
 * commentaires commençant par `#` sont ignorés, le reste doit être une adresse
 * absolue en http(s). Une adresse absente est un état normal (« bientôt »).
 */
export function parseAppUrl(text) {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    return line;
  }
  return '';
}

/** Vérifie qu'une adresse peut réellement être publiée, avant qu'elle ne parte en ligne. */
export function checkAppUrl(appUrl) {
  if (appUrl === '') return { ok: true, reason: 'aucune adresse : la page affiche « bientôt »' };
  let url;
  try {
    url = new URL(appUrl);
  } catch {
    return { ok: false, reason: `« ${appUrl} » n'est pas une adresse absolue (attendu : https://…)` };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: `le schéma « ${url.protocol} » n'est pas ouvrable dans un navigateur` };
  }
  if (url.protocol === 'http:') {
    return { ok: false, reason: 'une page publiée en HTTPS ne peut pas pointer vers une adresse http://' };
  }
  if (url.hostname.endsWith('github.io') && url.pathname.startsWith('/DROPForge')) {
    return { ok: false, reason: `« ${appUrl} » est cette page elle-même, pas l'application web` };
  }
  return { ok: true, reason: 'adresse acceptée' };
}

function replaceOnce(haystack, needle, replacement) {
  const index = haystack.indexOf(needle);
  if (index === -1) throw new Error(`la source ne contient plus « ${needle} »`);
  return haystack.slice(0, index) + replacement + haystack.slice(index + needle.length);
}

function replaceAll(haystack, needle, replacement) {
  return haystack.split(needle).join(replacement);
}

/** Retire le bloc de héros inutilisé et les marqueurs de choix (jamais publiés). */
export function selectGateway(html, appUrl) {
  const keep = appUrl === '' ? 'soon' : 'live';
  const drop = keep === 'live' ? 'soon' : 'live';
  const [dropStart, dropEnd] = MARKERS[drop];
  let out = html;
  const from = out.indexOf(dropStart);
  const to = out.indexOf(dropEnd);
  if (from === -1 || to === -1) throw new Error('les blocs « gateway » du modèle sont incomplets');
  out = out.slice(0, from) + out.slice(to + dropEnd.length);
  for (const [start, end] of Object.values(MARKERS)) out = replaceAll(out, start, '').split(end).join('');
  return out;
}

/**
 * Le logo est le même que celui de l'application : une seule source, `icon.svg`.
 * L'icône est insérée plusieurs fois (barre, pied de page) : chaque copie reçoit
 * un suffixe sur l'identifiant de son dégradé, pour qu'aucun `url(#…)` ne
 * désigne la mauvaise définition.
 */
export function inlineMark(iconSvg, suffix = '') {
  return iconSvg
    .replace(/<\?xml[^>]*\?>\s*/g, '')
    .replace(/\swidth="[^"]*"/, '')
    .replace(/\sheight="[^"]*"/, '')
    .replace(/<svg /, '<svg aria-hidden="true" ')
    .replace(/id="df"/g, `id="df${suffix}"`)
    .replace(/url\(#df\)/g, `url(#df${suffix})`);
}

/** Assemble la page publiée. Aucune ressource distante, aucun script externe. */
export function renderSite({ template, styles, mark, version, appUrl, repoUrl = REPO_URL, siteUrl = SITE_URL }) {
  const verdict = checkAppUrl(appUrl);
  if (!verdict.ok) throw new Error(verdict.reason);

  let page = selectGateway(template, appUrl);
  page = replaceOnce(page, '{{INLINE_CSS}}', styles.trimEnd());
  page = replaceOnce(page, '{{MARK_SVG}}', inlineMark(mark));
  page = replaceAll(page, '{{MARK_SVG}}', inlineMark(mark, '-footer'));
  page = replaceAll(page, '{{VERSION}}', version);
  page = replaceAll(page, '{{REPO_URL}}', repoUrl);
  page = replaceAll(page, '{{SITE_URL}}', siteUrl);
  // L'URL est aussi bien le texte affiché que l'attribut de copie : une seule
  // substitution, donc aucun risque d'afficher une adresse et d'en ouvrir une autre.
  page = replaceAll(page, '{{WEB_APP_URL}}', appUrl === '' ? repoUrl + '/releases/latest' : appUrl);
  if (/{{[A-Z_]+}}/.test(page)) {
    throw new Error(`substitution incomplète : ${page.match(/{{[A-Z_]+}}/)[0]}`);
  }
  return page;
}

async function readIfPresent(root, relative) {
  const full = path.join(root, relative);
  return existsSync(full) ? readFile(full, 'utf8') : undefined;
}

/** Produit l'ensemble des fichiers à publier (chemins relatifs → contenu). */
export async function buildOutputs(root) {
  const template = await readFile(path.join(root, SOURCES.template), 'utf8');
  const styles = await readFile(path.join(root, SOURCES.styles), 'utf8');
  const mark = await readFile(path.join(root, SOURCES.mark), 'utf8');
  const appUrl = parseAppUrl(await readIfPresent(root, SOURCES.appUrl).then((text) => text ?? ''));
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

  const outputs = new Map();
  outputs.set(OUTPUTS.page, renderSite({ template, styles, mark, version, appUrl }));
  // Le favicon est l'icône de l'application, copiée telle quelle : ce qui
  // apparaît dans l'onglet est exactement ce qui apparaît dans la barre des tâches.
  outputs.set(OUTPUTS.favicon, mark);
  // `.nojekyll` : sans lui, GitHub Pages fait passer les fichiers par Jekyll,
  // qui peut réécrire le contenu (et refuse certains dossiers commençant par `_`).
  outputs.set(OUTPUTS.noJekyll, '');
  return outputs;
}

export async function main(argv = process.argv.slice(2), root = process.cwd()) {
  const check = argv.includes('--check');
  const outputs = await buildOutputs(root);
  const drifted = [];

  for (const [relative, content] of outputs) {
    const current = await readIfPresent(root, relative);
    if (current === content) continue;
    if (check) {
      drifted.push(relative);
      continue;
    }
    await writeFile(path.join(root, relative), content, 'utf8');
    console.log(`écrit : ${relative} (${Buffer.byteLength(content, 'utf8')} octets)`);
  }

  if (check && drifted.length > 0) {
    console.error(`page publiée désynchronisée : ${drifted.join(', ')} — lancez « npm run site:build ».`);
    return 1;
  }
  if (check) console.log('page publiée synchronisée avec ses sources.');
  if (!check) {
    const appUrl = parseAppUrl((await readIfPresent(root, SOURCES.appUrl)) ?? '');
    console.log(
      appUrl === ''
        ? 'adresse de l’application web : absente — la page affiche « bientôt » (site/app-url.txt).'
        : `adresse de l’application web : ${appUrl}`,
    );
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
      console.error(`page publiée non générée : ${error.message}`);
      process.exitCode = 1;
    });
}
