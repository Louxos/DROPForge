/**
 * Génère les images d'interface de l'installateur Windows (NSIS et MSI).
 *
 *   node scripts/generate-installer-art.mjs
 *
 * Pourquoi par code : un installateur « premium » se reconnaît à sa page d'accueil et
 * à son bandeau. Si ces images étaient des fichiers binaires opaques, personne ne
 * pourrait les corriger, les mettre à la bonne taille ou les régénérer — exactement ce
 * que le dépôt évite déjà pour ses icônes. Elles sont donc dessinées ici, avec les
 * mêmes primitives que le symbole de marque, et écrites en BMP 24 bits (le seul format
 * que NSIS et WiX acceptent), sans aucune dépendance.
 *
 * Dimensions imposées par les outils, et vérifiées par `npm run check:desktop` :
 *  - en-tête NSIS  : 150 × 57   (haut des pages de l'installateur)
 *  - bandeau NSIS  : 164 × 314  (pages de bienvenue et de fin)
 *  - bandeau WiX   : 493 × 58   (haut des boîtes de dialogue MSI)
 *  - image WiX     : 493 × 312  (pages de bienvenue et de fin du MSI)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeBmp } from './lib/bmp.mjs';
import { MARK } from '../packages/design-system/src/brand-mark.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'desktop', 'src-tauri', 'installer');

/* ------------------------------------------------------------------ *
 * Jetons de thème (identiques à packages/design-system)
 * ------------------------------------------------------------------ */
const BACKGROUND = [11, 11, 15];
const SURFACE = [20, 20, 27];
/**
 * Le dégradé du logo, pris à la source (`brand-mark.mjs`). L'art de l'installateur
 * utilisait auparavant une seconde palette, proche mais différente : deux violets pour
 * une seule marque, cela se voit sur une page d'installation côte à côte avec l'icône.
 */
