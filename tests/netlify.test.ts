/**
 * Garde-fous de la publication sur Netlify.
 *
 * Deux classes d'erreur, toutes les deux invisibles à la compilation et coûteuses à
 * découvrir en production :
 *
 *  1. **Un service worker mis en cache.** S'il est servi depuis le cache du navigateur,
 *     une nouvelle version de l'application n'arrive **jamais** : l'utilisateur garde
 *     l'ancienne indéfiniment, et rien ne l'indique. Le fichier `netlify.toml` doit donc
 *     continuer d'imposer `must-revalidate` sur `/sw.js` et `/registerSW.js` ;
 *  2. **Une configuration qui ne correspond plus au dépôt.** Le dossier publié, la
 *     commande de compilation, la version de Node, le chemin de base : si l'un d'eux
 *     change dans `vite.config.ts` ou `package.json`, la publication Netlify doit changer
 *     avec lui — sinon le site publié n'est plus celui du dépôt.
 *
 * Ce que ces tests ne prouvent pas : que Netlify accepte le fichier (seule une
 * publication le dit), ni que le site publié fonctionne. Ils lisent ce qui est écrit.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

const netlify = read('netlify.toml');
const viteConfig = read('apps/web/vite.config.ts');
const rootManifest = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };

/**
 * One `[[headers]]` block as Netlify reads it: the pattern, and the headers under it.
 *
 * A real TOML parser would be better, but no TOML dependency is installed on purpose
 * (the repository adds nothing it does not ship). The file's own shape is simple and
 * stable — a section header, then `key = "value"` lines — and the assertions below
 * refuse anything that stops matching it.
 */
function headerBlocks(): Array<{ pattern: string; headers: Record<string, string> }> {
  const blocks = netlify.split('[[headers]]').slice(1);
  return blocks.map((block) => {
    const forMatch = /for\s*=\s*"([^"]+)"/.exec(block);
    expect(forMatch, 'chaque [[headers]] doit déclarer « for = "…" »').not.toBeNull();
    const values = block.split('[headers.values]')[1] ?? '';
    const headers: Record<string, string> = {};
    for (const line of values.split('\n')) {
      const match = /^\s*([A-Za-z-]+)\s*=\s*"([^"]*)"\s*$/.exec(line);
      if (match?.[1] && match[2] !== undefined) headers[match[1].toLowerCase()] = match[2];
    }
    return { pattern: forMatch![1] as string, headers };
  });
}

const headersFor = (pattern: string): Record<string, string> => {
  const block = headerBlocks().find((candidate) => candidate.pattern === pattern);
  expect(block, `aucun bloc [[headers]] pour « ${pattern} »`).toBeDefined();
  return block!.headers;
};

describe('netlify.toml', () => {
  it('construit et publie le dossier que Vite produit réellement', () => {
    const publish = /\[\s*\[?build\]?\]\s*[\s\S]*?publish\s*=\s*"([^"]+)"/.exec(netlify);
    expect(publish?.[1]).toBe('apps/web/dist');
    // Le dossier annoncé est celui de `outDir` : les deux ne peuvent pas diverger.
    expect(viteConfig).toContain("outDir: 'dist'");
    // La commande existe vraiment, et c'est celle de l'application web (pas du bureau).
    const command = /command\s*=\s*"([^"]+)"/.exec(netlify)?.[1] ?? '';
    const script = command.replace('npm run ', '').trim();
    expect(rootManifest.scripts).toHaveProperty(script);
    expect(script).toBe('build:web');
  });

  it('épingle Node et le chemin de base', () => {
    expect(netlify).toContain('NODE_VERSION = "22"');
    // `/` et non `/DROPForge/` : ce chemin-là est celui de GitHub Pages, et une variable
    // héritée enverrait tous les fichiers de l'application dans le vide.
    expect(netlify).toContain('DROPFORGE_BASE = "/"');
    // Le `base` de Vite vient bien de cette variable, donc l'épingler suffit.
    expect(viteConfig).toContain("process.env['DROPFORGE_BASE']");
  });

  it('interdit au service worker d’être servi depuis un cache', () => {
    for (const pattern of ['/sw.js', '/registerSW.js', '/index.html']) {
      const headers = headersFor(pattern);
      expect(headers['cache-control'], `${pattern} doit être revalidé`).toContain('must-revalidate');
      expect(headers['cache-control']).toContain('max-age=0');
    }
    // Le manifeste décrit l'application installée (nom, icônes) : même règle.
    expect(headersFor('/manifest.webmanifest')['cache-control']).toContain('must-revalidate');
  });

  it('met en cache long les fichiers empreintés, et eux seuls', () => {
    for (const pattern of ['/assets/*', '/workbox-*.js']) {
      expect(headersFor(pattern)['cache-control'], pattern).toContain('immutable');
    }
    // Les icônes ne sont pas empreintées : un cache long y cacherait un changement de
    // logo pendant un an.
    const icons = headersFor('/icons/*')['cache-control'] ?? '';
    expect(icons).not.toContain('immutable');
    expect(icons).toContain('max-age=86400');
  });

  it('pose les en-têtes de sécurité de base, et ne pose pas de CSP', () => {
    const root = headersFor('/*');
    expect(root['x-content-type-options']).toBe('nosniff');
    expect(root['referrer-policy']).toBe('no-referrer');
    expect(root['x-frame-options']).toBeDefined();
    // Une CSP écrite ici casserait l'application en silence (service worker, WebSocket,
    // téléchargements `blob:`) : elle dépend de l'adresse du relais, choisie après coup.
    // `docs/GUIDE.md` (§ 9) donne celle à utiliser, à vérifier sur un aperçu.
    expect(netlify).not.toContain('Content-Security-Policy');
    expect(netlify).toContain('docs/GUIDE.md');
  });

  it('renvoie toute adresse vers l’application, sans écraser les vrais fichiers', () => {
    const redirect = /\[\[redirects\]\][\s\S]*?from\s*=\s*"([^"]+)"[\s\S]*?to\s*=\s*"([^"]+)"[\s\S]*?status\s*=\s*(\d+)/.exec(
      netlify,
    );
    expect(redirect?.[1]).toBe('/*');
    expect(redirect?.[2]).toBe('/index.html');
    // 200 : une réécriture. Un 301 ferait de chaque adresse saisie une redirection
    // permanente, que les navigateurs mémorisent.
    expect(redirect?.[3]).toBe('200');
  });
});

describe('version de l’application', () => {
  it('est remplacée à la compilation, dans une application publiée par un hébergeur', () => {
    const main = read('apps/web/src/main.tsx');
    // `define` ne remplace que la notation avec des points. Écrite en notation crochets,
    // la version n'était jamais substituée : l'application publiée annonçait
    // `0.0.0-dev` — une version qui ne veut rien dire — au lieu de la sienne.
    expect(main).toContain('import.meta.env.VITE_APP_VERSION ??');
    expect(main).not.toContain("import.meta.env['VITE_APP_VERSION']");
    // Et le remplacement vit dans `define` : dans `build.define`, il était ignoré.
    expect(viteConfig).toMatch(/^\s{2}define: \{/m);
    expect(viteConfig).not.toMatch(/^\s{4}define: \{/m);
    expect(viteConfig).toContain("'import.meta.env.VITE_APP_VERSION'");
    // La valeur de repli vient du manifeste du dépôt, et non d'une chaîne recopiée.
    expect(viteConfig).not.toMatch(/appVersion\(\) \?\?\s*'/);
    const packageJson = JSON.parse(read('package.json')) as { version: string };
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
