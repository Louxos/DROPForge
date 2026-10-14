/**
 * Écriture et relecture d'un fichier `.ico` (l'icône d'un exécutable Windows).
 *
 * L'icône d'un `.exe` n'est pas une image : c'est un **jeu** d'images de tailles
 * différentes, et Windows choisit. Un seul cadre de 256 pixels oblige Windows à le
 * réduire pour le menu Démarrer (16 px), la barre des tâches (24 ou 32 px) et
 * l'Explorateur (48 px) : le logo y devient flou, ce qu'un logo ne doit jamais être.
 * Ce module produit donc un jeu complet, avec les deux encodages que Windows connaît :
 *
 *  - **DIB** (`BITMAPINFOHEADER`, 32 bits, canal alpha) pour les petites tailles : le
 *    plus compatible, et le seul que les versions anciennes de Windows comprennent ;
 *  - **PNG** pour 256 px, comme le veut l'usage depuis Vista (une image PNG dans un
 *    `.ico`, ce que le format autorise explicitement).
 *
 * La relecture (`readIco`) sert à vérifier le fichier livré : une icône mal formée ne
 * casse aucune compilation, elle donne juste un exécutable sans logo — exactement le
 * genre de défaut qui ne se voit que chez la personne qui l'installe.
 */

/** Signature d'un PNG, telle qu'elle apparaît au début d'un cadre encodé en PNG. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Un cadre au format DIB : en-tête `BITMAPINFOHEADER`, pixels en BGRA de bas en haut,
 * puis le masque AND (1 bit par pixel, lignes alignées sur 4 octets).
 *
 * @param {number} size côté du cadre, en pixels
 * @param {Buffer | Uint8Array} rgba pixels non prémultipliés, ligne du haut d'abord
 */
export function dibFrame(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4); // biWidth
  header.writeInt32LE(size * 2, 8); // biHeight : XOR puis AND
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // biCompression : BI_RGB

  const maskRowBytes = Math.ceil(size / 32) * 4;
  const maskSize = maskRowBytes * size;
  header.writeUInt32LE(size * size * 4 + maskSize, 20); // biSizeImage
  header.writeInt32LE(0, 24); // biXPelsPerMeter
  header.writeInt32LE(0, 28); // biYPelsPerMeter
  header.writeUInt32LE(0, 32); // biClrUsed
  header.writeUInt32LE(0, 36); // biClrImportant

  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    // Le DIB se lit de bas en haut ; la source est donnée de haut en bas.
    const source = (size - 1 - y) * size * 4;
    const target = y * size * 4;
    for (let x = 0; x < size; x += 1) {
      const s = source + x * 4;
      const t = target + x * 4;
      pixels[t] = rgba[s + 2]; // bleu
      pixels[t + 1] = rgba[s + 1]; // vert
      pixels[t + 2] = rgba[s]; // rouge
      pixels[t + 3] = rgba[s + 3]; // alpha
    }
  }

  // Masque AND entièrement à zéro : avec un canal alpha, « 0 » veut dire « opaque »,
  // et c'est le canal qui décide. Il doit néanmoins être présent et de la bonne taille,
  // sinon Windows lit les pixels suivants comme un masque.
  const mask = Buffer.alloc(maskSize);
  return Buffer.concat([header, pixels, mask]);
}

/**
 * Assemble un `.ico` à partir de ses cadres.
 *
 * @param {Array<{ size: number, png?: Uint8Array, rgba?: Uint8Array }>} images
 *   chaque cadre fournit soit un PNG déjà encodé, soit des pixels RGBA (encodés en DIB)
 * @returns {Buffer}
 */
export function encodeIco(images) {
  if (images.length === 0) throw new Error('un .ico doit contenir au moins un cadre');

  const frames = images.map((image) => {
    if (image.png) return image.png;
    if (image.rgba) return dibFrame(image.size, image.rgba);
    throw new Error(`le cadre ${image.size} n’a ni pixels ni PNG`);
  });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // réservé
  header.writeUInt16LE(1, 2); // type : icône
  header.writeUInt16LE(images.length, 4);

  let offset = header.length + images.length * 16;
  const entries = images.map((image, index) => {
    const entry = Buffer.alloc(16);
    // Dans un `.ico`, 0 signifie « 256 » : le champ fait un octet.
    entry[0] = image.size >= 256 ? 0 : image.size;
    entry[1] = image.size >= 256 ? 0 : image.size;
    entry[2] = 0; // couleurs de la palette
    entry[3] = 0; // réservé
    entry.writeUInt16LE(1, 4); // plans
    entry.writeUInt16LE(32, 6); // bits par pixel
    entry.writeUInt32LE(frames[index].length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += frames[index].length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...frames]);
}

/**
 * Relit un `.ico` : nombre de cadres, tailles, encodage et bornes de chaque image.
 * Sert aux vérifications (voir `npm run check:desktop`).
 *
 * @param {Uint8Array} buffer
 */
export function readIco(buffer) {
  const data = Buffer.from(buffer);
  if (data.length < 6) throw new Error('.ico tronqué : en-tête absent');
  const type = data.readUInt16LE(2);
  if (data.readUInt16LE(0) !== 0 || type !== 1) throw new Error('.ico invalide : ce n’est pas une icône');
  const count = data.readUInt16LE(4);
  if (count === 0) throw new Error('.ico invalide : aucun cadre');
  if (data.length < 6 + count * 16) throw new Error('.ico tronqué : table des cadres incomplète');

  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const at = 6 + index * 16;
    const width = data[at] === 0 ? 256 : data[at];
    const height = data[at + 1] === 0 ? 256 : data[at + 1];
    const bitCount = data.readUInt16LE(at + 6);
    const bytes = data.readUInt32LE(at + 8);
    const offset = data.readUInt32LE(at + 12);
    if (offset + bytes > data.length) {
      throw new Error(`.ico invalide : le cadre ${width}×${height} dépasse le fichier`);
    }
    const payload = data.subarray(offset, offset + bytes);
    const isPng = payload.subarray(0, 8).equals(PNG_SIGNATURE);
    let headerHeight = 0;
    if (!isPng) {
      if (payload.length < 40) throw new Error(`.ico invalide : cadre ${width}×${height} sans en-tête DIB`);
      const headerSize = payload.readUInt32LE(0);
      if (headerSize !== 40) throw new Error(`.ico invalide : en-tête DIB de ${headerSize} octets`);
      headerHeight = payload.readInt32LE(8) / 2;
    }
    entries.push({
      width,
      height,
      bitCount,
      bytes,
      offset,
      format: isPng ? 'png' : 'dib',
      /** La hauteur déclarée dans l'en-tête DIB (le double de la hauteur réelle). */
      dibHeight: headerHeight,
    });
  }

  return { count, entries };
}
