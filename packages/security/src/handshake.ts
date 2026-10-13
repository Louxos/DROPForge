/**
 * DF-HANDSHAKE v1 — mutually authenticated key agreement.
 *
 * Exchange (2 RTT):
 *   initiator → responder : hello, key
 *   responder → initiator : hello, key            (both sides call start() when the socket opens)
 *   initiator → responder : [pairProof,] auth
 *   responder → initiator : auth, [pairProof,] ready
 *
 * What this design guarantees, and what it does not:
 *  - key agreement is ephemeral per session: a recorded session cannot be
 *    decrypted later even if a long-term identity key leaks (forward secrecy
 *    with respect to the identity key);
 *  - each peer signs a canonical transcript containing both hellos, both
 *    ephemeral keys, both identity keys and both algorithm choices. Swapping an
 *    ephemeral key invalidates both signatures, so a relay cannot silently
 *    become a man in the middle and stay undetected once the users compare the
 *    6-digit code (SAS) or scan the QR code of the other device;
 *  - identity is the public key, never the display name: trust decisions bind
 *    to the fingerprint (sha-256 of the public key);
 *  - replay is blocked by the per-session `sessionNonce` inside the transcript,
 *    single-use ephemeral keys, `expiresAt`, and strictly increasing frame
 *    counters (see SessionCrypto);
 *  - an outcome is only produced once the peer's signature has been verified
 *    AND, on the initiator side, once `ready` confirmed the same session code.
 *
 * LIMIT, stated explicitly: without an out-of-band comparison (QR code, SAS
 * confirmation or a previously trusted fingerprint) both peers can only prove
 * they are in the *same* session. A hostile relay present from the first
 * message could run two half-sessions; the UI therefore never claims a device is
 * authenticated before one of those checks happened.
 */
import {
  HANDSHAKE_TIMEOUT_MS,
  PROTOCOL_VERSION,
  assertCompatible,
  canonicalJsonUnsafe,
  hmacSha256,
  negotiateCapabilities,
  parseHandshakeMessage,
  sha256Bytes,
  timingSafeEqual,
  toHex,
  utf8,
  type Capability,
  type HandshakeMessage,
  type HelloMessage,
  type KeyAgreementAlg,
  type KeyMessage,
  type Platform,
  type SignatureAlg,
} from '@dropforge/protocol';
import { CryptoRandomSource, type RandomSource } from './random.js';
import { detectCryptoCapabilities, fromBase64Url, toBase64Url } from './crypto.js';
import {
  hydrateIdentity,
  signBytes,
  verifySelfConsistentIdentity,
  verifySignature,
  type DeviceIdentity,
  type StoredIdentity,
} from './identity.js';
import { SessionCrypto, deriveSasCode, type SessionKeyMaterial } from './session.js';

export const HANDSHAKE_CONTEXT = 'DF-HANDSHAKE-v1';
export const AUTH_CONTEXT = 'DF-AUTH-v1';
const HKDF_INFO = {
  initiatorToResponder: 'dropforge/v1/i2r',
  responderToInitiator: 'dropforge/v1/r2i',
  sas: 'dropforge/v1/sas',
} as const;

export class HandshakeError extends Error {
  readonly code: string;
  readonly fatal: boolean;
  constructor(code: string, message: string, fatal = true) {
    super(message);
    this.name = 'HandshakeError';
    this.code = code;
    this.fatal = fatal;
  }
}

export interface PeerInfo {
  deviceId: string;
  displayName: string;
  platform: Platform;
  sign: SignatureAlg;
  agree: KeyAgreementAlg;
  publicKey: string;
  fingerprint: string;
}

export interface HandshakeOutcome {
  peer: PeerInfo;
  capabilities: Set<Capability>;
  sas: string;
  transcriptHashHex: string;
  session: SessionCrypto;
  /** Set when a pairing secret was supplied: did the peer prove it holds the same secret? */
  pairingProofValid?: boolean;
  /** The peer asked to be remembered as a trusted device (the user still decides). */
  peerRequestedTrust: boolean;
  role: 'initiator' | 'responder';
}

