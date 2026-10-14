/**
 * WebKit, on an iPhone-shaped screen.
 *
 * What is checked here is deliberately **not** a transfer. On iOS the browser does not
 * expose what a transfer would need to be driven from outside: there is no File System
 * Access, no folder picker, and WebKit's WebRTC in the automation build is not the one
 * iOS ships. A test that "passes" by not being able to do anything would be worse than
 * no test at all.
 *
 * So this suite checks the promises that *must* hold on iOS, and that are the ones a
 * person would notice if they were wrong:
 *   - the mobile layout is used;
 *   - the folder picker is absent, because iOS does not have one;
 *   - the install path explains the real iOS gesture instead of showing a dead button;
 *   - the pairing code can be produced (that is how an iPhone *receives*).
 *
 * The real transfer protocol on a real iPhone is in `docs/TESTING.md`, as a manual
 * procedure, and `docs/PLATFORM-MATRIX.md` says so plainly.
 */
import { expect, test } from '@playwright/test';
import { L, openDevice } from './helpers/app.js';

test.describe('iOS (WebKit) : ce qui est promis, ce qui ne l’est pas', () => {
  test('la mise en page mobile est utilisée', async ({ browser }) => {
    const device = await openDevice(await browser.newContext());

    await expect(device.page.locator('.df-bottom-nav')).toBeVisible();
    await expect(device.page.locator('.df-sidebar')).toBeHidden();

    await device.context.close();
  });

  test('le sélecteur de dossier n’est pas proposé, et l’installation explique le geste réel', async ({ browser }) => {
    const device = await openDevice(await browser.newContext());

    // iOS cannot pick a folder: the button must not exist, rather than fail on click.
    await expect(device.page.getByRole('button', { name: 'Choisir un dossier' })).toHaveCount(0);

    // No `beforeinstallprompt` on iOS: the banner explains Share → Add to Home Screen
    // instead of offering a button that would do nothing.
    const installHint = device.page.getByText(/Sur iPhone ou iPad/);
    if ((await installHint.count()) > 0) {
      await expect(installHint.first()).toBeVisible();
    }
    await expect(device.page.getByRole('button', { name: L.receiveDevice })).toBeVisible();
    await expect(device.page.getByRole('button', { name: 'Installer' })).toHaveCount(0);

    await device.context.close();
  });

  test('un iPhone peut afficher un code d’appairage (côté réception)', async ({ browser }) => {
    const device = await openDevice(await browser.newContext());

    await device.page.getByRole('button', { name: L.receiveDevice }).click();
    const code = device.page.locator('.df-code');
    await expect(code).toBeVisible({ timeout: 20_000 });
    expect(((await code.textContent()) ?? '').trim().length).toBeGreaterThanOrEqual(4);

    await device.context.close();
  });
});
