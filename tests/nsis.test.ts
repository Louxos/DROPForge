/**
 * Analyse des hooks NSIS de l'installateur.
 *
 * Le défaut d'origine, trouvé par la tâche Windows de la chaîne d'intégration : le
 * contrôle cherchait la chaîne `!macro X\n`. Git extrait les fichiers texte en CRLF sous
 * Windows par défaut, la chaîne n'existait donc jamais, et la tâche annonçait une macro
 * « non définie » alors qu'elle l'était — un échec incompréhensible, sur un fichier
 * correct.
 *
 * Ces tests fixent les deux moitiés de la question : les fins de ligne ne doivent plus
 * rien changer, et les vraies erreurs doivent toujours être signalées.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyseHooks, definedMacros, insertedMacros, normalizeNewlines, TAURI_HOOKS } from '../scripts/lib/nsis.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const realHooks = readFileSync(join(root, 'apps/desktop/src-tauri/installer/hooks.nsh'), 'utf8');

/** Le fichier réel, tel qu'un Windows l'extrait par défaut avec `core.autocrlf=true`. */
const asWindowsCheckout = (source: string): string => source.replace(/\n/g, '\r\n');

/** Le code réellement exécuté par NSIS : les commentaires (lignes `;`) sont retirés. */
const codeOnly = (source: string): string =>
  source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith(';'))
    .join('\n');

describe('fin de ligne', () => {
  it('normalise CRLF et CR isolé sans toucher aux LF', () => {
    expect(normalizeNewlines('a\r\nb\r\n')).toBe('a\nb\n');
    expect(normalizeNewlines('a\rb')).toBe('a\nb');
    expect(normalizeNewlines('a\nb')).toBe('a\nb');
  });

  it('trouve les mêmes macros dans un extrait Windows que dans un extrait Linux', () => {
    expect([...definedMacros(asWindowsCheckout(realHooks))]).toEqual([...definedMacros(realHooks)]);
    expect([...insertedMacros(asWindowsCheckout(realHooks))]).toEqual([...insertedMacros(realHooks)]);
  });

  it('le seul défaut réel du fichier — un extrait Windows — ne produit plus aucun problème', () => {
    // C'est exactement ce que la tâche Windows signalait à tort.
    expect(analyseHooks(asWindowsCheckout(realHooks))).toEqual([]);
  });
});

