/**
 * La page d'accueil publiée par GitHub Pages (`index.html` à la racine).
 *
 * Ces tests protègent trois choses qui, sans surveillance, se cassent en
 * silence :
 *  1. la page est **autonome** — aucune police, aucun script, aucune image
 *     distante : elle doit s'afficher même sans réseau, et une page qui
 *     télécharge un fichier externe ne le ferait pas ;
 *  2. l'adresse de l'application web n'existe qu'une fois, dans
 *     `docs/site/app-url.txt`, et la page publiée ne peut pas contenir un lien
 *     mort : elle affiche soit le bouton, soit l'état « bientôt » ;
 *  3. le fichier publié est **régénéré** depuis ses sources (sinon il dérive,
 *     et plus personne ne sait ce qui est en ligne).
 *
 * Tout est vérifié sur le contenu réellement présent dans le dépôt : ce qui
 * passe ici est ce que GitHub Pages sert.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  OUTPUTS,
  REPO_URL,
  SOURCES,
  buildOutputs,
  checkAppUrl,
  parseAppUrl,
  renderSite,
  selectGateway,
} from '../scripts/build-site.mjs';

const root = process.cwd();
const read = (relative: string) => readFile(path.join(root, relative), 'utf8');
const pkg = JSON.parse(await read('package.json')) as { version: string };
const version = pkg.version;

let cachedSources: {
  template: string;
  styles: string;
  mark: string;
  appUrl: string;
} | undefined;

async function sources() {
  if (cachedSources === undefined) {
    cachedSources = {
      template: await read(SOURCES.template),
      styles: await read(SOURCES.styles),
      mark: await read(SOURCES.mark),
      appUrl: parseAppUrl(await read(SOURCES.appUrl)),
    };
  }
  return cachedSources;
}

async function rendered(appUrl?: string) {
  const { template, styles, mark } = await sources();
  return renderSite({ template, styles, mark, version, appUrl: appUrl ?? '' }) as string;
}

describe('page publiée : fichiers servis par GitHub Pages', () => {
  it('publie un index.html à la racine, un favicon et .nojekyll', async () => {
    // GitHub Pages en mode « branche » sert `index.html` s'il existe, et
    // seulement sinon le README. `.nojekyll` évite que Jekyll réécrive le
    // contenu ou refuse un dossier commençant par `_`.
    for (const file of Object.values(OUTPUTS)) {
      expect(existsSync(path.join(root, file)), `${file} doit exister à la racine`).toBe(true);
    }
    expect(await read(OUTPUTS.noJekyll)).toBe('');
  });

  it('reprend l’icône de l’application : un seul logo dans tout le projet', async () => {
    expect(await read(OUTPUTS.favicon)).toBe(await read(SOURCES.mark));
  });

  it('est autonome : aucune ressource distante à charger', async () => {
    const page = await read(OUTPUTS.page);
    // Pas de feuille de style externe, pas de script externe, pas de police
    // distante, pas de data-URI géante : tout est dans le fichier.
    expect(page).not.toMatch(/<link[^>]+rel=["']stylesheet/i);
    expect(page).not.toMatch(/<script[^>]+src=/i);
    expect(page).not.toMatch(/@import\s+url/i);
    expect(page).not.toMatch(/(src|srcset)=["']https?:/i);
    expect(page).not.toMatch(/fonts\.googleapis|cdn\./i);
    // Aucune adresse en clair (http://) hors espaces de noms SVG/XML, qui ne
    // déclenchent aucun chargement : la page, elle, n'envoie aucune requête.
    const sansEspacesDeNoms = page.replace(/xmlns(:[a-z]+)?="http:\/\/[^"]*"/gi, '');
    expect(sansEspacesDeNoms).not.toMatch(/["'=]http:\/\//i);
    expect(page).not.toMatch(/https?:\/\/(fonts|cdn|unpkg|jsdelivr)/i);
    // Le CSS est bien inséré, et pas seulement référencé.
    expect(page).toMatch(/--violet:/);
    expect(page.length).toBeGreaterThan(20_000);
  });

  it('ne publie aucun gabarit non remplacé, ni marqueur interne', async () => {
    const page = await read(OUTPUTS.page);
    expect(page).not.toMatch(/{{[A-Z_]+}}/);
    expect(page).not.toMatch(/GATEWAY:(LIVE|SOON)/);
    expect(page).toContain(`Version ${version}`);
    expect(page).toContain(`DropForge_${version}_x64-setup.exe`);
  });
});

describe('page publiée : où aller, et dans quel ordre', () => {
  it('place le bloc de l’application web avant tout le reste du contenu', async () => {
    const page = await read(OUTPUTS.page);
    const app = page.indexOf('id="application"');
    const features = page.indexOf('id="transfers"');
    const security = page.indexOf('id="security"');
    const download = page.indexOf('id="download"');
    expect(app).toBeGreaterThan(-1);
    expect(app).toBeLessThan(features);
    expect(app).toBeLessThan(security);
    expect(app).toBeLessThan(download);
    // Le bloc lui-même annonce « L'application web », dès le premier écran.
    expect(page.slice(app, app + 1500)).toMatch(/L'application web/);
    // Avant la première section de contenu : c'est le premier écran de la page.
    expect(app).toBeLessThan(page.indexOf('<section'));
  });

  it('propose les deux chemins : application web, ou téléchargement du logiciel', async () => {
    const page = await read(OUTPUTS.page);
    expect(page).toMatch(/Ouvrir l.application web|Application web · bientôt/);
    expect(page).toContain('Télécharger le logiciel');
    expect(page).toContain(`${REPO_URL}/releases/latest`);
    // Sans adresse enregistrée, le bouton primaire n'est jamais un lien mort.
    expect(page).not.toMatch(/href="\s*"/);
  });

  it('affiche l’adresse enregistrée, et un état d’attente sinon', async () => {
    const absent = await rendered('');
    expect(absent).toContain("Application web · bientôt");
    expect(absent).not.toMatch(/Ouvrir l.application web/);

    const present = await rendered('https://dropforge.netlify.app');
    expect(present).toContain("Ouvrir l'application web");
    // L'adresse cliquable et l'adresse copiée sont la même, au caractère près.
    expect(present).toContain('href="https://dropforge.netlify.app"');
    expect(present).toContain('data-copy="https://dropforge.netlify.app"');
    expect(present).toContain('<code id="app-url">https://dropforge.netlify.app</code>');
    expect(present).not.toContain("Application web · bientôt");
  });

  it('ne laisse jamais passer deux blocs « où aller » à la fois', () => {
    const template = `<a>LIVE</a><!--GATEWAY:LIVE--><b>live</b><!--/GATEWAY:LIVE-->` +
      `<!--GATEWAY:SOON--><c>soon</c><!--/GATEWAY:SOON-->`;
    expect(selectGateway(template, 'https://x.example')).toBe('<a>LIVE</a><b>live</b>');
    expect(selectGateway(template, '')).toBe('<a>LIVE</a><c>soon</c>');
  });
});

describe('adresse de l’application web : une seule constante', () => {
  it('ignore les commentaires du fichier de configuration', () => {
    expect(parseAppUrl('# commentaire\n\n   \n')).toBe('');
    expect(parseAppUrl('# à faire\nhttps://dropforge.netlify.app\n')).toBe('https://dropforge.netlify.app');
    expect(parseAppUrl('https://dropforge.netlify.app\nhttps://autre.example')).toBe(
      'https://dropforge.netlify.app',
    );
  });

  it('refuse ce qui mènerait à une page cassée', () => {
    expect(checkAppUrl('').ok).toBe(true);
    expect(checkAppUrl('https://dropforge.netlify.app').ok).toBe(true);
    expect(checkAppUrl('dropforge.netlify.app').ok).toBe(false);
    expect(checkAppUrl('http://dropforge.netlify.app').ok).toBe(false);
    expect(checkAppUrl('ftp://dropforge.example').ok).toBe(false);
    // Pointer vers cette page elle-même serait une boucle, pas une application.
    expect(checkAppUrl('https://louxos.github.io/DROPForge/').ok).toBe(false);
  });

  it('échoue bruyamment plutôt que de publier un lien cassé', async () => {
    const { template, styles, mark } = await sources();
    expect(() =>
      renderSite({ template, styles, mark, version, appUrl: 'dropforge.netlify.app' }),
    ).toThrow(/adresse absolue/);
  });
});

describe('page publiée : garde de dérive', () => {
  it('correspond exactement à ce que produisent ses sources', async () => {
    // C'est la version « test » de `npm run check:site` : si quelqu'un modifie
    // le modèle ou le CSS sans régénérer, la page en ligne ne serait plus celle
    // du dépôt.
    const outputs = (await buildOutputs(root)) as Map<string, string>;
    const drifted: string[] = [];
    for (const [relative, content] of outputs) {
      const current = existsSync(path.join(root, relative)) ? await read(relative) : undefined;
      if (current !== content) drifted.push(relative);
    }
    expect(drifted).toEqual([]);
  });

  it('rappelle les limites réelles du projet, sans les embellir', async () => {
    const page = await read(OUTPUTS.page);
    // L'avertissement Windows est présent tant que les deux défauts signalés ne
    // sont pas corrigés, et la page dit ce qui n'est pas encore testé.
    expect(page).toContain('Application Windows : correction en cours');
    expect(page).toMatch(/pas encore ouverte sur un vrai Windows/);
    expect(page).toMatch(/pas encore sur un téléphone réel/);
    expect(page).toMatch(/nécessite un hébergement/);
    expect(page).toContain(`${REPO_URL}/blob/main/docs/SPEC-AUDIT.md`);
  });
});
