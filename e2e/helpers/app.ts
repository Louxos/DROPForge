/**
 * Helpers shared by the end-to-end suites.
 *
 * Everything here drives the application the way a person would: by its visible
 * labels, in the shipped French interface. No internal API is called, no state is
 * injected — a helper that could not be performed by hand would not prove anything.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type BrowserContext, type Download, type Locator, type Page } from '@playwright/test';

/** French labels of the shipped interface (the app starts in French). */
export const L = {
  /**
   * The two entry choices. The transfer screen opens on them and nothing else: the
   * file picker, the code input and the hosting button only exist once one of the two
   * has been chosen. Every helper that needs one of those three goes through the
   * choice first — by hand, exactly as a person would.
   */
  chooseSend: 'Envoyer',
  chooseReceive: 'Recevoir',
  back: 'Retour',
  selectFiles: 'Choisir des fichiers',
  // Le libellé exact du dictionnaire (« Envoyer vers », `transfer.sendTo`) : le helper
  // cherchait « Envoyer à », qui n'existe nulle part dans l'interface — le clic
  // attendait donc un bouton qui ne viendrait jamais, et **aucun test de transfert
  // n'est jamais allé plus loin que cette ligne**.
  sendTo: 'Envoyer vers',
  receiveDevice: 'Recevoir d’un appareil',
  pairingCode: 'Code d’appairage',
  pasteCode: 'Coller un code ou un lien',
  connect: 'Se connecter',
  accept: 'Accepter',
  refuse: 'Refuser',
  confirmDevice: 'Nouvel appareil',
  incomingRequest: 'Demande de réception',
  queue: 'File d’attente',
  completed: 'Terminé',
  failed: 'Échec',
  verifying: 'Vérification',
  history: 'Historique',
  settings: 'Réglages',
  devicesNavigation: 'Appareils',
  /** Le libellé de l'onglet « transfert » dans la barre basse (et dans la barre latérale). */
  transfers: 'Transfert',
} as const;

/** A pair of devices, each with its own browser context, storage and identity. */
export interface Device {
  context: BrowserContext;
  page: Page;
}

/**
 * What each page said, collected from the moment it opened.
 *
 * A failure that reports only "selector not found" costs a whole round of debugging:
 * the browser console and the text on screen are the only things that know why. Every
 * page opened by `openDevice` is registered here, so any helper can attach them.
 */
const journals = new WeakMap<Page, string[]>();

/**
 * Everything a person would see, what the browser complained about, and **what the
 * application itself thinks** it is doing.
 *
 * `main.tsx` exposes the controller for diagnostics (`globalThis.dropforge`), so the
 * test can read the state the interface is rendering: whether it is connecting, which
 * transport method it tried, and the notices — including the error it reported. The
 * rendered text says what the user sees; this says why.
 */
export async function describePage(page: Page): Promise<string> {
  const text = await page
    .locator('body')
    .innerText({ timeout: 5_000 })
    .catch(() => '');
  // GitHub coupe une annotation à quelques milliers de caractères : l'écran entier
  // (près de 3 000 caractères sur les Réglages) pousserait la raison de l'échec hors
  // du message. Il est donc tronqué ici, et `attempt` place l'erreur *avant* lui.
  const screen = text.replace(/\s+/g, ' ').trim() || '(vide)';
  const state = await page
    .evaluate(() => {
      const controller = (globalThis as { dropforge?: { controller?: { state?: unknown } } }).dropforge?.controller;
      if (!controller?.state) return undefined;
      const snapshot = controller.state as Record<string, unknown>;
      return {
        ready: snapshot['ready'],
        connecting: snapshot['connecting'],
        connection: snapshot['connection'] ?? null,
        methodExplanation: snapshot['methodExplanation'] ?? [],
        notices: snapshot['notices'] ?? [],
        hasNewDeviceQuestion: Boolean(snapshot['newDevice']),
        pairingRoom: Boolean(snapshot['pairingRoom']),
      };
    })
    .catch(() => undefined);
  const problems = journals.get(page) ?? [];
  return [
    `État de l'application : ${state ? JSON.stringify(state) : '(contrôleur indisponible)'}`,
    problems.length > 0 ? `Journal du navigateur :\n${problems.join('\n')}` : 'Journal du navigateur : vide',
    `Écran : ${screen.length > 1_500 ? `${screen.slice(0, 1_500)} […]` : screen}`,
  ].join('\n');
}

