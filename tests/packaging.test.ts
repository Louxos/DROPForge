/**
 * The release archives are produced by a small ZIP writer of our own (`zlib` does
 * the compression). These tests pin the parts that decide whether the archive is
 * valid: the CRC, the stored/deflated choice, the structure, and the refusal to
 * produce something it cannot represent.
 *
 * The definitive check remains an external tool — `unzip -t` is run by the CI —
 * which is exactly why the writer has to be verifiable independently.
 */
import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { createZip, crc32 } from '../scripts/lib/zip.mjs';
import { readZip } from '../scripts/lib/unzip.mjs';

interface Entry {
  path: string;
  data: Uint8Array | string;
}

const bytes = (value: Uint8Array): Buffer => Buffer.from(value);

/** Reads the central directory back, independently of the writer's code path. */
function readDirectory(archive: Uint8Array): { count: number; names: string[]; offsets: number[] } {
  const buffer = bytes(archive);
  const endIndex = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(endIndex).toBeGreaterThan(0);
  const count = buffer.readUInt16LE(endIndex + 10);
  const centralSize = buffer.readUInt32LE(endIndex + 12);
  const centralOffset = buffer.readUInt32LE(endIndex + 16);
  expect(centralOffset + centralSize).toBe(endIndex);

  const names: string[] = [];
  const offsets: number[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    expect(buffer.readUInt32LE(cursor)).toBe(0x02014b50);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    names.push(buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'));
    offsets.push(buffer.readUInt32LE(cursor + 42));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return { count, names, offsets };
}

/** Decodes one entry straight from its local header, the way an unzip tool would. */
function readEntry(archive: Uint8Array, offset: number): { name: string; data: Buffer; crc: number } {
  const buffer = bytes(archive);
  expect(buffer.readUInt32LE(offset)).toBe(0x04034b50);
  const method = buffer.readUInt16LE(offset + 8);
  const crc = buffer.readUInt32LE(offset + 14);
  const compressedSize = buffer.readUInt32LE(offset + 18);
  const uncompressedSize = buffer.readUInt32LE(offset + 22);
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
  const start = offset + 30 + nameLength + extraLength;
  const body = buffer.subarray(start, start + compressedSize);
  const data = method === 0 ? Buffer.from(body) : inflateRawSync(body);
  expect(data.length).toBe(uncompressedSize);
  return { name, data, crc };
}

const make = (entries: Entry[]): Uint8Array => createZip(entries);

describe('crc32', () => {
  it('matches the reference value every ZIP implementation uses', () => {
    // The check value from the CRC-32 specification: "123456789" → 0xCBF43926.
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('createZip', () => {
  it('writes a valid archive with a central directory that points where it says', () => {
    const archive = make([
      { path: 'index.html', data: '<!doctype html>' },
      { path: 'assets/app.js', data: 'console.log(1)' },
    ]);
    expect(Buffer.from(archive.subarray(0, 4))).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

    const directory = readDirectory(archive);
    expect(directory.count).toBe(2);
    expect(directory.names).toEqual(['index.html', 'assets/app.js']);
    for (const offset of directory.offsets) {
      const entry = readEntry(archive, offset);
      expect(directory.names).toContain(entry.name);
      // The CRC stored in the header is the CRC of the real content.
      expect(entry.crc).toBe(crc32(entry.data));
    }
  });

  it('round-trips text, binary and empty files byte for byte', () => {
    const binary = new Uint8Array(4096).map((_, index) => (index * 37) % 251);
    const archive = make([
      { path: 'texte.txt', data: 'accents : éàü — ok' },
      { path: 'binaire.bin', data: binary },
      { path: 'vide.txt', data: '' },
    ]);
    const directory = readDirectory(archive);
    const content = new Map(directory.names.map((name, index) => [name, readEntry(archive, directory.offsets[index]!).data]));

    expect(content.get('texte.txt')?.toString('utf8')).toBe('accents : éàü — ok');
    expect(content.get('binaire.bin')).toEqual(Buffer.from(binary));
    expect(content.get('vide.txt')?.length).toBe(0);
  });

  it('stores incompressible data instead of inflating it', () => {
    // Random bytes cannot be deflated; storing them keeps the archive honest.
    const random = new Uint8Array(2048);
    for (let index = 0; index < random.length; index += 1) random[index] = Math.floor(Math.random() * 256);
    const archive = make([{ path: 'aleatoire.bin', data: random }]);
    const [offset] = readDirectory(archive).offsets;
    expect(bytes(archive).readUInt16LE(offset! + 8)).toBe(0);
  });

  it('actually compresses what can be compressed', () => {
    const repetitive = new Uint8Array(64 * 1024).fill(0x41);
    const archive = make([{ path: 'repetitif.bin', data: repetitive }]);
    expect(archive.length).toBeLessThan(repetitive.length / 10);
    const [offset] = readDirectory(archive).offsets;
    expect(bytes(archive).readUInt16LE(offset! + 8)).toBe(8);
  });

  it('reads back what it wrote, checksums verified', () => {
    const archive = make([
      { path: 'index.html', data: '<!doctype html><title>x</title>' },
      { path: 'assets/app.js', data: 'void 0;' },
      { path: 'vide.bin', data: new Uint8Array(0) },
    ]);
    const files = readZip(archive);
    expect([...files.keys()]).toEqual(['index.html', 'assets/app.js', 'vide.bin']);
    expect(files.get('index.html')?.toString('utf8')).toBe('<!doctype html><title>x</title>');
    expect(files.get('vide.bin')?.length).toBe(0);
  });

  it('rejects a corrupted entry instead of returning silent garbage', () => {
    const archive = make([{ path: 'a.txt', data: 'contenu' }]);
    // Flip one byte of the deflated body: the CRC no longer matches.
    const at = bytes(archive).indexOf(Buffer.from('contenu'));
    const body = at >= 0 ? at : 40;
    archive[body] = archive[body]! ^ 0xff;
    expect(() => readZip(archive)).toThrow(/checksum mismatch|expected/);
  });

  it('rejects something that is not an archive at all', () => {
    expect(() => readZip(new TextEncoder().encode('pas un zip'))).toThrow(/end-of-central-directory/);
  });

  it('normalises separators and refuses an entry without a path', () => {
    const archive = make([{ path: '\\dossier\\fichier.txt', data: 'x' }]);
    expect(readDirectory(archive).names).toEqual(['dossier/fichier.txt']);
    expect(() => make([{ path: '', data: 'x' }])).toThrow(/needs a path/);
  });
});