describe('hooks livrés', () => {
  it('le fichier réel est accepté, avec ses quatre hooks et ses deux macros', () => {
    expect(analyseHooks(realHooks)).toEqual([]);
    // Les macros sont définies avant les hooks qui les insèrent.
    expect([...definedMacros(realHooks)]).toEqual([
      'DROPFORGE_STOP_RUNNING_APP',
      'DROPFORGE_RELEASE_MAIN_BINARY',
      ...TAURI_HOOKS,
    ]);
    expect([...insertedMacros(realHooks)]).toEqual([
      'DROPFORGE_STOP_RUNNING_APP',
      'DROPFORGE_RELEASE_MAIN_BINARY',
    ]);
  });

  it('les deux hooks qui en ont besoin libèrent l’exécutable principal', () => {
    // Installer par-dessus une application qui tourne laisse des fichiers verrouillés ;
    // désinstaller pendant qu'elle tourne, aussi. Les deux chemins doivent la fermer,
    // et écarter le fichier que le contrôle du modèle interroge.
    const preinstall = realHooks.slice(realHooks.indexOf('!macro NSIS_HOOK_PREINSTALL'), realHooks.indexOf('!macro NSIS_HOOK_POSTINSTALL'));
    const preuninstall = realHooks.slice(realHooks.indexOf('!macro NSIS_HOOK_PREUNINSTALL'), realHooks.indexOf('!macro NSIS_HOOK_POSTUNINSTALL'));
    for (const block of [preinstall, preuninstall]) {
      expect(block).toContain('!insertmacro DROPFORGE_RELEASE_MAIN_BINARY');
    }
  });

  it('écarte l’exécutable du chemin exact que le modèle interroge', () => {
    // Défaut réel, signalé deux fois : « l'application est en cours d'exécution » alors
    // qu'elle ne tourne pas. Le contrôle du modèle (`CheckIfAppIsRunning`) interroge le
    // Windows Restart Manager sur `$INSTDIR\DropForge.exe` — un fichier renommé n'a
    // plus d'utilisateurs, donc le contrôle passe. Les deux noms possibles du binaire
    // (le nom du produit et le nom du binaire Rust) doivent être traités.
    const code = codeOnly(realHooks);
    expect(code).toContain('Rename "$INSTDIR\\DropForge.exe"');
    expect(code).toContain('Rename "$INSTDIR\\dropforge.exe"');
    // Le nom écarté est le nôtre, et il n'est jamais confondu avec un fichier reçu.
    expect(code.match(/\.df-ecarte/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    // L'échec du renommage est expliqué dans le journal, jamais avalé.
    expect(code).toContain('DetailPrint');
    // Et le fichier écarté est retiré : rien ne traîne dans le dossier d'installation.
    expect(code).toMatch(/Delete "\$INSTDIR\\(DropForge|dropforge)\.exe\.df-ecarte"/g);
  });

  it('ne supprime jamais de données locales : la case du modèle officiel s’en charge', () => {
    // Une seconde question posée par nos hooks supprimerait des données que la personne
    // a explicitement choisi de garder (voir l'en-tête du fichier). Les commentaires
    // parlent évidemment de cette case : seul le code exécuté est examiné.
    const code = codeOnly(realHooks);
    // Aucun dossier de données, aucune suppression récursive : les deux gestes qui
    // détruiraient des données locales sont interdits ici.
    expect(code).not.toMatch(/RmDir|RMDir|SetShellVarContext/i);
    expect(code).not.toMatch(/APPDATA|LOCALAPPDATA|org\.dropforge\.app|DropForge\\data/i);
    // Les seules suppressions autorisées sont les fichiers écartés, créés par ce fichier.
    const deletions = [...code.matchAll(/Delete\s+"([^"]*)"/gi)].map((match) => match[1]);
    expect(deletions.length).toBeGreaterThan(0);
    for (const target of deletions) {
      expect(target).toMatch(/^\$INSTDIR\\(DropForge|dropforge)\.exe\.df-ecarte$/);
    }
  });
});

describe('erreurs signalées', () => {
  it('une macro insérée mais jamais définie arrête NSIS : elle est refusée', () => {
    const source = '!macro NSIS_HOOK_PREINSTALL\n  !insertmacro DROPFORGE_ABSENTE\n!macroend\n';
    expect(analyseHooks(source)).toContain('installer/hooks.nsh insère « DROPFORGE_ABSENTE », qui n’est pas défini.');
  });

  it('un hook que Tauri n’appelle pas est du code mort : il est refusé', () => {
    const source = '!macro NSIS_HOOK_PREINSTALL\n!macroend\n!macro NSIS_HOOK_BEFORE_QUIT\n!macroend\n';
    expect(analyseHooks(source)).toContain('installer/hooks.nsh définit « NSIS_HOOK_BEFORE_QUIT », que Tauri n’appelle pas.');
  });

  it('une macro locale définie mais jamais insérée est refusée', () => {
    const source = '!macro NSIS_HOOK_PREINSTALL\n!macroend\n!macro DROPFORGE_INUTILE\n!macroend\n';
    expect(analyseHooks(source)).toContain('installer/hooks.nsh définit « DROPFORGE_INUTILE » mais ne l’insère jamais (code mort).');
  });

  it('un hook absent n’est pas une erreur : Tauri l’entoure de « !ifmacrodef »', () => {
    expect(analyseHooks('!macro NSIS_HOOK_PREINSTALL\n!macroend\n')).toEqual([]);
  });

  it('une macro d’un autre projet, insérée et définie ailleurs, n’est pas signalée', () => {
    // Tauri fournit ses propres macros : seules celles préfixées DROPFORGE_ nous
    // appartiennent, et seules celles-là sont vérifiables ici.
    const source = '!macro NSIS_HOOK_PREINSTALL\n  !insertmacro MUI_PAGE_WELCOME\n!macroend\n';
    expect(analyseHooks(source)).toEqual([]);
  });
});