/**
 * Runs one interaction and, if it fails, says what the page showed.
 *
 * The message is deliberately verbose: a failing browser test is read from a CI
 * annotation, where the only cheap thing to add is context.
 */
export async function attempt<T>(page: Page, what: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    // L'erreur vient en premier : c'est la seule partie qui explique l'échec, et une
    // annotation CI coupée au milieu doit la garder entière.
    throw new Error(`${what} : échec.\n${String(error)}\n${await describePage(page)}`);
  }
}

/**
 * Opens one of the two steps of the transfer screen.
 *
 * The application starts on the choice (« envoyer » or « recevoir »). The helpers below
 * that need the send form or the receiving panel click the choice first — and do
 * nothing when the step is already open, so a scenario that navigated there by itself
 * keeps working.
 *
 * `exact: true` matters: « Recevoir » is also the beginning of « Recevoir d'un
 * appareil », a different button on a different step.
 */
async function openStep(page: Page, label: string, marker: (page: Page) => Locator): Promise<void> {
  if (await marker(page).count()) return;
  // The other step may be open: the two choices only exist on the entry screen, so the
  // way there is « Retour ». Without this, a helper called from the send step would wait
  // twenty seconds for a button that is not on screen.
  const back = page.getByRole('button', { name: L.back, exact: true });
  if (await back.count()) {
    await back.first().click();
    await expect(page.getByRole('button', { name: L.chooseSend, exact: true })).toBeVisible({ timeout: 20_000 });
  }
  const choice = page.getByRole('button', { name: label, exact: true });
  await expect(choice).toBeVisible({ timeout: 20_000 });
  await choice.click();
  await expect(marker(page)).toBeVisible({ timeout: 20_000 });
}

/** Goes to the send step (the file form). */
export async function openSendStep(page: Page): Promise<void> {
  await openStep(page, L.chooseSend, (target) => target.locator('input[type="file"]').first());
}

/** Goes to the receiving step (the code panel and the code input). */
export async function openReceiveStep(page: Page): Promise<void> {
  await openStep(page, L.chooseReceive, (target) => target.locator('#df-code'));
}

/**
 * Opens a fresh device. Each context has its own IndexedDB, its own identity key pair
 * and its own service worker: two contexts really are two devices.
 */
export async function openDevice(context: BrowserContext): Promise<Device> {
  const page = await context.newPage();
  // Everything the page says, collected from the first moment: a failure that only
  // reports "selector not found" costs a whole debugging round, and the browser's own
  // console is the one place that knows why.
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`erreur JavaScript : ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console : ${message.text()}`);
  });
  journals.set(page, problems);

  await page.goto('/');

  // The application is ready when the shell is on screen (never a blank page: the
  // shell renders a loading state first, which is also what rules out a silent boot).
  //
  // Every screen carries `data-dropforge-shell`, the failure screen included: it means
  // "the interface rendered something". If it is missing, nothing rendered at all —
  // and the failure must say what the page contained, not just that a selector missed.
  try {
    await expect(page.locator('[data-dropforge-shell]')).toBeVisible({ timeout: 45_000 });
  } catch (error) {
    throw new Error(`La coque n'est jamais apparue.\n${await describePage(page)}\n\n${String(error)}`);
  }

  // A failure screen is a screen: it satisfies the check above, so it is caught here,
  // with the sentence it shows.
  if (await page.locator('.df-app--error').isVisible().catch(() => false)) {
    throw new Error(`L'application refuse de démarrer.\n${await describePage(page)}`);
  }

  return { context, page };
}



