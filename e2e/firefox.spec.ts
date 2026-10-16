/**
 * Firefox: the third engine, and the one without File System Access.
 *
 * Firefox cannot write into a folder the user picked, so a received file always ends
 * as a download. That is exactly the path this test follows — and the reason it is
 * worth having on a third engine: the fallback is a real code path, not a degraded
 * version of the Chromium one.
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

const FIXTURE = createTestFiles({ largeBytes: 256 * 1024 });
const file = FIXTURE.files[0]!;
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test.describe('Firefox : le repli par téléchargement', () => {
  test('un fichier envoyé depuis Firefox arrive complet et vérifié', async ({ browser }) => {
    const sender = await openDevice(await browser.newContext());
    const receiver = await openDevice(await browser.newContext());

    const code = await hostRoom(receiver.page);
    await joinRoom(sender.page, code);
    const [sasSender, sasReceiver] = await Promise.all([
      answerNewDevice(sender.page, true),
      answerNewDevice(receiver.page, true),
    ]);
    expect(sasSender).toBe(sasReceiver);

    const downloads = collectDownloads(receiver.page, 1);
    await selectFiles(sender.page, [file.path]);
    await sendSelection(sender.page);
    await acceptIncoming(receiver.page);

    const received = await downloads;
    expect(received.get(file.name)?.length).toBe(file.bytes.length);
    await expectQueueState(receiver.page, new RegExp(escapeRegExp(file.name)), L.completed);

    await sender.context.close();
    await receiver.context.close();
  });
});
