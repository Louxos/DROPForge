/**
 * L'écran de démarrage de l'application Windows.
 *
 * Défaut réel signalé deux fois : « l'écran de démarrage reste sur l'écran de
 * démarrage ». La fenêtre s'affiche (les contrôles de secours côté Rust fonctionnent),
 * mais elle affiche le texte de démarrage pour toujours : le paquet de l'interface n'a
 * pas démarré, et **rien à l'écran ne dit pourquoi**.
 *
 * Ce que ces tests protègent : un contrôle de secours écrit dans la page, exécuté
 * **avant** le paquet de l'interface, qui n'importe rien (il ne peut donc pas échouer
 * pour la même raison), qui écoute les erreurs de chargement et les exceptions, et qui
 * remplace l'écran de démarrage par la cause réelle — au bout de 15 secondes, ou dès
 * qu'une erreur est connue.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(join(root, 'apps/desktop/index.html'), 'utf8');
const rust = readFileSync(join(root, 'apps/desktop/src-tauri/src/lib.rs'), 'utf8');

/** Le premier bloc `<script>` sans attribut : le contrôle de secours. */
function inlineWatchdog(source: string): string {
  const body = /<script>\n([\s\S]*?)<\/script>/.exec(source)?.[1];
  if (body === undefined) throw new Error('aucun script en ligne dans index.html');
  return body;
}

const watchdog = inlineWatchdog(html);

describe('écran de démarrage : le contrôle de secours', () => {
  it('est du JavaScript valide, sans aucune importation', () => {
    // S'il importait quoi que ce soit, il pourrait échouer exactement comme
    // l'interface qu'il surveille — et ne servirait à rien.
    expect(() => new Function(watchdog)).not.toThrow();
    expect(watchdog).not.toMatch(/\bimport\s|\brequire\s*\(/);
    expect(watchdog).not.toMatch(/https?:\/\//);
  });

  it('est exécuté avant le paquet de l’interface', () => {
    // Un contrôle placé après ne verrait jamais l'échec du chargement du module :
    // le navigateur ne l'exécuterait pas non plus.
    const watchdogAt = html.indexOf('data-detail');
    const moduleAt = html.indexOf('<script type="module"');
    expect(watchdogAt).toBeGreaterThan(-1);
    expect(moduleAt).toBeGreaterThan(-1);
    expect(html.indexOf('<script>')).toBeLessThan(moduleAt);
    // Le diagnostic n'existe que dans le contrôle de secours, pas dans le module.
    expect(watchdog).not.toContain('<script');
    expect(html.slice(moduleAt).includes('df-boot__failure')).toBe(false);
  });

  it('écoute les trois façons dont une interface peut ne pas démarrer', () => {
    expect(watchdog).toContain("addEventListener(\n          'error'");
    expect(watchdog).toContain("addEventListener('unhandledrejection'");
    // Un fichier manquant ne produit aucune erreur du reste de la page : il faut
    // écouter l'événement sur la balise du module elle-même.
    expect(watchdog).toContain("querySelectorAll('script[type=\"module\"]')");
    expect(watchdog).toContain("addEventListener('error'");
  });

  it('n’affiche rien quand l’interface a démarré', () => {
    // La détection est le remplacement de `#root` par React : plus de `#df-boot`,
    // donc plus rien à signaler.
    expect(watchdog).toContain("document.getElementById('df-boot')");
    expect(watchdog).toMatch(/if \(!boot\) return;/);
  });

  it('remplace l’écran de démarrage par la cause, jamais par un indicateur éternel', () => {
    expect(watchdog).toContain('df-boot__failure');
    expect(watchdog).toMatch(/setTimeout\(show, 15000\)/);
    // Le journal est nommé à l'écran : c'est ce que la personne doit ouvrir.
    expect(watchdog).toContain('%APPDATA%');
    expect(watchdog).toContain('org.dropforge.app');
    expect(watchdog).toContain('diagnostics.log');
    // Le détail reste lisible même sans presse-papiers.
    expect(watchdog).toContain('data-detail');
    expect(watchdog).toContain("navigator.clipboard");
  });

  it('consigne l’échec dans le journal de diagnostic de l’application', () => {
    // `report_problem` est une commande Rust, pas une invention du navigateur :
    // elle doit exister des deux côtés, sinon l'écriture échouerait en silence.
    const handlers = /generate_handler!\[([\s\S]*?)\]/.exec(rust)?.[1] ?? '';
    expect(handlers).toContain('report_problem');
    expect(watchdog).toContain("invoke('report_problem'");
    const invoked = [...watchdog.matchAll(/invoke\('([^']+)'/g)].map((match) => match[1]);
    expect(invoked).toEqual(['report_problem']);
    expect(watchdog).toContain("scope: 'splash'");
  });

  it('ne peut pas faire tomber la page en signalant une panne', () => {
    // Le contrôle de secours entoure ses appels système : un échec ici doit
    // rester sans conséquence, sinon le diagnostic deviendrait la panne.
    expect(watchdog).toMatch(/catch \(error\) \{/);
    expect(watchdog).toMatch(/MAX = 6/);
    expect(watchdog).toMatch(/failures\.indexOf\(text\) !== -1/);
  });

  it('garde le repère du logo intact, exactement comme avant', () => {
    // L'écran de démarrage est aussi la première image de marque : le bloc du
    // logo est écrit par `scripts/generate-icons.mjs` et ne doit pas être touché.
    expect(html).toMatch(/<!-- DROPFORGE_MARK:START -->[\s\S]*?<!-- DROPFORGE_MARK:END -->/);
    expect(html).toContain('DropForge — démarrage…');
  });
});
