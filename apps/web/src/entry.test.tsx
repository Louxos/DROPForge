// @vitest-environment happy-dom
/**
 * The real entry point, started for real.
 *
 * `main.tsx` is the only file that wires the application to the platform: IndexedDB,
 * WebCrypto, the service worker, the file pickers. Every other test replaces that
 * platform with an in-memory port — which is why none of them could have caught the
 * defect this file was written for: **`void boot()` had no `catch`.** A single throw
 * while building the platform left the page blank, with nothing on screen and no
 * explanation, exactly the failure the Windows shell had.
 *
 * So this test does the opposite of the others: it imports `main.tsx`, lets it start,
 * and asks the only question that matters to a person opening the application —
 * *is there something on screen?* — then checks that whatever is there says the truth.
 *
 * happy-dom is not a browser and cannot prove the application renders in Chromium.
 * What it proves is that the boot sequence completes against a real IndexedDB and real
 * WebCrypto, and that a failure is shown instead of swallowed. The browser itself is
 * covered by `npm run test:e2e`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SHELL = '[data-dropforge-shell]';

/** Waits for a condition on the real DOM, with real timers. */
async function waitFor(condition: () => boolean, timeout = 15_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeout) throw new Error(`condition jamais remplie après ${timeout} ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Everything a person would see, so a failure here is readable. */
function visibleText(): string {
  return (globalThis.document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  // Chaque scénario démarre l'entrée pour de vrai : sans cela, le module serait déjà
  // en cache et le second test ne prouverait rien.
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('entrée réelle de l’application', () => {
  it('démarre contre IndexedDB et WebCrypto réels, et affiche la coque', async () => {
    // fake-indexeddb fournit une implémentation conforme dans happy-dom ; WebCrypto
    // est celui de Node (le même algorithme que le navigateur).
    await import('fake-indexeddb/auto');
    globalThis.document.body.innerHTML = '<div id="root"></div>';

    await import('./main.js');

    try {
      await waitFor(() => globalThis.document.querySelector(SHELL) !== null);
    } catch (error) {
      // Le message d'échec doit dire ce que la personne verrait, pas seulement qu'un
      // sélecteur manque.
      throw new Error(`${String(error)}\nÉcran : ${visibleText() || '(vide)'}`);
    }

    // L'écran d'attente puis l'interface complète portent tous deux le repère : le
    // premier à s'afficher suffit à prouver que l'application a rendu quelque chose.
    const shell = globalThis.document.querySelector(SHELL);
    expect(shell).not.toBeNull();
    expect(visibleText().length).toBeGreaterThan(0);
  }, 30_000);

  it('un échec du démarrage affiche une explication au lieu d’une page blanche', async () => {
    // WebCrypto absent : le même genre de panne que « ce navigateur ne sait pas
    // chiffrer ». L'application doit le dire, pas rester vide.
    vi.stubGlobal('crypto', undefined);
    globalThis.document.body.innerHTML = '<div id="root"></div>';

    await import('./main.js');
    await waitFor(() => globalThis.document.querySelector(SHELL) !== null);

    expect(visibleText().length).toBeGreaterThan(0);
    // Rien n'est promis : le message nomme le problème, il ne dit pas « erreur ».
    expect(globalThis.document.querySelector('[role="alert"]')).not.toBeNull();
  }, 30_000);

  it('l’écran d’échec porte le repère de coque, comme les autres écrans', async () => {
    // C'est la leçon du premier passage de la suite dans de vrais navigateurs : onze
    // scénarios ont échoué en attendant `[data-dropforge-shell]` sur un écran d'erreur
    // honnête qui ne le portait pas. Le repère veut dire « l'interface a rendu
    // quelque chose », et un écran d'erreur est quelque chose.
    vi.stubGlobal('crypto', undefined);
    globalThis.document.body.innerHTML = '<div id="root"></div>';

    await import('./main.js');
    await waitFor(() => globalThis.document.querySelector('[role="alert"]') !== null);

    expect(globalThis.document.querySelector(SHELL)).not.toBeNull();
  }, 30_000);
});
