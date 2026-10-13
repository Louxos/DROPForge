/**
 * Error model.
 *
 * Every user-visible failure carries a stable, machine-readable `code` that the
 * UI translates. Messages are written to be shown as-is (plain language, no
 * paths, no keys, no stack traces, no internal addresses).
 */

export type ErrorSeverity = 'info' | 'warning' | 'error';

export interface DropForgeErrorInit {
  severity?: ErrorSeverity;
  /** Extra, non-sensitive context for logs (never secrets, never file contents). */
  context?: Record<string, string | number | boolean>;
  /** Whether retrying the same operation may succeed. */
  retryable?: boolean;
  cause?: unknown;
}

export class DropForgeError extends Error {
  readonly code: string;
  readonly severity: ErrorSeverity;
  readonly context: Record<string, string | number | boolean>;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(code: string, message: string, init: DropForgeErrorInit = {}) {
    super(message);
    this.name = 'DropForgeError';
    this.code = code;
    this.severity = init.severity ?? 'error';
    this.context = init.context ?? {};
    this.retryable = init.retryable ?? false;
    this.cause = init.cause;
  }

  /** Safe for logs: code + message + context, never the raw cause chain. */
  toLogObject(): Record<string, unknown> {
    return { code: this.code, message: this.message, ...this.context };
  }
}

/** Stable codes used across the app; kept together so the i18n files can be checked. */
export const ERROR_CODES = {
  // network / connection
  NO_COMMON_TRANSPORT: 'NO_COMMON_TRANSPORT',
  RELAY_UNAVAILABLE: 'RELAY_UNAVAILABLE',
  RELAY_QUOTA_REACHED: 'RELAY_QUOTA_REACHED',
  PEER_UNREACHABLE: 'PEER_UNREACHABLE',
  CONNECTION_LOST: 'CONNECTION_LOST',
  CONNECTION_TIMEOUT: 'CONNECTION_TIMEOUT',
  HANDSHAKE_FAILED: 'HANDSHAKE_FAILED',
  DEVICE_NOT_TRUSTED: 'DEVICE_NOT_TRUSTED',
  /**
   * The peer proved possession of a key, but not of the identity that was
   * announced (discovery, QR code or trusted-device record). This is a security
   * stop, never a retry on another path.
   */
  DEVICE_IDENTITY_MISMATCH: 'DEVICE_IDENTITY_MISMATCH',
  DEVICE_REVOKED: 'DEVICE_REVOKED',
  PAIRING_CODE_INVALID: 'PAIRING_CODE_INVALID',
  PAIRING_CODE_EXPIRED: 'PAIRING_CODE_EXPIRED',
  PAIRING_SECRET_MISMATCH: 'PAIRING_SECRET_MISMATCH',
  SAS_MISMATCH: 'SAS_MISMATCH',
  // storage / filesystem
  NO_SPACE_LEFT: 'NO_SPACE_LEFT',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  PATH_UNSAFE: 'PATH_UNSAFE',
  NAME_CONFLICT: 'NAME_CONFLICT',
  WRITE_FAILED: 'WRITE_FAILED',
  RESUME_MISMATCH: 'RESUME_MISMATCH',
  READ_FAILED: 'READ_FAILED',
  SOURCE_CHANGED: 'SOURCE_CHANGED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  // transfers
  TRANSFER_DECLINED: 'TRANSFER_DECLINED',
  TRANSFER_CANCELLED: 'TRANSFER_CANCELLED',
  INTEGRITY_FAILED: 'INTEGRITY_FAILED',
  UNSUPPORTED_OPERATION: 'UNSUPPORTED_OPERATION',
  TOO_MANY_FILES: 'TOO_MANY_FILES',
  TOO_LARGE: 'TOO_LARGE',
  TOO_MANY_TRANSFERS: 'TOO_MANY_TRANSFERS',
  BUSY: 'BUSY',
  // crypto / platform
  CRYPTO_UNAVAILABLE: 'CRYPTO_UNAVAILABLE',
  IDENTITY_UNAVAILABLE: 'IDENTITY_UNAVAILABLE',
  PLATFORM_UNSUPPORTED: 'PLATFORM_UNSUPPORTED',
  BACKGROUND_UNSUPPORTED: 'BACKGROUND_UNSUPPORTED',
  APP_CLOSED: 'APP_CLOSED',
  // sharing links
  HOSTED_SHARING_DISABLED: 'HOSTED_SHARING_DISABLED',
  LINK_EXPIRED: 'LINK_EXPIRED',
  LINK_REVOKED: 'LINK_REVOKED',
  LINK_NOT_FOUND: 'LINK_NOT_FOUND',
  LINK_QUOTA_REACHED: 'LINK_QUOTA_REACHED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Localised text lives in the app; the packages only ever emit codes. */
export const errorTranslationKey = (code: string): string => `errors.${code}`;

export function isDropForgeError(value: unknown): value is DropForgeError {
  return value instanceof DropForgeError;
}

/** Normalises anything thrown into a displayable error without leaking details. */
export function toDropForgeError(
  value: unknown,
  fallback: { code: string; message: string; retryable?: boolean },
): DropForgeError {
  if (isDropForgeError(value)) return value;
  return new DropForgeError(fallback.code, fallback.message, {
    retryable: fallback.retryable ?? false,
    cause: value,
  });
}

/**
 * Maps a DOMException/browser error to a code. Name-based on purpose: browsers
 * do not expose numeric codes reliably across engines.
 */
export function fromPlatformError(value: unknown): DropForgeError {
  // Errors we produced ourselves already carry the right code and message.
  if (isDropForgeError(value)) return value;
  const name = typeof (value as { name?: unknown })?.name === 'string' ? (value as { name: string }).name : '';
  const message = typeof (value as { message?: unknown })?.message === 'string' ? (value as { message: string }).message : '';
  switch (name) {
    case 'QuotaExceededError':
      return new DropForgeError(ERROR_CODES.NO_SPACE_LEFT, 'The destination device has no free space left', {
        retryable: false,
      });
    case 'NotFoundError':
      return new DropForgeError(ERROR_CODES.READ_FAILED, 'A file or folder could not be found', { retryable: true });
    case 'NotAllowedError':
    case 'SecurityError':
      return new DropForgeError(
        ERROR_CODES.PERMISSION_DENIED,
        'The permission needed for this action was not granted',
        { retryable: true },
      );
    case 'NotReadableError':
    case 'InvalidStateError':
      return new DropForgeError(ERROR_CODES.READ_FAILED, 'A file could not be read (it may be in use)', {
        retryable: true,
      });
    case 'AbortError':
      return new DropForgeError(ERROR_CODES.TRANSFER_CANCELLED, 'The operation was cancelled', { severity: 'info' });
    case 'NetworkError':
      return new DropForgeError(ERROR_CODES.CONNECTION_LOST, 'The connection was lost', { retryable: true });
    default:
      if (/space/i.test(message)) {
        return new DropForgeError(ERROR_CODES.NO_SPACE_LEFT, 'The destination device has no free space left');
      }
      return new DropForgeError(ERROR_CODES.WRITE_FAILED, 'This action could not be completed', { retryable: true });
  }
}
