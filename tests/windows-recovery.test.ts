/**
 * Le déblocage d'une installation Windows coincée.
 *
 * Défaut réel signalé deux fois : « l'application est en cours d'exécution » alors
 * qu'elle ne tourne pas — désinstallation refusée, réinstallation impossible. La cause
 * est dans `docs/TROUBLESHOOTING.md` (le contrôle du modèle NSIS interroge le Windows
 * Restart Manager sur le chemin de l'exécutable, pas les processus) ; la correction dans
 * l'installateur est gardée par `tests/nsis.test.ts`.
 *
 * Ce fichier garde la **récupération** : le script de nettoyage et la procédure
 * documentée. Ils sont dangereux par nature — ils touchent au registre et suppriment des
 * dossiers — donc ce qui est vérifié ici, c'est la prudence : rien n'est modifié sans
 * demande explicite, les fichiers de la personne ne sont jamais visés, et les données
 * locales seulement sur option.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (relative: string) => readFileSync(join(root, relative), 'utf8');

const script = read('scripts/unblock-windows.ps1');
const troubleshooting = read('docs/TROUBLESHOOTING.md');
const ownerGuide = read('docs/OWNER-GUIDE.md');

/** Les lignes de code PowerShell, sans les commentaires ni les chaînes d'affichage. */
const codeLines = script
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith(' Write'));

describe('script de déblocage : prudent par défaut', () => {
  it('existe, est en PowerShell, et ne modifie rien sans -Apply', () => {
    expect(existsSync(join(root, 'scripts/unblock-windows.ps1'))).toBe(true);
    expect(script).toContain('[switch]$Apply');
    // Le garde-fou central : sans -Apply, toute demande d'action est refusée.
    expect(script).toMatch(/function Confirm-Action[\s\S]*?if \(-not \$Apply\) \{ return \$false \}/);
    // …et chaque commande destructrice est derrière ce garde-fou.
    const steps = script.split('Write-Step');
    const destructive = /Remove-Item|Remove-ItemProperty|Stop-Process/;
    const guarded = steps.filter((step) => destructive.test(step));
    expect(guarded.length).toBeGreaterThanOrEqual(4); // processus, registre, dossiers, raccourcis
    for (const step of guarded) {
      expect(step).toContain('Confirm-Action');
    }
  });

  it('ne touche jamais aux fichiers reçus de la personne', () => {
    const deletions = [...script.matchAll(/Remove-Item[^\n]*/g)].map((match) => match[0]);
    expect(deletions.length).toBeGreaterThan(0);
    for (const line of deletions) {
      // Les seules cibles autorisées : le programme, ses raccourcis, ses données — ou
      // une variable construite juste au-dessus à partir de ces mêmes cibles.
      expect(line).toMatch(/DropForge|org\.dropforge\.app|\$(key\.PSPath|folder|shortcut|entry\.Name)/i);
    }
    // Les dossiers de la personne ne sont jamais des cibles de suppression.
    expect(deletions.join('\n')).not.toMatch(/Downloads|Téléchargements|Documents/i);
    // Les listes dont ces variables proviennent sont, elles, filtrées sur DropForge.
    expect(script).toContain("like '*DropForge*'");
    expect(script).toContain("Join-Path $env:LOCALAPPDATA 'DropForge'");
    expect(script).toContain("Join-Path $env:APPDATA 'org.dropforge.app'");
  });

  it('ne supprime les données locales que sur demande explicite', () => {
    expect(script).toContain('[switch]$RemoveData');
    const dataSection = script.slice(script.indexOf('Données locales'));
    expect(dataSection).toContain('$RemoveData');
    expect(dataSection).toMatch(/conservées/);
  });

  it('couvre les deux noms possibles du binaire et les deux racines du registre', () => {
    // Le binaire peut s'appeler DropForge (nom du produit) ou dropforge (nom du
    // binaire Rust) : le déblocage doit fermer les deux.
    expect(script).toContain("'DropForge', 'dropforge'");
    // L'entrée de désinstallation est celle que l'installateur consulte pour savoir
    // s'il doit désinstaller une version précédente.
    expect(script).toContain('CurrentVersion\\Uninstall');
    expect(script).toContain('CurrentVersion\\Run');
  });

  it('explique ce qu’il fait, en français, et dit ce qu’il ne fait pas', () => {
    expect(script).toContain('Restart Manager');
    expect(script).toMatch(/ne touche jamais/i);
    expect(script).toMatch(/Mode constat/);
  });
});

describe('procédure documentée : les deux chemins existent', () => {
  it('dépannage : cause, correction, et récupération pas à pas', () => {
    expect(troubleshooting).toContain("L'application est en cours d'exécution");
    expect(troubleshooting).toContain('Windows Restart Manager');
    // La correction dans l'installateur est décrite, sans prétendre qu'elle est publiée.
    expect(troubleshooting).toMatch(/Aucun installateur\s+corrigé n'a encore été publié/);
    expect(troubleshooting).toContain('unblock-windows.ps1');
    expect(troubleshooting).toContain('df-ecarte');
    // L'écran de démarrage a sa propre section, avec la cause réelle à l'écran.
    expect(troubleshooting).toContain("L'écran de démarrage reste affiché");
    expect(troubleshooting).toContain('report_problem');
  });

  it('guide du propriétaire : commandes équivalentes lisibles avant d’être collées', () => {
    expect(ownerGuide).toContain('unblock-windows.ps1');
    expect(ownerGuide).toContain('Uninstall\\DropForge');
    expect(ownerGuide).toContain('taskkill /F /IM DropForge.exe');
    expect(ownerGuide).toMatch(/ne sont jamais touchés/);
  });
});
