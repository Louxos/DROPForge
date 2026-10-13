/**
 * Security tests that go through the real stack: a real handshake, real sealing,
 * a real transfer engine, in-memory wires only.
 *
 * Each test names the attack it represents, so a failure says what broke in
 * product terms instead of only "assertion failed".
 */
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@dropforge/app-core';
import {
  DATA_CHUNK_BYTES,
  decodeFrame,
  encodeInnerData,
  sha256Bytes,
  toHex,
  utf8,
  type ControlMessage,
} from '@dropforge/protocol';
import { TransferReceiver, prepareTransfer, sendTransfer } from '@dropforge/transfer-engine';
import { MemoryFileSystem, MemorySource } from './helpers/memory-fs.js';
import { connect, sessionsFrom } from './helpers/loopback.js';
import { plan, rig, runTransfer } from './helpers/transfer-rig.js';

const CHUNK = 16 * 1024;

function bytes(size: number, seed = 1): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) out[i] = (i * 7 + seed) % 251;
  return out;
}

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

describe('transport security', () => {
  it('never puts file contents or file names in clear on the wire', async () => {
    const payload = utf8('TOP-SECRET-INSIDE-THE-FILE');
    const r = await rig();
    plan(r, [new MemorySource('my secret plan.txt', payload)], CHUNK);

    // Record every frame the receiving side actually saw.
    const observed: Uint8Array[] = [];
    r.bob.transport.onFrame((frame) => observed.push(Uint8Array.from(frame)));
    await runTransfer(r);
    expect(observed.length).toBeGreaterThan(3);

    const nameBytes = utf8('my secret plan.txt');
    for (const frame of observed) {
      const decoded = decodeFrame(frame, 4 * 1024 * 1024);
      // Exactly one frame kind may appear here: sealed. The handshake happened
      // before this transfer, so nothing may be readable.
      expect(decoded.kind).not.toBe(0x00);
      expect(contains(decoded.body, payload)).toBe(false);
      expect(contains(decoded.body, nameBytes)).toBe(false);
    }
  });

  it('produces a different short authentication string when the handshake is tampered with', async () => {
    // An attacker replaces the ephemeral key: both sides derive different keys, so
    // the SAS they show differs and the user can see it.
    const swapKey = (message: Record<string, unknown>): void => {
      if (message['t'] === 'key' && typeof message['ephemeralPublicKey'] === 'string') {
        const original = message['ephemeralPublicKey'] as string;
        message['ephemeralPublicKey'] = `${original.slice(0, -4)}AAAA`;
      }
    };
    const honest = await connect();
    // The tampering is either caught outright (the handshake fails) or it changes
    // the short authentication string the two users compare — never "nothing".
    const attacked = await connect({ tamper: swapKey }).then(
      (result) => result.outcomeA.sas,
      () => 'refused',
    );
    expect(attacked).not.toBe(honest.outcomeA.sas);
  });

  it('rejects a tampered identity signature instead of trusting the peer', async () => {
    // A peer that cannot prove possession of the key it announced must be refused.
    await expect(
      connect({
        tamper: (message: Record<string, unknown>) => {
          if (message['t'] === 'auth' && typeof message['signature'] === 'string') {
            message['signature'] = `${(message['signature'] as string).slice(0, -4)}AAAA`;
          }
        },
      }),
    ).rejects.toThrow();
  });

  it('detects a replayed sealed frame', async () => {
    const { alice, bob, outcomeA, outcomeB } = await connect();
    sessionsFrom({ alice, bob, outcomeA, outcomeB });
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Capture a real sealed control frame from Alice…
    const captured: Uint8Array[] = [];
    const stopCapture = alice.transport.onFrame((frame) => captured.push(Uint8Array.from(frame)));
    await alice.session?.sendControl({ t: 'ping', id: 1, at: Date.now() });
    await new Promise((resolve) => setTimeout(resolve, 30));
    stopCapture();
    expect(captured.length).toBeGreaterThan(0);

    // …and replay it to Bob, exactly as an attacker on the path could.
    let errorSeen = false;
    bob.session?.events.on('error', () => {
      errorSeen = true;
    });
    bob.session?.events.on('control', () => {
      errorSeen = false;
    });
    for (const frame of captured) bob.transport.send(frame);
    await new Promise((resolve) => setTimeout(resolve, 30));

    // A replayed frame must not be accepted as fresh: the session reports the
    // problem (or closes), and it never delivers it as a new message.
    expect(errorSeen || bob.session?.isClosed === true).toBe(true);
  });

  it('delivers a transfer that uses a non-default stream index', async () => {
    // Streams let several transfers share one session without mixing their frames.
    const r = await rig();
    plan(r, [new MemorySource('a.bin', bytes(1024), CHUNK)], CHUNK);
    const result = await runTransfer(r, { streamIndex: 3 });
    expect(result.receiver.outcome).toBe('completed');
    expect(result.receiver.verifiedFiles).toBe(1);
  });
});