/** Starts showing a pairing code and returns it. */
export async function hostRoom(page: Page): Promise<string> {
  return attempt(page, 'affichage du code d’appairage', async () => {
    await openReceiveStep(page);
    await page.getByRole('button', { name: L.receiveDevice }).click();

    const codePanel = page.locator('.df-code');
    await expect(codePanel).toBeVisible({ timeout: 20_000 });
    const code = (await codePanel.textContent())?.trim() ?? '';
    expect(code.length).toBeGreaterThanOrEqual(4);
    return code;
  });
}

/** Types a pairing code and connects. */
export async function joinRoom(page: Page, code: string): Promise<void> {
  return attempt(page, 'saisie du code et connexion', async () => {
    await openReceiveStep(page);
    await page.locator('#df-code').fill(code);
    await page.getByRole('button', { name: L.connect }).click();
  });
}

/**
 * Answers the "new device" question.
 *
 * The identity check is not decorative: the question is shown on both sides and the
 * comparison code must match. The test reads both, compares them, and only then
 * accepts — exactly what the interface asks a person to do.
 */
export async function answerNewDevice(page: Page, accept: boolean): Promise<string> {
  return attempt(page, 'question « nouvel appareil »', async () => {
    const dialog = page.locator('div[role="dialog"]', { hasText: L.confirmDevice });
    await expect(dialog).toBeVisible({ timeout: 45_000 });
    const sas = (await dialog.locator('.df-sas').textContent())?.trim() ?? '';
    await dialog.getByRole('button', { name: accept ? L.accept : L.refuse }).click();
    return sas;
  });
}

/** Attaches files to the send form (the input is hidden, as in the real interface). */
export async function selectFiles(page: Page, paths: string[]): Promise<void> {
  return attempt(page, 'sélection de fichiers', async () => {
    await openSendStep(page);
    await page.locator('input[type="file"]').setInputFiles(paths);
    await expect(page.getByText(/élément\(s\) sélectionné/)).toBeVisible();
  });
}

/** Sends the current selection to the connected device. */
export async function sendSelection(page: Page): Promise<void> {
  return attempt(page, 'envoi', async () => {
    // Connected, the screen shows the peer panel, whose « Envoyer vers » sends the
    // current selection. Not connected, it is the device row of the send step.
    await expect(page.getByRole('button', { name: L.sendTo }).first()).toBeEnabled({ timeout: 20_000 });
    await page.getByRole('button', { name: L.sendTo }).first().click();
  });
}

/** Accepts an incoming transfer offer (the second dialog, after the device question). */
export async function acceptIncoming(page: Page): Promise<void> {
  return attempt(page, 'acceptation de la réception', async () => {
    const dialog = page.locator('div[role="dialog"]', { hasText: L.incomingRequest });
    await expect(dialog).toBeVisible({ timeout: 45_000 });
    await dialog.getByRole('button', { name: L.accept }).click();
  });
}

/**
 * Allows more than one file to land as a download without asking.
 *
 * Chromium downloads the first automatic download and then blocks the next one behind
 * a permission prompt (a real browser behaviour: it protects against a page quietly
 * dropping a pile of files). A person answers it once; here the answer is given through
 * the browser's own protocol, exactly like `acceptDownloads` answers the download
 * prompt itself. Without it, a two-file transfer downloads one file and the second is
 * blocked — which is what made the suite see « 1/2 téléchargement(s) reçu(s) ».
 *
 * Other engines have no such limit: the call is a no-op there.
 */
export async function allowMultipleDownloads(page: Page): Promise<void> {
  if (page.context().browser()?.browserType().name() !== 'chromium') return;
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Browser.grantPermissions', {
      origin: new URL(page.url()).origin,
      // Not every Chromium build exposes this permission type. When it does not, the
      // call fails and is ignored: the browser then behaves exactly as it would for a
      // person who ignored the prompt, which is what `docs/TECHNIQUE.md`
      // documents. A test must never be made to pass by an API the runtime rejects.
      permissions: ['multipleAutomaticDownloads'] as unknown as never[],
    });
  } catch {
    // Documented, not hidden: see `docs/TECHNIQUE.md`, « téléchargements
    // multiples ». The suite continues without it.
  } finally {
    await session.detach();
  }
}

