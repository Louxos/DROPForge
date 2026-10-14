/**
 * Two real devices, a real transfer.
 *
 * This is the test the whole product exists for, and the one no unit test can write:
 * two browser contexts with their own identities meet through the real signaling
 * service, negotiate a real WebRTC data channel, and move real bytes. The receiving
 * side's downloads are captured and hashed here, outside the application, so "it
 * worked" means the bytes arrived intact — not that the interface claimed so.
 */
import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  acceptIncoming,
  allowMultipleDownloads,
  answerNewDevice,
  collectDownloads,
  connectionMethod,
  createTestFiles,
  expectQueueState,
  hostRoom,
  joinRoom,
  L,
  openDevice,
  refuseIncoming,
  selectFiles,
  sendSelection,
  describePage,
  type Device,
} from './helpers/app.js';

/**
 * The files this suite sends: a small text file and a quarter-megabyte of binary data.
 *
 * Both stay small on purpose. What this file proves is that real bytes cross a real
 * WebRTC channel and are handed to the browser **as downloads**, whose content is then
 * hashed outside the application. A 3 MiB second file made that download take over a
 * minute on a shared runner without proving anything more; the multi-megabyte path is
 * covered by `tests/loopback-transfer.test.ts` (4 MiB) and by the phone suite.
 */
const FIXTURE = createTestFiles({ largeBytes: 256 * 1024 });
const files = FIXTURE.files;
const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

/** Escapes a file name so it can be used inside a regular expression. */
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Pairs two devices the way a person does when they are not on the same network: one
 * shows a code, the other types it in, and both confirm the comparison code.
 */
async function pairAndConnect(a: Device, b: Device): Promise<void> {
  const code = await hostRoom(b.page);
  await joinRoom(a.page, code);

  try {
    const [sasA, sasB] = await Promise.all([answerNewDevice(a.page, true), answerNewDevice(b.page, true)]);
    expect(sasA).toBe(sasB);
    expect(sasA).toMatch(/^\d{6}$/);
  } catch (error) {
    // Les deux moitiés de la conversation : celle qui a saisi le code et celle qui l'a
    // affiché. Un échec d'appairage ne se comprend qu'en les lisant ensemble.
    throw new Error(
      [
        String(error),
        `Appareil qui a saisi le code :\n${await describePage(a.page)}`,
        `Appareil qui a affiché le code :\n${await describePage(b.page)}`,
      ].join('\n\n'),
    );
  }
}