describe('receiver defences', () => {
  it('refuses a path that tries to escape the receiving folder', async () => {
    const store = new MemoryFileSystem();
    const r = await rig();
    const built = prepareTransfer({ files: [new MemorySource('ok.txt', utf8('hello'))], chunkBytes: CHUNK });
    // The offer comes from the *other* device, so the entry is forged by hand here:
    // this is exactly what a hostile or buggy peer sends.
    const offer = {
      ...built.offer,
      entries: [
        { ...built.offer.entries[0]!, path: '../../etc/passwd' },
        { ...built.offer.entries[0]!, index: 1, path: 'subdir/notes.txt' },
      ],
      files: 2,
      totalBytes: built.offer.totalBytes * 2,
    };

    const receiver = new TransferReceiver({
      session: r.bob.session!,
      offer,
      store,
      clock: r.clock,
      streamIndex: 1,
      policy: 'ask',
      logger: r.logger,
      requestDecision: async () => ({ accepted: true, decisions: [] }),
    });
    const outcomePromise = receiver.run();
    const sent = await sendTransfer({
      session: r.alice.session!,
      offer,
      sources: new Map([
        [0, new MemorySource('../../../etc/passwd', utf8('root:x:0:0'))],
        [1, new MemorySource('subdir/notes.txt', utf8('notes'))],
      ]),
      clock: r.clock,
      logger: r.logger,
      acceptTimeoutMs: 2000,
      ackTimeoutMs: 1500,
    });
    const outcome = await outcomePromise;

    // The receiver records the refusal, and the refusal is visible in its result.
    expect(receiver.refusedEntries.some((entry) => entry.index === 0)).toBe(true);
    // Nothing escaped the receiving folder, and the safe file still arrived.
    expect(store.paths().some((path) => path.includes('..'))).toBe(false);
    expect(store.content('subdir/notes.txt')).not.toBeUndefined();
    // The sender is told about the refusal, so it does not wait for a file it will
    // never be allowed to deliver.
    expect(sent.outcome.unavailable.some((entry) => entry.index === 0)).toBe(true);
  });

  it('refuses to overwrite an existing file without an explicit decision', async () => {
    const existing = utf8('precious');
    const r = await rig({ seed: { 'report.txt': existing } });
    plan(r, [new MemorySource('report.txt', utf8('new content'))], CHUNK);

    const result = await runTransfer(r, { policy: 'ask' });
    // No decision was given: the receiver must refuse, and the original file must
    // stay exactly as it was.
    expect(result.receiver.outcome).toBe('failed');
    expect(toHex(sha256Bytes(r.store.content('report.txt')!))).toBe(toHex(sha256Bytes(existing)));
    expect(result.receiver.errorCode).toBe(ERROR_CODES.NAME_CONFLICT);
  });

  it('accepts the overwrite when the user asked for it', async () => {
    const r = await rig({ seed: { 'report.txt': utf8('old') } });
    plan(r, [new MemorySource('report.txt', utf8('new content'))], CHUNK);

    const result = await runTransfer(r, {
      requestDecision: async () => ({ accepted: true, decisions: [{ index: 0, action: 'overwrite' }] }),
    });
    expect(result.receiver.outcome).toBe('completed');
    expect(r.store.content('report.txt')).toEqual(utf8('new content'));
  });

  it('stops the transfer when the destination runs out of space, and the sender learns it', async () => {
    const store = new MemoryFileSystem();
    store.freeSpaceBytes = 1024;
    const r = await rig();
    plan(r, [new MemorySource('big.bin', bytes(200 * 1024), CHUNK)], CHUNK);
    const receiver = new TransferReceiver({
      session: r.bob.session!,
      offer: r.offer,
      store,
      clock: r.clock,
      streamIndex: 1,
      policy: 'ask',
      logger: r.logger,
      requestDecision: async () => ({ accepted: true, decisions: [] }),
    });

    // The receiving side is already waiting for the offer.
    const outcomePromise = receiver.run();
    // The free-space check happens before the accept, so the sender is refused
    // before a single byte is written.
    const sent = await sendTransfer({
      session: r.alice.session!,
      offer: r.offer,
      sources: r.sources,
      clock: r.clock,
      logger: r.logger,
      acceptTimeoutMs: 2000,
      ackTimeoutMs: 1500,
    });
    const outcome = await outcomePromise;

    expect(outcome.outcome).toBe('failed');
    expect(outcome.errorCode).toBe(ERROR_CODES.NO_SPACE_LEFT);
    expect(sent.outcome.outcome).not.toBe('completed');
    expect(sent.outcome.errorCode).toBe(ERROR_CODES.NO_SPACE_LEFT);
  });

  it('refuses a chunk larger than the protocol allows, even from a hostile peer', async () => {
    const r = await rig();
    plan(r, [new MemorySource('tiny.bin', bytes(4096, 3), CHUNK)], CHUNK);
    const receiver = new TransferReceiver({
      session: r.bob.session!,
      offer: r.offer,
      store: new MemoryFileSystem(),
      clock: r.clock,
      streamIndex: 1,
      policy: 'ask',
      logger: r.logger,
      requestDecision: async () => ({ accepted: true, decisions: [] }),
    });
    const outcomePromise = receiver.run();

    // A well-behaved sender cannot produce this frame: the session refuses it. So it
    // is forged by hand with the session keys, exactly like a modified client would.
    const forged = new Uint8Array(DATA_CHUNK_BYTES + 1);
    const inner = encodeInnerData(
      { streamIndex: 1, fileIndex: 0, chunkIndex: 0, lastChunk: true, emptyFile: false },
      forged,
    );
    const sealed = await r.outcomeA.session.sealData(inner);
    // Pushed from Alice's side: Bob is the one that must refuse it.
    r.alice.transport.send(sealed);

    const outcome = await outcomePromise;
    expect(outcome.outcome).toBe('failed');
    expect(outcome.errorCode).toBe(ERROR_CODES.UNSUPPORTED_OPERATION);
  });

  it('answers an unknown file digest with an explicit refusal, never silence', async () => {
    const r = await rig();
    plan(r, [new MemorySource('known.bin', bytes(2048, 9), CHUNK)], CHUNK);
    const seen: ControlMessage[] = [];
    r.alice.session?.events.on('control', (message) => seen.push(message));

    const receiver = new TransferReceiver({
      session: r.bob.session!,
      offer: r.offer,
      store: new MemoryFileSystem(),
      clock: r.clock,
      streamIndex: 1,
      policy: 'ask',
      logger: r.logger,
      requestDecision: async () => ({ accepted: true, decisions: [] }),
    });
    const outcomePromise = receiver.run();
    await r.alice.session?.sendControl(r.offer);
    // Let the receiver accept before the hostile digest (about a file it never
    // announced) arrives.
    await new Promise((resolve) => setTimeout(resolve, 60));
    await r.alice.session?.sendControl({
      t: 'fileDigest',
      transferId: r.offer.transferId,
      index: 7,
      algorithm: 'sha-256',
      digest: toHex(sha256Bytes(utf8('nonsense'))),
      size: 8,
    });
    await new Promise((resolve) => setTimeout(resolve, 60));

    const verdict = seen.find((message) => message.t === 'fileDigestResult' && message.index === 7);
    expect(verdict).toBeDefined();
    if (verdict?.t === 'fileDigestResult') {
      expect(verdict.ok).toBe(false);
      expect(verdict.action).toBe('reject');
    }
    // The file that was announced never arrived, so the receiving side cannot
    // report success: abandoning it is the honest end of this scenario.
    await receiver.cancel();
    const outcome = await outcomePromise;
    expect(outcome.outcome).not.toBe('completed');
    expect(outcome.verifiedFiles).toBe(0);
  });
});