export interface HandshakeOptions {
  identity: StoredIdentity;
  /** 'initiator' is the side that dialled (the sender side by default). */
  role: 'initiator' | 'responder';
  deviceId: string;
  displayName: string;
  platform: Platform;
  capabilities: readonly Capability[];
  /** Secret obtained through the QR code / pairing fragment, if any. */
  pairingSecret?: Uint8Array;
  requestTrust: boolean;
  /** Local clock in ms since epoch (injectable for tests). */
  now?: number;
  /** Protocol version to announce (defaults to the current one). */
  version?: string;
  /** Tolerance applied when checking the peer's key expiry. */
  clockSkewToleranceMs?: number;
  /** Injected RNG, for deterministic tests only. */
  random?: RandomSource;
}

export type HandshakeStage = 'idle' | 'hello-sent' | 'key-sent' | 'awaiting-ready' | 'completed' | 'failed';

export class Handshake {
  readonly role: 'initiator' | 'responder';
  private stage: HandshakeStage = 'idle';
  private identity: DeviceIdentity | undefined;
  private ourHello: HelloMessage | undefined;
  private peerHello: HelloMessage | undefined;
  private ourKey: KeyMessage | undefined;
  private peerKey: KeyMessage | undefined;
  private ownEphemeral: CryptoKeyPair | undefined;
  private transcriptHashHex: string | undefined;
  private session: SessionCrypto | undefined;
  private sas: string | undefined;
  private peerRequestedTrust = false;
  private peerPairingProof: Uint8Array | undefined;
  private sentAuth = false;
  private sentReady = false;
  private peerAuthVerified = false;
  private outcomeEmitted = false;
  private readonly startedAt: number;
  private readonly random: RandomSource;

  constructor(private readonly options: HandshakeOptions) {
    this.role = options.role;
    this.startedAt = options.now ?? Date.now();
    this.random = options.random ?? new CryptoRandomSource();
  }

  get stageName(): HandshakeStage {
    return this.stage;
  }

  get outcome(): HandshakeOutcome | undefined {
    return this.outcomeEmitted ? this.builtOutcome : undefined;
  }

  /** First message(s) to put on the wire. Both peers call this when the socket opens. */
  async start(): Promise<HandshakeMessage[]> {
    if (this.stage !== 'idle') throw new HandshakeError('HANDSHAKE_OUT_OF_ORDER', 'Handshake already started');
    const { identity } = await hydrateIdentity(this.options.identity);
    this.identity = identity;
    const algs = await this.supportedAlgorithms();
    this.ourHello = {
      t: 'hello',
      v: this.options.version ?? PROTOCOL_VERSION,
      caps: [...this.options.capabilities],
      deviceId: this.options.deviceId,
      displayName: this.options.displayName,
      role: this.role === 'initiator' ? 'sender' : 'receiver',
      sessionNonce: toBase64Url(this.random.bytes(16)),
      platform: this.options.platform,
      agreeAlgs: algs.agree,
      signAlgs: algs.sign,
    };
    this.stage = 'hello-sent';
    if (this.role === 'initiator') {
      const key = await this.makeKeyMessage(undefined);
      this.stage = 'awaiting-ready';
      return [this.ourHello, key];
    }
    return [this.ourHello];
  }

  private async supportedAlgorithms(): Promise<{ agree: KeyAgreementAlg[]; sign: SignatureAlg[] }> {
    const caps = await detectCryptoCapabilities();
    const agree: KeyAgreementAlg[] = [];
    if (caps.x25519) agree.push('x25519');
    if (caps.p256Ecdh) agree.push('p256');
    const sign: SignatureAlg[] = [];
    if (caps.ed25519) sign.push('ed25519');
    if (caps.p256Ecdsa) sign.push('ecdsa-p256');
    if (agree.length === 0 || sign.length === 0) {
      throw new HandshakeError('HANDSHAKE_CRYPTO_UNAVAILABLE', 'This device cannot negotiate a secure session');
    }
    return { agree, sign };
  }

