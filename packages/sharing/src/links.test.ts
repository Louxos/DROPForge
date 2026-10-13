import { describe, expect, it } from 'vitest';
import { DropForgeError, ERROR_CODES, type SourceFile } from '@dropforge/app-core';
import { systemClock } from '@dropforge/protocol';
import {
  SHARE_MAX_BYTES,
  SHARE_MAX_FILES,
  createHostedShare,
  downloadHostedShare,
  readShareUrl,
  type ShareBackend,
  type ShareFileEntry,
  type ShareStatus,
  type SharePayload,
} from './links.js';

/** In-memory share server, with the same rules the real one must enforce. */
class MemoryShareBackend implements ShareBackend {
  readonly objects = new Map<string, Map<string, Uint8Array>>();
  readonly shares = new Map<string, { expiresAt: number; maxDownloads: number; downloads: number; revoked: boolean; ready: boolean }>();
  /** Every byte the server was ever asked to store, for the "ciphertext only" test. */
  readonly receivedBytes: Uint8Array[] = [];
  failNextUpload = false;

  async createShare(request: { id: string; expiresAt: number; maxDownloads: number }): Promise<{ id: string }> {
    this.shares.set(request.id, {
      expiresAt: request.expiresAt,
      maxDownloads: request.maxDownloads,
      downloads: 0,
      revoked: false,
      ready: false,
    });
    this.objects.set(request.id, new Map());
    return { id: request.id };
  }

  async uploadObject(shareId: string, objectId: string, data: Uint8Array): Promise<void> {
    if (this.failNextUpload) {
      this.failNextUpload = false;
      throw new Error('quota exceeded');
    }
    this.receivedBytes.push(Uint8Array.from(data));
    this.objects.get(shareId)?.set(objectId, Uint8Array.from(data));
  }

  async finalizeShare(shareId: string): Promise<void> {
    const share = this.shares.get(shareId);
    if (share) share.ready = true;
  }

  async status(shareId: string): Promise<ShareStatus> {
    const share = this.shares.get(shareId);
    if (!share) return { exists: false, revoked: false, expiresAt: 0, bytesStored: 0, downloads: 0 };
    const bytesStored = [...(this.objects.get(shareId)?.values() ?? [])].reduce((sum, o) => sum + o.length, 0);
    return {
      exists: true,
      revoked: share.revoked,
      expiresAt: share.expiresAt,
      bytesStored,
      downloads: share.downloads,
    };
  }

  async revoke(shareId: string): Promise<void> {
    const share = this.shares.get(shareId);
    if (share) share.revoked = true;
  }

  async downloadObject(shareId: string, objectId: string): Promise<Uint8Array | undefined> {
    const share = this.shares.get(shareId);
    if (!share || !share.ready || share.revoked || share.expiresAt <= Date.now()) return undefined;
    share.downloads += 1;
    return this.objects.get(shareId)?.get(objectId);
  }

  async sweepExpired(now: number): Promise<string[]> {
    const removed: string[] = [];
    for (const [id, share] of this.shares) {
      if (share.expiresAt <= now) {
        this.shares.delete(id);
        this.objects.delete(id);
        removed.push(id);
      }
    }
    return removed;
  }
}

function file(path: string, data: Uint8Array, kind: 'file' | 'directory' = 'file'): SourceFile {
  return {
    path,
    kind,
    size: kind === 'directory' ? 0 : data.length,
    lastModified: 1,
    read: async (offset: number, length: number) => data.subarray(offset, offset + length),
    revalidate: async () => 'unchanged' as const,
  };
}

function bytes(size: number, seed = 1): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) out[i] = (i * 31 + seed) % 251;
  return out;
}

const ORIGIN = 'https://share.example.com';

