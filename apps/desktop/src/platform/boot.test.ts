// @vitest-environment happy-dom
/**
 * Tests for the Windows boot sequence.
 *
 * They cover the failure that mattered in practice: a step that throws must produce a
 * named, bounded, single-line description and must not stop the application from
 * opening a window that says so.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BootFailure,
  describeError,
  failureText,
  interfaceRendered,
  runBootSteps,
  type BootStepName,
} from './boot.js';

const step = <T>(name: BootStepName, value: T) => ({ name, run: async () => value });

describe('boot sequence', () => {
  it('runs the steps in order and returns their results', async () => {
    const order: BootStepName[] = [];
    const results = await runBootSteps(
      [step('data', 1), step('identity', 2), step('interface', 3)],
      (name) => order.push(name),
    );

    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual(['data', 'identity', 'interface']);
  });

  it('stops at the first failure and names the step that failed', async () => {
    const laterStep = vi.fn(async () => 'never');

    await expect(
      runBootSteps([
        step('data', 'ok'),
        {
          name: 'identity',
          run: async () => {
            throw new Error('the database could not be opened');
          },
        },
        { name: 'interface', run: laterStep },
      ]),
    ).rejects.toBeInstanceOf(BootFailure);

    expect(laterStep).not.toHaveBeenCalled();
  });

  it('keeps the original cause, so the screen can be precise rather than vague', async () => {
    const failure = await runBootSteps([
      {
        name: 'settings',
        run: async () => {
          throw new Error('STORAGE_UNAVAILABLE');
        },
      },
    ]).catch((error: unknown) => error);

    expect(failureText(failure)).toEqual({ step: 'settings', detail: 'Error: STORAGE_UNAVAILABLE' });
  });

  it('describes an unknown failure without pretending to know more', async () => {
    const failure = await runBootSteps([
      {
        name: 'updates',
        run: async () => {
          throw 'no';
        },
      },
    ]).catch((error: unknown) => error);

    expect(failureText(failure)).toEqual({ step: 'updates', detail: 'no' });
    expect(failureText(new Error('unrelated'))).toEqual({
      step: 'unknown',
      detail: 'Error: unrelated',
    });
  });

  it('allows a failed boot to be retried: the second run succeeds', async () => {
    let attempt = 0;
    const steps = [
      {
        name: 'data' as const,
        run: async () => {
          attempt += 1;
          if (attempt === 1) throw new Error('transient');
          return 'ready';
        },
      },
    ];

    await expect(runBootSteps(steps)).rejects.toBeInstanceOf(BootFailure);
    await expect(runBootSteps(steps)).resolves.toEqual(['ready']);
  });
});

describe('error descriptions', () => {
  it('collapses a multi-line message into one line, so a log entry cannot be forged', () => {
    expect(describeError(new Error('line one\n[999] fake: entry\r\nline two'))).toBe(
      'Error: line one [999] fake: entry line two',
    );
  });

  it('bounds the length of what is written and shown', () => {
    const described = describeError(new Error('x'.repeat(5000)));
    expect(described.length).toBeLessThanOrEqual(600);
    expect(described.endsWith('…')).toBe(true);
  });

  it('answers something useful even when the failure carries nothing', () => {
    expect(describeError(undefined)).toBe('undefined');
    expect(describeError(new Error(''))).toContain('cause inconnue');
  });
});

describe('interface rendered', () => {
  const withShell = (text: string): HTMLElement => {
    const container = document.createElement('div');
    const shell = document.createElement('div');
    shell.setAttribute('data-dropforge-shell', '');
    shell.textContent = text;
    container.append(shell);
    return container;
  };

  it('accepts a shell that carries actual content', () => {
    expect(interfaceRendered(withShell('Transfert'))).toBe(true);
  });

  it('refuses an empty shell: a mounted but blank interface is a failure, not a success', () => {
    expect(interfaceRendered(withShell('  '))).toBe(false);
  });

  it('refuses a missing root', () => {
    expect(interfaceRendered(null)).toBe(false);
    expect(interfaceRendered(undefined)).toBe(false);
  });
});
