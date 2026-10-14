/**
 * Lecture d'un fichier de hooks NSIS.
 *
 * Tauri compile `installer/hooks.nsh` par-dessus son modèle officiel : c'est le seul
 * endroit où l'on peut ajouter un geste à l'installation ou à la désinstallation. Ce
 * fichier est petit, mais deux erreurs y sont silencieuses — un hook qui n'existe pas
 * côté Tauri (jamais appelé), une macro insérée mais jamais définie (NSIS s'arrête, et
 * l'installateur ne se construit plus).
 *
 * **Fins de ligne.** Le défaut d'origine de ce module : l'analyse cherchait la chaîne
 * `!macro X\n`. Sous Windows, Git extrait les fichiers texte en CRLF par défaut, la
 * chaîne cherchée n'existait donc jamais, et la tâche Windows de la chaîne d'intégration
 * annonçait une macro « non définie » alors qu'elle l'était. Le nettoyage se fait une
 * seule fois, ici, pour que tout le reste raisonne sur des fins de ligne normales.
 */

/** Les quatre seuls hooks que le modèle NSIS de Tauri appelle réellement. */
export const TAURI_HOOKS = [
  'NSIS_HOOK_PREINSTALL',
  'NSIS_HOOK_POSTINSTALL',
  'NSIS_HOOK_PREUNINSTALL',
  'NSIS_HOOK_POSTUNINSTALL',
];

/** Le préfixe des macros propres à DropForge (invoquées par les hooks, pas par Tauri). */
export const LOCAL_PREFIX = 'DROPFORGE_';

/**
 * Ramène les fins de ligne à `\n`.
 *
 * On gère aussi le CR isolé (`\r` sans `\n`), qui n'arrive pas par Git mais peut arriver
 * par un éditeur mal réglé — cela coûte une ligne et évite une classe entière de
 * surprises.
 */
export const normalizeNewlines = (source) => source.replace(/\r\n?/g, '\n');

/** Les macros définies par le fichier, dans l'ordre d'apparition, sans doublon. */
export function definedMacros(source) {
  const found = normalizeNewlines(source).matchAll(/!macro\s+([A-Za-z_][\w]*)/g);
  return new Set([...found].map((match) => match[1]));
}

/** Les macros que le fichier insère, sans doublon. */
export function insertedMacros(source) {
  const found = normalizeNewlines(source).matchAll(/!insertmacro\s+([A-Za-z_][\w]*)/g);
  return new Set([...found].map((match) => match[1]));
}

/**
 * Analyse le fichier et renvoie la liste des problèmes, en français, tels qu'ils doivent
 * être montrés. Liste vide = fichier correct.
 */
export function analyseHooks(source) {
  const problems = [];
  const defined = definedMacros(source);
  const inserted = insertedMacros(source);

  for (const macro of inserted) {
    if (!defined.has(macro) && macro.startsWith(LOCAL_PREFIX)) {
      problems.push(`installer/hooks.nsh insère « ${macro} », qui n’est pas défini.`);
    }
  }

  for (const macro of defined) {
    if (macro.startsWith('NSIS_HOOK_') && !TAURI_HOOKS.includes(macro)) {
      problems.push(`installer/hooks.nsh définit « ${macro} », que Tauri n’appelle pas.`);
    }
  }

  for (const macro of defined) {
    if (macro.startsWith(LOCAL_PREFIX) && !inserted.has(macro)) {
      problems.push(`installer/hooks.nsh définit « ${macro} » mais ne l’insère jamais (code mort).`);
    }
  }

  // Un hook absent n'est pas une erreur : Tauri l'entoure de `!ifmacrodef`. On ne
  // signale donc que ce qui casse la compilation ou ne sert à rien.

  return problems;
}
