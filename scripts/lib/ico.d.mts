/**
 * Types pour l'écriture et la relecture des icônes Windows (`ico.mjs`), testées par
 * `tests/icons.test.ts` et utilisées par `npm run icons` et `npm run check:desktop`.
 */

/** Un cadre tel qu'il est lu dans le fichier. */
export interface IcoEntry {
  /** Largeur réelle en pixels (0 dans le fichier signifie 256). */
  width: number;
  height: number;
  bitCount: number;
  /** Taille du cadre, en octets. */
  bytes: number;
  /** Position du cadre dans le fichier. */
  offset: number;
  format: 'png' | 'dib';
  /** Hauteur déclarée dans l'en-tête DIB (le double de la hauteur réelle), 0 si PNG. */
  dibHeight: number;
}

/** Le contenu d'un `.ico`. */
export interface IcoFile {
  count: number;
  entries: IcoEntry[];
}

/** Un cadre au format DIB (BITMAPINFOHEADER, 32 bits, canal alpha). */
export declare function dibFrame(size: number, rgba: Buffer | Uint8Array): Buffer;

/** Assemble un `.ico` à partir de ses cadres (PNG déjà encodé, ou pixels RGBA). */
export declare function encodeIco(images: Array<{ size: number; png?: Uint8Array; rgba?: Uint8Array }>): Buffer;

/** Relit un `.ico` et vérifie que chaque cadre tient dans le fichier. */
export declare function readIco(buffer: Uint8Array): IcoFile;
