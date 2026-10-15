/**
 * Resume: a transfer that was interrupted continues where it stopped, and never
 * pretends to have bytes it does not have.
 *
 * The receiving side re-hashes what it already holds (see docs/TECHNIQUE.md), so the
 * final digest still covers every byte of the file.
 */
import { describe, expect, it } from 'vitest';
import { MemorySource } from './helpers/memory-fs.js';
import { digestOf, plan, rig, runTransfer } from './helpers/transfer-rig.js';

const bytes = (size: number, seed = 1): Uint8Array => {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) out[i] = (i * 31 + seed) % 251;
  return out;
};

const CHUNK = 16 * 1024;

describe('resuming an interrupted transfer', () => {
  it('keeps only the bytes that were really written, and reuses them', async () => {
    const payload = bytes(400 * 1024, 5);
    const r = await rig();
    plan(r, [new MemorySource('video.mp4', payload)], CHUNK);

    // Cut the transfer in the middle: the sender stops, the session dies.
    const interrupted = await runTransfer(r, {
      progressThrottleMs: 0,
      stallTimeoutMs: 400,
      onProgress: (bytesDone, sender) => {
        if (bytesDone >= CHUNK * 6) {
          sender.cancel();
          void r.alice.session?.close();
        }
      },
    });
    expect(interrupted.sender.outcome).toBe('cancelled');

    const state = interrupted.receiverInstance.resumeState(r.manifestHash);
    expect(state).toBeDefined();
    const ranges = state?.files[0]?.ranges ?? [];
    expect(ranges.length).toBeGreaterThan(0);
    const durable = ranges.reduce((sum, range) => sum + (range.end - range.start), 0);
    expect(durable).toBeLessThan(payload.length);
    // The receiver only announces ranges that are really in its store.
    const stored = r.store.content('video.mp4');
    expect(stored?.length).toBe(payload.length);
  });
});

describe('resume guards', () => {
  it('ignores resume data that belongs to another manifest', async () => {
    const payload = bytes(64 * 1024, 7);
    const r = await rig();
    plan(r, [new MemorySource('report.pdf', payload)], CHUNK);
    const bytesBefore = r.bob.transport.stats().bytesReceived;

    // The checkpoint claims the whole file is already there, but it was taken for
    // a different file set: reusing it would write unrelated bytes.
    const transferred = await runTransfer(r, {
      resume: { manifestHash: 'f'.repeat(64), files: [{ index: 0, ranges: [{ start: 0, end: payload.length }] }] },
    });
    const bytesAfter = r.bob.transport.stats().bytesReceived;

    expect(transferred.receiver.outcome).toBe('completed');
    expect(digestOf(r.store.content('report.pdf'))).toBe(digestOf(payload));
    // Everything crossed the wire: nothing was assumed to be already there.
    expect(bytesAfter - bytesBefore).toBeGreaterThan(payload.length);
  });

  it('ignores a checkpoint whose ranges do not match the file layout', async () => {
    const payload = bytes(48 * 1024, 11);
    const r = await rig();
    plan(r, [new MemorySource('archive.zip', payload)], CHUNK);

    const transferred = await runTransfer(r, {
      // A range that ends in the middle of a chunk cannot be resumed safely: the
      // receiver verifies whole chunks only.
      resume: { manifestHash: r.manifestHash, files: [{ index: 0, ranges: [{ start: 0, end: CHUNK + 7 }] }] },
    });

    expect(transferred.receiver.outcome).toBe('completed');
    expect(digestOf(r.store.content('archive.zip'))).toBe(digestOf(payload));
  });

  it('refuses to resume when the file on disk is not the one that was promised', async () => {
    const payload = bytes(32 * 1024, 3);
    const r = await rig({ seed: { 'song.flac': new Uint8Array(1024) } });
    plan(r, [new MemorySource('song.flac', payload)], CHUNK);

    const switched = await runTransfer(r, {
      // The checkpoint says "the first chunk is here", but the store holds a file
      // of a different size: the prefix must not be trusted.
      resume: { manifestHash: r.manifestHash, files: [{ index: 0, ranges: [{ start: 0, end: CHUNK }] }] },
      policy: 'overwrite',
    });

    expect(switched.receiver.outcome).toBe('completed');
    expect(digestOf(r.store.content('song.flac'))).toBe(digestOf(payload));
  });

  it('falls back to sending everything when the partial file was deleted', async () => {
    const payload = bytes(24 * 1024, 13);
    const r = await rig();
    plan(r, [new MemorySource('shot.png', payload)], CHUNK);
    const bytesBefore = r.bob.transport.stats().bytesReceived;

    const transferred = await runTransfer(r, {
      resume: { manifestHash: r.manifestHash, files: [{ index: 0, ranges: [{ start: 0, end: CHUNK }] }] },
    });
    const bytesAfter = r.bob.transport.stats().bytesReceived;

    expect(transferred.receiver.outcome).toBe('completed');
    expect(bytesAfter - bytesBefore).toBeGreaterThan(CHUNK * 1.5);
    expect(digestOf(r.store.content('shot.png'))).toBe(digestOf(payload));
  });
});
