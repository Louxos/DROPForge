/**
 * Structural checks on the QR matrix.
 *
 * A decoder is not available offline, so correctness of the *encoding* is delegated
 * to `qrcode`; what is checked here is that we read the matrix out of it correctly
 * and that it really has the shape of a QR code.
 */
import { describe, expect, it } from 'vitest';
import { qrMatrix } from './qr.js';

const dark = (row: boolean[], x: number): boolean => row[x] === true;

describe('qrMatrix', () => {
  const link = 'https://dropforge.example/#c=ABCD-2345';

  it('builds a square matrix whose size is a legal QR version', () => {
    const matrix = qrMatrix(link);
    expect(matrix).toBeDefined();
    // Versions 1..40 give sizes 21, 25, … 177: always 4n+1 and never below 21.
    expect(matrix!.size).toBeGreaterThanOrEqual(21);
    expect(matrix!.size % 4).toBe(1);
    expect(matrix!.dark).toHaveLength(matrix!.size);
    expect(matrix!.dark.every((row) => row.length === matrix!.size)).toBe(true);
  });

  it('draws the three finder patterns a scanner looks for', () => {
    const { size, dark: rows } = qrMatrix(link)!;
    const finder = (originRow: number, originColumn: number): boolean => {
      for (let r = 0; r < 7; r += 1) {
        for (let c = 0; c < 7; c += 1) {
          const expected = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          if (rows[originRow + r]![originColumn + c] !== expected) return false;
        }
      }
      return true;
    };
    expect(finder(0, 0)).toBe(true);
    expect(finder(0, size - 7)).toBe(true);
    expect(finder(size - 7, 0)).toBe(true);
  });

  it('alternates the timing pattern between the finders', () => {
    const { dark: rows } = qrMatrix(link)!;
    for (let index = 8; index < 13; index += 1) {
      expect(rows[6]![index]).toBe(index % 2 === 0);
      expect(rows[index]![6]).toBe(index % 2 === 0);
    }
  });

  it('is deterministic and content dependent', () => {
    expect(qrMatrix(link)!.dark).toEqual(qrMatrix(link)!.dark);
    expect(qrMatrix(link)!.dark).not.toEqual(qrMatrix(`${link}x`)!.dark);
  });

  it('refuses an empty string instead of drawing a meaningless code', () => {
    expect(qrMatrix('')).toBeUndefined();
  });

  it('encodes a long link, and gives up cleanly beyond what a QR code can hold', () => {
    const long = `https://dropforge.example/#c=${'A'.repeat(700)}`;
    const matrix = qrMatrix(long);
    expect(matrix).toBeDefined();
    expect(matrix!.size).toBeGreaterThanOrEqual(21);
    // 3000 characters do not fit: `undefined` means "show the code and the link",
    // never a half-drawn QR code.
    expect(qrMatrix('x'.repeat(3000))).toBeUndefined();
  });

  it('accepts non-ASCII text, which is what a pairing link may contain', () => {
    const matrix = qrMatrix('https://exemple.fr/#c=ÉLÉ-2024');
    expect(matrix).toBeDefined();
    expect(dark(matrix!.dark[0]!, 0)).toBe(true);
  });
});
