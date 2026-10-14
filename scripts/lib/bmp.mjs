/**
 * Écriture d'un BMP 24 bits, sans dépendance.
 *
 * NSIS et WiX n'acceptent que du BMP pour leurs images d'interface (en-tête, bandeau
 * et image latérale des pages d'installation). Un BMP 24 bits non compressé, écrit à
 * la main, est le format le plus sûr : aucune bibliothèque à installer, aucun
 * encodage exotique que les outils d'empaquetage pourraient refuser.
 *
 * Le fichier produit est un BMP « classique » : en-tête de 14 octets, en-tête
 * BITMAPINFOHEADER de 40 octets, lignes stockées du bas vers le haut, chaque ligne
 * complétée à un multiple de 4 octets, en BGR.
 */

/** Taille d'une ligne BMP : 3 octets par pixel, complétée à 4 octets. */
function rowBytes(width) {
  return Math.ceil((width * 3) / 4) * 4;
}

/**
 * Encode un raster RGBA (largeur × hauteur × 4 octets) en BMP 24 bits.
 *
 * @param {number} width
 * @param {number} height
 * @param {Buffer} rgba
 * @returns {Buffer}
 */
export function encodeBmp(width, height, rgba) {
  if (rgba.length < width * height * 4) {
    throw new Error(`raster trop court : ${rgba.length} octets pour ${width}×${height}`);
  }

  const stride = rowBytes(width);
  const pixelBytes = stride * height;
  const offset = 14 + 40;
  const file = Buffer.alloc(offset + pixelBytes);

  // En-tête de fichier.
  file.write('BM', 0, 'ascii');
  file.writeUInt32LE(file.length, 2);
  file.writeUInt32LE(0, 6);
  file.writeUInt32LE(offset, 10);

  // BITMAPINFOHEADER.
  file.writeUInt32LE(40, 14);
  file.writeInt32LE(width, 18);
  file.writeInt32LE(height, 22); // hauteur positive : lignes du bas vers le haut
  file.writeUInt16LE(1, 26); // plans
  file.writeUInt16LE(24, 28); // bits par pixel
  file.writeUInt32LE(0, 30); // BI_RGB, aucune compression
  file.writeUInt32LE(pixelBytes, 34);
  file.writeInt32LE(2835, 38); // ~72 ppp : sans importance, mais explicite
  file.writeInt32LE(2835, 42);
  file.writeUInt32LE(0, 46); // couleurs utilisées
  file.writeUInt32LE(0, 50); // couleurs importantes

  for (let y = 0; y < height; y += 1) {
    const source = (height - 1 - y) * width * 4;
    const target = offset + y * stride;
    for (let x = 0; x < width; x += 1) {
      const from = source + x * 4;
      const to = target + x * 3;
      file[to] = rgba[from + 2]; // bleu
      file[to + 1] = rgba[from + 1]; // vert
      file[to + 2] = rgba[from]; // rouge
    }
  }

  return file;
}

/** Lit les dimensions et la profondeur d'un BMP (sert aux vérifications). */
export function readBmpHeader(buffer) {
  if (buffer.length < 54 || buffer.toString('ascii', 0, 2) !== 'BM') {
    throw new Error("ce fichier n'est pas un BMP");
  }
  const headerSize = buffer.readUInt32LE(14);
  if (headerSize !== 40) throw new Error(`en-tête BMP inattendu : ${headerSize} octets`);
  return {
    width: buffer.readInt32LE(18),
    height: buffer.readInt32LE(22),
    bitsPerPixel: buffer.readUInt16LE(28),
    compression: buffer.readUInt32LE(30),
    byteLength: buffer.length,
  };
}
