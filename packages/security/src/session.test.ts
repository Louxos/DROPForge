import { describe, expect, it } from 'vitest';
import { fromUtf8, utf8 } from '@dropforge/protocol';
import { FRAME_SEALED_DATA, FRAME_SEALED_JSON } from '@dropforge/protocol';
import { ReplayError, SessionCrypto, SessionCryptoError, deriveSasCode, type SessionKeyMaterial } from './session.js';
import { randomBytes } from './crypto.js';

function material(): SessionKeyMaterial {
  return {
    initiatorToResponder: randomBytes(32),
    responderToInitiator: randomBytes(32),
    sasMaterial: randomBytes(32),
  };
}

async function pair(): Promise<{ alice: SessionCrypto; bob: SessionCrypto }> {
  const shared = material();
  const alice = await SessionCrypto.create(shared, 'initiator');
  const bob = await SessionCrypto.create(shared, 'responder');
  return { alice, bob };
}

describe('session crypto', () => {
  it('seals in one direction and opens in the other', async () => {
    const { alice, bob } = await pair();
    const sealed = await alice.sealJson(utf8('bonjour'));
    const opened = await bob.open(sealed);
    expect(opened.kind).toBe(FRAME_SEALED_JSON);
    expect(fromUtf8(opened.plaintext)).toBe('bonjour');
  });

  it('refuses to open its own frame (direction separation)', async () => {
    const { alice } = await pair();
    const sealed = await alice.sealJson(utf8('loop'));
    await expect(alice.open(sealed)).rejects.toBeInstanceOf(SessionCryptoError);
  });

  it('rejects a replayed frame at the session layer', async () => {
    const { alice, bob } = await pair();
    const first = await alice.sealJson(utf8('one'));
    const second = await alice.sealJson(utf8('two'));
    await bob.open(first);
    await bob.open(second);
    await expect(bob.open(first)).rejects.toBeInstanceOf(ReplayError);
  });

  it('rejects a modified ciphertext', async () => {
    const { alice, bob } = await pair();
    const sealed = await alice.sealData(new Uint8Array([1, 2, 3, 4, 5]));
    sealed[sealed.length - 1] = (sealed[sealed.length - 1]! ^ 0xff) as number;
    await expect(bob.open(sealed)).rejects.toBeInstanceOf(SessionCryptoError);
  });

  it('rejects a frame sealed with a different key', async () => {
    const first = await pair();
    const second = await pair();
    const sealed = await first.alice.sealJson(utf8('secret'));
    await expect(second.bob.open(sealed)).rejects.toBeInstanceOf(SessionCryptoError);
  });

  it('never reuses a nonce across frames of the same direction', async () => {
    const { alice } = await pair();
    const nonces = new Set<string>();
    for (let i = 0; i < 64; i += 1) {
      const sealed = await alice.sealData(new Uint8Array([i]));
      nonces.add(Buffer.from(sealed.slice(1, 13)).toString('hex'));
    }
    expect(nonces.size).toBe(64);
    expect(alice.framesSent).toBe(64);
  });

  it('rejects plain frames once the session is established', async () => {
    const { bob } = await pair();
    const plain = new Uint8Array(13);
    plain[0] = 0x00;
    await expect(bob.open(plain)).rejects.toThrow(/Plain frames are not accepted/);
  });

  it('destroys its keys and refuses further use', async () => {
    const { alice, bob } = await pair();
    alice.destroy();
    await expect(alice.sealJson(utf8('x'))).rejects.toThrow(/destroyed/);
    // Bob's side still works for its own key material.
    const sealed = await bob.sealJson(utf8('still alive'));
    expect(sealed.length).toBeGreaterThan(0);
  });

  it('refuses payloads above the maximum sealed frame size', async () => {
    const { alice } = await pair();
    const tooBig = new Uint8Array(300 * 1024);
    await expect(alice.sealData(tooBig)).rejects.toThrow(/maximum sealed frame size/);
  });

  it('derives a six-digit code from the SAS material', () => {
    expect(deriveSasCode(new Uint8Array([0, 0, 0]))).toBe('000000');
    const code = deriveSasCode(new Uint8Array([0xff, 0xff, 0xff]));
    expect(code).toMatch(/^\d{6}$/);
    // Deterministic: both peers compute the same code from the same material.
    expect(deriveSasCode(new Uint8Array([1, 2, 3]))).toBe(deriveSasCode(new Uint8Array([1, 2, 3])));
  });
});
