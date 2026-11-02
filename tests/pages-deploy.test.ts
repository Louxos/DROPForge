/**
 * The publication itself: what GitHub Actions builds, and what it deploys.
 *
 * A workflow is code that nothing compiles: a renamed script, a folder that no longer
 * exists or a base path that stopped matching the repository all keep `npm test` green
 * while the published site is broken or, worse, never updated. These tests read what is
 * written and refuse the shapes that have actually failed here before:
 *
 *  - a deployment that builds something other than the site this repository produces;
 *  - a base path that is not the repository's (every asset would land on a 404);
 *  - a publication announced as successful without ever reading the deployed site;
 *  - a leftover Netlify configuration — the project is hosted on GitHub Pages, and
 *    nowhere else.
 *
 * They also check the **built** site when `_site/` exists (`npm run verify` builds it
 * first): prefix in the HTML, no source map, and no file from the former hosts.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const exists = (path: string): boolean => existsSync(join(root, path));

const workflow = read('.github/workflows/pages.yml');
const viteConfig = read('apps/web/vite.config.ts');
const rootManifest = JSON.parse(read('package.json')) as { scripts?: Record<string, string>; version: string };

describe('chaîne de publication GitHub Pages', () => {
  it('publie à chaque envoi sur la branche principale', () => {
    expect(workflow).toMatch(/on:\s*\n\s*push:\s*\n\s*branches:\s*\[main\]/);
    // Une publication peut aussi être relancée à la main : c'est ce qui permet de
    // republier après avoir activé Pages, sans pousser un commit vide.
    expect(workflow).toContain('workflow_dispatch');
  });

  it('a les permissions exactes de Pages, et rien de plus', () => {
    expect(workflow).toContain('pages: write');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('contents: read');
  });

  it('construit le site complet, puis le vérifie, puis le publie', () => {
    expect(workflow).toContain('npm run verify');
    expect(workflow).toContain('npm run build:pages');
    expect(workflow).toContain('node scripts/check-pages.mjs');
    expect(workflow).toContain('path: _site');
    expect(workflow).toContain('actions/upload-pages-artifact');
    expect(workflow).toContain('actions/deploy-pages');
  });

  it('calcule le chemin du dépôt, y compris à la racine du domaine', () => {
    // `/<dépôt>/` pour un site de projet, `/` pour un dépôt `<compte>.github.io`.
    expect(workflow).toContain('github.event.repository.name');
    expect(workflow).toContain('*.github.io');
    expect(workflow).toContain('DROPFORGE_PAGES_BASE');
  });

  it('dit quoi cliquer quand Pages n’est pas réglé sur GitHub Actions', () => {
    // La seule panne que la chaîne ne peut pas réparer elle-même. Un échec silencieux,
    // ou une erreur de l'action de publication en fin de course, laisserait le site
    // figé sans que personne ne sache quel réglage changer.
    expect(workflow).toContain("build_type=$(gh api");
    expect(workflow).toContain("!= 'workflow'");
    expect(workflow).toContain('Settings → Pages');
    expect(workflow).toContain('Run workflow');
  });

  it('vérifie le site **après** la publication, depuis son adresse publique', () => {
    const smoke = workflow.slice(workflow.indexOf('Vérification du site publié'));
    expect(smoke).toContain('needs: deploy');
    expect(smoke).toContain('--url');
    expect(smoke).toContain('page_url');
  });

  it('publie un seul artefact, et seulement ce qui est construit ici', () => {
    const uploads = [...workflow.matchAll(/upload-pages-artifact[\s\S]{0,200}?path:\s*(\S+)/g)].map((match) => match[1]);
    expect(uploads).toEqual(['_site']);
  });
});

describe('Netlify et Tauri ont quitté le dépôt', () => {
  it('n’existe plus aucun fichier de configuration Netlify', () => {
    expect(exists('netlify.toml')).toBe(false);
    expect(exists('netlify')).toBe(false);
  });

  it('aucune documentation, aucun script et aucun workflow ne renvoie à Netlify', () => {
    // `CHANGELOG.md` est l'historique : il a le droit de dire ce qui a été retiré.
    const files = [
      'README.md',
      'package.json',
      'apps/web/vite.config.ts',
      'apps/web/src/platform/signaling.ts',
      'docs/GUIDE.md',
      'docs/TECHNIQUE.md',
      'site/index.html',
      '.github/workflows/ci.yml',
      '.github/workflows/pages.yml',
      '.github/workflows/release.yml',
    ];
    const mentions = files.filter((file) => /netlify/i.test(read(file)));
    expect(mentions).toEqual([]);
  });

  it('ne laisse aucun reste de l’application Windows', () => {
    expect(exists('apps/desktop')).toBe(false);
    expect(read('README.md')).not.toContain('Tauri');
    expect(read('docs/GUIDE.md')).not.toMatch(/installateur Windows à télécharger|\.msi/i);
  });
});

describe('compilation de l’application pour son adresse publiée', () => {
  it('produit le dossier que la chaîne publie', () => {
    // Le dossier annoncé est celui de `outDir` : les deux ne peuvent pas diverger.
    expect(viteConfig).toContain("outDir: 'dist'");
    expect(rootManifest.scripts).toHaveProperty('build:web');
    expect(rootManifest.scripts?.['build:pages']).toContain('scripts/build-pages.mjs');
  });

  it('prend son chemin de base dans l’environnement', () => {
    expect(viteConfig).toContain("process.env['DROPFORGE_BASE']");
    // Un préfixe écrit à la main serait faux dès qu'un dépôt est renommé ou forké.
    expect(read('scripts/build-pages.mjs')).toContain('DROPFORGE_PAGES_BASE');
  });

  it('ne publie pas de cartes de sources par défaut', () => {
    // Elles pèsent plusieurs mégaoctets et publient les sources avec le code.
    expect(viteConfig).toMatch(/sourcemap:\s*process\.env\['DROPFORGE_SOURCEMAP'\] === '1'/);
  });

  it('remplace la version à la compilation, dans un `define` de premier niveau', () => {
    const main = read('apps/web/src/main.tsx');
    // `define` ne remplace que la notation avec des points : écrite en notation crochets,
    // la version n'était jamais substituée et « À propos » annonçait `0.0.0-dev`.
    expect(main).toContain('import.meta.env.VITE_APP_VERSION ??');
    expect(main).not.toContain("import.meta.env['VITE_APP_VERSION']");
    expect(viteConfig).toMatch(/^\s{2}define: \{/m);
    expect(viteConfig).not.toMatch(/^\s{4}define: \{/m);
    expect(viteConfig).toContain("'import.meta.env.VITE_APP_VERSION'");
    expect(rootManifest.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('site construit (quand `npm run build:pages` a tourné)', () => {
  const built = exists('_site/index.html');
  const maybe = built ? it : it.skip;

  maybe('contient l’accueil, la page 404 et l’application', () => {
    for (const file of ['_site/index.html', '_site/404.html', '_site/favicon.svg', '_site/app/index.html']) {
      expect(exists(file), `${file} doit exister`).toBe(true);
    }
  });

  maybe('préfixe toutes les références de l’application par le chemin du site', () => {
    const metadata = JSON.parse(read('.pages-build.json')) as { base: string; appBase: string };
    const html = read('_site/app/index.html');
    const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => match[1] as string)
      .filter((value) => !value.startsWith('data:') && !value.startsWith('#'));
    expect(references.length).toBeGreaterThan(2);
    for (const reference of references) {
      expect(reference.startsWith(metadata.appBase), `${reference} doit commencer par ${metadata.appBase}`).toBe(true);
    }
    // Et le manifeste décrit cette même adresse : sinon le navigateur refuse d'installer.
    const manifest = JSON.parse(read('_site/app/manifest.webmanifest')) as { start_url: string; scope: string };
    expect(manifest.start_url).toBe(metadata.appBase);
    expect(manifest.scope).toBe(metadata.appBase);
  });

  maybe('ne contient ni carte de sources, ni fichier d’un ancien hébergeur', () => {
    const walk = (directory: string, prefix = ''): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(join(directory), { withFileTypes: true })) {
        const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isDirectory()) out.push(...walk(join(directory, entry.name), path));
        else out.push(path);
      }
      return out;
    };
    const files = walk(join(root, '_site'));
    expect(files.filter((file) => file.endsWith('.map'))).toEqual([]);
    expect(files.filter((file) => /netlify|tauri/i.test(file))).toEqual([]);
    // Rien de caché ne part en ligne : l'artefact de Pages exclut les fichiers cachés,
    // et un fichier caché oublié ici serait publié ou ignoré sans qu'on sache lequel.
    expect(files.filter((file) => file.split('/').some((part) => part.startsWith('.')))).toEqual([]);
  });

  maybe('reste sous un budget de taille raisonnable', () => {
    const walk = (directory: string): number => {
      let total = 0;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        total += entry.isDirectory() ? walk(path) : statSync(path).size;
      }
      return total;
    };
    // GitHub Pages tolère 1 Go ; ce budget est celui d'un site qui se charge vite.
    expect(walk(join(root, '_site'))).toBeLessThan(4 * 1024 * 1024);
  });
});
