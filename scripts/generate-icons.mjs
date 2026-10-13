/**
 * Generates the DropForge icons from code, so the repository carries no opaque
 * binary asset that nobody can regenerate.
 *
 *   node scripts/generate-icons.mjs
 *
 * The mark is a "drop" (a downward wedge) over a violet-to-blue gradient, which is
 * the same symbol as the in-app brand block. It is drawn with plain pixel maths and
 * encoded as PNG with zlib, so the only dependency is Node itself.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public', 'icons');
/** Where the Windows shell looks for its icons (Tauri bundle configuration). */
const DESKTOP_OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'desktop', 'src-tauri', 'icons');

const VIOLET = [124, 92, 255];
const BLUE = [56, 156, 255];
const DARK = [11, 11, 15];

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

/** Encodes an RGBA raster (width*height*4) as a PNG. */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((value, index) => Math.round(value + (b[index] - value) * t));
const over = (dst, src, alpha) => dst.map((value, index) => Math.round(value * (1 - alpha) + src[index] * alpha));

/**
 * Draws the icon.
 * @param {number} size
 * @param {{maskable?: boolean}} [options]
 */
function draw(size, options = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = options.maskable ? size * 0.5 : size * 0.22;
  // A maskable icon must keep its content inside the safe zone (the middle 80%).
  const scale = options.maskable ? 0.62 : 0.78;
  const center = size / 2;
  const half = (size * scale) / 2;
  const top = center - half;
  const bottom = center + half;
  const stroke = Math.max(2, size * 0.085);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      // Rounded-square (or full circle when maskable) background alpha.
      const background = cornerAlpha(x + 0.5, y + 0.5, size, radius);
      const gradient = mix(VIOLET, BLUE, y / (size - 1));
      let pixel = DARK.slice();

      // The wedge: a downward triangle whose tip sits at `bottom`.
      const wedgeTop = top + (bottom - top) * 0.08;
      const wedgeWidth = half * 1.02;
      const wedgeHeight = (bottom - top) * 0.5;
      const dy = y + 0.5 - wedgeTop;
      if (dy >= 0 && dy <= wedgeHeight) {
        const allowed = wedgeWidth * (1 - dy / wedgeHeight);
        if (Math.abs(x + 0.5 - center) <= allowed) pixel = over(pixel, gradient, 1);
      }

      // The stem under the wedge, with a gap so the two shapes read as a "drop".
      const stemTop = wedgeTop + wedgeHeight + (bottom - top) * 0.06;
      if (y + 0.5 >= stemTop && y + 0.5 <= bottom && Math.abs(x + 0.5 - center) <= stroke / 2) {
        pixel = over(pixel, gradient, 1);
      }

      rgba[offset] = pixel[0];
      rgba[offset + 1] = pixel[1];
      rgba[offset + 2] = pixel[2];
      rgba[offset + 3] = Math.round(background * 255);
    }
  }
  return encodePng(size, size, rgba);
}

/** Anti-aliased rounded-square coverage. */
function cornerAlpha(x, y, size, radius) {
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  const distance = Math.hypot(x - cx, y - cy);
  if (distance <= radius - 0.5) return 1;
  if (distance >= radius + 0.5) return 0;
  return radius + 0.5 - distance;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="DropForge">
  <defs>
    <linearGradient id="df" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7c5cff" />
      <stop offset="1" stop-color="#389cff" />
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="#0b0b0f" />
  <path d="M256 112 L368 272 L144 272 Z" fill="url(#df)" />
  <rect x="238" y="312" width="36" height="88" rx="10" fill="url(#df)" />
</svg>
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'icon.svg'), svg);
writeFileSync(join(OUT, 'icon-192.png'), draw(192));
writeFileSync(join(OUT, 'icon-512.png'), draw(512));
writeFileSync(join(OUT, 'icon-maskable-512.png'), draw(512, { maskable: true }));
writeFileSync(join(OUT, 'apple-touch-icon.png'), draw(180));
console.log('Icons written to', OUT);

/* ------------------------------------------------------------------ *
 * Icônes de l'application Windows (Tauri)
 * ------------------------------------------------------------------ */

/** Un .ico valide, avec une image PNG encapsulée (accepté depuis Windows Vista). */
function encodeIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // réservé
  header.writeUInt16LE(1, 2); // type : icône
  header.writeUInt16LE(1, 4); // nombre d'images
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; // 0 signifie 256
  entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0; // palette
  entry[3] = 0; // réservé
  entry.writeUInt16LE(1, 4); // plans
  entry.writeUInt16LE(32, 6); // bits par pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);
  return Buffer.concat([header, entry, png]);
}

mkdirSync(DESKTOP_OUT, { recursive: true });
const png256 = draw(256);
writeFileSync(join(DESKTOP_OUT, 'icon.png'), png256);
writeFileSync(join(DESKTOP_OUT, '32x32.png'), draw(32));
writeFileSync(join(DESKTOP_OUT, '128x128.png'), draw(128));
writeFileSync(join(DESKTOP_OUT, '128x128@2x.png'), draw(256));
writeFileSync(join(DESKTOP_OUT, 'icon.ico'), encodeIco(png256, 256));
console.log('Icons written to', DESKTOP_OUT);
