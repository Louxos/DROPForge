/**
 * Publie la fin d'un journal d'exécution en **annotation** GitHub.
 *
 *   node scripts/ci-annotate.mjs build.log "Compilation Windows" [lignes]
 *
 * Pourquoi : le journal complet d'un travail n'est pas toujours récupérable depuis
 * l'extérieur de GitHub (il est servi par un stockage d'objets séparé, qui peut être
 * inaccessible depuis un environnement restreint). Une annotation, elle, reste
 * attachée au passage et se lit par l'API comme sur la page du travail. C'est la
 * différence entre « le travail a échoué » et « voici la ligne qui explique pourquoi ».
 *
 * Le contenu est borné et les retours à la ligne sont encodés (`%0A`), comme GitHub
 * l'attend ; les `%` sont échappés d'abord, sinon un message contenant « 100 % » serait
 * decode partiellement.
 */
import { readFileSync, existsSync } from 'node:fs';

const [path, title = 'Échec', requestedLines = '40'] = process.argv.slice(2);

if (!path) {
  console.error('usage : node scripts/ci-annotate.mjs <fichier-journal> [titre] [lignes]');
  process.exit(2);
}

if (!existsSync(path)) {
  console.log(`::error title=${escape(title)}::Aucun journal à lire (${path}).`);
  process.exit(0);
}

const lines = Number.parseInt(requestedLines, 10);
const keep = Number.isFinite(lines) && lines > 0 ? lines : 40;

const content = readFileSync(path, 'utf8')
  .split('\n')
  .slice(-keep)
  .join('\n')
  // Une annotation GitHub a une taille limitée : au-delà, la fin du message est perdue.
  // 8 000 caractères suffisent à contenir la cause, et restent sous la limite.
  .slice(-8000);

console.log(`::error title=${escape(title)}::${escape(content)}`);

/** Échappe ce que GitHub interprète dans une annotation. */
function escape(value) {
  return String(value).replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A');
}