  private async makeKeyMessage(peerAlgs: readonly KeyAgreementAlg[] | undefined): Promise<KeyMessage> {
    const identity = this.identity;
    if (!identity) throw new HandshakeError('HANDSHAKE_OUT_OF_ORDER', 'Identity not loaded');
    const agree = this.pickAgreement(peerAlgs);
    this.ownEphemeral = await generateEphemeral(agree);
    const ephemeralPublicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', this.ownEphemeral.publicKey)));
    const expiresAt = (this.options.now ?? Date.now()) + HANDSHAKE_TIMEOUT_MS * 4;
    this.ourKey = {
      t: 'key',
      agree,
      ephemeralPublicKey,
      sign: identity.sign,
      identityPublicKey: this.options.identity.publicKey,
      identityFingerprint: identity.fingerprint,
      expiresAt,
    };
    return this.ourKey;
  }

  /** The initiator chooses the agreement algorithm; the responder accepts it. */
  private pickAgreement(peerAlgs: readonly KeyAgreementAlg[] | undefined): KeyAgreementAlg {
    const ours = this.options.identity.agree;
    if (!peerAlgs || peerAlgs.length === 0) return ours;
    if (peerAlgs.includes('x25519') && ours === 'x25519') return 'x25519';
    if (peerAlgs.includes('p256')) return 'p256';
    throw new HandshakeError('HANDSHAKE_NO_COMMON_ALGORITHM', 'The two devices have no key agreement algorithm in common');
  }

  /**
   * Processes one inbound handshake message and returns the messages to send
   * next plus, once, the established session.
   */
  async receive(raw: unknown): Promise<{ send: HandshakeMessage[]; outcome?: HandshakeOutcome }> {
    const message = parseHandshakeMessage(raw);
    if (this.identity === undefined) {
      throw new HandshakeError('HANDSHAKE_OUT_OF_ORDER', 'Call start() before receive()');
    }
    if (this.hasExpired()) {
      this.stage = 'failed';
      throw new HandshakeError('HANDSHAKE_TIMEOUT', 'The handshake took too long and was abandoned');
    }
    this.store(message);
    const send = await this.advance();
    const outcome = this.takeOutcome();
    return outcome ? { send, outcome } : { send };
  }

  private store(message: HandshakeMessage): void {
    switch (message.t) {
      case 'hello': {
        if (this.peerHello) throw new HandshakeError('HANDSHAKE_REPLAY', 'Received a second hello for this session');
        try {
          assertCompatible(message.v);
        } catch {
          throw new HandshakeError('HANDSHAKE_VERSION_MISMATCH', 'The other device uses an incompatible version');
        }
        if (message.deviceId === this.options.deviceId) {
          throw new HandshakeError('HANDSHAKE_SELF_CONNECTION', 'Refusing to connect to this same device');
        }
        this.peerHello = message;
        break;
      }
      case 'key': {
        if (this.peerKey) throw new HandshakeError('HANDSHAKE_REPLAY', 'Received a second key message');
        const now = this.options.now ?? Date.now();
        const skew = this.options.clockSkewToleranceMs ?? 120_000;
        if (message.expiresAt + skew < now) {
          throw new HandshakeError('HANDSHAKE_EXPIRED_KEY', 'The other device sent an expired key');
        }
        this.peerKey = message;
        break;
      }
      case 'auth': {
        if (this.bufferedAuth || this.peerAuthVerified) {
          throw new HandshakeError('HANDSHAKE_REPLAY', 'Received a second auth message');
        }
        this.bufferedAuth = { signature: message.signature };
        break;
      }
      case 'pairProof': {
        this.peerRequestedTrust = message.requestTrust;
        this.peerPairingProof = fromBase64Url(message.hmac);
        break;
      }
      case 'ready': {
        // The responder confirms the fingerprint of *its own* key: the initiator
        // compares it with the key it accepted during the exchange.
        const expected = this.peerKey?.identityFingerprint;
        if (!expected || message.selfFingerprint !== expected) {
          this.stage = 'failed';
          throw new HandshakeError('HANDSHAKE_PEER_CONFUSION', 'The other device confirmed an unexpected identity');
        }
        if (this.sas && message.sas !== this.sas) {
          this.stage = 'failed';
          throw new HandshakeError('HANDSHAKE_SAS_MISMATCH', 'Both devices derived different session codes');
        }
        this.readyReceived = true;
        break;
      }
    }
  }

