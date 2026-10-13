/**
 * Shared byte/string encodings. One implementation for the browser, Node and
 * the tests, so a transcript hashed on one side is byte-identical on the other.
 * These helpers are runtime-agnostic: `btoa`/`atob`/`TextEncoder` exist in both
 * modern browsers and Node ≥ 16.
 */

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('Invalid base64url input');
  const normalised = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Cryptographically secure random bytes from the platform CSPRNG. */
export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('This runtime does not expose a cryptographically secure random generator');
  }
  crypto.getRandomValues(out);
  return out;
}
