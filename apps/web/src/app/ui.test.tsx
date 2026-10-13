// @vitest-environment happy-dom
/**
 * End-to-end test of the *rendered* application.
 *
 * The controller tests assert the logic; the QR and i18n tests assert small pieces.
 * Nothing so far proved that the interface itself renders the truth: that a transfer
 * really appears, moves through its states, and that a refusal is shown as a refusal
 * instead of a success. That is what this file does, in a real DOM (happy-dom), with
 * the shipping components and the shipping controller — only the platform underneath
 * (WebRTC, the file system, SQLite/IndexedDB) is replaced by in-memory ports, because
 * a browser is not available in this environment.
 *
 * What it therefore does **not** prove: rendering in Chromium/Safari/Firefox, CSS
 * layout, touch interactions, or the browser file pickers. Those remain listed as
 * untested in `docs/PLATFORM-MATRIX.md`.
 */
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MemorySource } from '../../../../tests/helpers/memory-fs.js';
import { i18n, setupI18n } from '../i18n/index.js';
import { Shell } from './shell.js';
import { useAppState } from './use-app-state.js';
import type { AppController } from './controller.js';
import {
  answerNextIncoming,
  connectPair,
  makeRig,
  settle,
  stopStartedControllers,
  waitFor,
} from './testing/rig.js';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(async () => {
  await setupI18n('fr');
});

/** The application shell, mounted exactly as `main.tsx` mounts it. */
function Harness({ controller }: { controller: AppController }): React.ReactElement {
  const state = useAppState(controller);
  return <Shell controller={controller} state={state} />;
}

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

async function mount(controller: AppController): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(
      <StrictMode>
        <Harness controller={controller} />
      </StrictMode>,
    );
  });
  return container;
}

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
  stopStartedControllers();
  document.body.innerHTML = '';
});

/** Clicks a button by its visible label, the way a person would. */
async function click(container: HTMLElement, label: string): Promise<void> {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    (candidate.textContent ?? '').includes(label),
  );
  if (!button) {
    throw new Error(`no button labelled "${label}"; buttons: ${[...container.querySelectorAll('button')].map((b) => b.textContent).join(' | ')}`);
  }
  await act(async () => {
    button.click();
  });
}

const text = (container: HTMLElement): string => container.textContent ?? '';

/** Re-renders after the controller changed state behind React's back. */
async function flush(): Promise<void> {
  await act(async () => {
    await settle(4);
  });
}

