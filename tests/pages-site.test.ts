/**
 * La page publique du site GitHub Pages : l'accueil et la page 404.
 *
 * Ces tests protègent trois choses qui, sans surveillance, se cassent en silence :
 *
 *  1. les pages sont **autonomes** — aucune police, aucun script, aucune image
 *     distante : elles s'affichent sans réseau, et une page qui télécharge un fichier
 *     externe ne le ferait pas ;
 *  2. l'application est un **chemin relatif** (`app/`), et rien d'autre : le même site
 *     fonctionne sur `https://louxos.github.io/DROPForge/`, sur une fourche et dans un
 *     dossier local, sans qu'aucune adresse absolue n'ait à être tenue à jour ;
 *  3. la page 404 parle de l'adresse demandée, renvoie à l'application, et ne redirige
 *     que lorsqu'un fragment de l'application est présent.
 *
 * Tout est vérifié sur le contenu **réellement rendu** par le générateur : ce qui passe
 * ici est ce que GitHub Pages sert.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  APP_PATH,
  OUTPUTS,
  REPO_URL,
  SOURCES,
  buildSiteFiles,
  checkAppUrl,
  renderNotFound,
  renderSite,
} from '../scripts/build-site.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (relative: string): string => readFileSync(join(root, relative), 'utf8');
const pkg = JSON.parse(read('package.json')) as { version: string };
const version = pkg.version;

const template = read(SOURCES.template);
const notFound = read(SOURCES.notFound);
const styles = read(SOURCES.styles);
const mark = read(SOURCES.mark);

const home = (): string => renderSite({ template, styles, mark, version }) as string;

const notFoundPage = (base = '/DROPForge/'): string =>
  renderNotFound({ template: notFound, styles, mark, base, appUrl: `${base}app/` }) as string;

describe('page d’accueil publiée', () => {
  it('est autonome : aucune ressource distante à charger', () => {
    const page = home();
    // Pas de feuille de style externe, pas de script externe, pas de police distante.
    expect(page).not.toMatch(/<link[^>]+rel=["']stylesheet/i);
    expect(page).not.toMatch(/<script[^>]+src=/i);
    expect(page).not.toMatch(/@import\s+url/i);
    expect(page).not.toMatch(/(src|srcset)=["']https?:/i);
    expect(page).not.toMatch(/fonts\.googleapis|cdn\./i);
    // Aucune adresse en clair (http://) hors espaces de noms SVG/XML, qui ne déclenchent
    // aucun chargement.
    const withoutNamespaces = page.replace(/xmlns(:[a-z]+)?="http:\/\/[^"]*"/gi, '');
    expect(withoutNamespaces).not.toMatch(/["'=]http:\/\//i);
    // Le CSS est inséré, et pas seulement référencé.
    expect(page).toMatch(/--violet:/);
    expect(page.length).toBeGreaterThan(20_000);
  });

  it('ne publie aucun gabarit non remplacé', () => {
    const page = home();
    expect(page).not.toMatch(/{{[A-Z_]+}}/);
    expect(page).toContain(`Version ${version}`);
    expect(page).toContain(`dropforge-pwa-${version}.zip`);
  });

  it('place l’application avant tout le reste du contenu', () => {
    const page = home();
    const app = page.indexOf('id="application"');
    const features = page.indexOf('id="transfers"');
    const security = page.indexOf('id="security"');
    expect(app).toBeGreaterThan(-1);
    expect(app).toBeLessThan(features);
    expect(app).toBeLessThan(security);
    expect(app).toBeLessThan(page.indexOf('<section'));
  });

  it('pointe vers l’application par un chemin relatif, sans jamais écrire de domaine', () => {
    const page = home();
    expect(page).toContain('href="app/"');
    // Le chemin est aussi la valeur de repli affichée sans JavaScript, et celle que le
    // script résout en adresse absolue à l'ouverture.
    expect(page).toContain(`data-path="${APP_PATH}"`);
    expect(page).not.toMatch(/href="https?:\/\/louxos\.github\.io/);
    // Aucun lien mort : l'adresse n'est jamais vide.
    expect(page).not.toMatch(/href="\s*"/);
  });

  it('rappelle les limites réelles du projet, sans les embellir', () => {
    const page = home();
    expect(page).toMatch(/pas encore été essayée sur un téléphone réel/);
    expect(page).toMatch(/nécessite un hébergement/);
    expect(page).not.toMatch(/setup\.exe/);
    expect(page).not.toContain('.msi');
    expect(page).not.toContain('Tauri');
    expect(page).toMatch(/restent téléchargeables mais ne sont plus\s+maintenus/);
    // La documentation tient en quatre fichiers : la page ne renvoie qu'à ceux-là.
    expect(page).toContain(`${REPO_URL}/blob/main/docs/TECHNIQUE.md`);
    expect(page).toContain(`${REPO_URL}/blob/main/docs/GUIDE.md`);
    expect(page).toContain(`${REPO_URL}/blob/main/CHANGELOG.md`);
    for (const gone of ['SPEC-AUDIT', 'PLATFORM-MATRIX', 'TROUBLESHOOTING', 'THREAT-MODEL', 'ARCHITECTURE.md']) {
      expect(page, `${gone} ne doit plus être référencé`).not.toContain(gone);
    }
  });

  it('ne renvoie plus à Netlify, ni à un hébergement tiers', () => {
    const page = home();
    expect(page.toLowerCase()).not.toContain('netlify');
    expect(page).toMatch(/GitHub Pages/);
  });
});

describe('page 404', () => {
  it('est autonome, comme l’accueil', () => {
    const page = notFoundPage();
    expect(page).not.toMatch(/<link[^>]+rel=["']stylesheet/i);
    expect(page).not.toMatch(/<script[^>]+src=/i);
    expect(page).not.toMatch(/(src|srcset)=["']https?:/i);
    expect(page).toMatch(/--violet:/);
  });

  it('dit ce qui s’est passé, et où aller', () => {
    const page = notFoundPage();
    expect(page).toContain('Erreur 404');
    expect(page).toMatch(/adresse ne mène nulle part/);
    // Les liens sont **absolus et préfixés** : la page est servie à l'adresse fautive
    // (`/DROPForge/une/autre/page`), où un `app/` relatif pointerait dans le vide.
    expect(page).toContain('href="/DROPForge/app/"');
    expect(page).toContain('href="/DROPForge/"');
    expect(page).not.toMatch(/{{[A-Z_]+}}/);
  });

  it('suit le chemin du site, quel qu’il soit', () => {
    const forked = notFoundPage('/autre-depot/');
    expect(forked).toContain('href="/autre-depot/app/"');
    expect(forked).toContain('href="/autre-depot/"');
    const rootSite = notFoundPage('/');
    expect(rootSite).toContain('href="/app/"');
  });

  it('ne redirige que pour un fragment qui appartient à l’application', () => {
    const page = notFoundPage();
    // Le script est écrit pour `#c=…` (appairage) et `#df=…` (lien de partage)
    // uniquement — pas pour n'importe quelle adresse, qui doit rester une 404 honnête.
    expect(page).toMatch(/\^#\(c=\|df=\)/);
    expect(page).toContain('window.location.replace');
  });
});

describe('adresse de l’application', () => {
  it('accepte un chemin relatif dans le site', () => {
    expect(checkAppUrl('app/').ok).toBe(true);
    expect(checkAppUrl('app/').relative).toBe(true);
    expect(checkAppUrl('./app/').ok).toBe(true);
  });

  it('refuse ce qui mènerait à une page cassée', () => {
    // Rien : un lien mort ne part pas en ligne.
    expect(checkAppUrl('').ok).toBe(false);
    // Un chemin absolu ignorerait le préfixe du dépôt sur GitHub Pages.
    expect(checkAppUrl('/app/').ok).toBe(false);
    // Sortir du dossier publié.
    expect(checkAppUrl('../app/').ok).toBe(false);
    // Une page HTTPS ne peut pas ouvrir une adresse non sécurisée.
    expect(checkAppUrl('http://exemple.test/app/').ok).toBe(false);
    // Renvoyer à cette page elle-même serait une boucle, pas une application.
    expect(checkAppUrl('https://louxos.github.io/DROPForge/').ok).toBe(false);
  });

  it('échoue bruyamment plutôt que de publier un lien cassé', () => {
    expect(() => renderSite({ template, styles, mark, version, appUrl: '' })).toThrow(/aucune adresse/);
    expect(() => renderSite({ template, styles, mark, version, appUrl: '/app/' })).toThrow(/absolu/);
  });

  it('accepte une application hébergée ailleurs, si elle est en HTTPS', () => {
    const external = renderSite({ template, styles, mark, version, appUrl: 'https://dropforge.example/app/' });
    expect(external).toContain('href="https://dropforge.example/app/"');
  });
});

describe('fichiers produits pour la publication', () => {
  it('produit l’accueil, la page 404 et le favicon', async () => {
    const files = (await buildSiteFiles({ root })) as Map<string, string>;
    expect([...files.keys()].sort()).toEqual([OUTPUTS.notFound, OUTPUTS.page, OUTPUTS.favicon].sort());
    expect(files.get(OUTPUTS.page)).toContain('href="app/"');
    expect(files.get(OUTPUTS.notFound)).toContain('Erreur 404');
  });

  it('reprend l’icône de l’application : un seul logo dans tout le projet', async () => {
    const files = (await buildSiteFiles({ root })) as Map<string, string>;
    expect(files.get(OUTPUTS.favicon)).toBe(mark);
  });

  it('n’est plus versionné à la racine du dépôt', () => {
    // Le site publié est reconstruit à chaque envoi : aucun fichier généré ne doit
    // rester dans le dépôt, sinon il dérive de ses sources sans que personne ne le voie.
    for (const file of Object.values(OUTPUTS)) {
      expect(() => read(file), `${file} ne doit plus être versionné`).toThrow();
    }
  });
});
