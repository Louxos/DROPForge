/**
 * Le logo, partout où il apparaît.
 *
 * Un logo qui existe en plusieurs versions finit par exister en plusieurs logos : le
 * fichier d'icônes, le bloc de marque de l'interface et l'écran de chargement étaient
 * trois dessins différents du même symbole — un « DF » en texte dans l'application, un
 * triangle aux proportions recalculées ailleurs, un troisième tracé dans les fichiers.
 * Il n'en existe plus qu'un, décrit dans
 * `packages/design-system/src/brand-mark.mjs`, et tout en dérive.
 *
 * Ces tests tiennent les deux bouts : la **structure** des fichiers livrés (une icône
 * mal formée ne casse aucune compilation, elle donne juste une application sans visage)
 * et la **cohérence** entre la description partagée et ce qui est réellement écrit sur
 * le disque.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MARK, markSvg, wedgePath } from '../packages/design-system/src/brand-mark.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const bytes = (path: string): Buffer => readFileSync(join(root, path));
/** Compare deux SVG sans se disputer sur les espaces et les fins de ligne. */
const compact = (value: string): string => value.replace(/\s+/g, ' ').trim();

describe('description du logo', () => {
  it('décrit une goutte sur un carré aux coins arrondis', () => {
    expect(wedgePath()).toBe('M256 112 L368 272 L144 272 Z');
    expect(MARK.stem).toMatchObject({ x: 238, y: 312, width: 36, height: 88, radius: 10 });
    // Les coins arrondis sont plus petits qu'un demi-côté : c'est un carré arrondi, pas
    // un rond (le rond, c'est la variante masquable, décidée au dessin).
    expect(MARK.radius).toBeLessThan(MARK.viewBox / 2);
  });

  it('produit un SVG qui porte le tracé, le fond et le dégradé', () => {
    const svg = markSvg();
    expect(svg).toContain('viewBox="0 0 512 512"');
    expect(svg).toContain(wedgePath());
    expect(svg).toContain(MARK.gradient.from);
    expect(svg).toContain(MARK.gradient.to);
    expect(svg).toContain(MARK.background);
  });

  it('le SVG livré est exactement celui de la description partagée', () => {
    // Le moindre écart veut dire que quelqu'un a modifié le logo à la main quelque part :
    // c'est la garantie qu'il n'y a qu'un dessin.
    expect(compact(read('apps/web/public/icons/icon.svg'))).toBe(compact(markSvg()));
  });

  it('l’interface dessine le même logo, pas des lettres', () => {
    const atoms = read('apps/web/src/components/atoms.tsx');
    expect(atoms).toContain('wedgePath');
    expect(atoms).toContain('MARK.viewBox');
    expect(atoms).not.toContain('>DF<');
  });

});

describe('icônes de l’application web', () => {
  it('le manifeste et la page déclarent des fichiers qui existent', () => {
    const config = read('apps/web/vite.config.ts');
    const declared = [...config.matchAll(/`\$\{BASE\}icons\/([^`]+)`/g)].map((match) => match[1]!);
    expect(declared.length).toBeGreaterThanOrEqual(3);
    for (const name of declared) {
      expect(bytes(`apps/web/public/icons/${name}`).length).toBeGreaterThan(0);
    }

    const html = read('apps/web/index.html');
    for (const name of ['icons/icon.svg', 'icons/icon-192.png']) {
      expect(html).toContain(name);
      expect(bytes(`apps/web/public/${name}`).length).toBeGreaterThan(0);
    }
  });

  it('l’icône masquable est un carré plein, sans transparence', () => {
    // Une icône masquable est découpée par le système : un coin transparent laisserait
    // voir le fond de l'écran d'accueil au travers.
    const png = bytes('apps/web/public/icons/icon-maskable-512.png');
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // En-tête IHDR : largeur, hauteur, profondeur 8, type 6 (RGBA).
    expect(png.readUInt32BE(16)).toBe(512);
    expect(png.readUInt32BE(20)).toBe(512);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(6);
  });

  it('le README montre le logo', () => {
    expect(read('README.md')).toMatch(/icons\/icon-\d+\.png|icons\/icon\.svg/);
  });
});
