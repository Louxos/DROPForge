/**
 * Transfer orchestration: the few steps that turn "these files, that peer" into a
 * running transfer, shared by the desktop app, the PWA and the tests.
 *
 * Keeping this here (and not in the UI) is what makes the product honest: the
 * offer/decision/accept exchange exists in exactly one implementation, so the UI
 * cannot invent a shortcut that skips the user's approval or the integrity check.
 */
import { DropForgeError, ERROR_CODES, type FileSystemPort, type SourceFile } from '@dropforge/app-core';
import {
  DATA_CHUNK_BYTES,
  HANDSHAKE_TIMEOUT_MS,
  type Clock,
  type Logger,
  type ConflictDecision,
  type ControlMessage,
  type TransferAccept,
  type TransferOffer,
  type TransferReject,
  type Unsubscribe,
} from '@dropforge/protocol';
import type { PeerSession } from './session.js';
import { TransferSender, type SenderOutcome, type TransferProgress } from './sender.js';
import {
  TransferReceiver,
  type ConflictAction,
  type DecisionRequest,
  type ReceiverOutcome,
} from './receiver.js';
import { buildManifest } from './manifest.js';

export interface SendTransferOptions {
  session: PeerSession;
  offer: TransferOffer;
  sources: ReadonlyMap<number, SourceFile>;
  clock: Clock;
  logger?: Logger;
  /** Stream index reserved for this transfer (see PeerSession.registerStream). */
  streamIndex?: number;
  /**
   * Progress hook. The running sender is handed over so the caller can pause,
   * cancel or resume it without keeping a reference of its own.
   */
  onProgress?: (progress: TransferProgress, sender: TransferSender) => void;
  /** How long we wait for the receiving side to accept or refuse the offer. */
  acceptTimeoutMs?: number;
  ackTimeoutMs?: number;
  progressThrottleMs?: number;
}

export interface SendTransferResult {
  outcome: SenderOutcome;
  /** The accept message, when the peer accepted (useful for the UI and the tests). */
  accept?: TransferAccept;
  /** Conflict decisions received from the peer. */
  decisions: ConflictDecision['decisions'];
  /** The running instance, once the peer accepted: pause/cancel/resume live here. */
  sender?: TransferSender;
}

/**
 * Sends a prepared offer and runs the transfer to its end (success, refusal,
 * cancellation or interruption). The promise always resolves with the real
 * outcome: it never throws for a transfer that simply did not succeed.
 */
export async function sendTransfer(options: SendTransferOptions): Promise<SendTransferResult> {
  const { session, offer } = options;
  const transferId = offer.transferId;
  const timeoutMs = options.acceptTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  let decisions: ConflictDecision['decisions'] = [];
  let accept: TransferAccept | undefined;
  let reject: TransferReject | undefined;
  const unsubscribes: Unsubscribe[] = [];

  const answer = new Promise<void>((resolve) => {
    unsubscribes.push(
      session.events.on('control', (message: ControlMessage) => {
        if (!('transferId' in message) || message.transferId !== transferId) return;
        if (message.t === 'conflictDecision') {
          decisions = message.decisions;
          return;
        }
        if (message.t === 'transferAccept') {
          accept = message;
          resolve();
          return;
        }
        if (message.t === 'transferReject') {
          reject = message;
          resolve();
        }
      }),
    );
  });

  try {
    await session.sendControl(offer);
    const timeout = new Promise<void>((resolve) => {
      options.clock.setTimeout(resolve, timeoutMs);
    });
    await Promise.race([answer, timeout]);
  } finally {
    for (const unsubscribe of unsubscribes) unsubscribe();
  }

  if (!accept) {
    // The peer refused the offer, or never answered. This is a failure, not a
    // cancellation by the user: the UI must not say "cancelled" when the other
    // device said no, and the reason it gave has to survive.
    const reason: TransferReject['reason'] | 'unreachable' = reject?.reason ?? 'unreachable';
    const code =
      reason === 'declined'
        ? ERROR_CODES.TRANSFER_DECLINED
        : reason === 'noSpace'
          ? ERROR_CODES.NO_SPACE_LEFT
          : reason === 'busy'
            ? ERROR_CODES.BUSY
            : reason === 'tooLarge'
              ? ERROR_CODES.TOO_LARGE
              : reason === 'cancelled'
                ? ERROR_CODES.TRANSFER_CANCELLED
                : ERROR_CODES.CONNECTION_LOST;
    return {
      decisions,
      outcome: {
        outcome: reason === 'cancelled' ? 'cancelled' : 'failed',
        bytesDone: 0,
        verifiedFiles: 0,
        unavailable: [],
        failed: [],
        errorCode: code,
      },
    };
  }

  const sender: TransferSender = new TransferSender({
    session,
    streamIndex: options.streamIndex ?? 1,
    offer,
    sources: options.sources,
    accept,
    decisions,
    clock: options.clock,
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.onProgress ? { onProgress: (progress: TransferProgress) => options.onProgress?.(progress, sender) } : {}),
    ...(options.ackTimeoutMs !== undefined ? { ackTimeoutMs: options.ackTimeoutMs } : {}),
    ...(options.progressThrottleMs !== undefined ? { progressThrottleMs: options.progressThrottleMs } : {}),
  });
  const outcome = await sender.run();
  return { outcome, accept, decisions, sender };
}