/** Refuses an incoming transfer offer. */
export async function refuseIncoming(page: Page): Promise<void> {
  return attempt(page, 'refus de la réception', async () => {
    const dialog = page.locator('div[role="dialog"]', { hasText: L.incomingRequest });
    await expect(dialog).toBeVisible({ timeout: 45_000 });
    await dialog.getByRole('button', { name: L.refuse }).click();
  });
}

/** Waits until the queue shows the given state on a row whose label matches. */
export async function expectQueueState(page: Page, labelPattern: RegExp, state: string, timeout = 60_000): Promise<void> {
  const row = page.locator('li.df-card', { hasText: labelPattern }).first();
  await expect(row).toBeVisible({ timeout });
  await expect(row.getByText(state, { exact: true })).toBeVisible({ timeout });
}

/** What the interface says the connection method is, as displayed. */
export async function connectionMethod(page: Page): Promise<string> {
  const line = page.getByText(/Méthode\s*:/).first();
  if ((await line.count()) === 0) return '';
  return (await line.textContent())?.replace(/\s+/g, ' ').trim() ?? '';
}

/* ------------------------------------------------------------------ *
 * Files and their integrity
 * ------------------------------------------------------------------ */

export interface TestFile {
  path: string;
  name: string;
  bytes: Buffer;
  sha256: string;
}

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

/** A deterministic binary payload: reproducible, and not compressible to nothing. */
function pseudoRandom(seed: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    // xorshift32: enough to defeat compression, deterministic across runs.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    buffer[index] = state & 0xff;
  }
  return buffer;
}

/**
 * Writes the files a test sends, and returns their bytes and digests.
 *
 * Two files, on purpose: a small text file (the common case) and a few mebibytes of
 * incompressible data (which crosses many chunks and exercises backpressure).
 */
export function createTestFiles(options: { largeBytes?: number } = {}): { directory: string; files: TestFile[] } {
  const directory = mkdtempSync(join(tmpdir(), 'dropforge-e2e-'));
  const small = Buffer.from(
    `DropForge end-to-end test file\nwritten ${new Date().toISOString()}\n`,
    'utf8',
  );
  const large = pseudoRandom(0x5eed, options.largeBytes ?? 3 * 1024 * 1024);

  const files: TestFile[] = [
    {
      path: join(directory, 'rapport.txt'),
      name: 'rapport.txt',
      bytes: small,
      sha256: sha256(small),
    },
    {
      path: join(directory, 'mesures.bin'),
      name: 'mesures.bin',
      bytes: large,
      sha256: sha256(large),
    },
  ];

  for (const file of files) writeFileSync(file.path, file.bytes);
  return { directory, files };
}

/**
 * Saves a download and returns its bytes.
 *
 * This is the receiver's real outcome in a browser without File System Access: the
 * file arrives as a download. Checking its digest is the only end-to-end proof of
 * integrity that does not trust the application's own report.
 */
export async function readDownload(download: Download): Promise<Buffer> {
  const target = join(mkdtempSync(join(tmpdir(), 'dropforge-dl-')), download.suggestedFilename());
  await download.saveAs(target);
  return readFileSync(target);
}

/**
 * Collects `count` downloads from a page, keyed by the file name the browser used.
 *
 * The listener is installed before the transfer starts: a download can begin while the
 * interface is still showing its acceptance dialog, and an event missed then would make
 * the test blame the application for a timing mistake of its own.
 */
export function collectDownloads(page: Page, count: number): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const collected = new Map<string, Buffer>();
    const timeout = setTimeout(() => {
      reject(new Error(`${collected.size}/${count} téléchargement(s) reçu(s) : ${[...collected.keys()].join(', ')}`));
    }, 120_000);

    page.on('download', (download) => {
      void readDownload(download)
        .then((bytes) => {
          collected.set(download.suggestedFilename(), bytes);
          if (collected.size >= count) {
            clearTimeout(timeout);
            resolve(collected);
          }
        })
        .catch(reject);
    });
  });
}
