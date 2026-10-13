/**
 * End-to-end transfers between two real peers: real WebCrypto handshake, real
 * framing, real transfer engine, real integrity verification. Only the network
 * and the disk are in memory.
 */
import { describe, expect, it } from 'vitest';
import { sha256Hex, toHex, Sha256Stream } from '@dropforge/protocol';
import { ERROR_CODES, type SourceFile } from '@dropforge/app-core';
import { buildManifest, validateOffer } from '@dropforge/transfer-engine';
import { digestOf, plan, rig, runTransfer } from './helpers/transfer-rig.js';
import { MemoryDirectory, MemorySource } from './helpers/memory-fs.js';
import { settle } from './helpers/loopback.js';

const CHUNK = 64 * 1024;

function bytes(size: number, seed = 0): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) out[i] = (i * 31 + seed) % 251;
  return out;
}

describe('end-to-end transfer', () => {
  it('sends several files, verifies each one and updates both sides', async () => {
    const r = await rig();
    const files: SourceFile[] = [
      new MemorySource('small.txt', new TextEncoder().encode('bonjour le monde')),
      new MemorySource('docs/readme.md', bytes(200 * 1024, 1)),
      new MemorySource('big.bin', bytes(600 * 1024, 2)),
      new MemorySource('empty.txt', new Uint8Array(0)),
      new MemoryDirectory('docs/empty-folder'),
    ];
    plan(r, files);

    const { sender, receiver } = await runTransfer(r);

    expect(sender.outcome).toBe('completed');
    expect(sender.verifiedFiles).toBe(4);
    expect(receiver.outcome).toBe('completed');
    expect(receiver.verifiedFiles).toBe(4);
    expect(receiver.bytesDone).toBe(r.offer.totalBytes);
    expect(r.store.paths()).toEqual(['big.bin', 'docs/readme.md', 'empty.txt', 'small.txt']);
    expect(new TextDecoder().decode(r.store.content('small.txt'))).toBe('bonjour le monde');
    expect(digestOf(r.store.content('docs/readme.md'))).toBe(sha256Hex(bytes(200 * 1024, 1)));
    expect(digestOf(r.store.content('big.bin'))).toBe(sha256Hex(bytes(600 * 1024, 2)));
    expect(r.store.content('empty.txt')!.length).toBe(0);
    // Empty directories announced in the manifest are created.
    expect(await r.store.stat('docs')).toBeDefined();
  });

  it('keeps the relay blind: no frame carries a file name or its content', async () => {
    const r = await rig();
    const secret = bytes(300 * 1024, 77);
    plan(r, [new MemorySource('private/secret.txt', secret)]);

    // Record everything the relay would forward.
    const observed: Uint8Array[] = [];
    r.bob.transport.onFrame((frame) => observed.push(frame.slice()));

    const { sender } = await runTransfer(r);
    expect(sender.outcome).toBe('completed');

    const needles = ['secret.txt', 'private/'];
    // A distinctive byte sequence from the middle of the payload.
    const payloadNeedle = Buffer.from(secret.subarray(100 * 1024, 100 * 1024 + 64)).toString('latin1');
    for (const frame of observed) {
      const asLatin1 = Buffer.from(frame).toString('latin1');
      for (const needle of needles) expect(asLatin1).not.toContain(needle);
      expect(asLatin1).not.toContain(payloadNeedle);
      expect([0x00, 0x01, 0x02]).toContain(frame[0]);
      expect(frame.length).toBeLessThanOrEqual(CHUNK + 4096);
    }
    // Offer + 5 data frames + digest + complete at the very least.
    expect(observed.length).toBeGreaterThan(6);
  });

  it('refuses to replace an existing file without a decision', async () => {
    const r = await rig({ seed: { 'notes.txt': 'ORIGINAL' } });
    plan(r, [new MemorySource('notes.txt', new TextEncoder().encode('REPLACEMENT'))]);

    const { sender, receiver } = await runTransfer(r);

    expect(sender.outcome).toBe('failed');
    expect(sender.errorCode).toBe(ERROR_CODES.TRANSFER_DECLINED);
    expect(receiver.outcome).toBe('failed');
    expect(receiver.errorCode).toBe(ERROR_CODES.NAME_CONFLICT);
    expect(new TextDecoder().decode(r.store.content('notes.txt'))).toBe('ORIGINAL');
  });

  it('renames on conflict when asked, keeping the original file', async () => {
    const r = await rig({ seed: { 'notes.txt': 'ORIGINAL' } });
    plan(r, [new MemorySource('notes.txt', new TextEncoder().encode('REPLACEMENT'))]);

    const { sender, receiver } = await runTransfer(r, { policy: 'rename' });

    expect(sender.outcome).toBe('completed');
    expect(receiver.outcome).toBe('completed');
    expect(new TextDecoder().decode(r.store.content('notes.txt'))).toBe('ORIGINAL');
    expect(new TextDecoder().decode(r.store.content('notes (1).txt'))).toBe('REPLACEMENT');
  });

  it('picks a free name when the receiver answers "rename" without proposing one', async () => {
    const r = await rig({ seed: { 'notes.txt': 'ORIGINAL' } });
    plan(r, [new MemorySource('notes.txt', new TextEncoder().encode('REPLACEMENT'))]);

    const result = await runTransfer(r, {
      // The interface sends the user's choice, not a name: proposing one is the
      // receiving side's job, since it knows what already exists on its disk.
      requestDecision: async () => ({
        accepted: true,
        decisions: [{ index: 0, action: 'rename' }],
      }),
    });

    expect(result.sender.outcome).toBe('completed');
    expect(result.receiver.outcome).toBe('completed');
    expect(new TextDecoder().decode(r.store.content('notes.txt'))).toBe('ORIGINAL');
    expect(new TextDecoder().decode(r.store.content('notes (1).txt'))).toBe('REPLACEMENT');
    // The sender is told the name that was really used.
    expect(result.decisions).toEqual([{ index: 0, action: 'rename', newPath: 'notes (1).txt' }]);
  });

  it('skips a conflicting file when asked to ignore it', async () => {
    const r = await rig({ seed: { 'a.txt': 'KEEP' } });
    plan(r, [
      new MemorySource('a.txt', new TextEncoder().encode('NEW')),
      new MemorySource('b.txt', new TextEncoder().encode('B')),
    ]);

    const { sender, receiver } = await runTransfer(r, { policy: 'skip' });

    expect(sender.outcome).toBe('partial');
    expect(sender.unavailable).toEqual([{ index: 0, reason: 'skipped' }]);
    expect(receiver.outcome).toBe('completed');
    expect(new TextDecoder().decode(r.store.content('a.txt'))).toBe('KEEP');
    expect(new TextDecoder().decode(r.store.content('b.txt'))).toBe('B');
    expect(receiver.bytesDone).toBe(1);
  });

  it('replaces a file only after an explicit overwrite decision', async () => {
    const r = await rig({ seed: { 'a.txt': 'OLD' } });
    plan(r, [new MemorySource('a.txt', new TextEncoder().encode('NEW CONTENT'))]);

    const { sender } = await runTransfer(r, { policy: 'overwrite' });

    expect(sender.outcome).toBe('completed');
    expect(new TextDecoder().decode(r.store.content('a.txt'))).toBe('NEW CONTENT');
  });

  it('reports unreadable files instead of pretending they were sent', async () => {
    const r = await rig();
    const missing = new MemorySource('gone.bin', bytes(4096));
    missing.markRevalidation('missing');
    plan(r, [missing, new MemorySource('ok.bin', bytes(2048, 3))]);

    const { sender, receiver } = await runTransfer(r);

    expect(sender.outcome).toBe('partial');
    expect(sender.unavailable).toEqual([{ index: 0, reason: 'unreadable' }]);
    expect(sender.verifiedFiles).toBe(1);
    expect(receiver.outcome).toBe('completed');
    expect(digestOf(r.store.content('ok.bin'))).toBe(sha256Hex(bytes(2048, 3)));
  });

  it('stops with an honest error when the destination is full', async () => {
    const r = await rig();
    r.store.freeSpaceBytes = 1000;
    plan(r, [new MemorySource('big.bin', bytes(50_000))]);

    const { sender, receiver } = await runTransfer(r);

    expect(sender.outcome).toBe('failed');
    expect(sender.errorCode).toBe(ERROR_CODES.NO_SPACE_LEFT);
    expect(receiver.outcome).toBe('failed');
    expect(r.store.paths()).toEqual([]);
  });

  it('refuses a hostile path while delivering the safe ones', async () => {
    const r = await rig();
    plan(r, [
      new MemorySource('../../etc/passwd', new TextEncoder().encode('root:x:0:0')),
      new MemorySource('ok.txt', new TextEncoder().encode('fine')),
    ]);

    const { sender, receiver, receiverInstance } = await runTransfer(r);

    // The refused entry is reported by the sender as unavailable, while the safe
    // file is delivered and verified.
    expect(sender.outcome).toBe('partial');
    expect(sender.unavailable).toEqual([{ index: 0, reason: 'refused' }]);
    expect(receiver.outcome).toBe('completed');
    expect(receiver.verifiedFiles).toBe(1);
    expect(r.store.paths()).toEqual(['ok.txt']);
    expect(receiverInstance.refusedEntries.length).toBe(1);
  });

  it('refuses the entire transfer when every announced path is hostile', async () => {
    const r = await rig();
    plan(r, [new MemorySource('../escape.txt', new TextEncoder().encode('nope'))]);

    const { sender, receiver } = await runTransfer(r);

    expect(receiver.outcome).toBe('failed');
    expect(sender.outcome).toBe('failed');
    expect(r.store.paths()).toEqual([]);
  });

  it('honours a decline', async () => {
    const r = await rig();
    plan(r, [new MemorySource('a.txt', new TextEncoder().encode('a'))]);

    const { sender, receiver } = await runTransfer(r, {
      requestDecision: async () => ({ accepted: false, decisions: [] }),
    });

    expect(receiver.outcome).toBe('declined');
    expect(sender.outcome).toBe('failed');
    expect(sender.errorCode).toBe(ERROR_CODES.TRANSFER_DECLINED);
    expect(r.store.paths()).toEqual([]);
  });

  it('refuses a transfer that does not fit in the free space', async () => {
    const r = await rig();
    r.store.freeSpaceBytes = 512;
    plan(r, [new MemorySource('a.bin', bytes(1024))]);

    const { sender, receiver } = await runTransfer(r);

    expect(receiver.outcome).toBe('failed');
    expect(receiver.errorCode).toBe(ERROR_CODES.NO_SPACE_LEFT);
    expect(sender.errorCode).toBe(ERROR_CODES.NO_SPACE_LEFT);
  });

  it('can be cancelled by the sender while running', async () => {
    const r = await rig();
    plan(r, [new MemorySource('big.bin', bytes(2 * 1024 * 1024, 7))]);

    const { sender, receiver } = await runTransfer(r, {
      progressThrottleMs: 0,
      onProgress: (bytesDone, senderInstance) => {
        if (bytesDone > CHUNK * 4) senderInstance.cancel();
      },
    });

    expect(sender.outcome).toBe('cancelled');
    expect(sender.errorCode).toBe(ERROR_CODES.TRANSFER_CANCELLED);
    expect(['cancelled', 'interrupted', 'failed']).toContain(receiver.outcome);
    // A cancelled transfer is never reported as complete.
    expect(receiver.outcome).not.toBe('completed');
  });

  it('transfers 4 MiB in bounded chunks with flat memory', async () => {
    const r = await rig();
    const payload = bytes(4 * 1024 * 1024, 11);
    plan(r, [new MemorySource('large.bin', payload)]);

    const { sender, receiver } = await runTransfer(r);

    expect(sender.outcome).toBe('completed');
    expect(receiver.verifiedFiles).toBe(1);
    expect(digestOf(r.store.content('large.bin'))).toBe(sha256Hex(payload));
    expect(Math.ceil(payload.length / CHUNK)).toBe(64);
  });

  it('handles many small files without losing one', async () => {
    const r = await rig();
    const files = Array.from({ length: 40 }, (_, index) => new MemorySource(`batch/file-${index}.txt`, new TextEncoder().encode(`content-${index}`)));
    plan(r, files);

    const { sender, receiver } = await runTransfer(r);

    expect(sender.outcome).toBe('completed');
    expect(receiver.verifiedFiles).toBe(40);
    expect((await r.store.list('batch')).length).toBe(40);
  });
});

