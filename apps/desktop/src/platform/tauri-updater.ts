/**
 * Updates for the Windows application.
 *
 * The rule from the specification, implemented literally: DropForge *checks* and
 * then *asks*. The Tauri updater only applies a package whose signature matches the
 * public key compiled into the application (`plugins.updater.pubkey` in
 * `tauri.conf.json`); that check cannot be turned off from here, and this module
 * never installs anything without an explicit call from the interface.
 */
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { ERROR_CODES } from '@dropforge/app-core';
import type { UpdateSource, UpdateStatus } from '@dropforge/web';

export class TauriUpdateSource implements UpdateSource {
  readonly canCheck = true;
  private pending: Update | undefined;
  private downloaded = false;

  async check(): Promise<UpdateStatus> {
    try {
      const update = await check();
      if (!update) {
        this.pending = undefined;
        return { kind: 'upToDate', messageKey: 'settings.updateUpToDate' };
      }
      this.pending = update;
      this.downloaded = false;
      // The version comes from the signed manifest, not from a string we composed.
      return { kind: 'available', messageKey: 'settings.updateAvailable', version: update.version };
    } catch (error) {
      return {
        kind: 'error',
        messageKey: 'settings.updateCheckFailed',
        errorCode: ERROR_CODES.RELAY_UNAVAILABLE,
        ...(error instanceof Error ? {} : {}),
      };
    }
  }

  async install(): Promise<UpdateStatus> {
    const update = this.pending;
    if (!update) {
      return { kind: 'error', messageKey: 'settings.updateNothingToInstall', errorCode: ERROR_CODES.UNSUPPORTED_OPERATION };
    }
    try {
      if (!this.downloaded) {
        // `downloadAndInstall` verifies the signature before writing the package.
        await update.downloadAndInstall();
        this.downloaded = true;
      }
      return { kind: 'ready', messageKey: 'settings.updateReady', version: update.version };
    } catch {
      return { kind: 'error', messageKey: 'settings.updateCheckFailed', errorCode: ERROR_CODES.WRITE_FAILED };
    }
  }

  relaunch(): void {
    void relaunch();
  }
}
