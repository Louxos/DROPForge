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

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

  it('l’extraction des notes de version fonctionne vraiment', () => {
    // Ce test existe à cause d'un vrai échec : la version 0.1.2 a été **entièrement
    // construite** (installateurs Windows, application web, serveur) puis la publication
    // a échoué sur un motif `awk` mal échappé — `awk: runaway regular expression`. Une
    // barre oblique de trop dans un motif littéral, et la version n'a jamais été publiée
    // alors que tous ses fichiers étaient prêts.
    //
    // La leçon vaut d'être **exécutée**, pas seulement relue : le test reprend le vrai
    // programme `awk` du workflow et le passe au vrai `awk`, sur le vrai `CHANGELOG.md`.
    // Un échappement cassé échoue ici, en quelques millisecondes, au lieu d'échouer après
    // dix minutes de compilation.
    //
    // Le programme est lancé **directement**, sans passer par un shell : c'est le motif
    // qui a cassé la publication, et un test qui échoue à cause d'un chemin Windows ou
    // d'une barre oblique inversée mangée par le shell ne prouverait rien sur ce motif.
    // (Cette version du test est née là : la première passait par `bash -c` et un chemin
    // temporaire, et rendait zéro octet sur Windows, où la publication n'a jamais lieu.)
    const workflow = read('.github/workflows/release.yml');
    const lines = workflow.split('\n');
    const start = lines.findIndex((line) => line.includes('awk -v v='));
    expect(start).toBeGreaterThan(0);
    const indentation = lines[start]!.match(/^\s*/)?.[0] ?? '';
    const scriptLines: string[] = [];
    for (const line of lines.slice(start)) {
      // Le script awk s'arrête à la ligne qui le branche sur le CHANGELOG : le reste de
      // l'étape parle à GitHub, et n'a rien à faire ici.
      if (scriptLines.length > 0 && line.includes('CHANGELOG.md')) {
        scriptLines.push(line.slice(indentation.length));
        break;
      }
      scriptLines.push(line.slice(indentation.length));
    }
    const awkStep = scriptLines.join('\n').replace(/\r/g, '');
    expect(awkStep).toContain('CHANGELOG.md');

    // Les deux formes, écrites exactement comme elles doivent l'être : deux barres
    // obliques dans la chaîne (awk en retire une), une seule dans le motif littéral.
    const chain = awkStep.split('\n').find((line) => line.includes('$0 ~ ')) ?? '';
    const literal = awkStep.split('\n').find((line) => line.trim().startsWith('found && /')) ?? '';
    expect(chain).toContain('"^## \\\\[" v "\\\\]"');
    expect(literal.trim()).toBe('found && /^## \\[/ { exit }');
    // Et la forme fautive, celle qui a bloqué la publication, n'est nulle part.
    expect(awkStep).not.toContain('found && /^## \\\\[');

    // Le programme seul, tel qu'il est écrit entre apostrophes dans l'étape.
    const program = awkStep.match(/awk -v v="\$VERSION" '([\s\S]*?)'\s+CHANGELOG\.md/)?.[1];
    expect(program, awkStep).toBeDefined();

    // `awk` n'existe pas partout (un poste Windows sans outils Unix) : le test ne doit
    // pas échouer pour un outil manquant. Là où il est, l'extraction doit être prouvée.
    // `awk --version` ne dit rien : mawk (Ubuntu) refuse l'option et sort en erreur.
    const probe = spawnSync('awk', ['BEGIN { exit 0 }'], { encoding: 'utf8' });
    if (probe.error || probe.status !== 0) return;

    const version = (JSON.parse(read('package.json')) as { version: string }).version;
    // Le journal par l'entrée standard, la version par `-v` : aucune source de panne en
    // dehors du programme lui-même.
    const result = spawnSync('awk', ['-v', `v=${version}`, program!], {
      input: read('CHANGELOG.md'),
      encoding: 'utf8',
    });
    const diagnosis = `awk: ${String(result.stderr)}\nProgramme : ${String(program)}`;
    expect(result.stderr, diagnosis).not.toContain('runaway');
    expect(result.stderr, diagnosis).not.toContain('unterminated');
    expect(result.status, diagnosis).toBe(0);

    const notes = String(result.stdout);
    // La section extraite est bien celle de la version : elle porte son contenu et
    // s'arrête avant le titre suivant.
    expect(notes.length, diagnosis).toBeGreaterThan(100);
    expect(notes).not.toContain(`## [${version}]`);
    expect(notes).not.toContain('## [Non publiée]');
    expect(notes).toContain('### Corrigé');
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
    // On vérifie les **titres**, pas les numéros : une section insérée au milieu
    // décale la numérotation, et ce n'est pas une perte de contenu.
    const technique = read('docs/TECHNIQUE.md');
    for (const title of [
      'Sécurité',
      'Tests',
      'État réel du projet',
      'Infrastructure 100 % gratuite',
      'Annexes générées',
    ]) {
      expect(technique).toMatch(new RegExp(`^## \\d+\\. ${title}$`, 'm'));
    }
    expect(technique).toContain('<!-- DEPENDANCES:START -->');
    expect(technique).toContain('<!-- LICENCES:START -->');
    for (const title of ['Dépannage', 'Réparer une installation Windows coincée', 'Déployer soi-même']) {
      expect(guide).toMatch(new RegExp(`^## \\d+\\. ${title}$`, 'm'));
    }
  });
});
