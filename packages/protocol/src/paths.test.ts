import { describe, expect, it } from 'vitest';
import { UnsafePathError, isSafeRelativePath, redactPath, safeRelativePath, sanitiseRelativePath, uniqueName } from './paths.js';

describe('path sanitisation (peer input is untrusted)', () => {
  it('accepts ordinary relative paths and normalises separators', () => {
    expect(sanitiseRelativePath('photos/2024/img.jpg')).toEqual(['photos', '2024', 'img.jpg']);
    expect(sanitiseRelativePath('photos\\2024\\img.jpg')).toEqual(['photos', '2024', 'img.jpg']);
    expect(sanitiseRelativePath('./a//b/./c.txt')).toEqual(['a', 'b', 'c.txt']);
    expect(safeRelativePath('a/b')).toBe('a/b');
  });

  it.each([
    ['../secret', 'parent traversal'],
    ['a/../../b', 'parent traversal'],
    ['..', 'parent traversal'],
    ['/etc/passwd', 'absolute path'],
    ['\\\\server\\share', 'UNC or URL path'],
    ['C:\\Windows\\System32', 'drive qualifier'],
    ['https://example.com/file', 'UNC or URL path'],
    ['a/b\u0000c', 'control characters'],
    ['CON', 'reserved device name'],
    ['nul.txt', 'reserved device name'],
    ['LPT1.log', 'reserved device name'],
    ['folder/COM3.dat', 'reserved device name'],
    ['', 'empty'],
  ])('rejects %j', (input) => {
    expect(() => sanitiseRelativePath(input)).toThrow(UnsafePathError);
    expect(isSafeRelativePath(input)).toBe(false);
  });

  it('rejects names whose Windows-normalised form is a reserved device', () => {
    // "evil.exe." resolves to "evil.exe" on Windows; trailing dots/spaces are stripped.
    expect(sanitiseRelativePath('evil.exe.')).toEqual(['evil.exe']);
    expect(() => sanitiseRelativePath('aux.')).toThrow(UnsafePathError);
  });

  it('rejects overlong paths and absurd nesting', () => {
    expect(() => sanitiseRelativePath('x'.repeat(2000))).toThrow(UnsafePathError);
    expect(() => sanitiseRelativePath(Array.from({ length: 80 }, () => 'd').join('/'))).toThrow(UnsafePathError);
  });
});

describe('uniqueName', () => {
  it('keeps the extension and finds a free name', () => {
    const taken = new Set(['report.pdf', 'report (1).pdf']);
    expect(uniqueName('report.pdf', (candidate) => taken.has(candidate))).toBe('report (2).pdf');
  });

  it('handles files without extension and nested directories', () => {
    const taken = new Set(['dir/README']);
    expect(uniqueName('dir/README', (candidate) => taken.has(candidate))).toBe('dir/README (1)');
  });

  it('returns the desired path when it is free', () => {
    expect(uniqueName('free.txt', () => false)).toBe('free.txt');
  });

  it('falls back to a timestamped name when the space is exhausted', () => {
    const name = uniqueName('a.txt', () => true, 3);
    expect(name).toMatch(/^a-[0-9a-z]+\.txt$/);
  });
});

describe('redactPath', () => {
  it('never reveals the file name', () => {
    expect(redactPath('secret/clients/contract.pdf')).toBe('….pdf');
    expect(redactPath('secret/clients/contract')).toBe('…');
  });
});