export interface ReceiveTransferOptions {
  session: PeerSession;
  clock: Clock;
  logger?: Logger;
  streamIndex?: number;
  /** Where the received bytes are written. */
  store: FileSystemPort;
  /** How conflicts are resolved when the user does not answer individually. */
  policy?: ConflictAction;
  /** Ranges already durable from a previous session (resume). */
  resume?: { manifestHash: string; files: Array<{ index: number; ranges: Array<{ start: number; end: number }> }> };
  /**
   * Asks the user. Called *after* the receiving side has computed the real
   * conflicts and the free space it has, never before: the question must always
   * describe the actual situation (see docs/SPEC.md).
   */
  requestDecision: (request: DecisionRequest, offer: TransferOffer) => Promise<{
    accepted: boolean;
    decisions: ConflictDecision['decisions'];
    rejectReason?: 'declined' | 'noSpace' | 'busy' | 'unsupported' | 'tooLarge';
  }>;
  /** Free space known by the platform, when it exposes it. */
  freeSpaceBytes?: number;
  progressIntervalMs?: number;
  progressThrottleMs?: number;
  stallTimeoutMs?: number;
  /** How long to wait for an offer before giving up. */
  offerTimeoutMs?: number;
  /**
   * Called the moment the receiver exists, before it runs: the UI needs it to
   * pause, cancel or inspect the transfer while it is happening.
   */
  onReceiver?: (receiver: TransferReceiver) => void;
}

export interface ReceiveTransferResult {
  outcome: ReceiverOutcome;
  offer: TransferOffer;
  /** The instance that ran: `resumeState()` and `refusedEntries` live here. */
  receiver: TransferReceiver;
}

/**
 * Waits for an offer on the session and runs the receiving side. Used by the apps,
 * so the "accept / refuse" decision always happens before a single byte is written
 * and always describes the real conflicts.
 */
export async function receiveTransfer(options: ReceiveTransferOptions): Promise<ReceiveTransferResult> {
  const timeoutMs = options.offerTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  let offer: TransferOffer | undefined;
  let resolveOffer: (() => void) | undefined;
  const arrived = new Promise<void>((resolve) => {
    resolveOffer = resolve;
  });
  const unsubscribe = options.session.events.on('control', (message: ControlMessage) => {
    if (offer !== undefined || message.t !== 'transferOffer') return;
    offer = message;
    resolveOffer?.();
  });

  try {
    await Promise.race([
      arrived,
      new Promise<void>((resolve) => {
        options.clock.setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    unsubscribe();
  }

  const received = offer;
  if (!received) {
    throw new DropForgeError(ERROR_CODES.CONNECTION_TIMEOUT, 'The other device did not send anything to receive', {
      retryable: true,
    });
  }

  const receiver = new TransferReceiver({
    session: options.session,
    offer: received,
    store: options.store,
    clock: options.clock,
    streamIndex: options.streamIndex ?? 1,
    policy: options.policy ?? 'ask',
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.resume ? { resume: options.resume } : {}),
    ...(options.freeSpaceBytes !== undefined ? { freeSpaceBytes: options.freeSpaceBytes } : {}),
    ...(options.progressIntervalMs !== undefined ? { progressIntervalMs: options.progressIntervalMs } : {}),
    ...(options.progressThrottleMs !== undefined ? { progressThrottleMs: options.progressThrottleMs } : {}),
    ...(options.stallTimeoutMs !== undefined ? { stallTimeoutMs: options.stallTimeoutMs } : {}),
    requestDecision: async (request) => {
      // The receiver knows the real conflicts and free space at this point: the
      // question handed to the user contains those, not guesses.
      const answer = await options.requestDecision(request, received);
      return answer.accepted
        ? { accepted: true, decisions: answer.decisions }
        : {
            accepted: false,
            decisions: answer.decisions,
            ...(answer.rejectReason ? { rejectReason: answer.rejectReason } : {}),
          };
    },
  });
  options.onReceiver?.(receiver);
  const outcome = await receiver.run();
  return { outcome, offer: received, receiver };
}

/** Builds an offer plus the map of sources, in one step, for the apps. */
export function prepareTransfer(options: { files: SourceFile[]; chunkBytes?: number }): {
  offer: TransferOffer;
  sources: Map<number, SourceFile>;
  manifestHash: string;
} {
  const files = options.files;
  const built = buildManifest({ files, chunkBytes: options.chunkBytes ?? DATA_CHUNK_BYTES });
  return {
    offer: built.offer,
    sources: new Map(files.map((file, index) => [index, file])),
    manifestHash: built.manifestHash,
  };
}
