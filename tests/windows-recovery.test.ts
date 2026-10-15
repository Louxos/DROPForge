/**
 * Le déblocage d'une installation Windows coincée.
 *
 * Défaut réel signalé deux fois : « l'application est en cours d'exécution » alors
 * qu'elle ne tourne pas — désinstallation refusée, réinstallation impossible. La cause
 * est dans `docs/GUIDE.md` (le contrôle du modèle NSIS interroge le Windows
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
const guide = read('docs/GUIDE.md');
const technique = read('docs/TECHNIQUE.md');

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
  it('le guide dit la cause, la correction, et la récupération pas à pas', () => {
    expect(guide).toContain("L'application est en cours d'exécution");
    expect(guide).toContain('Windows Restart Manager');
    // La correction est décrite, et son statut est dit sans embellissement : corrigé en
    // 0.1.2, pas encore essayé sur un poste réel.
    expect(guide).toContain('Corrigé en 0.1.2');
    expect(guide).toContain('df-ecarte');
    expect(guide).toContain('unblock-windows.ps1');
    // L'écran de démarrage bloqué a sa ligne dans le tableau de dépannage.
    expect(guide).toContain('DropForge — démarrage');
    // La technique explique le contrôle du modèle et le contrôle de secours de la page.
    expect(technique).toContain('Restart Manager');
    expect(technique).toContain('report_problem');
  });

  it('le guide donne les commandes équivalentes, lisibles avant d’être collées', () => {
    expect(guide).toContain('unblock-windows.ps1');
    expect(guide).toContain('Uninstall\\DropForge');
    expect(guide).toContain('taskkill /F /IM DropForge.exe');
    expect(guide).toContain('%LOCALAPPDATA%\\DropForge');
    expect(guide).toMatch(/jamais\*{0,2} aux\*{0,2}\s*fichiers|ne touche \*\*jamais\*\*/i);
  });

  it('le journal des versions porte la section de la version courante', () => {
    // `release.yml` extrait la section « ## [x.y.z] » de CHANGELOG.md pour écrire les
    // notes de la Release : sans elle, la page de téléchargement retombe sur une phrase
    // générique et personne ne s'en aperçoit.
    const changelog = read('CHANGELOG.md');
    const { version } = JSON.parse(read('package.json')) as { version: string };
    expect(changelog).toContain(`## [${version}]`);
    expect(changelog).toMatch(/\[Keep a Changelog\]/);
    // Le workflow ne cherche plus de fichier par version : une seule source.
    const workflow = read('.github/workflows/release.yml');
    expect(workflow).toContain('CHANGELOG.md');
    expect(workflow).not.toContain('docs/releases');
  });

  it('la documentation tient en quatre fichiers, et rien n’est perdu', () => {
    // Demande explicite : pas de documentation qui part dans tous les sens. Les quatre
    // documents sont le README, ce guide, la documentation technique et le journal des
    // versions ; tout le reste vit dedans.
    const { readdirSync, existsSync } = require('node:fs');
    const docs = readdirSync(join(root, 'docs')).sort();
    expect(docs).toEqual(['GUIDE.md', 'TECHNIQUE.md']);
    expect(existsSync(join(root, 'CHANGELOG.md'))).toBe(true);
    // Ce qui a remplacé les anciens documents est bien là :
    const technique = read('docs/TECHNIQUE.md');
    expect(technique).toContain('## 5. Sécurité');
    expect(technique).toContain('## 9. Tests');
    expect(technique).toContain('## 10. État réel du projet');
    expect(technique).toContain('## 11. Infrastructure 100 % gratuite');
    expect(technique).toContain('<!-- DEPENDANCES:START -->');
    expect(technique).toContain('<!-- LICENCES:START -->');
    expect(guide).toContain('## 7. Réparer une installation Windows coincée');
    expect(guide).toContain('## 10. Déployer soi-même');
  });
});