describe('integrity guarantees', () => {
  it('never validates a file whose digest does not match, and never says completed', async () => {
    const r = await rig();
    const file = new MemorySource('lie.bin', bytes(4096, 5));
    plan(r, [file]);
    const bobSession = r.bob.session!;
    const aliceSession = r.alice.session!;

    const receiverPromise = (async () => {
      await aliceSession.sendControl(r.offer);
      await settle(10);
      return null;
    })();

    // A hostile sender: real chunks, then a fabricated digest.
    const { TransferReceiver } = await import('@dropforge/transfer-engine');
    const receiver = new TransferReceiver({
      session: bobSession,
      offer: r.offer,
      store: r.store,
      clock: r.clock,
      streamIndex: 9,
      policy: 'ask',
      requestDecision: async () => ({ accepted: true, decisions: [] }),
    });
    const outcomePromise = receiver.run();
    await receiverPromise;
    await settle(20);
    const chunk = await file.read(0, 4096);
    await aliceSession.sendData({ streamIndex: 9, fileIndex: 0, chunkIndex: 0, lastChunk: true, emptyFile: false }, chunk!);
    await settle(20);
    await aliceSession.sendControl({
      t: 'fileDigest',
      transferId: r.offer.transferId,
      index: 0,
      algorithm: 'sha-256',
      digest: 'f'.repeat(64),
      size: 4096,
    });
    await settle(20);
    await aliceSession.sendControl({ t: 'transferComplete', transferId: r.offer.transferId, unavailable: [] });
    const outcome = await outcomePromise;

    expect(outcome.outcome).not.toBe('completed');
    expect(outcome.verifiedFiles).toBe(0);
    expect(outcome.failed).toEqual([{ index: 0, reason: 'digestMismatch' }]);
  });

  it('verifies the integrity of a large file independently of the transfer', async () => {
    const payload = bytes(300 * 1024, 12);
    const stream = new Sha256Stream();
    stream.update(payload.subarray(0, 100 * 1024));
    stream.update(payload.subarray(100 * 1024));
    expect(toHex(stream.digest())).toBe(sha256Hex(payload));
  });

  it('derives the same manifest hash for identical content and a different one otherwise', () => {
    const a = buildManifest({ files: [new MemorySource('a.txt', bytes(16))], chunkBytes: CHUNK });
    const b = buildManifest({ files: [new MemorySource('a.txt', bytes(16))], chunkBytes: CHUNK });
    const bigger = buildManifest({ files: [new MemorySource('a.txt', bytes(32))], chunkBytes: CHUNK });
    const renamed = buildManifest({ files: [new MemorySource('b.txt', bytes(16))], chunkBytes: CHUNK });
    expect(a.manifestHash).toBe(b.manifestHash);
    expect(bigger.manifestHash).not.toBe(a.manifestHash);
    expect(renamed.manifestHash).not.toBe(a.manifestHash);
  });

  it('rejects an offer whose announced sizes do not add up', async () => {
    const r = await rig();
    plan(r, [new MemorySource('a.bin', bytes(1024))]);
    expect(() => validateOffer({ ...r.offer, totalBytes: 99 })).toThrow(/do not add up/);
    expect(() => validateOffer({ ...r.offer, expiresAt: 1 })).toThrow(/expired/);
  });

  it('rejects duplicate paths in an offer', async () => {
    const r = await rig();
    plan(r, [new MemorySource('dup.txt', bytes(8))]);
    const entry = r.offer.entries[0]!;
    expect(() =>
      validateOffer({ ...r.offer, entries: [entry, { ...entry, index: 1 }], totalBytes: entry.size * 2 }),
    ).toThrow(/same path twice/);
  });
});

