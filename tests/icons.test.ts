/**
 * Le logo, partout où il apparaît.
 *
 * Un logo qui existe en plusieurs versions finit par exister en plusieurs logos : le
 * fichier d'icônes, l'art de l'installateur et le bloc de marque de l'interface étaient
 * trois dessins différents du même symbole — un « DF » en texte dans l'application, un
 * triangle aux proportions recalculées dans l'installateur, un troisième tracé dans le
 * `.ico`. Il n'en existe plus qu'un, décrit dans
 * `packages/design-system/src/brand-mark.mjs`, et tout en dérive.
 *
 * Ces tests tiennent les deux bouts : la **structure** des fichiers livrés (un `.ico`
 * mal formé ne casse aucune compilation, il donne juste un exécutable sans visage) et
 * la **cohérence** entre la description partagée et ce qui est réellement écrit sur le
 * disque.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { encodeIco, readIco } from '../scripts/lib/ico.mjs';
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

  it('l’écran de démarrage de la coque Windows montre le même logo', () => {
    const html = read('apps/desktop/index.html');
    const block = /<!-- DROPFORGE_MARK:START -->([\s\S]*?)<!-- DROPFORGE_MARK:END -->/.exec(html)?.[1] ?? '';
    expect(block).toContain('<svg');
    expect(compact(block)).toContain(wedgePath());
    expect(compact(block)).toContain(MARK.gradient.from);
    // Le repère laissé à la main était un « DF » en texte : deux lettres ne sont pas un
    // logo, et c'est la première chose que voit une personne qui lance l'application.
    expect(html).not.toMatch(/>\s*DF\s*</);
  });

  it('l’interface dessine le même logo, pas des lettres', () => {
    const atoms = read('apps/web/src/components/atoms.tsx');
    expect(atoms).toContain('wedgePath');
    expect(atoms).toContain('MARK.viewBox');
    expect(atoms).not.toContain('>DF<');
  });

  it('l’art de l’installateur prend le dégradé à la source', () => {
    const art = read('scripts/generate-installer-art.mjs');
    expect(art).toContain('MARK.gradient.from');
    expect(art).toContain('MARK.wedge');
    // La seconde palette (deux violets pour une marque) ne doit pas revenir.
    expect(art).not.toMatch(/\[\s*139,\s*92,\s*246\s*\]/);
  });
});

describe('icône de l’exécutable Windows', () => {
  const ico = readIco(bytes('apps/desktop/src-tauri/icons/icon.ico'));

  it('contient les sept tailles que Windows demande', () => {
    expect(ico.entries.map((entry) => entry.width)).toEqual([16, 24, 32, 48, 64, 128, 256]);
  });

  it('encode les petites tailles en DIB et la grande en PNG', () => {
    // Le DIB est ce que toutes les versions de Windows comprennent ; le PNG pour 256 est
    // l'usage depuis Vista (une image PNG dans un `.ico` est explicitement permis).
    expect(ico.entries.filter((entry) => entry.format === 'dib').map((entry) => entry.width)).toEqual([
      16, 24, 32, 48, 64, 128,
    ]);
    expect(ico.entries.at(-1)).toMatchObject({ width: 256, format: 'png' });
  });

  it('déclare des cadres cohérents, tous dans le fichier', () => {
    const size = bytes('apps/desktop/src-tauri/icons/icon.ico').length;
    for (const entry of ico.entries) {
      expect(entry.bitCount).toBe(32);
      expect(entry.bytes).toBeGreaterThan(0);
      expect(entry.offset + entry.bytes).toBeLessThanOrEqual(size);
      if (entry.format === 'dib') {
        // Dans un DIB d'icône, la hauteur déclarée vaut le double : la moitié des lignes
        // porte le masque hérité. L'oublier décale toute l'image d'un facteur deux.
        expect(entry.dibHeight).toBe(entry.height);
      }
    }
  });
});

describe('icône de la zone de notification', () => {
  it('est livrée à la taille que Windows y dessine, et la configuration la référence', () => {
    // Windows dessine 16 px dans la zone de notification (20, 24 ou 32 selon la mise à
    // l'échelle). Lui donner l'image de 256 px l'oblige à la réduire elle-même : un logo
    // mou, et personne ne s'en aperçoit avant de l'avoir sous les yeux.
    const config = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json'));
    expect(config.app.trayIcon.iconPath).toBe('icons/tray-icon.png');

    const png = bytes('apps/desktop/src-tauri/icons/tray-icon.png');
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(32);
    expect(png.readUInt32BE(20)).toBe(32);
  });
});

describe('écriture d’un .ico', () => {
  it('range les pixels en BGRA, de bas en haut, comme le veut un DIB', () => {
    // Une image 2×2 : rouge en haut à gauche, vert en haut à droite, bleu en bas à
    // gauche, blanc en bas à droite (RGBA, ligne du haut d'abord).
    const rgba = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    const frame = readIco(encodeIco([{ size: 2, rgba }]));
    expect(frame.count).toBe(1);

    const ico = encodeIco([{ size: 2, rgba }]);
    const offset = frame.entries[0]!.offset;
    // Les premières lignes écrites sont celles du bas de l'image : bleu, puis blanc.
    expect([...ico.subarray(offset + 40, offset + 48)]).toEqual([255, 0, 0, 255, 255, 255, 255, 255]);
    // Puis celles du haut : rouge, puis vert.
    expect([...ico.subarray(offset + 48, offset + 56)]).toEqual([0, 0, 255, 255, 0, 255, 0, 255]);
    // Le masque AND suit les pixels : une ligne de largeur ceil(2/32)×4 = 4 octets, sur
    // deux lignes, entièrement à zéro (avec un canal alpha, zéro veut dire « opaque »).
    expect(ico.length).toBe(offset + 40 + 16 + 8);
    expect([...ico.subarray(offset + 56, offset + 64)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('refuse un icône sans image', () => {
    expect(() => encodeIco([])).toThrow(/au moins un cadre/);
  });

  it('relit ce qu’il a écrit, et rien d’autre', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const ico = readIco(encodeIco([{ size: 256, png }]));
    expect(ico.entries).toEqual([
      expect.objectContaining({ width: 256, height: 256, format: 'png', bytes: png.length }),
    ]);
    // Un fichier qui n'est pas un icône est refusé, plutôt que lu de travers.
    expect(() => readIco(Buffer.alloc(6))).toThrow(/icône|invalide/);
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
