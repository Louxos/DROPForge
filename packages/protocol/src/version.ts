/**
 * Versioning and feature negotiation for the DropForge wire protocol.
 *
 * Compatibility rule: two peers may talk if they share the same MAJOR version.
 * A peer must never assume the other side supports a capability it did not
 * explicitly announce (`hello.caps`).
 */

export const PROTOCOL_MAJOR = 1;
export const PROTOCOL_MINOR = 0;
export const PROTOCOL_VERSION = `${PROTOCOL_MAJOR}.${PROTOCOL_MINOR}` as const;

/** Capabilities a peer can announce. Absence means "unsupported". */
export const CAPABILITIES = [
  /** Direct WebRTC DataChannel between peers. */
  'webrtc.direct',
  /** Binary frames can be relayed (encrypted) by the signaling/relay service. */
  'relay.blind',
  /** Receiver can write into a user-chosen directory handle (File System Access / Tauri). */
  'fs.directory',
  /** Receiver can request a download per file (browser fallback). */
  'fs.download',
  /** Resume of an interrupted transfer is supported by this implementation. */
  'transfer.resume',
  /** Peer can pause/resume individual transfers on request. */
  'transfer.pause',
  /** Sending whole folders (including empty directories) is supported. */
  'transfer.folders',
  /** Integrity manifest (per-chunk + whole-file digests) is supported. */
  'transfer.integrity',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/** Intersection of both peers' announced capabilities. */
export function negotiateCapabilities(a: readonly string[], b: readonly string[]): Set<Capability> {
  const other = new Set(b);
  const out = new Set<Capability>();
  for (const cap of a) {
    if (other.has(cap) && isCapability(cap)) out.add(cap);
  }
  return out;
}

export class ProtocolVersionError extends Error {
  readonly code = 'PROTOCOL_VERSION_MISMATCH';
  constructor(
    readonly local: string,
    readonly remote: string,
  ) {
    super(`Incompatible protocol version: local ${local}, remote ${remote}`);
    this.name = 'ProtocolVersionError';
  }
}

export function assertCompatible(remoteVersion: string): void {
  const remoteMajor = Number.parseInt(remoteVersion.split('.')[0] ?? '', 10);
  if (!Number.isFinite(remoteMajor) || remoteMajor !== PROTOCOL_MAJOR) {
    throw new ProtocolVersionError(PROTOCOL_VERSION, remoteVersion);
  }
}