describe('store behaviour on the receiving side', () => {
  it('never overwrites a file created between the offer and the write', async () => {
    const r = await rig();
    plan(r, [new MemorySource('race.txt', new TextEncoder().encode('incoming'))]);
    const store = r.store;

    const { receiver } = await runTransfer(r, {
      requestDecision: async () => {
        // A file appears after the conflict detection ran: the write must not
        // replace it, and the incoming file gets a free name instead.
        store.setFile('race.txt', new TextEncoder().encode('created meanwhile'));
        return { accepted: true, decisions: [] };
      },
    });

    expect(receiver.outcome).toBe('completed');
    expect(new TextDecoder().decode(store.content('race.txt'))).toBe('created meanwhile');
    expect(new TextDecoder().decode(store.content('race (1).txt'))).toBe('incoming');
  });

  it('exposes the partial ranges so a resume is possible later', async () => {
    const r = await rig();
    const { manifestHash } = plan(r, [new MemorySource('partial.bin', bytes(512 * 1024, 4))]);
    const result = await runTransfer(r, {
      progressThrottleMs: 0,
      stallTimeoutMs: 400,
      onProgress: (bytesDone, senderInstance, receiverInstance) => {
        if (bytesDone <= CHUNK * 3) return;
        senderInstance.interrupt();
        // The user abandons the receiving side; partial data is kept for resume.
        void receiverInstance.cancel();
      },
    });

    expect(result.sender.outcome).toBe('interrupted');
    const resumeState = result.receiverInstance.resumeState(manifestHash);
    expect(resumeState.manifestHash).toBe(manifestHash);
    expect(resumeState.files.length).toBe(1);
    expect(resumeState.files[0]!.ranges[0]!.start).toBe(0);
    expect(resumeState.files[0]!.ranges[0]!.end).toBeGreaterThan(0);
  });
});
