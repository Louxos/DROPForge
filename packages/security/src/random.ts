/**
 * Random source port. Everything security-relevant takes its randomness from
 * here, so production always uses the platform CSPRNG while tests can inject a
 * deterministic stream when they need reproducible bytes.
 */
import { randomBytes } from './crypto.js';

export interface RandomSource {
  bytes(length: number): Uint8Array;
}

export class CryptoRandomSource implements RandomSource {
  bytes(length: number): Uint8Array {
    return randomBytes(length);
  }
}

/** Deterministic source for tests only — never use outside a test. */
export class SeededRandomSource implements RandomSource {
  private counter = 0;

  constructor(private readonly seed: number = 0x5eed) {}

  bytes(length: number): Uint8Array {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      this.counter += 1;
      out[i] = (Math.imul(this.seed ^ this.counter, 2654435761) >>> 24) & 0xff;
    }
    return out;
  }
}
