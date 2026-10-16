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
  attempt,
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

    // The bar is anchored to the bottom of the screen and covers the width: that is
    // what makes it reachable with a thumb.
    const bar = await device.page.locator('.df-bottom-nav').boundingBox();
    const viewport = device.page.viewportSize();
    expect(bar).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(Math.abs(bar!.y + bar!.height - viewport!.height)).toBeLessThan(2);
    expect(bar!.width).toBeGreaterThanOrEqual(viewport!.width - 2);

    // Every screen is reachable from the bottom bar, which is the whole point of the
    // bar. Each tap is checked *before* it is attempted: the point the browser would
    // click on is resolved through `elementFromPoint`, so an element in the way is
    // named here — a click that silently lands elsewhere costs a 150-second timeout
    // and says nothing about what covered it.
    for (const label of [L.devicesNavigation, L.history, L.settings, L.transfers]) {
      await attempt(device.page, `appui sur « ${label} » dans la barre basse`, async () => {
        // A fixed bar is positioned against the viewport, not the document: scrolling
        // back to the top keeps the click point where the layout put it.
        await device.page.evaluate(() => window.scrollTo(0, 0));
        const button = device.page.locator('.df-bottom-nav__item', { hasText: label }).first();
        await expect(button).toBeVisible();
        const box = await button.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThan(0);
        // Les coordonnées viennent de Playwright (`boundingBox`), la même source que celle
        // dans laquelle `mouse.click` clique vraiment — et non de
        // `getBoundingClientRect()` lu dans la page : sur un téléphone émulé les deux
        // repères divergent (fenêtre visuelle contre fenêtre de mise en page) et le point
        // tombait **hors** de la fenêtre, ce qui donnait « rien sous le point » suivi de
        // coordonnées à 1 650 px de haut dans une fenêtre de 839. Un seul repère supprime
        // l'écart ; le contrôle, lui, reste : si quelque chose recouvrait la barre,
        // `elementFromPoint` le nommerait toujours.
        const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
        const hits = await device.page.evaluate(
          ({ x, y }) => {
            const element = document.elementFromPoint(x, y);
            const geometry = {
              point: { x: Math.round(x), y: Math.round(y) },
              fenetre: { largeur: window.innerWidth, hauteur: window.innerHeight },
              visuelle: window.visualViewport
                ? {
                    largeur: Math.round(window.visualViewport.width),
                    hauteur: Math.round(window.visualViewport.height),
                    decalage: Math.round(window.visualViewport.offsetTop),
                  }
                : null,
            };
            const item = element?.closest('.df-bottom-nav__item');
            return {
              vu: item
                ? `le bouton « ${item.textContent?.trim()} »`
                : element
                  ? `${element.tagName.toLowerCase()}.${element.className}`
                  : 'rien',
              geometry: JSON.stringify(geometry),
            };
          },
          point,
        );
        expect(hits.vu, `rien sous le point ${hits.geometry}`).toContain(label);

        // A thumb lands on a **point**, so that is what is clicked here, at the point
        // `elementFromPoint` just proved belongs to this tab. `locator.click()` is not
        // used on purpose: its actionability loop waits for the bar to be *stable frame
        // by frame*, which a fixed bar composited by `backdrop-filter` never reports on
        // an emulated phone — 20 seconds of waiting, then a failure that says nothing
        // about the interface. Nothing is given up: what has to be true (nothing covers
        // the bar, and the tab answers a real click at that point) is still checked, and
        // the tab that ended up current is asserted right after.
        await device.page.mouse.click(point.x, point.y);
        await expect(button).toHaveAttribute('aria-current', 'page');
        await expect(device.page.locator('.df-main')).toBeVisible();
      });
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
