#!/usr/bin/env node
/**
 * Publishes the built site (`_site/`) **into the repository root**, where GitHub Pages
 * serves it from the branch:
 *
 *   index.html      la page d'archive
 *   404.html        la page servie pour toute adresse inconnue
 *   favicon.svg     l'icône de l'application
 *   app/            l'application web installable
 *   .nojekyll       « ne traitez pas ceci avec Jekyll, servez les fichiers tels quels »
 *
 * Pourquoi une copie versionnée, alors que le site était jusqu'ici reconstruit à chaque
 * envoi : **le dépôt est archivé**. Un dépôt archivé n'exécute plus ses workflows ; un
 * site qui n'existerait que comme artefact de workflow ne pourrait donc plus être
 * reconstruit, et dépendrait d'un déploiement qui ne se refera jamais. Publié depuis la
 * branche, il n'a besoin de rien : les fichiers sont là, GitHub les sert.
 *
 * La copie n'est jamais crue sur parole : `scripts/check-pages.mjs` reconstruit `_site/`
 * et compare **octet par octet** chaque fichier publié avec celui du dépôt. Une dérive
 * échoue la chaîne au lieu de partir en ligne.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(root, '_site');

/** Ce que la branche sert, et rien d'autre. Les mêmes chemins que dans `_site/`. */
export const PUBLISHED = ['index.html', '404.html', 'favicon.svg', 'app'];

/** Fichier lu par GitHub Pages : sa présence suffit à désactiver Jekyll. */
export const NOJEKYLL = '.nojekyll';

export function publishSite({ from = OUT, to = root } = {}) {
  if (!existsSync(join(from, 'index.html'))) {
    throw new Error(`site absent : ${from}/index.html — lancez « npm run build:pages » d'abord.`);
  }

  for (const entry of PUBLISHED) {
    const source = join(from, entry);
    if (!existsSync(source)) throw new Error(`fichier manquant dans _site/ : ${entry}`);
    const destination = join(to, entry);
    // Un dossier remplacé en entier : aucune ancienne ressource hachée ne survit à une
    // nouvelle construction, donc rien ne peut être servi « par accident ».
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(to, { recursive: true });
    cpSync(source, destination, { recursive: true });
  }

  writeFileSync(join(to, NOJEKYLL), '');
  return PUBLISHED.map((entry) => join(to, entry));
}

const launchedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (launchedDirectly) {
  const written = publishSite();
  for (const file of written) console.log(`[publish] ${file.replace(root, '')}`);
  console.log(`[publish] ${NOJEKYLL}`);
  console.log('[publish] le site publié est maintenant dans le dépôt (racine de la branche).');
}