  private readyReceived = false;
  private bufferedAuth: { signature: string } | undefined;
  private bufferedAuthVerified = false;

  /** Runs whatever the current state allows and returns the messages to send. */
  private async advance(): Promise<HandshakeMessage[]> {
    const send: HandshakeMessage[] = [];
    // Verify the peer's key material as soon as both hellos and both keys exist.
    if (this.peerKey && this.peerHello && !this.peerKeyChecked) {
      this.peerKeyChecked = true;
      const consistent = await verifySelfConsistentIdentity(
        this.peerKey.sign,
        this.peerKey.identityPublicKey,
        this.peerKey.identityFingerprint,
      );
      if (!consistent) {
        throw new HandshakeError('HANDSHAKE_INVALID_IDENTITY', 'The other device announced an inconsistent identity');
      }
      if (this.peerKey.identityFingerprint === this.identity?.fingerprint) {
        throw new HandshakeError('HANDSHAKE_SELF_CONNECTION', 'Refusing a session with our own identity');
      }
    }

    // Responder: answer the initiator's hello with its own key.
    if (this.role === 'responder' && this.peerHello && !this.ourKey) {
      send.push(await this.makeKeyMessage(this.peerHello.agreeAlgs));
      this.stage = 'key-sent';
    }

    const transcriptReady = Boolean(this.ourKey && this.peerKey && this.peerHello);
    if (!transcriptReady) return send;

    if (this.transcriptHashHex === undefined) {
      this.transcriptHashHex = toHex(sha256Bytes(utf8(this.buildTranscript())));
    }

    // Verify the peer's authentication before anything else can be concluded.
    await this.verifyPeerAuth();

    // Each side sends its own authentication exactly once.
    if (!this.sentAuth) {
      if (!this.session) await this.deriveKeys();
      const proof = this.makePairingProof();
      // The pair proof travels before `auth` so the peer's outcome can include it.
      if (proof) send.push(proof);
      send.push({ t: 'auth', signature: toBase64Url(await signBytes(this.options.identity, this.authPayload())) });
      this.sentAuth = true;
      if (this.role === 'initiator') this.stage = 'awaiting-ready';
    }

    // Responder: confirm the session with `ready` (it carries the SAS).
    if (this.role === 'responder' && !this.sentReady) {
      send.push({ t: 'ready', selfFingerprint: this.identity!.fingerprint, sas: this.sas! });
      this.sentReady = true;
    }
    return send;
  }

  private peerKeyChecked = false;

