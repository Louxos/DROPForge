/**
 * Canonical JSON: the byte-exact serialisation used inside handshake
 * transcripts and manifest hashes. Two independent implementations must
 * produce the same bytes, so the rules are fixed:
 *   - object keys sorted by code point,
 *   - no insignificant whitespace,
 *   - only string | number (finite) | boolean | null | array | plain object,
 *   - no `undefined`, no functions, no symbols, no cycles.
 */

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

export class CanonicalJsonError extends TypeError {
  readonly code = 'CANONICAL_JSON_INVALID';
}

function encode(value: CanonicalValue, path: string, seen: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalJsonError(`Non-finite number at ${path}`);
      // -0 and 0 must serialise identically.
      return JSON.stringify(value === 0 ? 0 : value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (seen.has(value)) throw new CanonicalJsonError(`Circular reference at ${path}`);
      seen.add(value);
      let out: string;
      if (Array.isArray(value)) {
        out = `[${value.map((item, i) => encode(item as CanonicalValue, `${path}[${i}]`, seen)).join(',')}]`;
      } else {
        const keys = Object.keys(value).sort();
        out = `{${keys
          .map((key) => `${JSON.stringify(key)}:${encode((value as Record<string, CanonicalValue>)[key] as CanonicalValue, `${path}.${key}`, seen)}`)
          .join(',')}}`;
      }
      seen.delete(value);
      return out;
    }
    default:
      throw new CanonicalJsonError(`Unsupported value type "${typeof value}" at ${path}`);
  }
}

/** Serialises a value that is already known to be canonically encodable. */
export function canonicalJsonUnsafe(value: unknown): string {
  return encode(value as CanonicalValue, '$', new Set<object>());
}

export function canonicalJson(value: CanonicalValue): string {
  return canonicalJsonUnsafe(value);
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJsonUnsafe(value));
}