const rgb = (value) => [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
const VIOLET = rgb(MARK.gradient.from);
const BLUE = rgb(MARK.gradient.to);
const TEXT = [244, 244, 247];
const TEXT_MUTED = [165, 165, 180];
const BORDER = [38, 38, 47];

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/* ------------------------------------------------------------------ *
 * Tampon de dessin
 * ------------------------------------------------------------------ */

function createCanvas(width, height) {
  // Le tampon travaille en composantes 0-1 (c'est ce qui rend les mélanges justes) ;
  // toutes les méthodes publiques acceptent des couleurs 0-255, comme les jetons de
  // thème, et convertissent ici — une seule règle, aucune confusion possible.
  const pixels = new Float32Array(width * height * 3);
  const unit = (color) => [color[0] / 255, color[1] / 255, color[2] / 255];
  const blend = (x, y, color, alpha) => {
    if (alpha <= 0 || x < 0 || y < 0 || x >= width || y >= height) return;
    const index = (y * width + x) * 3;
    const a = Math.min(1, alpha);
    const value = Array.isArray(color) ? unit(color) : color;
    pixels[index] = pixels[index] * (1 - a) + value[0] * a;
    pixels[index + 1] = pixels[index + 1] * (1 - a) + value[1] * a;
    pixels[index + 2] = pixels[index + 2] * (1 - a) + value[2] * a;
  };

  const canvas = {
    width,
    height,
    /** Remplit tout le tampon avec une couleur (composantes 0-255). */
    fill(color) {
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) blend(x, y, color, 1);
      return canvas;
    },
    /** Dégradé vertical, du haut vers le bas (couleurs 0-255). */
    fillVertical(top, bottom) {
      for (let y = 0; y < height; y += 1) {
        const color = mix(top, bottom, height === 1 ? 0 : y / (height - 1));
        for (let x = 0; x < width; x += 1) blend(x, y, color, 1);
      }
      return canvas;
    },
    /**
     * Remplit une forme décrite par un test d'appartenance. `colorAt` reçoit des
     * coordonnées en pixels et renvoie une couleur 0-255 ; `samples` échantillons par
     * axe et par pixel donnent des bords lisses.
     */
    fillShape(inside, colorAt, samples = 4) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          let covered = 0;
          for (let sy = 0; sy < samples; sy += 1) {
            for (let sx = 0; sx < samples; sx += 1) {
              const px = x + (sx + 0.5) / samples;
              const py = y + (sy + 0.5) / samples;
              if (inside(px, py)) covered += 1;
            }
          }
          if (covered === 0) continue;
          blend(x, y, colorAt(x + 0.5, y + 0.5), covered / (samples * samples));
        }
      }
      return canvas;
    },
    /** Rectangle plein (couleur fixe, ou dégradé horizontal par `colorAt`). */
    rect(x0, y0, w, h, colorAt) {
      return canvas.fillShape(
        (x, y) => x >= x0 && x < x0 + w && y >= y0 && y < y0 + h,
        typeof colorAt === 'function' ? colorAt : () => colorAt,
      );
    },
    /** Trait épais le long d'une polyligne, avec des extrémités arrondies. */
    stroke(points, thickness, colorAt) {
      const half = thickness / 2;
      const color = typeof colorAt === 'function' ? colorAt : () => colorAt;
      return canvas.fillShape(
        (x, y) => distanceToPolyline(x, y, points) <= half,
        (x, y) => color(x, y),
        // Quatre échantillons par axe : un trait de deux pixels reste net au lieu de
        // devenir gris, ce qui est exactement le défaut visible d'un texte fin.
        4,
      );
    },
    /** Halo radial très discret (profondeur, sans décor gratuit). */
    glow(cx, cy, radius, color, strength) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (distance > radius) continue;
          const falloff = 1 - distance / radius;
          blend(x, y, color, strength * falloff * falloff);
        }
      }
      return canvas;
    },
    toRgba() {
      const out = Buffer.alloc(width * height * 4);
      for (let index = 0; index < width * height; index += 1) {
        out[index * 4] = Math.round(Math.min(255, Math.max(0, pixels[index * 3] * 255)));
        out[index * 4 + 1] = Math.round(Math.min(255, Math.max(0, pixels[index * 3 + 1] * 255)));
        out[index * 4 + 2] = Math.round(Math.min(255, Math.max(0, pixels[index * 3 + 2] * 255)));
        out[index * 4 + 3] = 255;
      }
      return out;
    },
  };

  return canvas;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distanceToPolyline(px, py, points) {
  let best = Infinity;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const [ax, ay] = points[index];
    const [bx, by] = points[index + 1];
    best = Math.min(best, distanceToSegment(px, py, ax, ay, bx, by));
    if (best === 0) break;
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Symbole de marque : la « goutte » (coin + tige), comme les icônes
 * ------------------------------------------------------------------ */

/**
 * Dessine le symbole dans une boîte donnée, à partir de la description partagée
 * (`packages/design-system/src/brand-mark.mjs`).
 *
 * Les proportions ne sont donc plus recalculées ici : elles *sont* le logo. C'est la
 * différence entre un installateur qui affiche une marque approchante et un
 * installateur qui affiche la marque — la même que celle du `.ico`, des icônes de la
 * PWA et du bloc de marque de l'interface.
 *
 * @param {import('./lib/canvas.mjs').Canvas} canvas
 * @param {{ x: number, y: number, size: number, glow?: boolean }} box
 */
function drawMark(canvas, box, options = {}) {
  const { x, y, size } = box;
  /** Le repère du logo (512) ramené à la boîte demandée. */
  const at = (vx, vy) => ({ x: x + (vx / MARK.viewBox) * size, y: y + (vy / MARK.viewBox) * size });
  const gradientAt = (px, py) => mix(VIOLET, BLUE, Math.min(1, Math.max(0, (py - y) / size)));

  if (options.glow) {
    canvas.glow(x + size / 2, y + (MARK.wedge[1][1] / MARK.viewBox) * size, size * 1.15, VIOLET, 0.18);
  }

  // Le coin descendant : trois sommets, exactement ceux du SVG.
  const [a, b, c] = MARK.wedge.map(([vx, vy]) => at(vx, vy));
  const sign = (p, q, r) => (p.x - r.x) * (q.y - r.y) - (q.x - r.x) * (p.y - r.y);
  canvas.fillShape(
    (px, py) => {
      const point = { x: px, y: py };
      const d1 = sign(point, a, b);
      const d2 = sign(point, b, c);
      const d3 = sign(point, c, a);
      const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
      const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
      return !(hasNegative && hasPositive);
    },
    gradientAt,
    4,
  );

  // La tige : le rectangle arrondi du SVG, mis à l'échelle.
  const stem = MARK.stem;
  const topLeft = at(stem.x, stem.y);
  const bottomRight = at(stem.x + stem.width, stem.y + stem.height);
  const radius = (stem.radius / MARK.viewBox) * size;
  canvas.fillShape(
    (px, py) => {
      if (px < topLeft.x || px > bottomRight.x || py < topLeft.y || py > bottomRight.y) return false;
      const cx = Math.min(Math.max(px, topLeft.x + radius), bottomRight.x - radius);
      const cy = Math.min(Math.max(py, topLeft.y + radius), bottomRight.y - radius);
      return Math.hypot(px - cx, py - cy) <= radius;
    },
    gradientAt,
    4,
  );
}

/* ------------------------------------------------------------------ *
 * Police de traits : un mot-symbole net, sans fichier de police
 * ------------------------------------------------------------------ */

const ARC_SEGMENTS = 40;
const arc = (cx, cy, rx, ry, fromDegrees, toDegrees) => {
  const points = [];
  for (let index = 0; index <= ARC_SEGMENTS; index += 1) {
    const t = index / ARC_SEGMENTS;
    const angle = ((fromDegrees + (toDegrees - fromDegrees) * t) * Math.PI) / 180;
    points.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
  }
  return points;
};

/**
 * Lettres du mot-symbole, dans une boîte unitaire (0-1 en x et en y, y vers le bas).
 * Chaque lettre est une liste de polylignes ; `advance` est la largeur d'avance.
 */
const GLYPHS = {
  D: {
    advance: 0.80,
    strokes: [
      [[0.07, 0.02], [0.07, 0.98]],
      arc(0.07, 0.5, 0.68, 0.48, -90, 90),
    ],
  },
  E: {
    advance: 0.70,
    strokes: [
      [[0.08, 0.02], [0.08, 0.98]],
      [[0.08, 0.02], [0.74, 0.02]],
      [[0.08, 0.5], [0.62, 0.5]],
      [[0.08, 0.98], [0.74, 0.98]],
    ],
  },
  F: {
    advance: 0.70,
    strokes: [
      [[0.08, 0.02], [0.08, 0.98]],
      [[0.08, 0.02], [0.76, 0.02]],
      [[0.08, 0.5], [0.60, 0.5]],
    ],
  },
  G: {
    advance: 0.88,
    strokes: [
      arc(0.44, 0.5, 0.40, 0.48, 10, 350),
      [[0.86, 0.5], [0.52, 0.5]],
    ],
  },
  O: {
    advance: 0.86,
    strokes: [arc(0.43, 0.5, 0.39, 0.48, 0, 360)],
  },
  P: {
    advance: 0.78,
    strokes: [
      [[0.08, 0.02], [0.08, 0.98]],
      arc(0.08, 0.32, 0.64, 0.30, -90, 90),
    ],
  },
  R: {
    advance: 0.80,
    strokes: [
      [[0.08, 0.02], [0.08, 0.98]],
      arc(0.08, 0.34, 0.62, 0.32, -90, 90),
      [[0.40, 0.62], [0.82, 0.98]],
    ],
  },
};

/**
 * Dessine un mot en capitales avec la police de traits.
 *
 * @param {{x: number, y: number, capHeight: number, thickness: number, tracking?: number, color?: number[]}} options
 */
function drawWord(canvas, text, options) {
  const { x, y, capHeight, thickness, tracking = 0.08, color = TEXT, muted = TEXT_MUTED } = options;
  // Dégradé vertical très contenu : le mot reste net, mais il a la profondeur du
  // reste de l'interface au lieu d'un aplat.
  const colorAt = (px, py) => {
    const t = Math.min(1, Math.max(0, (py - y) / capHeight));
    return mix(color, muted, t * 0.55);
  };
  let cursor = x;
  for (const character of text) {
    const glyph = GLYPHS[character];
    if (!glyph) {
      cursor += capHeight * 0.5;
      continue;
    }
    for (const stroke of glyph.strokes) {
      const points = stroke.map(([gx, gy]) => [cursor + gx * capHeight, y + gy * capHeight]);
      canvas.stroke(points, thickness, colorAt);
    }
    cursor += (glyph.advance + tracking) * capHeight;
  }
  return cursor - x;
}

/** Largeur qu'un mot occupera, sans le dessiner (pour centrer). */
function measureWord(text, capHeight, tracking = 0.08) {
  let width = 0;
  for (const character of text) {
    const glyph = GLYPHS[character];
    width += glyph ? (glyph.advance + tracking) * capHeight : capHeight * 0.5;
  }
  return Math.max(0, width - tracking * capHeight);
}

/* ------------------------------------------------------------------ *
 * Les quatre images
 * ------------------------------------------------------------------ */

const WORD = 'DROPFORGE';

/** En-tête des pages de l'installateur NSIS : symbole + mot, sur fond charbon. */
function header() {
  const width = 150;
  const height = 57;
  const canvas = createCanvas(width, height).fillVertical(BACKGROUND, SURFACE);
  drawMark(canvas, { x: 10, y: 15, size: 27 });
  drawWord(canvas, WORD, { x: 46, y: 23, capHeight: 11, thickness: 2.1 });
  // Filet de séparation : la marque de couleur du produit, discrète.
  canvas.rect(0, height - 3, width * 0.42, 3, (x) => mix(VIOLET, BLUE, x / (width * 0.42)));
  canvas.rect(0, height - 1, width, 1, BORDER);
  return { name: 'header.bmp', canvas, width, height };
}

/** Bandeau des pages de bienvenue et de fin (NSIS). */
function sidebar() {
  const width = 164;
  const height = 314;
  const canvas = createCanvas(width, height).fillVertical(BACKGROUND, [16, 16, 22]);
  canvas.glow(width / 2, 118, 96, VIOLET, 0.16);

  const markSize = 74;
  drawMark(canvas, { x: (width - markSize) / 2, y: 66, size: markSize, glow: true });

  const capHeight = 12.5;
  const wordWidth = measureWord(WORD, capHeight);
  drawWord(canvas, WORD, {
    x: (width - wordWidth) / 2,
    y: 176,
    capHeight,
    thickness: 2.2,
    tracking: 0.12,
  });

  // Sous-titre : trois traits inégaux, comme un texte volontairement non écrit.
  // Aucun mot inventé, aucune promesse : l'installateur affiche déjà les vraies.
  const ruleY = 214;
  const rules = [
    [26, 112],
    [40, 84],
    [52, 96],
  ];
  rules.forEach(([inset, ruleWidth], index) => {
    canvas.rect(inset, ruleY + index * 9, ruleWidth, 2.5, TEXT_MUTED);
  });

  canvas.rect(0, height - 4, (width * 0.5), 4, (x) => mix(VIOLET, BLUE, x / (width * 0.5)));
  return { name: 'sidebar.bmp', canvas, width, height };
}

/** Bandeau haut des boîtes de dialogue MSI. */
function wixBanner() {
  const width = 493;
  const height = 58;
  const canvas = createCanvas(width, height).fillVertical(SURFACE, BACKGROUND);
  drawMark(canvas, { x: 16, y: 16, size: 26 });
  drawWord(canvas, WORD, { x: 52, y: 24, capHeight: 10.5, thickness: 2.0 });
  // Filet à droite : équilibre le bandeau sans occuper l'espace du texte de la boîte.
  canvas.rect(width - 180, height - 3, 180 * 0.75, 3, (x) => mix(VIOLET, BLUE, 1 - x / (180 * 0.75)));
  canvas.rect(0, height - 1, width, 1, BORDER);
  return { name: 'wix-banner.bmp', canvas, width, height };
}

/** Image des pages de bienvenue et de fin du MSI. */
function wixDialog() {
  const width = 493;
  const height = 312;
  const canvas = createCanvas(width, height).fillVertical(BACKGROUND, [16, 16, 22]);
  canvas.glow(width / 2, 132, 220, VIOLET, 0.14);

  const markSize = 96;
  drawMark(canvas, { x: (width - markSize) / 2, y: 62, size: markSize, glow: true });

  const capHeight = 16;
  const wordWidth = measureWord(WORD, capHeight, 0.14);
  drawWord(canvas, WORD, {
    x: (width - wordWidth) / 2,
    y: 196,
    capHeight,
    thickness: 2.8,
    tracking: 0.14,
  });

  canvas.rect((width - 220) / 2, 232, 220, 3, (x) => mix(VIOLET, BLUE, x / 220));
  return { name: 'wix-dialog.bmp', canvas, width, height };
}

/* ------------------------------------------------------------------ *
 * Écriture
 * ------------------------------------------------------------------ */

mkdirSync(OUT, { recursive: true });
const images = [header(), sidebar(), wixBanner(), wixDialog()];
for (const image of images) {
  const buffer = encodeBmp(image.width, image.height, image.canvas.toRgba());
  writeFileSync(join(OUT, image.name), buffer);
  console.log(`installer/${image.name} — ${image.width}×${image.height}, ${Math.round(buffer.length / 1024)} Kio`);
}
console.log('Images de l’installateur écrites dans', OUT);
