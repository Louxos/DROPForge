import { describe, expect, it } from 'vitest';
import {
  InvalidTransitionError,
  assertTransition,
  canTransition,
  isActive,
  isTerminal,
  nextState,
  TRANSFER_STATES,
} from './state-machine.js';

describe('transfer state machine', () => {
  it('exposes exactly the states from the specification', () => {
    expect([...TRANSFER_STATES]).toEqual([
      'queued',
      'connecting',
      'transferring',
      'paused',
      'interrupted',
      'verifying',
      'completed',
      'cancelled',
      'failed',
    ]);
  });

  it('never reaches completed without going through verifying', () => {
    expect(canTransition('transferring', 'completed')).toBe(false);
    expect(canTransition('queued', 'completed')).toBe(false);
    expect(nextState('transferring', 'verified')).toBeUndefined();
    expect(nextState('verifying', 'verified')).toBe('completed');
  });

  it('follows the nominal path', () => {
    let state = nextState('queued', 'start');
    expect(state).toBe('connecting');
    state = nextState(state!, 'connected');
    expect(state).toBe('transferring');
    state = nextState(state!, 'verify');
    expect(state).toBe('verifying');
    state = nextState(state!, 'verified');
    expect(state).toBe('completed');
  });

  it('refuses pause when the peer did not announce support', () => {
    expect(canTransition('transferring', 'paused', { pauseSupported: false })).toBe(false);
    expect(nextState('transferring', 'pause', { pauseSupported: false })).toBeUndefined();
    expect(nextState('transferring', 'pause', { pauseSupported: true })).toBe('paused');
  });

  it('treats terminal states as final, except an explicit retry from failed', () => {
    for (const terminal of ['completed', 'cancelled'] as const) {
      expect(isTerminal(terminal)).toBe(true);
      expect(nextState(terminal, 'cancel')).toBeUndefined();
      expect(nextState(terminal, 'fail')).toBeUndefined();
      expect(nextState(terminal, 'start')).toBeUndefined();
    }
    expect(nextState('failed', 'retry')).toBe('queued');
    expect(nextState('completed', 'retry')).toBeUndefined();
  });

  it('reports integrity failures as a failure, not as a success', () => {
    expect(nextState('verifying', 'integrityFailed')).toBe('failed');
  });

  it('allows cancelling from every non-terminal state', () => {
    for (const state of ['queued', 'connecting', 'transferring', 'paused', 'interrupted', 'verifying'] as const) {
      expect(nextState(state, 'cancel')).toBe('cancelled');
    }
  });

  it('only lets interrupted transfers reconnect or restart', () => {
    expect(nextState('interrupted', 'reconnect')).toBe('connecting');
    expect(nextState('interrupted', 'connected')).toBe('transferring');
    expect(nextState('paused', 'connected')).toBeUndefined();
  });

  it('throws a precise error when a transition is forced', () => {
    expect(() => assertTransition('completed', 'connecting')).toThrow(InvalidTransitionError);
    try {
      assertTransition('queued', 'verifying');
    } catch (error) {
      expect((error as InvalidTransitionError).from).toBe('queued');
      expect((error as InvalidTransitionError).to).toBe('verifying');
      expect((error as InvalidTransitionError).code).toBe('TRANSFER_INVALID_TRANSITION');
    }
  });

  it('classifies active states', () => {
    expect(isActive('transferring')).toBe(true);
    expect(isActive('queued')).toBe(true);
    expect(isActive('paused')).toBe(false);
    expect(isActive('completed')).toBe(false);
  });
});
