/**
 * The one transfer state machine, shared by the engine, the UI and the tests.
 *
 *   queued → connecting → transferring → verifying → completed
 *               ↘ interrupted ↗        ↘ failed
 *   (paused) is only reachable from transferring, and only when the peer
 *   announced the `transfer.pause` capability; otherwise the UI says so.
 *
 * Invariants enforced here (spec §9):
 *  - `completed` is reachable ONLY through `verifying`: a transfer is never
 *    reported as done before its integrity check succeeded;
 *  - terminal states (`completed`, `cancelled`, `failed`) never transition,
 *    except `failed → queued` for an explicit retry;
 *  - `paused` cannot be entered while verifying or after completion.
 */

export const TRANSFER_STATES = [
  'queued',
  'connecting',
  'transferring',
  'paused',
  'interrupted',
  'verifying',
  'completed',
  'cancelled',
  'failed',
] as const;

export type TransferState = (typeof TRANSFER_STATES)[number];

export type TransferEvent =
  | 'start'
  | 'connected'
  | 'data'
  | 'pause'
  | 'resume'
  | 'disconnect'
  | 'verify'
  | 'verified'
  | 'integrityFailed'
  | 'cancel'
  | 'fail'
  | 'retry'
  | 'reconnect';

const TRANSITIONS: Record<TransferState, readonly TransferState[]> = {
  queued: ['connecting', 'cancelled', 'failed'],
  connecting: ['transferring', 'interrupted', 'cancelled', 'failed'],
  transferring: ['paused', 'interrupted', 'verifying', 'cancelled', 'failed'],
  paused: ['transferring', 'interrupted', 'cancelled', 'failed'],
  interrupted: ['connecting', 'transferring', 'cancelled', 'failed'],
  verifying: ['completed', 'failed', 'interrupted', 'cancelled'],
  completed: [],
  cancelled: [],
  failed: ['queued'],
};

export const TERMINAL_STATES: readonly TransferState[] = ['completed', 'cancelled', 'failed'];

export interface TransitionContext {
  /** Peer announced `transfer.pause`. */
  pauseSupported?: boolean;
  /** Resume state exists (manifest + partial data on disk). */
  resumable?: boolean;
}

export class InvalidTransitionError extends Error {
  readonly code = 'TRANSFER_INVALID_TRANSITION';
  constructor(
    readonly from: TransferState,
    readonly to: TransferState,
  ) {
    super(`Transfer cannot go from "${from}" to "${to}"`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition(
  from: TransferState,
  to: TransferState,
  context: TransitionContext = {},
): boolean {
  if (from === to) return true;
  if (!TRANSITIONS[from].includes(to)) return false;
  if (to === 'paused' && context.pauseSupported === false) return false;
  if ((to === 'transferring' || to === 'connecting') && from === 'paused' && context.resumable === false) {
    return false;
  }
  return true;
}

export function assertTransition(
  from: TransferState,
  to: TransferState,
  context: TransitionContext = {},
): void {
  if (!canTransition(from, to, context)) throw new InvalidTransitionError(from, to);
}

export function isTerminal(state: TransferState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function isActive(state: TransferState): boolean {
  return !isTerminal(state) && state !== 'paused';
}

/**
 * Maps an event to the next state, or undefined when the event does not apply
 * to the current state (callers then keep the current state and may log it).
 */
export function nextState(
  state: TransferState,
  event: TransferEvent,
  context: TransitionContext = {},
): TransferState | undefined {
  const candidate = ((): TransferState | undefined => {
    switch (event) {
      case 'start':
        return state === 'queued' ? 'connecting' : undefined;
      case 'connected':
        return state === 'connecting' || state === 'interrupted' ? 'transferring' : undefined;
      case 'data':
        return state === 'connecting' ? 'transferring' : undefined;
      case 'pause':
        return state === 'transferring' ? 'paused' : undefined;
      case 'resume':
        return state === 'paused' ? 'transferring' : undefined;
      case 'disconnect':
        return state === 'transferring' || state === 'connecting' ? 'interrupted' : undefined;
      case 'verify':
        return state === 'transferring' ? 'verifying' : undefined;
      case 'verified':
        return state === 'verifying' ? 'completed' : undefined;
      case 'integrityFailed':
        return state === 'verifying' ? 'failed' : undefined;
      case 'cancel':
        return isTerminal(state) ? undefined : 'cancelled';
      case 'fail':
        return isTerminal(state) ? undefined : 'failed';
      case 'retry':
        return state === 'failed' ? 'queued' : undefined;
      case 'reconnect':
        return state === 'interrupted' ? 'connecting' : undefined;
      default:
        return undefined;
    }
  })();
  if (candidate === undefined) return undefined;
  return canTransition(state, candidate, context) ? candidate : undefined;
}
