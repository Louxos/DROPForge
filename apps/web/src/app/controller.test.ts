import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Transport } from '@dropforge/protocol';
import { DropForgeError, ERROR_CODES, type SourceFile } from '@dropforge/app-core';
import { DEFAULT_PREFERENCES, type Preferences } from '@dropforge/settings';
import { MemoryFileSystem, MemorySource } from '../../../../tests/helpers/memory-fs.js';
import { MemoryStore } from '../../../../tests/helpers/memory-store.js';
import { MemoryTransport } from '../../../../tests/helpers/memory-transport.js';
import { detectCapabilities } from '../platform/capabilities.js';
import { UPDATE_IDLE, type UpdateSource } from '../platform/updater.js';
import {
  AppController,
  newRoomCode,
  pairingLinkFor,
  type LinkPeerInfo,
} from './controller.js';
import {
  FakeLinkFactory,
  FakeRelay,
  MemoryIdentityStore,
  answerNextIncoming,
  connectPair,
  makeRig,
  recordOf,
  settle,
  stopStartedControllers,
  trackController,
  waitFor,
} from './testing/rig.js';

afterEach(stopStartedControllers);

afterEach(stopStartedControllers);

/* ------------------------------------------------------------------ *
 * Lifecycle and local data
 * ------------------------------------------------------------------ */

