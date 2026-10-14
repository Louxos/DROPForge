/**
 * Génère les icônes DropForge et le logo de l'écran de démarrage, à partir de la seule
 * description du logo (`packages/design-system/src/brand-mark.mjs`).
 *
 *   node scripts/generate-icons.mjs     (ou `npm run icons`)
 *
 * Aucun binaire opaque dans le dépôt : tout se redessine. Le tracé est le même partout
 * — icône de la PWA, `.ico` de l'exécutable Windows, écran de démarrage de la coque —
 * parce qu'il n'est écrit qu'une fois et que ce script le met à l'échelle.
 *
 * Le `.ico` contient **sept** images (16, 24, 32, 48, 64, 128 en DIB, 256 en PNG) :
 * Windows choisit la bonne pour le menu Démarrer, la barre des tâches, l'Explorateur et
 * la boîte de dialogue d'installation. Une seule image de 256 aurait été réduite par
 * Windows, et le logo y aurait été flou.
 *
 * Les dépendances : Node, et rien d'autre — PNG écrit avec `zlib`, ICO avec le module
 * maison `scripts/lib/ico.mjs`.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeIco } from './lib/ico.mjs';
import { MARK, markSvg, wedgePath } from '../packages/design-system/src/brand-mark.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'apps', 'web', 'public', 'icons');
/** Où la coque Windows cherche ses icônes (configuration du paquet Tauri). */
const DESKTOP_OUT = join(root, 'apps', 'desktop', 'src-tauri', 'icons');
/** L'écran de démarrage, affiché avant même que React ait rendu quoi que ce soit. */
const BOOT_HTML = join(root, 'apps', 'desktop', 'index.html');

/** Le dégradé, en composantes 0-255. */
const hex = (value) => [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
const VIOLET = hex(MARK.gradient.from);
const BLUE = hex(MARK.gradient.to);
const DARK = hex(MARK.background);

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Encode des pixels RGBA en PNG (couleur vraie, canal alpha, sans entrelacement). */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // pas de filtre : les images sont petites
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits par composante
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((value, index) => Math.round(value + (b[index] - value) * t));

/** Le point est-il à l'intérieur du coin descendant ? */
function insideWedge(x, y) {
  const [[ax, ay], [bx, by], [cx, cy]] = MARK.wedge;
  const side = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (ry - py) * 0;
  const sign = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = sign(x, y, ax, ay, bx, by);
  const d2 = sign(x, y, bx, by, cx, cy);
  const d3 = sign(x, y, cx, cy, ax, ay);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  void side;
  return !(hasNegative && hasPositive);
}

/** Le point est-il dans la tige (rectangle aux coins arrondis) ? */
function insideStem(x, y) {
  const { x: sx, y: sy, width, height, radius } = MARK.stem;
  if (x < sx || x > sx + width || y < sy || y > sy + height) return false;
  const cx = Math.min(Math.max(x, sx + radius), sx + width - radius);
  const cy = Math.min(Math.max(y, sy + radius), sy + height - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

/** Le point est-il dans le carré aux coins arrondis du fond (ou dans son cercle) ? */
function insideBackground(x, y, radius) {
  const edge = MARK.viewBox - radius;
  const cx = Math.min(Math.max(x, radius), edge);
  const cy = Math.min(Math.max(y, radius), edge);
  return Math.hypot(x - cx, y - cy) <= radius + 0.5;
}

/**
 * Dessine le logo.
 *
 * Chaque pixel est échantillonné 4×4 fois : c'est ce qui donne des bords propres aux
 * petites tailles (16 px dans un menu Démarrer, ce n'est pas grand-chose).
 *
 * @param {number} size
 * @param {{maskable?: boolean}} [options] `maskable` : fond plein et symbole réduit dans
 *   la zone sûre, comme le veut la spécification des icônes masquables.
 * @returns {Buffer} pixels RGBA
 */
function renderMark(size, options = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  const samples = 4;
  const scale = size / MARK.viewBox;
  const center = MARK.viewBox / 2;
  // Une icône masquable est rognée par le système : le symbole doit tenir dans les 80 %
  // du carré, sinon un bord de la goutte disparaît sur certains écrans d'accueil.
  const contentScale = options.maskable ? 0.8 : 1;
  const radius = options.maskable ? MARK.viewBox / 2 : MARK.radius;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = (x + (sx + 0.5) / samples) / scale;
          const py = (y + (sy + 0.5) / samples) / scale;

          // Une icône masquable remplit tout le carré : le système découpe lui-même le
          // rond, un coin transparent laisserait voir le fond de l'écran d'accueil.
          if (!options.maskable && !insideBackground(px, py, radius)) continue;

          const contentX = center + (px - center) / contentScale;
          const contentY = center + (py - center) / contentScale;
          const onMark = insideWedge(contentX, contentY) || insideStem(contentX, contentY);
          const color = onMark ? mix(VIOLET, BLUE, py / MARK.viewBox) : DARK;

          red += color[0];
          green += color[1];
          blue += color[2];
          alpha += 255;
        }
      }

      const total = samples * samples;
      const offset = (y * size + x) * 4;
      if (alpha === 0) continue;
      // Moyenne des seuls échantillons couverts : garder la couleur juste sur les bords.
      const covered = alpha / 255;
      pixels[offset] = Math.round(red / covered);
      pixels[offset + 1] = Math.round(green / covered);
      pixels[offset + 2] = Math.round(blue / covered);
      pixels[offset + 3] = Math.round(alpha / total);
    }
  }
  return pixels;
}