  /** Validates and consumes the buffered auth message, once. */
  private async verifyPeerAuth(): Promise<void> {
    if (!this.bufferedAuth || this.peerAuthVerified) return;
    const key = this.peerKey;
    if (!key) throw new HandshakeError('HANDSHAKE_OUT_OF_ORDER', 'Auth received before key');
    const hash = this.transcriptHashHex;
    if (!hash) throw new HandshakeError('HANDSHAKE_OUT_OF_ORDER', 'Auth received before the transcript was built');
    const payload = utf8(`${AUTH_CONTEXT}:${this.role === 'initiator' ? 'responder' : 'initiator'}:${hash}`);
    const ok = await verifySignature(
      key.sign,
      fromBase64Url(key.identityPublicKey),
      fromBase64Url(this.bufferedAuth.signature),
      payload,
    );
    if (!ok) {
      this.stage = 'failed';
      throw new HandshakeError('HANDSHAKE_BAD_SIGNATURE', 'The other device could not prove its identity');
    }
    this.peerAuthVerified = true;
    this.bufferedAuthVerified = true;
    this.bufferedAuth = undefined;
  }

  private takeOutcome(): HandshakeOutcome | undefined {
    if (this.outcomeEmitted || !this.peerAuthVerified) return undefined;
    if (this.role === 'initiator' && !this.readyReceived) return undefined;
    if (!this.session || !this.sas || !this.transcriptHashHex) return undefined;
    const outcome = this.buildOutcome();
    this.builtOutcome = outcome;
    this.outcomeEmitted = true;
    this.stage = 'completed';
    return outcome;
  }

  private builtOutcome: HandshakeOutcome | undefined;

  get established(): boolean {
    return this.outcomeEmitted;
  }

  private hasExpired(): boolean {
    const now = this.options.now ?? Date.now();
    return now - this.startedAt > HANDSHAKE_TIMEOUT_MS * 2;
  }

  private transcriptInput(): {
    initiator: { hello: HelloMessage; key: KeyMessage };
    responder: { hello: HelloMessage; key: KeyMessage };
  } {
    if (!this.ourHello || !this.peerHello || !this.ourKey || !this.peerKey) {
      throw new HandshakeError('HANDSHAKE_OUT_OF_ORDER', 'Transcript is incomplete');
    }
    const mine = { hello: this.ourHello, key: this.ourKey };
    const theirs = { hello: this.peerHello, key: this.peerKey };
    return this.role === 'initiator' ? { initiator: mine, responder: theirs } : { initiator: theirs, responder: mine };
  }

  /** Canonical, byte-exact transcript shared by both peers. */
  private buildTranscript(): string {
    const { initiator, responder } = this.transcriptInput();
    const hello = (h: HelloMessage) => ({
      v: h.v,
      caps: [...h.caps].sort(),
      deviceId: h.deviceId,
      displayName: h.displayName,
      role: h.role,
      sessionNonce: h.sessionNonce,
      platform: h.platform,
      agreeAlgs: [...h.agreeAlgs],
      signAlgs: [...h.signAlgs],
    });
    const key = (k: KeyMessage) => ({
      agree: k.agree,
      ephemeralPublicKey: k.ephemeralPublicKey,
      sign: k.sign,
      identityPublicKey: k.identityPublicKey,
      identityFingerprint: k.identityFingerprint,
      expiresAt: k.expiresAt,
    });
    return canonicalJsonUnsafe({
      ctx: HANDSHAKE_CONTEXT,
      initiator: { hello: hello(initiator.hello), key: key(initiator.key) },
      responder: { hello: hello(responder.hello), key: key(responder.key) },
    });
  }

  private authPayload(): Uint8Array {
    if (!this.transcriptHashHex) throw new HandshakeError('HANDSHAKE_OUT_OF_ORDER', 'Transcript hash missing');
    return utf8(`${AUTH_CONTEXT}:${this.role}:${this.transcriptHashHex}`);
  }

  private makePairingProof(): HandshakeMessage | undefined {
    const secret = this.options.pairingSecret;
    if (!secret || secret.length === 0 || !this.transcriptHashHex) return undefined;
    const mac = hmacSha256(secret, utf8(`${HANDSHAKE_CONTEXT}:pair:${this.transcriptHashHex}`));
    return { t: 'pairProof', hmac: toBase64Url(mac), requestTrust: this.options.requestTrust };
  }

