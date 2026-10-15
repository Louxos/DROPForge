/**
 * Garde-fous du mode « deux appareils sur le même Wi‑Fi ».
 *
 * Ce que ces tests protègent : le mode qui **marche vraiment** aujourd'hui. Une page
 * servie en HTTPS ne peut pas ouvrir une connexion `ws://` vers la machine d'à côté, et
 * un hébergement statique ne garde pas de WebSocket ouverte — donc, en pratique, les
 * deux appareils doivent ouvrir l'application depuis une machine du réseau, celle qui
 * les met en relation. C'est ce que fait `npm run lan`.
 *
 * Les assertions sont volontairement structurelles : elles relisent le script, son
 * entrée dans `package.json`, la configuration de compilation qui rend le proxy `/ws`
 * possible, et la documentation qui dit quoi faire. **Ce qu'elles ne prouvent pas** :
 * que le réseau d'une maison laisse passer (pare-feu, Wi‑Fi « invité »), ni qu'un
 * transfert réel passe — cela reste la suite de navigateurs (`e2e/`) et un essai humain.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

const script = read('scripts/serve-lan.mjs');
const rootManifest = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
const viteConfig = read('apps/web/vite.config.ts');
const guide = read('docs/GUIDE.md');

describe('mode réseau local', () => {
  it('s’installe par une seule commande', () => {
    expect(rootManifest.scripts?.['lan']).toBe('node scripts/serve-lan.mjs');
    // Le service de mise en relation est déjà exposé par un script du dépôt : le
    // mode local ne doit pas en réinventer un.
    expect(rootManifest.scripts?.['start:signaling']).toContain('signaling');
  });

  it('démarre l’application et le service, et affiche l’adresse à ouvrir', () => {
    // Les deux processus, et l'adresse locale du service donnée à l'application.
    expect(script).toContain("run(['run', 'start:signaling']");
    expect(script).toContain("run(['run', 'preview', '-w', '@dropforge/web'");
    expect(script).toContain('DROPFORGE_SIGNALING_ORIGIN');
    // Les adresses des autres appareils, et l'instruction qui va avec.
    expect(script).toContain('networkInterfaces');
    expect(script).toContain('http://${address}:${port}');
    expect(script).toContain('Recevoir');
    // Compilation seulement si elle manque : le mode local ne recompile pas pour rien.
    expect(script).toContain('existsSync');
    expect(script).toContain("spawn(npm, ['run', 'build:web']");
  });

  it('ne laisse pas un demi-service tourner', () => {
    // Si l'un des deux processus s'arrête en erreur, l'autre est arrêté aussi.
    expect(script).toContain("child.on('exit'");
    expect(script).toContain('stop(children');
    expect(script).toContain("process.on('SIGINT'");
  });

  it('le proxy `/ws` existe bien des deux côtés', () => {
    // L'application servie par `vite preview` doit diriger `/ws` vers le service : c'est
    // ce qui permet aux deux appareils de n'ouvrir qu'une seule adresse, sans réglage.
    expect(viteConfig).toContain("'/ws': { target: SIGNALING_ORIGIN, ws: true, changeOrigin: true }");
    expect(viteConfig).toContain('preview:');
    // Et le service écoute sur toutes les interfaces en mode local (`HOST` du script).
    expect(script).toContain("HOST: '0.0.0.0'");
  });

  it('le guide dit quoi faire, et ce que ça ne promet pas', () => {
    expect(guide).toContain('npm run lan');
    expect(guide).toContain('même Wi‑Fi');
    // La raison technique, celle qui explique pourquoi une adresse en ligne ne suffit
    // pas : sans elle, quelqu'un finira par « corriger » le script en croyant à un oubli.
    expect(guide).toMatch(/HTTPS/i);
    expect(guide).toMatch(/WebSocket/i);
  });
});