/** Waits for the queue of a page to show a row matching a file name. */
async function queueRow(page: Page, name: string): Promise<ReturnType<Page['locator']>> {
  const row = page.locator('li.df-card', { hasText: escapeRegExp(name) }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

test.describe('transfert entre deux appareils réels', () => {
  test('les fichiers arrivent octet pour octet, et les deux côtés disent « Terminé »', async ({ browser }) => {
    const a = await openDevice(await browser.newContext());
    const b = await openDevice(await browser.newContext());

    await pairAndConnect(a, b);
    test.info().annotations.push({ type: 'méthode de connexion', description: await connectionMethod(a.page) });

    // Two files land as two downloads: the browser must be allowed to do that before
    // the first one starts (see `allowMultipleDownloads`).
    await allowMultipleDownloads(b.page);
    // Start watching for downloads before sending: the receiver answers with a stream
    // of data, and the first file can arrive before the dialog has even closed.
    const downloads = collectDownloads(b.page, files.length);

    await selectFiles(a.page, files.map((file) => file.path));
    await sendSelection(a.page);
    await acceptIncoming(b.page);

    const received = await downloads;
    expect([...received.keys()].sort()).toEqual(files.map((file) => file.name).sort());

    // The only integrity check that does not trust the application: hash the bytes that
    // were actually downloaded on the receiving device and compare with the source.
    for (const file of files) {
      const bytes = received.get(file.name);
      expect(bytes, `le fichier ${file.name} doit être reçu`).toBeDefined();
      expect(bytes!.length).toBe(file.bytes.length);
      expect(sha256(bytes!)).toBe(file.sha256);
    }

    // Both sides report completion, and the receiver reports it only after verifying.
    for (const file of files) {
      await expectQueueState(a.page, new RegExp(escapeRegExp(file.name)), L.completed);
      await expectQueueState(b.page, new RegExp(escapeRegExp(file.name)), L.completed);
    }

    await a.context.close();
    await b.context.close();
  });

  test('un refus de transfert est un échec, jamais un succès', async ({ browser }) => {
    const a = await openDevice(await browser.newContext());
    const b = await openDevice(await browser.newContext());

    await pairAndConnect(a, b);
    await selectFiles(a.page, [files[0]!.path]);
    await sendSelection(a.page);

    await refuseIncoming(b.page);

    // The sender is told the transfer failed, with the reason, and never "completed".
    await expectQueueState(a.page, new RegExp(escapeRegExp(files[0]!.name)), L.failed);
    await expect(a.page.getByText('Le transfert a été refusé par l’autre appareil.')).toBeVisible();

    // Neither side claims the file arrived.
    await expect(a.page.getByText(L.completed, { exact: true })).toHaveCount(0);
    await expect(b.page.getByText(L.completed, { exact: true })).toHaveCount(0);

    await a.context.close();
    await b.context.close();
  });

  test('un nouvel appareil refusé n’obtient aucune connexion', async ({ browser }) => {
    const a = await openDevice(await browser.newContext());
    const b = await openDevice(await browser.newContext());

    const code = await hostRoom(b.page);
    await joinRoom(a.page, code);

    // The question is asked on both sides, and the answer is deliberate: A accepts,
    // B refuses. Nothing is transferred afterwards.
    const [sasA, sasB] = await Promise.all([answerNewDevice(a.page, true), answerNewDevice(b.page, false)]);
    expect(sasA).toBe(sasB);

    // The refusing device never reaches the connected state.
    await expect(b.page.getByRole('button', { name: L.sendTo })).toHaveCount(0, { timeout: 20_000 });
    await expect(b.page.locator('.df-code')).toHaveCount(0);

    // And no transfer is reported as completed on either side.
    await expect(a.page.getByText(L.completed, { exact: true })).toHaveCount(0);
    await expect(b.page.getByText(L.completed, { exact: true })).toHaveCount(0);

    await a.context.close();
    await b.context.close();
  });

  test('l’historique survit à un rechargement de la page', async ({ browser }) => {
    const a = await openDevice(await browser.newContext());
    const b = await openDevice(await browser.newContext());

    await pairAndConnect(a, b);
    const downloads = collectDownloads(b.page, 1);
    await selectFiles(a.page, [files[0]!.path]);
    await sendSelection(a.page);
    await acceptIncoming(b.page);
    await downloads;
    await expectQueueState(b.page, new RegExp(escapeRegExp(files[0]!.name)), L.completed);

    // A reload is the moment where local persistence either exists or does not.
    await b.page.reload();
    await expect(b.page.locator('[data-dropforge-shell]')).toBeVisible();
    await b.page.getByRole('button', { name: L.history }).first().click();
    await queueRow(b.page, files[0]!.name);

    await a.context.close();
    await b.context.close();
  });

  test('hors ligne, l’application s’ouvre encore depuis le cache', async ({ browser }) => {
    const device = await openDevice(await browser.newContext());

    // The service worker must be in control before the network is taken away; a second
    // navigation is what gives it that control, exactly like a second visit.
    await device.page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await device.page.reload();
    await expect(device.page.locator('[data-dropforge-shell]')).toBeVisible();
    expect(await device.page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    await device.context.setOffline(true);
    await device.page.reload();
    // The offline promise, tested the only way that counts: no network, and the
    // interface still comes up.
    await expect(device.page.locator('[data-dropforge-shell]')).toBeVisible({ timeout: 30_000 });
    await expect(device.page.locator('.df-nav__item').first()).toBeVisible();

    await device.context.setOffline(false);
    await device.context.close();
  });
});