/* ------------------------------------------------------------------ *
 * Icônes de l'application web (PWA, favicon, écran d'accueil iOS)
 * ------------------------------------------------------------------ */

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'icon.svg'), `${markSvg()}\n`);
writeFileSync(join(OUT, 'icon-192.png'), encodePng(192, 192, renderMark(192)));
writeFileSync(join(OUT, 'icon-512.png'), encodePng(512, 512, renderMark(512)));
writeFileSync(join(OUT, 'icon-maskable-512.png'), encodePng(512, 512, renderMark(512, { maskable: true })));
writeFileSync(join(OUT, 'apple-touch-icon.png'), encodePng(180, 180, renderMark(180)));
console.log('Icônes web écrites dans', OUT);

/* ------------------------------------------------------------------ *
 * Icônes de l'application Windows (Tauri)
 * ------------------------------------------------------------------ */

mkdirSync(DESKTOP_OUT, { recursive: true });
writeFileSync(join(DESKTOP_OUT, 'icon.png'), encodePng(256, 256, renderMark(256)));
writeFileSync(join(DESKTOP_OUT, '32x32.png'), encodePng(32, 32, renderMark(32)));
writeFileSync(join(DESKTOP_OUT, '128x128.png'), encodePng(128, 128, renderMark(128)));
writeFileSync(join(DESKTOP_OUT, '128x128@2x.png'), encodePng(256, 256, renderMark(256)));

// Les tailles que Windows demande réellement : 16 (menu Démarrer, barre de titre),
// 24 et 32 (barre des tâches selon la mise à l'échelle), 48 (Explorateur), 64 et
// 128 (grandes icônes), 256 (aperçu). Les six premières en DIB, la dernière en PNG.
const ICO_SIZES = [16, 24, 32, 48, 64, 128];
writeFileSync(
  join(DESKTOP_OUT, 'icon.ico'),
  encodeIco([
    ...ICO_SIZES.map((size) => ({ size, rgba: renderMark(size) })),
    { size: 256, png: encodePng(256, 256, renderMark(256)) },
  ]),
);
console.log('Icônes Windows écrites dans', DESKTOP_OUT);

/* ------------------------------------------------------------------ *
 * Écran de démarrage de la coque Windows
 * ------------------------------------------------------------------ */

/**
 * Le logo de `index.html`, entre ses deux repères.
 *
 * Il est écrit ici et pas à la main : c'est le même tracé que l'icône, et une
 * vérification de la chaîne d'intégration régénère les visuels puis refuse toute
 * différence — impossible, donc, que l'écran de démarrage garde un ancien logo.
 */
const START = '<!-- DROPFORGE_MARK:START -->';
const END = '<!-- DROPFORGE_MARK:END -->';
const html = readFileSync(BOOT_HTML, 'utf8');
const before = html.indexOf(START);
const after = html.indexOf(END);
if (before === -1 || after === -1 || after < before) {
  throw new Error(`repères du logo absents de ${BOOT_HTML} : ${START} … ${END}`);
}
const mark = markSvg({ size: 40, label: null });
const updated = `${html.slice(0, before + START.length)}\n          ${mark}\n          ${html.slice(after)}`;
if (updated !== html) writeFileSync(BOOT_HTML, updated);
console.log('Logo de l’écran de démarrage mis à jour dans', BOOT_HTML);

if (wedgePath() !== 'M256 112 L368 272 L144 272 Z') {
  throw new Error('le tracé du logo a changé : mettez à jour les tests qui le fixent');
}
