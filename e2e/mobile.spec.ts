/**
 * The same product, on a phone-sized screen (Chromium / Android).
 *
 * Two things are checked here that a desktop browser cannot show: that the layout is
 * really adapted to a small screen (fixed bottom navigation, no sidebar), and that a
 * real transfer works from a phone-shaped viewport — including receiving it as a
 * download, which is what an Android browser without File System Access does.
 */
import { expect, test } from '@playwright/test';
import {
  acceptIncoming,
  answerNewDevice,
  collectDownloads,
  createTestFiles,
  expectQueueState,
  hostRoom,
  joinRoom,
  L,
  openDevice,
  selectFiles,
  sendSelection,
} from './helpers/app.js';

const FIXTURE = createTestFiles({ largeBytes: 512 * 1024 });
const file = FIXTURE.files[0]!;
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test.describe('PWA sur un écran de téléphone', () => {
  test('la navigation basse est là, la barre latérale non', async ({ browser }) => {
    const device = await openDevice(await browser.newContext());

    // The two layouts exist in the DOM; CSS decides which one is visible at this width.
    await expect(device.page.locator('.df-bottom-nav')).toBeVisible();
    await expect(device.page.locator('.df-sidebar')).toBeHidden();

    // Every screen is reachable from the bottom bar.
    for (const label of [L.devicesNavigation, L.history, L.settings, 'Transfert']) {
      const button = device.page.locator('.df-bottom-nav__item', { hasText: label }).first();
      await expect(button).toBeVisible();
      await button.click();
      await expect(device.page.locator('.df-main')).toBeVisible();
    }

    await device.context.close();
  });

  test('un téléphone envoie vers un autre appareil, et reçoit un fichier complet', async ({ browser }) => {
    const phone = await openDevice(await browser.newContext());
    const other = await openDevice(await browser.newContext());

    // The phone shows the code (the gesture that matters on mobile: no typing).
    const code = await hostRoom(phone.page);
    await joinRoom(other.page, code);
    const [sasPhone, sasOther] = await Promise.all([answerNewDevice(phone.page, true), answerNewDevice(other.page, true)]);
    expect(sasPhone).toBe(sasOther);

    // The other device sends; the phone receives it as a download.
    const downloads = collectDownloads(phone.page, 1);
    await selectFiles(other.page, [file.path]);
    await sendSelection(other.page);
    await acceptIncoming(phone.page);

    const received = await downloads;
    expect(received.get(file.name)?.length).toBe(file.bytes.length);
    await expectQueueState(phone.page, new RegExp(escapeRegExp(file.name)), L.completed);

    await phone.context.close();
    await other.context.close();
  });
});
