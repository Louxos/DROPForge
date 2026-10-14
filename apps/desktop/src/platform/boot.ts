/**
 * Boot sequencing for the Windows shell.
 *
 * The rule this file exists for: an application whose interface fails to start must
 * *say so* instead of leaving an invisible window behind. The old shell hid the window
 * by configuration and only revealed it from the interface — so any failure in boot
 * (an unreachable database, a plugin that refused to load) produced exactly the worst
 * possible symptom: launching DropForge appeared to do nothing at all.
 *
 * Everything here is pure logic, testable without Tauri: run the steps, stop at the
 * first failure, name it, and sanitise what is shown and logged.
 */

/** The boot phases, in order. Names are shown to the person and written to the log. */
export type BootStepName = 'data' | 'identity' | 'settings' | 'updates' | 'interface';

export const BOOT_STEP_LABELS: Record<BootStepName, { fr: string; en: string }> = {
  data: { fr: 'Ouverture des données locales', en: 'Opening local data' },
  identity: { fr: 'Préparation de l’identité de cet appareil', en: 'Preparing this device identity' },
  settings: { fr: 'Chargement des réglages', en: 'Loading settings' },
  updates: { fr: 'Préparation des mises à jour', en: 'Preparing updates' },
  interface: { fr: 'Affichage de l’interface', en: 'Rendering the interface' },
};

export interface BootStep<T> {
  name: BootStepName;
  run: () => Promise<T>;
}

/** Thrown when a step fails. Keeps *which* step, so the message can be truthful. */
export class BootFailure extends Error {
  constructor(
    readonly step: BootStepName,
    // `Error.cause` exists since ES2022; overriding it keeps the standard field.
    override readonly cause: unknown,
  ) {
    super(`boot step "${step}" failed`);
    this.name = 'BootFailure';
  }
}

/**
 * Runs the steps in order and stops at the first failure.
 *
 * The steps return different things (a store, an identity, a language, an update
 * source), so the tuple type is preserved: flattening them into one array type would
 * force the call site to cast, which is exactly how a boot sequence drifts out of
 * sync with what it actually produces.
 *
 * The started steps are reported as they begin, so the screen can show real progress
 * rather than an animated lie.
 */
export async function runBootSteps<const T extends readonly unknown[]>(
  steps: { readonly [K in keyof T]: BootStep<T[K]> },
  onStep?: (step: BootStepName) => void,
): Promise<T> {
  const results: unknown[] = [];
  for (const step of steps as readonly BootStep<unknown>[]) {
    onStep?.(step.name);
    try {
      results.push(await step.run());
    } catch (error) {
      throw new BootFailure(step.name, error);
    }
  }
  return results as unknown as T;
}

/**
 * Turns any thrown value into one bounded, single-line description.
 *
 * Diagnostics go to a file the user may hand to someone else: the text must be
 * useful, never multi-line (which could forge log entries) and never unbounded. A
 * failure that carries no message at all says so, rather than showing a bare "Error:".
 */
export function describeError(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  // "Error:" alone, or "TypeError:" alone: the name without any message is not a
  // diagnosis, so it is treated as an empty description.
  const bareName = /^[A-Za-z0-9_$.]*(Error|Exception)$/.test(cleaned.replace(/[:]+$/, '').trim());
  const useful = bareName ? '' : cleaned;
  const bounded = useful.length > 600 ? `${useful.slice(0, 597)}…` : useful;
  return bounded.length > 0 ? bounded : 'cause inconnue / unknown cause';
}

/** The message shown on the recovery screen: what failed, in both languages. */
export function failureText(failure: unknown): { step: BootStepName | 'unknown'; detail: string } {
  if (failure instanceof BootFailure) {
    return { step: failure.step, detail: describeError(failure.cause) };
  }
  return { step: 'unknown', detail: describeError(failure) };
}

/**
 * Is the interface actually on screen?
 *
 * A mounted React tree with no rendered content is a failure the person can see; this
 * check turns it into a failure the application can *report*. It looks for real
 * content, not for the loading screen.
 */
export function interfaceRendered(root: ParentNode | null | undefined): boolean {
  if (!root) return false;
  const shell = root.querySelector('[data-dropforge-shell]');
  if (!shell) return false;
  return (shell.textContent ?? '').trim().length > 0;
}
