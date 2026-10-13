import { describe, expect, it } from 'vitest';
import { joinUnder, parentOf } from './local-paths.js';

describe('joinUnder', () => {
  it('builds a POSIX path under a POSIX root', () => {
    expect(joinUnder('/home/ada/Téléchargements', 'album/photo 1.jpg')).toBe(
      '/home/ada/Téléchargements/album/photo 1.jpg',
    );
  });

  it('keeps backslashes on a Windows root', () => {
    expect(joinUnder('C:\\Users\\ada\\Downloads', 'album/photo 1.jpg')).toBe(
      'C:\\Users\\ada\\Downloads\\album\\photo 1.jpg',
    );
  });

  it('ignores a trailing separator on the root', () => {
    expect(joinUnder('C:\\Users\\ada\\Downloads\\', 'notes.txt')).toBe('C:\\Users\\ada\\Downloads\\notes.txt');
    expect(joinUnder('/tmp/drop/', 'notes.txt')).toBe('/tmp/drop/notes.txt');
  });

  it('never lets the relative part restart from the root', () => {
    // `safeRelativePath` is what actually rejects this; the join must not turn a
    // leading separator into an absolute path when it slips through.
    expect(joinUnder('C:\\Users\\ada\\Downloads', '\\Windows\\System32\\evil.dll')).toBe(
      'C:\\Users\\ada\\Downloads\\Windows\\System32\\evil.dll',
    );
    expect(joinUnder('/tmp/drop', '/etc/passwd')).toBe('/tmp/drop/etc/passwd');
  });

  it('normalises mixed separators inside the relative path', () => {
    expect(joinUnder('C:\\Users\\ada\\Downloads', 'album\\nested/photo.jpg')).toBe(
      'C:\\Users\\ada\\Downloads\\album\\nested\\photo.jpg',
    );
  });

  it('splits on both separators, so a mixed root still works', () => {
    expect(joinUnder('C:/Users/ada', 'a\\b')).toBe('C:/Users/ada/a/b');
  });

  it('uses the root itself when the relative path is empty', () => {
    expect(joinUnder('C:\\Users\\ada\\Downloads', '')).toBe('C:\\Users\\ada\\Downloads');
  });
});

describe('parentOf', () => {
  it('returns the containing folder', () => {
    expect(parentOf('C:\\Users\\ada\\Downloads\\a\\b.txt')).toBe('C:\\Users\\ada\\Downloads\\a');
    expect(parentOf('/tmp/drop/a/b.txt')).toBe('/tmp/drop/a');
  });

  it('returns nothing when there is no folder to create', () => {
    expect(parentOf('C:\\file.txt')).toBeUndefined();
    expect(parentOf('/file.txt')).toBeUndefined();
  });
});