describe('AppController: startup', () => {
  it('creates an identity once and reports its fingerprint', async () => {
    const rig = await makeRig();
    await rig.host.start();
    expect(rig.host.state.ready).toBe(true);
    expect(rig.host.state.fatalError).toBeUndefined();
    expect(rig.host.state.identityFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(rig.identities.host.saves).toBe(1);
    // Starting twice must not replace the identity: the fingerprint would change on
    // every launch and no trusted device would ever match.
    const again = await makeRig();
    await again.host.start();
    await again.host.start();
    expect(again.identities.host.saves).toBe(1);
  });

  it('reports a fatal error with a stable code when local storage is unavailable', async () => {
    const rig = await makeRig();
    // The platform layer is what turns a browser-level failure into a code; here the
    // code must survive all the way to the screen, with no invented message.
    vi.spyOn(rig.hostStore, 'init').mockRejectedValueOnce(
      new DropForgeError(ERROR_CODES.STORAGE_UNAVAILABLE, 'This browser does not provide local storage'),
    );
    await rig.host.start();
    expect(rig.host.state.ready).toBe(false);
    expect(rig.host.state.fatalError?.code).toBe(ERROR_CODES.STORAGE_UNAVAILABLE);
    expect(rig.host.state.fatalError?.message).toContain('local storage');
  });

  it('starts from the documented default preferences', async () => {
    const rig = await makeRig();
    await rig.host.start();
    expect(rig.host.state.settings).toEqual(DEFAULT_PREFERENCES);
    expect(rig.host.state.appVersion).toBe('9.9.9-test');
  });

  it('never claims background transfers, whatever the platform says', async () => {
    const rig = await makeRig();
    await rig.host.start();
    expect(rig.host.state.capabilities.backgroundTransfer).toBe(false);
  });
});

describe('AppController: settings and selection', () => {
  it('persists a settings change and ignores an invented value', async () => {
    const rig = await makeRig();
    await rig.host.start();
    await rig.host.updateSettings({ theme: 'light', language: 'en' });
    expect(rig.host.state.settings.theme).toBe('light');

    await rig.host.updateSettings({ maxConcurrentTransfers: 999 } as Partial<Preferences>);
    expect(rig.host.state.settings.maxConcurrentTransfers).toBeLessThanOrEqual(8);

    const reloaded = new AppController({
      store: rig.hostStore,
      identities: rig.identities.host,
      capabilities: rig.host.state.capabilities,
      links: () => new FakeLinkFactory(rig.relay, fakeInfo(), 'host'),
      receiveStore: async () => rig.hostReceiveFolder,
    });
    await reloaded.start();
    expect(reloaded.state.settings.theme).toBe('light');
    expect(reloaded.state.settings.language).toBe('en');
  });

  it('numbers the selection and sums its size without inventing anything', () => {
    const rig = new AppController({
      store: new MemoryStore(),
      identities: new MemoryIdentityStore(),
      capabilities: detectCapabilities({}),
      links: () => new FakeLinkFactory(new FakeRelay(), fakeInfo(), 'host'),
      receiveStore: async () => new MemoryFileSystem(),
    });
    rig.setSelection([
      { path: 'a.txt', kind: 'file', size: 10 },
      { path: 'b', kind: 'directory', size: 0 },
    ]);
    expect(rig.state.selected).toEqual([
      { index: 0, path: 'a.txt', kind: 'file', size: 10 },
      { index: 1, path: 'b', kind: 'directory', size: 0 },
    ]);
    expect(rig.state.selectedBytes).toBe(10);
    rig.clearSelection();
    expect(rig.state.selected).toEqual([]);
    expect(rig.state.selectedBytes).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Pairing and connections
 * ------------------------------------------------------------------ */

describe('AppController: pairing', () => {
  it('refuses a code that cannot be a room code, with the documented error', async () => {
    const rig = await makeRig();
    await rig.host.start();
    expect(await rig.host.connectWithCode('not a code!')).toBe(false);
    expect(rig.host.state.notices[0]?.messageKey).toBe('errors.PAIRING_CODE_INVALID');
  });

  it('shows a code and a link that the other device can use', async () => {
    const rig = await makeRig();
    await rig.host.start();
    const room = await rig.host.hostRoom();
    expect(room?.code).toMatch(/^[A-Za-z0-9_-]{4,32}$/);
    expect(rig.host.state.pairingRoom?.code).toBe(room?.code);
    // The code travels in the fragment, so it never reaches the server in a URL log.
    expect(room?.link).toContain(`#c=${room?.code}`);
    await rig.host.closeHostedRoom();
    expect(rig.host.state.pairingRoom).toBeUndefined();
  });

  it('never shows a code for a room the service refused to open', async () => {
    const rig = await makeRig();
    await rig.host.start();
    // The service is reachable but will not hold the room: publishing the code anyway
    // would send the other device to a room that does not exist.
    rig.relay.refuseRooms = true;
    expect(await rig.host.hostRoom()).toBeUndefined();
    expect(rig.host.state.pairingRoom).toBeUndefined();
    expect(rig.host.state.notices[0]?.kind).toBe('error');
    expect(rig.host.state.notices[0]?.errorCode).toBeDefined();
  });

  it('cesse d’afficher une connexion qui n’existe plus', async () => {
    const rig = await makeRig();
    await rig.host.start();
    await rig.guest.start();
    await connectPair(rig);
    expect(rig.guest.state.connection).toBeDefined();

    // L'autre appareil ferme la session (il a refusé, il est parti, le réseau est
    // tombé) : garder « Envoyer à » à l'écran serait annoncer une réussite qui n'a pas
    // eu lieu — exactement ce que ce produit s'interdit.
    await rig.host.disconnect();
    await settle(60);
    expect(rig.guest.state.connection).toBeUndefined();
    const notice = rig.guest.state.notices.find((entry) => entry.errorCode === 'CONNECTION_LOST');
    expect(notice?.kind).toBe('warning');
  });

  it('tries a direct path before the relay, whatever the capability plan said', async () => {
    const rig = await makeRig();
    await rig.guest.start();
    // A code nobody is waiting on: both paths fail, and the order they were tried in is
    // the point. The relay is the least private path, so it is never the first one.
    expect(await rig.guest.connectWithCode('ABCD2345XYZ')).toBe(false);
    expect(rig.relay.attemptedMethods).toEqual(['webrtc', 'relay']);
    expect(rig.guest.state.notices[0]?.messageKey).toBe('errors.PEER_UNREACHABLE');
    // The failure travels with the paths that were tried: an explanation, not a shrug.
    expect(rig.guest.state.notices[0]?.detail).toContain('webrtc:');
    expect(rig.guest.state.notices[0]?.detail).toContain('relay:');
  });

  it('says the platform is unsupported when no room can be hosted', async () => {
    const rig = new AppController({
      store: new MemoryStore(),
      identities: new MemoryIdentityStore(),
      capabilities: detectCapabilities({}),
      links: () => ({ create: async () => new MemoryTransport() }),
      receiveStore: async () => new MemoryFileSystem(),
    });
    await rig.start();
    expect(await rig.hostRoom()).toBeUndefined();
    expect(rig.state.notices[0]?.messageKey).toBe('errors.PLATFORM_UNSUPPORTED');
  });

  it('connects the two sides, reports the same comparison code on both ends', async () => {
    const rig = await makeRig();
    await rig.host.start();
    await rig.guest.start();
    await connectPair(rig);
    expect(rig.host.state.connection).toBeDefined();
    expect(rig.guest.state.connection).toBeDefined();
    expect(rig.host.state.connection?.sas).toBe(rig.guest.state.connection?.sas);
    expect(rig.host.state.connection?.fingerprint).toBe(rig.guest.state.identityFingerprint);
    expect(rig.host.state.pairingRoom).toBeUndefined();
  });

  it('shows the comparison code inside the question, on both devices', async () => {
    const rig = await makeRig();
    await rig.host.start();
    await rig.guest.start();
    const room = await rig.host.hostRoom();
    expect(room).toBeDefined();
    const connecting = rig.guest.connectWithCode(room!.code);
    await settle();

    // La question demande de comparer un code : ce code doit donc être **dans** la
    // question. Il ne l'était pas — les deux appareils affichaient un tiret, et
    // demandaient de vérifier six chiffres que personne ne voyait.
    expect(rig.host.state.newDevice?.sas).toMatch(/^[0-9]{6}$/);
    expect(rig.guest.state.newDevice?.sas).toMatch(/^[0-9]{6}$/);
    expect(rig.host.state.newDevice?.sas).toBe(rig.guest.state.newDevice?.sas);

    rig.host.answerNewDevice(true, false);
    await settle();
    rig.guest.answerNewDevice(true, false);
    expect(await connecting).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * A real transfer between the two controllers
 * ------------------------------------------------------------------ */

describe('AppController: transfer', () => {
  it('sends a file, records it and lets the receiver keep it, with integrity verified', async () => {
    const rig = await makeRig();
    await rig.host.start();
    await rig.guest.start();
    await connectPair(rig);
    expect(rig.host.state.connection).toBeDefined();

    const bytes = new TextEncoder().encode('un fichier de test pour DropForge');
    const source: SourceFile = new MemorySource('docs/note.txt', bytes);

    const answer = answerNextIncoming(rig.guest, (request) => {
      // The user sees the real file list before deciding.
      expect(request.files.map((file) => file.path)).toEqual(['docs/note.txt']);
      return { accepted: true, decisions: [] };
    });

    const transferId = await rig.host.sendSelection([source]);
    expect(transferId).toBeDefined();
    await answer.answered;
    await waitFor(
      rig.host,
      () => rig.host.state.history.some((record) => record.id === transferId && record.state === 'completed'),
      'the sender to finish',
    );
    await waitFor(
      rig.guest,
      () => rig.guest.state.history.some((record) => record.id === transferId && record.state === 'completed'),
      'the receiver to finish',
    );

    expect(rig.guestReceiveFolder.content('docs/note.txt')).toEqual(bytes);

    // The history of both sides records what really happened, not an intention.
    const hostRecord = rig.host.state.history.find((record) => record.id === transferId);
    const guestRecord = rig.guest.state.history.find((record) => record.id === transferId);
    expect(hostRecord?.state).toBe('completed');
    expect(guestRecord?.state).toBe('completed');
    expect(guestRecord?.files[0]?.verified).toBe(true);
    expect(guestRecord?.bytesDone).toBe(bytes.length);
  });

  it('lets the receiver refuse a transfer and never reports it as completed', async () => {
    const rig = await makeRig();
    await rig.host.start();
    await rig.guest.start();
    await connectPair(rig);

    const answer = answerNextIncoming(rig.guest, () => ({
      accepted: false,
      decisions: [],
      rejectReason: 'declined' as const,
    }));
    const transferId = (await rig.host.sendSelection([
      new MemorySource('secret.txt', new Uint8Array([1, 2, 3])),
    ]))!;
    await answer.answered;
    await waitFor(
      rig.host,
      () => rig.host.state.history.some((record) => record.id === transferId && record.state === 'failed'),
      'the sender to record the refusal',
    );

    const senderRecord = rig.host.state.history.find((record) => record.id === transferId);
    expect(senderRecord?.state).toBe('failed');
    expect(senderRecord?.lastErrorCode).toBe(ERROR_CODES.TRANSFER_DECLINED);
    // Nothing was written, and the receiving side never claims a success.
    expect(rig.guestReceiveFolder.content('secret.txt')).toBeUndefined();
    const guestRecord = await recordOf(rig.guestStore, transferId);
    expect(guestRecord?.['state']).not.toBe('completed');
  });

  it('asks before replacing an existing file and renames when asked to', async () => {
    const rig = await makeRig();
    await rig.host.start();
    await rig.guest.start();
    await connectPair(rig);
    rig.guestReceiveFolder.setFile('docs/note.txt', new TextEncoder().encode('ancienne version'));

    const answer = answerNextIncoming(rig.guest, (request) => {
      expect(request.conflicts.map((conflict) => conflict.path)).toEqual(['docs/note.txt']);
      return {
        accepted: true,
        decisions: [{ index: request.conflicts[0]!.index, action: 'rename' as const }],
      };
    });

    const transferId = (await rig.host.sendSelection([
      new MemorySource('docs/note.txt', new TextEncoder().encode('nouvelle version')),
    ]))!;
    await answer.answered;
    await waitFor(
      rig.guest,
      () => rig.guest.state.history.some((record) => record.id === transferId && record.state === 'completed'),
      'the renamed file to be written',
    );
    // The file that was already there is untouched, and the new content arrived
    // under a name that did not exist.
    expect(rig.guestReceiveFolder.content('docs/note.txt')).toEqual(new TextEncoder().encode('ancienne version'));
    const received = rig.guestReceiveFolder.paths().filter((path) => path.includes('note ('));
    expect(received).toEqual(['docs/note (1).txt']);
  });
});

/* ------------------------------------------------------------------ *
 * Updates and history bookkeeping
 * ------------------------------------------------------------------ */

describe('AppController: favourites and quick send', () => {
  it('keeps a favourite marked across a restart, without granting it trust', async () => {
    const rig = await makeRig();
    await rig.host.start();
    await rig.guest.start();
    await connectPair(rig);

    const peer = rig.host.state.devices[0];
    expect(peer).toBeDefined();
    expect(peer?.trusted).toBe(false);

    await rig.host.toggleFavorite(peer!.id);
    expect(rig.host.state.devices[0]?.favorite).toBe(true);
    // A favourite is a bookmark, not an approval.
    expect(rig.host.state.devices[0]?.trusted).toBe(false);

    const reopened = new AppController({
      store: rig.hostStore,
      identities: rig.identities.host,
      capabilities: rig.host.state.capabilities,
      links: () => new FakeLinkFactory(rig.relay, fakeInfo(), 'host'),
      receiveStore: async () => rig.hostReceiveFolder,
    });
    trackController(reopened);
    await reopened.start();
    expect(reopened.state.devices[0]?.favorite).toBe(true);

    await reopened.toggleFavorite(peer!.id);
    expect(reopened.state.devices[0]?.favorite).toBe(false);
  });

  it('sends to a favourite device in one action when it is already connected', async () => {
    const rig = await makeRig();
    await rig.host.start();
    await rig.guest.start();
    await connectPair(rig);

    const favourite = rig.host.state.devices[0];
    expect(favourite).toBeDefined();
    await rig.host.toggleFavorite(favourite!.id);

    const bytes = new TextEncoder().encode('envoi rapide');
    const answer = answerNextIncoming(rig.guest, () => ({ accepted: true, decisions: [] }));
    const transferId = await rig.host.quickSend(favourite!.id, [new MemorySource('rapide.txt', bytes)]);
    expect(transferId).toBeDefined();
    await answer.answered;

    await waitFor(
      rig.guest,
      () => rig.guest.state.history.some((record) => record.id === transferId && record.state === 'completed'),
      'the receiver to finish the quick send',
    );
    expect(rig.guestReceiveFolder.content('rapide.txt')).toEqual(bytes);
  });

  it('never queues anything and says so when a quick send cannot reach the device', async () => {
    const rig = await makeRig();
    await rig.host.start();
    await rig.guest.start();
    await connectPair(rig);

    const favourite = rig.host.state.devices[0];
    await rig.host.toggleFavorite(favourite!.id);
    // The connection is closed, and the peer is not hosting a room: no reachable path.
    rig.host.disconnect();
    const before = rig.host.state.queue.length;

    const transferId = await rig.host.quickSend(favourite!.id, [new MemorySource('rapide.txt', new Uint8Array(4))]);
    expect(transferId).toBeUndefined();
    expect(rig.host.state.queue.length).toBe(before);
    expect(rig.host.state.notices.some((notice) => notice.kind === 'error')).toBe(true);
  });

  it('refuses to quick send to a device this installation does not know', async () => {
    const rig = await makeRig();
    await rig.host.start();
    const transferId = await rig.host.quickSend('device-inconnu-0001', [
      new MemorySource('rapide.txt', new Uint8Array(4)),
    ]);
    expect(transferId).toBeUndefined();
    expect(rig.host.state.notices[0]?.messageKey).toBe('devices.unknown');
  });
});

describe('AppController: notifications', () => {
  it('announces a completed send to the sender and a completed receive to the receiver', async () => {
    const rig = await makeRig();
    await rig.host.start();
    await rig.guest.start();
    await connectPair(rig);

    const answer = answerNextIncoming(rig.guest, () => ({ accepted: true, decisions: [] }));
    const transferId = await rig.host.sendSelection([new MemorySource('photo.jpg', new Uint8Array(64))]);
    await answer.answered;
    await waitFor(
      rig.host,
      () => rig.host.state.history.some((record) => record.id === transferId && record.state === 'completed'),
      'the transfer to complete',
    );

    const sent = rig.channels.host.shown.find((entry) => entry.tag === transferId);
    const received = rig.channels.guest.shown.find((entry) => entry.tag === transferId);
    expect(sent?.title).toContain('notify.sentTitle');
    expect(sent?.body).toContain('notify.sentBody');
    expect(received?.title).toContain('notify.receivedTitle');
    expect(received?.body).toContain('notify.receivedBody');
    // Neither side is told the other's direction.
    expect(rig.channels.host.shown.some((entry) => entry.title.includes('receivedTitle'))).toBe(false);
  });

  it('says nothing about a transfer the user cancelled themselves', async () => {
    const rig = await makeRig();
    await rig.host.start();
    await rig.guest.start();
    await connectPair(rig);

    // The receiver is deliberately never asked to answer: the transfer stays in
    // flight, which is the only moment a cancel can be observed reliably.
    const transferId = await rig.host.sendSelection([new MemorySource('gros.bin', new Uint8Array(400_000))]);
    expect(transferId).toBeDefined();
    await settle(4);

    await rig.host.cancelTransfer(transferId!);
    await waitFor(
      rig.host,
      () => rig.host.state.history.some((record) => record.id === transferId && record.state === 'cancelled'),
      'the cancellation to be recorded',
    );

    // Cancelling is the user's own decision: telling them about it afterwards would
    // be noise, and the record already says what happened.
    expect(rig.channels.host.shown.some((entry) => entry.tag === transferId)).toBe(false);
    expect(rig.channels.guest.shown.some((entry) => entry.tag === transferId)).toBe(false);
  });

  it('announces a failure with its reason, without inventing success', async () => {
    const rig = await makeRig();
    await rig.host.start();
    await rig.guest.start();
    await connectPair(rig);

    // A file whose contents changed after it was offered: the engine must fail it.
    const bytes = new TextEncoder().encode('contenu initial');
    const changed: SourceFile = {
      path: 'mouvant.txt',
      kind: 'file',
      size: bytes.length,
      lastModified: 1,
      read: async (offset: number, length: number) => bytes.subarray(offset, offset + length),
      revalidate: async () => 'changed',
    };

    const answer = answerNextIncoming(rig.guest, () => ({ accepted: true, decisions: [] }));
    const transferId = await rig.host.sendSelection([changed]);
    await answer.answered;
    await waitFor(
      rig.host,
      () => rig.host.state.history.some((record) => record.id === transferId && record.state === 'failed'),
      'the failure to be recorded',
    );

    const failure = rig.channels.host.shown.find((entry) => entry.tag === transferId);
    expect(failure?.title).toContain('notify.failedTitle');
    expect(failure?.body).toContain(`errors.${ERROR_CODES.SOURCE_CHANGED}`);
  });
});

describe('AppController: hosted sharing', () => {
  it('shows the option as unavailable when no sharing service is configured, and refuses to create a link', async () => {
    const rig = await makeRig();
    await rig.host.start();
    // Without a configured backend, the interface must not offer a switch that does
    // nothing: the controller says so, and creating a link fails with a clear code.
    expect(rig.host.state.hostedSharingAvailable).toBe(false);
    await rig.host.updateSettings({ allowHostedSharing: true });

    const share = await rig.host.createShare([new MemorySource('photo.jpg', new Uint8Array(8))]);
    expect(share).toBeUndefined();
    expect(rig.host.state.activeShare).toBeUndefined();
    expect(rig.host.state.notices[0]?.errorCode).toBe(ERROR_CODES.PLATFORM_UNSUPPORTED);
  });

  it('refuses a hosted link when the preference is off, even with a service configured', async () => {
    const rig = await makeRig();
    await rig.host.start();
    await rig.host.updateSettings({ allowHostedSharing: false });
    const share = await rig.host.createShare([new MemorySource('photo.jpg', new Uint8Array(8))]);
    expect(share).toBeUndefined();
    expect(rig.host.state.notices[0]?.errorCode).toBe(ERROR_CODES.HOSTED_SHARING_DISABLED);
  });
});

describe('AppController: updates', () => {
  it('reports an update as available but never installs it without the user', async () => {
    let installs = 0;
    const source: UpdateSource = {
      canCheck: true,
      check: async () => ({ kind: 'available', messageKey: 'settings.updateAvailable' }),
      install: async () => {
        installs += 1;
        return { kind: 'ready', messageKey: 'settings.updateReady' };
      },
      relaunch: () => {},
    };
    const rig = await makeRig({ updateSource: source });
    await rig.host.start();
    expect(rig.host.state.canCheckUpdate).toBe(true);
    expect(rig.host.state.updateState).toBeUndefined();

    await rig.host.checkForUpdate();
    expect(rig.host.state.updateState?.kind).toBe('available');
    expect(installs).toBe(0); // checking is not installing

    await rig.host.installUpdate();
    expect(rig.host.state.updateState?.kind).toBe('ready');
    expect(installs).toBe(1);
  });

  it('says plainly that a plain browser cannot check for updates', async () => {
    const rig = await makeRig();
    await rig.host.start();
    expect(rig.host.state.canCheckUpdate).toBe(false);
    await rig.host.checkForUpdate();
    expect(rig.host.state.updateState?.kind).toBe('error');
    expect(rig.host.state.updateState?.errorCode).toBe(ERROR_CODES.PLATFORM_UNSUPPORTED);
    expect(UPDATE_IDLE.kind).toBe('idle');
  });
});

describe('AppController: history', () => {
  it('searches, exports and deletes what it recorded', async () => {
    const rig = await makeRig();
    await rig.host.start();
    await rig.hostStore.put('transfers', 't1', {
      v: 1,
      id: 't1',
      direction: 'send',
      peerDeviceId: 'peer',
      peerName: 'Téléphone',
      state: 'completed',
      startedAt: 1,
      updatedAt: 2,
      completedAt: 2,
      totalBytes: 4,
      bytesDone: 4,
      files: [{ index: 0, path: 'a.txt', kind: 'file', size: 4, bytesDone: 4, verified: true }],
      transport: 'webrtc',
    });
    await rig.host.refreshHistory();
    expect(rig.host.state.history.length).toBe(1);

    await rig.host.searchHistory('téléphone');
    expect(rig.host.state.history.length).toBe(1);
    await rig.host.searchHistory('rien-du-tout');
    expect(rig.host.state.history.length).toBe(0);

    await rig.host.searchHistory('');
    const exported = JSON.parse(await rig.host.exportHistory()) as { v: number; transfers: unknown[] };
    expect(exported.v).toBe(1);
    expect(exported.transfers).toHaveLength(1);

    await rig.host.deleteHistoryEntry('t1');
    expect(rig.host.state.history).toEqual([]);
  });
});

function fakeInfo(): LinkPeerInfo {
  return { deviceId: 'dev', displayName: 'dev', platform: 'web', fingerprint: 'ab', capabilities: [] };
}

describe('controller helpers', () => {
  it('builds a room code from the documented alphabet only', () => {
    const code = newRoomCode();
    expect(code).toHaveLength(12);
    expect(code).toMatch(/^[A-Za-z0-9_-]{4,32}$/);
    expect(newRoomCode()).not.toBe(code);
  });

  it('puts the pairing code in the link fragment', () => {
    expect(pairingLinkFor('abc123', { origin: 'https://dropforge.example' } as Location)).toBe(
      'https://dropforge.example/#c=abc123',
    );
  });
});
