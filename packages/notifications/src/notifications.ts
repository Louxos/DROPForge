/**
 * Notifications: honest, permission-aware, and never a substitute for the UI.
 *
 * Rules:
 *  - the permission is *queried* and reported, never assumed. A browser that has
 *    no notification support (`supported: false`) is not an error: the app simply
 *    shows the information inside the window, and the UI must say so;
 *  - a denied permission is remembered and respected: DropForge does not nag, and
 *    the settings screen explains how to re-enable it at the system level;
 *  - duplicates are collapsed (same kind + same transfer), so a burst of progress
 *    events cannot spam the user;
 *  - a notification never carries file contents, paths of sensitive folders, or
 *    keys: only a short, already-translatable summary.
 */
import { DropForgeError, ERROR_CODES } from '@dropforge/app-core';
import type { Clock, Logger } from '@dropforge/protocol';

export type NotificationKind =
  | 'incoming-request'
  | 'transfer-completed'
  | 'transfer-failed'
  | 'transfer-interrupted'
  | 'share-downloaded'
  | 'link-expiring';

export type NotificationPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

export interface NotificationRequest {
  kind: NotificationKind;
  /** Displayable title, already translated by the caller. */
  title: string;
  body: string;
  /** Optional transfer id: used to collapse duplicates, never shown. */
  tag?: string;
  /** Clicking the notification focuses this route inside the app. */
  route?: string;
  /** Urgency, used to decide batching; never used to bypass the user's settings. */
  priority?: 'normal' | 'high';
}

export interface DeliveredNotification extends NotificationRequest {
  id: string;
  createdAt: number;
}

/** The platform's notification channel (Web Notifications, Tauri, or nothing). */
export interface NotificationChannel {
  readonly supported: boolean;
  permission(): Promise<NotificationPermission>;
  requestPermission(): Promise<NotificationPermission>;
  show(request: { title: string; body: string; tag?: string }): Promise<void>;
  onActivated(listener: (tag: string | undefined) => void): () => void;
}

/** Used when the platform has no notification support at all (e.g. a strict iOS PWA). */
export const unsupportedChannel: NotificationChannel = {
  supported: false,
  permission: async () => 'unsupported',
  requestPermission: async () => 'unsupported',
  show: async () => {},
  onActivated: () => () => {},
};

export interface NotificationServiceOptions {
  channel: NotificationChannel;
  clock: Clock;
  logger?: Logger;
  /** How long identical notifications are collapsed. */
  dedupeWindowMs?: number;
  /** Hard cap on deliveries per minute, whatever happens upstream. */
  maxPerMinute?: number;
  /** The user switched notifications off: nothing is delivered at all. */
  enabled?: () => boolean;
}

const DEFAULT_DEDUPE_WINDOW_MS = 30_000;
const DEFAULT_MAX_PER_MINUTE = 12;

export class NotificationService {
  private permission: NotificationPermission = 'prompt';
  private readonly listeners = new Set<(notification: DeliveredNotification) => void>();
  private readonly recent = new Map<string, number>();
  private readonly history: DeliveredNotification[] = [];
  private deliveredInWindow: number[] = [];

  constructor(private readonly options: NotificationServiceOptions) {}

  get supported(): boolean {
    return this.options.channel.supported;
  }

  /** Reads (and caches) the platform permission. */
  async currentPermission(): Promise<NotificationPermission> {
    this.permission = this.options.channel.supported ? await this.options.channel.permission() : 'unsupported';
    return this.permission;
  }

  /**
   * Asks for the permission. Must be called from a user gesture (the UI does it
   * from the settings screen), and the result is what it is: a denial is reported,
   * never retried in a loop.
   */
  async requestPermission(): Promise<NotificationPermission> {
    if (!this.options.channel.supported) return 'unsupported';
    if (this.permission === 'denied') {
      // Re-asking after a denial achieves nothing in every browser implementation.
      return 'denied';
    }
    this.permission = await this.options.channel.requestPermission();
    return this.permission;
  }

  /** True when a notification would actually be shown right now. */
  async canDeliver(): Promise<boolean> {
    if (this.options.enabled && !this.options.enabled()) return false;
    return this.supported && (await this.currentPermission()) === 'granted';
  }

  /**
   * Delivers a notification, or reports why it was not delivered. The caller keeps
   * working either way: a notification is a convenience, never a step of a transfer.
   */
  async notify(request: NotificationRequest): Promise<{ delivered: boolean; reason?: string }> {
    if (!this.options.channel.supported) return { delivered: false, reason: 'unsupported' };
    if (this.options.enabled && !this.options.enabled()) return { delivered: false, reason: 'disabled' };
    const permission = await this.currentPermission();
    if (permission !== 'granted') return { delivered: false, reason: permission };

    const now = this.options.clock.now();
    const key = `${request.kind}:${request.tag ?? ''}`;
    const dedupeWindow = this.options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
    const last = this.recent.get(key);
    if (last !== undefined && now - last < dedupeWindow && request.priority !== 'high') {
      return { delivered: false, reason: 'duplicate' };
    }
    const maxPerMinute = this.options.maxPerMinute ?? DEFAULT_MAX_PER_MINUTE;
    this.deliveredInWindow = this.deliveredInWindow.filter((at) => now - at < 60_000);
    if (this.deliveredInWindow.length >= maxPerMinute) {
      return { delivered: false, reason: 'rate-limited' };
    }

    try {
      await this.options.channel.show({
        title: request.title,
        body: request.body,
        ...(request.tag ? { tag: request.tag } : {}),
      });
    } catch (error) {
      // A failing channel is not a failed transfer: log it and carry on.
      this.options.logger?.log('warn', 'notification could not be shown', { kind: request.kind });
      throw error instanceof DropForgeError
        ? error
        : new DropForgeError(ERROR_CODES.PLATFORM_UNSUPPORTED, 'This device refused to show the notification', {
            cause: error,
          });
    }

    this.recent.set(key, now);
    this.deliveredInWindow.push(now);
    const delivered: DeliveredNotification = {
      ...request,
      id: `${request.kind}-${now}`,
      createdAt: now,
    };
    this.history.push(delivered);
    if (this.history.length > 200) this.history.shift();
    for (const listener of [...this.listeners]) listener(delivered);
    return { delivered: true };
  }

  /**
   * In-app fallback for platforms without notifications: the same information is
   * pushed to the UI listener, and nothing pretends a system notification happened.
   */
  onDelivered(listener: (notification: DeliveredNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Notifications already delivered in this session, newest first. */
  delivered(): DeliveredNotification[] {
    return [...this.history].reverse();
  }

  onActivated(listener: (route: string | undefined) => void): () => void {
    return this.options.channel.onActivated((tag) => {
      const request = this.history.find((entry) => entry.tag === tag);
      listener(request?.route);
    });
  }

  /** What the settings screen must tell the user, in plain words. */
  describe(): { supported: boolean; permission: NotificationPermission; hint: string } {
    if (!this.supported) {
      return {
        supported: false,
        permission: 'unsupported',
        hint: 'This browser does not allow notifications: DropForge shows everything inside the window instead.',
      };
    }
    switch (this.permission) {
      case 'granted':
        return { supported: true, permission: 'granted', hint: 'Notifications are allowed.' };
      case 'denied':
        return {
          supported: true,
          permission: 'denied',
          hint: 'Notifications are blocked for this site. Allow them in your browser settings, then reload.',
        };
      default:
        return {
          supported: true,
          permission: 'prompt',
          hint: 'Notifications are not allowed yet: turn them on to be told when a transfer finishes.',
        };
    }
  }
}