  /** Derives the session keys (HKDF over the ECDH secret) exactly once. */
  private async deriveKeys(): Promise<void> {
    const ours = this.ourKey;
    const theirs = this.peerKey;
    if (!ours || !theirs || !this.ownEphemeral || !this.transcriptHashHex) {
      throw new HandshakeError('HANDSHAKE_OUT_OF_ORDER', 'Key material is incomplete');
    }
    const peerPublic = await importEphemeral(ours.agree, fromBase64Url(theirs.ephemeralPublicKey));
    const shared = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: ours.agree === 'x25519' ? 'X25519' : 'ECDH', public: peerPublic },
        this.ownEphemeral.privateKey,
        256,
      ),
    );
    const salt = sha256Bytes(utf8(this.transcriptHashHex));
    const info = HKDF_INFO;
    const material: SessionKeyMaterial = {
      initiatorToResponder: await hkdf(shared, salt, info.initiatorToResponder),
      responderToInitiator: await hkdf(shared, salt, info.responderToInitiator),
      sasMaterial: await hkdf(shared, salt, info.sas),
    };
    this.session = await SessionCrypto.create(material, this.role);
    this.sas = deriveSasCode(material.sasMaterial);
    material.initiatorToResponder.fill(0);
    material.responderToInitiator.fill(0);
    material.sasMaterial.fill(0);
    shared.fill(0);
  }

  private buildOutcome(): HandshakeOutcome {
    const peerKey = this.peerKey;
    const peerHello = this.peerHello;
    const session = this.session;
    const transcriptHashHex = this.transcriptHashHex;
    const sas = this.sas;
    if (!peerKey || !peerHello || !session || !transcriptHashHex || !sas) {
      throw new HandshakeError('HANDSHAKE_OUT_OF_ORDER', 'Outcome requested before the session was derived');
    }
    const capabilities = negotiateCapabilities(peerHello.caps, this.options.capabilities);
    let pairingProofValid: boolean | undefined;
    if (this.options.pairingSecret && this.options.pairingSecret.length > 0) {
      if (!this.peerPairingProof) {
        pairingProofValid = false;
      } else {
        const expected = hmacSha256(
          this.options.pairingSecret,
          utf8(`${HANDSHAKE_CONTEXT}:pair:${transcriptHashHex}`),
        );
        pairingProofValid = timingSafeEqual(expected, this.peerPairingProof);
        expected.fill(0);
      }
    }
    return {
      peer: {
        deviceId: peerHello.deviceId,
        displayName: peerHello.displayName,
        platform: peerHello.platform,
        sign: peerKey.sign,
        agree: peerKey.agree,
        publicKey: peerKey.identityPublicKey,
        fingerprint: peerKey.identityFingerprint,
      },
      capabilities,
      sas,
      transcriptHashHex,
      session,
      pairingProofValid,
      peerRequestedTrust: this.peerRequestedTrust,
      role: this.role,
    };
  }

  /** Discards ephemeral material; call on abort/cancel. */
  dispose(): void {
    this.session?.destroy();
    this.ownEphemeral = undefined;
    this.stage = 'failed';
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

async function generateEphemeral(alg: KeyAgreementAlg): Promise<CryptoKeyPair> {
  if (alg === 'x25519') {
    return crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']) as Promise<CryptoKeyPair>;
  }
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']) as Promise<CryptoKeyPair>;
}

async function importEphemeral(alg: KeyAgreementAlg, raw: Uint8Array): Promise<CryptoKey> {
  const expectedLength = alg === 'x25519' ? 32 : 65;
  if (raw.length !== expectedLength) {
    throw new HandshakeError('HANDSHAKE_INVALID_KEY', 'The other device sent a malformed ephemeral key');
  }
  if (alg === 'x25519') {
    return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'X25519' }, false, []);
  }
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: utf8(info) as BufferSource },
    key,
    256,
  );
  return new Uint8Array(bits);
}