describe('hosted shares', () => {
  it('uploads ciphertext only, and the stored bytes never contain the plaintext', async () => {
    const backend = new MemoryShareBackend();
    const payload = bytes(64 * 1024, 7);
    const created = await createHostedShare({
      backend,
      files: [file('holiday.jpg', payload)],
      origin: ORIGIN,
      clock: systemClock,
    });

    expect(backend.receivedBytes.length).toBe(1);
    const stored = backend.receivedBytes[0]!;
    // GCM keeps the length (plus tag) and never stores plaintext.
    expect(stored.length).toBeGreaterThan(payload.length);
    expect(contains(stored, payload)).toBe(false);
    // Not even the file name is uploaded: only an opaque object id.
    expect(contains(stored, new TextEncoder().encode('holiday.jpg'))).toBe(false);
    expect(created.url).toContain('#df=share');
    // Everything secret is in the *fragment*: browsers never send it in the HTTP
    // request that loads the share page, so the server cannot learn the key even if
    // it wanted to. The path and the query string carry nothing at all.
    const parsed = new URL(created.url);
    expect(parsed.pathname).toBe('/');
    expect(parsed.search).toBe('');
    const fromUrl = readShareUrl(created.url, systemClock);
    expect(fromUrl.key).toHaveLength(43); // base64url without padding = 32 bytes
    // What the server sees (origin + path) carries no key at all: the payload only
    // exists in the fragment.
    expect(() => readShareUrl(`${parsed.origin}${parsed.pathname}`, systemClock)).toThrowError(/incomplete/);
  });

  it('round-trips a share through a link, file by file', async () => {
    const backend = new MemoryShareBackend();
    const a = bytes(40 * 1024, 3);
    const b = bytes(1024, 9);
    const created = await createHostedShare({
      backend,
      files: [file('reports/q1.pdf', a), file('note.txt', b)],
      origin: ORIGIN,
      clock: systemClock,
    });

    const payload = readShareUrl(created.url, systemClock);
    expect(payload.files.map((entry) => entry.name)).toEqual(['reports/q1.pdf', 'note.txt']);
    expect(payload.expiresAt).toBeGreaterThan(systemClock.now());

    const written = new Map<string, Uint8Array>();
    const result = await downloadHostedShare({
      backend,
      payload,
      clock: systemClock,
      write: async (entry, data) => void written.set(entry.name, data),
    });

    expect(result.files.map((f) => f.name)).toEqual(['reports/q1.pdf', 'note.txt']);
    expect(written.get('note.txt')).toEqual(b);
    expect(written.get('reports/q1.pdf')?.length).toBe(a.length);
  });

  it('refuses a share whose ciphertext was altered on the server', async () => {
    const backend = new MemoryShareBackend();
    const created = await createHostedShare({
      backend,
      files: [file('secret.bin', bytes(4096, 5))],
      origin: ORIGIN,
      clock: systemClock,
    });
    // The server (or an attacker with storage access) flips one byte.
    for (const objects of backend.objects.values()) {
      for (const [id, data] of objects) {
        const tampered = Uint8Array.from(data);
        const last = tampered.length - 1;
        tampered[last] = (tampered[last] as number) ^ 0x01;
        objects.set(id, tampered);
      }
    }
    const payload = readShareUrl(created.url, systemClock);
    await expect(
      downloadHostedShare({ backend, payload, clock: systemClock, write: async () => {} }),
    ).rejects.toMatchObject({ code: ERROR_CODES.INTEGRITY_FAILED });
  });

  it('refuses a truncated file instead of writing half of it', async () => {
    const backend = new MemoryShareBackend();
    const created = await createHostedShare({
      backend,
      files: [file('big.bin', bytes(3 * 1024 * 1024, 2))],
      origin: ORIGIN,
      clock: systemClock,
    });
    for (const objects of backend.objects.values()) {
      for (const [id, data] of objects) objects.set(id, data.subarray(0, data.length - 10));
    }
    const payload = readShareUrl(created.url, systemClock);
    let wrote = false;
    await expect(
      downloadHostedShare({
        backend,
        payload,
        clock: systemClock,
        write: async () => {
          wrote = true;
        },
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.INTEGRITY_FAILED });
    expect(wrote).toBe(false);
  });

  it('stops a revoked share even when the receiver kept the link', async () => {
    const backend = new MemoryShareBackend();
    const created = await createHostedShare({
      backend,
      files: [file('private.txt', bytes(100, 4))],
      origin: ORIGIN,
      clock: systemClock,
    });
    const payload = readShareUrl(created.url, systemClock);
    await created.revoke();

    await expect(
      downloadHostedShare({ backend, payload, clock: systemClock, write: async () => {} }),
    ).rejects.toMatchObject({ code: ERROR_CODES.LINK_REVOKED });
    expect((await backend.status(created.id)).revoked).toBe(true);
  });

  it('refuses an expired link, and the server deletes the objects', async () => {
    const backend = new MemoryShareBackend();
    let now = 1_000_000;
    const clock = { ...systemClock, now: () => now };
    const created = await createHostedShare({
      backend,
      files: [file('old.txt', bytes(10, 1))],
      origin: ORIGIN,
      clock,
      lifetimeMs: 10 * 60 * 1_000,
    });
    const payload = readShareUrl(created.url, clock);

    now += 11 * 60 * 1_000;
    expect(() => readShareUrl(created.url, clock)).toThrowError(/expired/);
    await expect(
      downloadHostedShare({ backend, payload, clock, write: async () => {} }),
    ).rejects.toMatchObject({ code: ERROR_CODES.LINK_EXPIRED });

    const removed = await backend.sweepExpired(now);
    expect(removed).toEqual([created.id]);
    expect((await backend.status(created.id)).exists).toBe(false);
  });

  it('enforces the download quota and the local limits before uploading', async () => {
    const backend = new MemoryShareBackend();
    const clock = systemClock;
    const created = await createHostedShare({
      backend,
      files: [file('a.txt', bytes(10, 1))],
      origin: ORIGIN,
      clock,
      maxDownloads: 1,
    });
    const payload: SharePayload = readShareUrl(created.url, clock);
    const write = async (): Promise<void> => {};
    await downloadHostedShare({ backend, payload, clock, write });
    await expect(downloadHostedShare({ backend, payload, clock, write })).rejects.toMatchObject({
      code: ERROR_CODES.LINK_QUOTA_REACHED,
    });

    const many = Array.from({ length: SHARE_MAX_FILES + 1 }, (_, index) => file(`f${index}.bin`, bytes(1, index)));
    await expect(
      createHostedShare({ backend, files: many, origin: ORIGIN, clock }),
    ).rejects.toMatchObject({ code: ERROR_CODES.TOO_MANY_FILES });

    const big: SourceFile = {
      ...file('huge.bin', bytes(1, 1)),
      size: SHARE_MAX_BYTES + 1,
    };
    await expect(createHostedShare({ backend, files: [big], origin: ORIGIN, clock })).rejects.toMatchObject({
      code: ERROR_CODES.TOO_LARGE,
    });
    // Nothing was uploaded for the refused shares.
    expect(backend.receivedBytes).toHaveLength(1);
  });

  it('refuses a folder in a hosted share, with an explanation instead of a half upload', async () => {
    const backend = new MemoryShareBackend();
    await expect(
      createHostedShare({
        backend,
        files: [file('album', new Uint8Array(0), 'directory')],
        origin: ORIGIN,
        clock: systemClock,
      }),
    ).rejects.toBeInstanceOf(DropForgeError);
    expect(backend.receivedBytes).toHaveLength(0);
  });

  it('rejects a damaged or foreign link without contacting anything', () => {
    expect(() => readShareUrl('https://x.example/#df=share&v=1&s=%%%', systemClock)).toThrowError(/damaged|incomplete/);
    expect(() => readShareUrl('https://x.example/#df=other&s=abc', systemClock)).toThrowError(/not a file-sharing link/);
    expect(() => readShareUrl('not a url', systemClock)).toThrowError(/valid DropForge link/);
  });
});

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    for (let i = 0; i < needle.length; i += 1) {
      if (haystack[start + i] !== needle[i]) continue outer;
    }
    return true;
  }
  return false;
}

void (undefined as unknown as ShareFileEntry);
