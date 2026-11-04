/**
 * La page publique du site GitHub Pages : la page d'archive et la page 404.
 *
 * Ces tests protègent trois choses qui, sans surveillance, se cassent en silence :
 *
 *  1. les pages sont **autonomes** — aucune police, aucun script, aucune image
 *     distante : elles s'affichent sans réseau, et une page qui télécharge un fichier
 *     externe ne le ferait pas ;
 *  2. l'application est un **chemin relatif** (`app/`), et rien d'autre : le même site
 *     fonctionne sur `https://louxos.github.io/DROPForge/`, sur une fourche et dans un
 *     dossier local, sans qu'aucune adresse absolue n'ait à être tenue à jour ;
 *  3. la page d'archive annonce l'archivage, sa date, l'arrêt définitif, et donne accès
 *     au code, à l'historique et aux versions — sans jamais se lire comme une page
 *     temporaire ni comme une promesse de reprise ;
 *  4. la page 404 parle de l'adresse demandée, renvoie à l'application, et ne redirige
 *     que lorsqu'un fragment de l'application est présent.
 *
 * Tout est vérifié sur le contenu **réellement rendu** par le générateur : ce qui passe
 * ici est ce que GitHub Pages sert.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  APP_PATH,
  ARCHIVED_ON,
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

describe('page d’archive publiée', () => {
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
    // La date d'archivage vient du générateur, pas d'une phrase recopiée à la main.
    expect(page).toContain(ARCHIVED_ON);
    expect(page).not.toContain('{{ARCHIVED_ON}}');
  });

  it('annonce l’archivage avant tout le reste, et nulle part ailleurs', () => {
    const page = home();
    const announcement = page.indexOf('Ce projet est désormais archivé.');
    expect(announcement).toBeGreaterThan(-1);
    // Le titre arrive avant le rappel de l'objectif, avant les raisons, avant le code.
    for (const later of ['id="objectif"', 'id="raisons"', 'id="acces"']) {
      expect(announcement, `${later} doit venir après le titre`).toBeLessThan(page.indexOf(later));
    }
    // La date officielle est annoncée dans la page elle-même.
    expect(page).toContain(ARCHIVED_ON);
  });

  it('dit clairement que le développement est arrêté et qu’il n’y aura rien', () => {
    const page = home();
    expect(page).toMatch(/Développement arrêté/i);
    expect(page).toMatch(/aucune nouvelle fonctionnalité/i);
    expect(page).toMatch(/aucun correctif/i);
    // Aucune formulation de page temporaire : ce n'est ni une maintenance ni un « bientôt ».
    expect(page).not.toMatch(/bientôt|maintenance en cours|reviens|de retour prochainement/i);
    // Aucune invitation à revenir suivre un développement qui n'existe plus.
    expect(page).not.toMatch(/rejoignez|newsletter|abonnez-vous/i);
  });

  it('donne accès au code source, à l’historique et aux versions', () => {
    const page = home();
    expect(page).toContain(`href="${REPO_URL}"`);
    expect(page).toContain(`${REPO_URL}/commits/main`);
    expect(page).toContain(`${REPO_URL}/releases`);
    // Et l'état du dépôt, écrit noir sur blanc : public, en lecture seule.
    expect(page).toMatch(/public/i);
    expect(page).toMatch(/lecture seule/i);
  });

  it('rappelle l’objectif initial et les raisons de l’arrêt', () => {
    const page = home();
    expect(page).toMatch(/Ce que DropForge devait être/);
    expect(page).toMatch(/chiffré de bout en bout/i);
    expect(page).toMatch(/sans compte/i);
    expect(page).toMatch(/Pourquoi le développement s.arrête/);
  });

  it('ne prétend pas qu’une version stable a été publiée', () => {
    const page = home();
    // La dernière version publiée est 0.1.3, et la page le dit ; la 0.2.0 n'a jamais été
    // publiée comme version, et la page ne la présente pas comme telle.
    expect(page).toContain('0.1.3');
    expect(page).not.toMatch(/\bDropForge 1\.0\b|version 1\.0\b/i);
    expect(page).not.toMatch(/version stable/i);
    // Aucun bouton de téléchargement : il n'y a rien à installer, rien à promettre.
    expect(page).not.toMatch(/Télécharger/i);
    expect(page).not.toMatch(/class="btn/);
  });

  it('dit ce qui n’a jamais été couvert, au lieu de le laisser croire', () => {
    const page = home();
    // Le relais public n'a jamais existé : la page le dit, au lieu de promettre deux
    // réseaux différents.
    expect(page).toMatch(/faute de relais public/i);
    // La licence n'a jamais été choisie : la page le dit, pour que personne ne réutilise
    // le code en croyant qu'il est libre.
    expect(page).toMatch(/n’a jamais reçu de licence|n'a jamais reçu de licence/);
  });

  it('pointe vers l’application par un chemin relatif, sans jamais écrire de domaine', () => {
    const page = home();
    expect(page).toContain(`href="${APP_PATH}"`);
    expect(page).not.toMatch(/href="https?:\/\/louxos\.github\.io/);
    // Aucun lien mort : l'adresse n'est jamais vide.
    expect(page).not.toMatch(/href="\s*"/);
  });

  it('reste une page soignée sur téléphone, et discrète en animation', () => {
    const page = home();
    // Mise en page adaptative : au moins un point de rupture explicite.
    expect(page).toMatch(/@media \(max-width: 620px\)/);
    expect(page).toMatch(/@media \(max-width: 860px\)/);
    // Les animations existent, mais elles respectent le réglage système.
    expect(page).toMatch(/prefers-reduced-motion: reduce/);
    // Rien de clignotant, rien de clignotant simulé en JavaScript.
    expect(page).not.toMatch(/<marquee|animation-iteration-count:\s*infinite/i);
  });

  it('marque la fermeture en rouge et en orange, sans perdre l’identité de DropForge', () => {
    const page = home();
    // Le logo garde ses couleurs — c'est DropForge, pas une page d'erreur.
    expect(page).toContain('#7c5cff');
    expect(page).toContain('#389cff');
    // La fermeture a les siennes, et elles servent vraiment : filet, sceau, titre.
    expect(page).toContain('--closed: #ff5a4d');
    expect(page).toContain('--ember: #ff8a3d');
    expect(page).toContain('--amber: #ffc46b');
    expect(page).toMatch(/\.topbar::before \{[^}]*linear-gradient/);
    expect(page).toMatch(/\.archive-hero h1 \{[^}]*background-clip: text/);
    expect(page).toContain('class="closed"');
  });

  it('ne renvoie plus à Netlify, et dit qui sert la page', () => {
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
    expect(page).toContain(`Archivé le ${ARCHIVED_ON}`);
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

  it('est publié depuis la branche, donc versionné à la racine — et identique au générateur', async () => {
    // Le dépôt est archivé : ses workflows ne s'exécutent plus. Un site qui ne vivrait que
    // comme artefact de workflow ne serait plus reconstructible. GitHub Pages sert donc
    // les fichiers de la branche, et cette copie doit être exactement ce que le générateur
    // produit — sinon elle dérive en silence.
    // `index.html` et le favicon ne dépendent pas du chemin du dépôt : leur comparaison
    // est exacte. La page 404, elle, écrit des liens absolus préfixés ; son identité
    // octet par octet est vérifiée par `npm run check:pages`, qui connaît ce préfixe.
    const files = (await buildSiteFiles({ root })) as Map<string, string>;
    for (const name of [OUTPUTS.page, OUTPUTS.favicon]) {
      expect(read(name), `${name} a dérivé : lancez « npm run publish:site »`).toBe(files.get(name));
    }
    expect(read(OUTPUTS.notFound)).not.toMatch(/{{[A-Z_]+}}/);
    expect(existsSync(join(root, '.nojekyll')), '.nojekyll manquant : Jekyll servirait autre chose').toBe(true);
  });

  it('publie l’application à côté de la page d’archive, dans le dépôt', () => {
    // Sans les workflows, c'est ce dossier `app/` que GitHub Pages sert : s'il manque,
    // le lien « l'application telle qu'elle a été laissée » mène à une 404.
    for (const file of ['app/index.html', 'app/manifest.webmanifest', 'app/sw.js', 'favicon.svg']) {
      expect(existsSync(join(root, file)), `${file} manquant : lancez « npm run publish:site »`).toBe(true);
    }
  });
});
