/**
 * Transfer orchestration: the few steps that turn "these files, that peer" into a
 * running transfer, shared by the desktop app, the PWA and the tests.
 *
 * Keeping this here (and not in the UI) is what makes the product honest: the
 * offer/decision/accept exchange exists in exactly one implementation, so the UI
 * cannot invent a shortcut that skips the user's approval or the integrity check.
 */
import { DropForgeError, ERROR_CODES, type SourceFile } from '@dropforge/app-core';
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
import { TransferReceiver, type DecisionRequest, type ReceiverOutcome } from './receiver.js';
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
    const reason: TransferReject['reason'] | 'unreachable' = reject?.reason ?? 'unreachable';
    return {
      decisions,
      outcome: {
        outcome: reason === 'declined' ? 'cancelled' : 'failed',
        bytesDone: 0,
        verifiedFiles: 0,
        unavailable: [],
        failed: [],
        errorCode: reason === 'declined' ? ERROR_CODES.TRANSFER_DECLINED : ERROR_CODES.CONNECTION_LOST,
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
  /** Called when an offer arrives, with everything the receiving side knows. */
  requestDecision: (request: DecisionRequest, offer: TransferOffer) => Promise<{
    accepted: boolean;
    decisions: ConflictDecision['decisions'];
    rejectReason?: TransferReject['reason'];
  }>;
  /** Runs the transfer once the user (or the policy) approved it. */
  runReceiver: (
    offer: TransferOffer,
    answer: { accepted: boolean; decisions: ConflictDecision['decisions']; rejectReason?: TransferReject['reason'] },
  ) => TransferReceiver;
  /** How long to wait for an offer before giving up. */
  offerTimeoutMs?: number;
}

export interface ReceiveTransferResult {
  outcome: ReceiverOutcome;
  offer: TransferOffer;
  /** The instance that ran: `resumeState()` and `refusedEntries` live here. */
  receiver: TransferReceiver;
}

/**
 * Waits for an offer on the session and runs the receiving side. Used by the apps
 * so the "accept / refuse" decision always happens before a single byte is written.
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

  if (!offer) {
    throw new DropForgeError(ERROR_CODES.CONNECTION_TIMEOUT, 'The other device did not send anything to receive', {
      retryable: true,
    });
  }

  const answer = await options.requestDecision({ offer, conflicts: [], freeSpace: undefined }, offer);
  const receiver = options.runReceiver(offer, answer);
  const outcome = await receiver.run();
  return { outcome, offer, receiver };
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
