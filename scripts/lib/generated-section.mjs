/**
 * Écrit une section **générée** dans un document Markdown, entre deux repères.
 *
 * Les annexes de `docs/TECHNIQUE.md` (dépendances, licences) sont produites par des
 * scripts : elles décrivent ce qui sera réellement installé, donc elles ne peuvent pas
 * être écrites à la main sans devenir fausses au premier changement de dépendance. Elles
 * vivent dans le même fichier que le reste de la documentation plutôt que dans des
 * documents séparés — un seul endroit à lire, un seul endroit à mettre à jour.
 *
 * Le repère manquant est une erreur, jamais un silence : un document dont les repères ont
 * disparu ne doit pas être écrasé en entier par un générateur.
 */

import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Remplace le contenu situé entre `<!-- NOM:START -->` et `<!-- NOM:END -->`.
 *
 * @param {string} file chemin absolu du document Markdown
 * @param {string} marker nom du repère, en majuscules (ex. « DEPENDANCES »)
 * @param {string} body contenu à insérer (Markdown, sans les repères)
 * @returns {{ changed: boolean, bytes: number }}
 */
export function writeSection(file, marker, body) {
  const start = `<!-- ${marker}:START -->`;
  const end = `<!-- ${marker}:END -->`;
  const current = readFileSync(file, 'utf8');
  const from = current.indexOf(start);
  const to = current.indexOf(end);
  if (from === -1 || to === -1 || to < from) {
    throw new Error(
      `${file} : les repères ${start} / ${end} sont absents ou dans le mauvais ordre. ` +
        "Rétablissez-les (ils sont dans docs/TECHNIQUE.md § 12) avant de régénérer.",
    );
  }
  const content = `${start}\n${body.trimEnd()}\n${end}`;
  const next = current.slice(0, from) + content + current.slice(to + end.length);
  writeFileSync(file, next);
  return { changed: next !== current, bytes: Buffer.byteLength(body, 'utf8') };
}

/** Décale tous les titres d'un document de `levels` niveaux (`#` → `###`). */
export function demoteHeadings(markdown, levels) {
  const hashes = '#'.repeat(levels);
  return markdown.replace(/^#{1,6} /gm, (heading) => hashes + heading);
}
