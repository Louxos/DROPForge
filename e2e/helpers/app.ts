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
import { expect, type BrowserContext, type Download, type Page } from '@playwright/test';

/** French labels of the shipped interface (the app starts in French). */
export const L = {
  selectFiles: 'Choisir des fichiers',
  sendTo: 'Envoyer à',
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
} as const;

/** A pair of devices, each with its own browser context, storage and identity. */
export interface Device {
  context: BrowserContext;
  page: Page;
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

  await page.goto('/');

  // The application is ready when the shell is on screen (never a blank page: the
  // shell renders a loading state first, which is also what rules out a silent boot).
  //
  // Every screen carries `data-dropforge-shell`, the failure screen included: it means
  // "the interface rendered something". If it is missing, nothing rendered at all —
  // and the failure must say what the page contained, not just that a selector missed.
  try {
    await expect(page.locator('[data-dropforge-shell]')).toBeVisible({ timeout: 30_000 });
  } catch (error) {
    throw new Error(`La coque n'est jamais apparue.\n${await describeScreen(page, problems)}\n\n${String(error)}`);
  }

  // A failure screen is a screen: it satisfies the check above, so it is caught here,
  // with the sentence it shows.
  if (await page.locator('.df-app--error').isVisible().catch(() => false)) {
    throw new Error(`L'application refuse de démarrer.\n${await describeScreen(page, problems)}`);
  }

  return { context, page };
}

/** What a person would see and what the browser complained about, in one message. */
async function describeScreen(page: Page, problems: string[]): Promise<string> {
  const text = await page
    .locator('body')
    .innerText({ timeout: 5_000 })
    .catch(() => '');
  return [
    `Écran : ${text.replace(/\s+/g, ' ').trim() || '(vide)'}`,
    problems.length > 0 ? `Journal du navigateur :\n${problems.join('\n')}` : 'Journal du navigateur : vide',
  ].join('\n');
}

/** Starts showing a pairing code and returns it. */
export async function hostRoom(page: Page): Promise<string> {
  await page.getByRole('button', { name: L.receiveDevice }).click();

  const codePanel = page.locator('.df-code');
  await expect(codePanel).toBeVisible({ timeout: 20_000 });
  const code = (await codePanel.textContent())?.trim() ?? '';
  expect(code.length).toBeGreaterThanOrEqual(4);
  return code;
}

/** Types a pairing code and connects. */
export async function joinRoom(page: Page, code: string): Promise<void> {
  await page.locator('#df-code').fill(code);
  await page.getByRole('button', { name: L.connect }).click();
}

/**
 * Answers the "new device" question.
 *
 * The identity check is not decorative: the question is shown on both sides and the
 * comparison code must match. The test reads both, compares them, and only then
 * accepts — exactly what the interface asks a person to do.
 */
export async function answerNewDevice(page: Page, accept: boolean): Promise<string> {
  const dialog = page.locator('div[role="dialog"]', { hasText: L.confirmDevice });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  const sas = (await dialog.locator('.df-sas').textContent())?.trim() ?? '';
  await dialog.getByRole('button', { name: accept ? L.accept : L.refuse }).click();
  return sas;
}

/** Attaches files to the send form (the input is hidden, as in the real interface). */
export async function selectFiles(page: Page, paths: string[]): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(paths);
  await expect(page.getByText(/élément\(s\) sélectionné/)).toBeVisible();
}

/** Sends the current selection to the connected device. */
export async function sendSelection(page: Page): Promise<void> {
  await page.getByRole('button', { name: L.sendTo }).click();
}

/** Accepts an incoming transfer offer (the second dialog, after the device question). */
export async function acceptIncoming(page: Page): Promise<void> {
  const dialog = page.locator('div[role="dialog"]', { hasText: L.incomingRequest });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: L.accept }).click();
}

/** Refuses an incoming transfer offer. */
export async function refuseIncoming(page: Page): Promise<void> {
  const dialog = page.locator('div[role="dialog"]', { hasText: L.incomingRequest });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: L.refuse }).click();
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
    }, 90_000);

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