describe('interface montée de bout en bout', () => {
  it('affiche l’attente, puis les quatre sections une fois prête', async () => {
    const rig = await makeRig();
    const container = await mount(rig.host);
    // Nothing is invented while the controller has not reported readiness.
    expect(text(container)).toContain(i18n.t('app.loading'));

    await rig.host.start();
    await flush();
    expect(text(container)).toContain(i18n.t('nav.transfer'));
    expect(text(container)).toContain(i18n.t('nav.devices'));
    expect(text(container)).toContain(i18n.t('nav.activity'));
    expect(text(container)).toContain(i18n.t('nav.settings'));
    expect(text(container)).not.toContain(i18n.t('app.loading'));
  });

  it('annonce l’absence d’appareil au lieu de montrer une liste inventée', async () => {
    const rig = await makeRig();
    await rig.host.start();
    await rig.guest.start();
    const container = await mount(rig.host);
    await flush();
    // With nothing paired and nothing discovered, the screen says so instead of
    // offering a destination that does not exist.
    expect(text(container)).toContain(i18n.t('transfer.noDevices'));

    // It disappears the moment a device is really there.
    await connectPair(rig);
    await flush();
    expect(text(container)).toContain('Téléphone');
    expect(text(container)).not.toContain(i18n.t('transfer.noDevices'));
  });

  it('suit un transfert réel jusqu’à « Terminé », avec sa vérification', async () => {
    const rig = await makeRig();
    await rig.host.start();
    await rig.guest.start();
    const host = await mount(rig.host);
    const guest = await mount(rig.guest);
    await connectPair(rig);
    await flush();

    // The receiver answers the way its interface does: from the state it published.
    const decision = answerNextIncoming(rig.guest, (incoming) => {
      // The person sees the real file list before accepting.
      expect(incoming.files.map((file) => file.path)).toEqual(['rapport.txt']);
      return { accepted: true, decisions: [] };
    });

    const transferId = (await rig.host.sendSelection([
      new MemorySource('rapport.txt', new TextEncoder().encode('contenu du rapport')),
    ]))!;
    await decision.answered;
    await waitFor(
      rig.host,
      () => rig.host.state.history.some((r) => r.id === transferId && r.state === 'completed'),
      'la fin du transfert',
    );
    await flush();

    // The sender's activity screen, as a person would open it.
    await click(host, i18n.t('nav.activity'));
    await flush();
    const shown = text(host);
    expect(shown).toContain(i18n.t('activity.filterSend'));
    // The record's own row — not the whole screen, which also lists every state name
    // in its filter — must say "completed" and must not say "failed".
    const rows = [...host.querySelectorAll('li')].map((row) => row.textContent ?? '');
    const row = rows.find((candidate) => candidate.includes('Téléphone')) ?? '';
    expect(row).toContain(i18n.t('activity.filterSend'));
    expect(row).toContain(i18n.t('states.completed'));
    expect(row).not.toContain(i18n.t('states.failed'));

    // Details: the file is listed, and its verification status is the engine's, not
    // something the interface decided.
    await click(host, i18n.t('common.details'));
    await flush();
    const details = text(host);
    expect(details).toContain('rapport.txt');
    const record = rig.host.state.history.find((entry) => entry.id === transferId)!;
    const verified = record.files.every((file) => file.verified === true);
    expect(details).toContain(verified ? i18n.t('activity.verified') : i18n.t('activity.notVerified'));
    expect(text(guest)).not.toContain(i18n.t('states.failed'));
  });

  it('montre un refus comme un refus, jamais comme un succès', async () => {
    const rig = await makeRig();
    await rig.host.start();
    await rig.guest.start();
    const host = await mount(rig.host);
    await mount(rig.guest);
    await connectPair(rig);
    await flush();

    const decision = answerNextIncoming(rig.guest, () => ({
      accepted: false,
      decisions: [],
      rejectReason: 'declined' as const,
    }));
    const transferId = (await rig.host.sendSelection([
      new MemorySource('secret.txt', new TextEncoder().encode('non')),
    ]))!;
    await decision.answered;
    await waitFor(
      rig.host,
      () => rig.host.state.history.some((r) => r.id === transferId && r.state === 'failed'),
      'le refus enregistré',
    );
    await flush();

    await click(host, i18n.t('nav.activity'));
    await flush();
    const rows = [...host.querySelectorAll('li')].map((row) => row.textContent ?? '');
    const row = rows.find((candidate) => candidate.includes('Téléphone')) ?? '';
    expect(row).toContain(i18n.t('states.failed'));
    expect(row).not.toContain(i18n.t('states.completed'));
    expect(row).not.toContain(i18n.t('activity.verified'));

    // And the reason shown is the one the engine recorded, never a generic excuse.
    const record = rig.host.state.history.find((entry) => entry.id === transferId)!;
    expect(record.lastErrorCode).toBeTruthy();
    expect(text(host)).toContain(i18n.t(`errors.${record.lastErrorCode}` as never));
  });

  it('change de langue depuis les réglages, sans rechargement', async () => {
    const rig = await makeRig();
    await rig.host.start();
    const container = await mount(rig.host);
    await flush();
    await click(container, i18n.t('nav.settings'));
    expect(text(container)).toContain(i18n.t('settings.title'));

    await act(async () => {
      await rig.host.updateSettings({ language: 'en' });
    });
    await flush();

    expect(text(container)).toContain(String(i18n.t('settings.title', { lng: 'en' })));
    expect(text(container)).not.toContain(i18n.t('settings.title', { lng: 'fr' }));
  });

  it('dit qu’une fonction n’est pas disponible au lieu de la proposer', async () => {
    const rig = await makeRig({ capabilities: { notifications: false } });
    await rig.host.start();
    const container = await mount(rig.host);
    await flush();
    await click(container, i18n.t('nav.settings'));
    await flush();

    const shown = text(container);
    // The capability table is the source: no switch promising something the browser
    // cannot do, and the reason is written out.
    expect(shown).toContain(i18n.t('settings.notificationsUnsupported'));
    expect(shown).toContain(i18n.t('capabilities.unavailable'));
    expect(shown).toContain(i18n.t('settings.privacyText'));
  });
});
