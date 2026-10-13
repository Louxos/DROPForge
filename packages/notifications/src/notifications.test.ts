import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@dropforge/app-core';
import type { Clock } from '@dropforge/protocol';
import {
  NotificationService,
  unsupportedChannel,
  type NotificationChannel,
  type NotificationPermission,
} from './notifications.js';

class FakeClock implements Clock {
  private t = 0;
  now(): number {
    return this.t;
  }
  setTimeout(): unknown {
    return 0;
  }
  clearTimeout(): void {}
  setInterval(): unknown {
    return 0;
  }
  clearInterval(): void {}
  advance(ms: number): void {
    this.t += ms;
  }
}

class FakeChannel implements NotificationChannel {
  readonly supported = true;
  readonly shown: Array<{ title: string; body: string; tag?: string }> = [];
  private current: NotificationPermission = 'granted';
  askResult: NotificationPermission = 'granted';
  activated: (tag: string | undefined) => void = () => {};

  async permission(): Promise<NotificationPermission> {
    return this.current;
  }
  async requestPermission(): Promise<NotificationPermission> {
    this.current = this.askResult;
    return this.current;
  }
  async show(request: { title: string; body: string; tag?: string }): Promise<void> {
    this.shown.push(request);
  }
  onActivated(listener: (tag: string | undefined) => void): () => void {
    this.activated = listener;
    return () => {};
  }
  setPermission(value: NotificationPermission): void {
    this.current = value;
  }
}

const service = (channel: NotificationChannel, clock = new FakeClock()): NotificationService =>
  new NotificationService({ channel, clock });

describe('NotificationService', () => {
  it('delivers a notification when the permission is granted', async () => {
    const channel = new FakeChannel();
    const notifications = service(channel);
    const result = await notifications.notify({ kind: 'transfer-completed', title: 'Envoyé', body: '3 fichiers' });
    expect(result.delivered).toBe(true);
    expect(channel.shown).toHaveLength(1);
    expect(notifications.delivered()).toHaveLength(1);
  });

  it('never claims success when the permission is missing', async () => {
    const channel = new FakeChannel();
    channel.setPermission('denied');
    const notifications = service(channel);
    const result = await notifications.notify({ kind: 'transfer-completed', title: 't', body: 'b' });
    expect(result).toEqual({ delivered: false, reason: 'denied' });
    expect(channel.shown).toEqual([]);
    // …and the user is told what to do about it.
    const described = notifications.describe();
    expect(described.permission).toBe('denied');
    expect(described.hint).toMatch(/browser settings/);
  });

  it('does not nag after a denial', async () => {
    const channel = new FakeChannel();
    channel.askResult = 'denied';
    const notifications = service(channel);
    expect(await notifications.requestPermission()).toBe('denied');
    channel.askResult = 'granted';
    // A second call reports the remembered denial instead of prompting again.
    expect(await notifications.requestPermission()).toBe('denied');
  });

  it('reports a platform without notification support instead of throwing', async () => {
    const notifications = service(unsupportedChannel);
    expect(notifications.supported).toBe(false);
    expect(await notifications.currentPermission()).toBe('unsupported');
    expect(await notifications.notify({ kind: 'transfer-failed', title: 't', body: 'b' })).toEqual({
      delivered: false,
      reason: 'unsupported',
    });
    expect(notifications.describe().hint).toMatch(/inside the window/);
  });

  it('collapses duplicates, but lets an urgent one through', async () => {
    const channel = new FakeChannel();
    const clock = new FakeClock();
    const notifications = service(channel, clock);

    await notifications.notify({ kind: 'transfer-interrupted', title: 't', body: 'b', tag: 't-1' });
    const second = await notifications.notify({ kind: 'transfer-interrupted', title: 't', body: 'b', tag: 't-1' });
    expect(second).toEqual({ delivered: false, reason: 'duplicate' });

    const urgent = await notifications.notify({
      kind: 'incoming-request',
      title: 't',
      body: 'b',
      tag: 't-1',
      priority: 'high',
    });
    expect(urgent.delivered).toBe(true);

    clock.advance(60_000);
    const later = await notifications.notify({ kind: 'transfer-interrupted', title: 't', body: 'b', tag: 't-1' });
    expect(later.delivered).toBe(true);
  });

  it('rate limits a burst so it can never spam the user', async () => {
    const channel = new FakeChannel();
    const clock = new FakeClock();
    const notifications = new NotificationService({ channel, clock, maxPerMinute: 3 });
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await notifications.notify({ kind: 'share-downloaded', title: 't', body: 'b', tag: `t-${i}` }));
    }
    expect(results.filter((r) => r.delivered)).toHaveLength(3);
    expect(results.at(-1)).toEqual({ delivered: false, reason: 'rate-limited' });
    clock.advance(61_000);
    expect((await notifications.notify({ kind: 'share-downloaded', title: 't', body: 'b', tag: 't-9' })).delivered).toBe(
      true,
    );
  });

  it('honours the user setting before touching the channel', async () => {
    const channel = new FakeChannel();
    let enabled = false;
    const notifications = new NotificationService({ channel, clock: new FakeClock(), enabled: () => enabled });
    expect(await notifications.notify({ kind: 'transfer-completed', title: 't', body: 'b' })).toEqual({
      delivered: false,
      reason: 'disabled',
    });
    enabled = true;
    expect((await notifications.notify({ kind: 'transfer-completed', title: 't', body: 'b' })).delivered).toBe(true);
  });

  it('maps a click back to the route the caller asked for, never leaking the tag', async () => {
    const channel = new FakeChannel();
    const notifications = service(channel);
    const routes: Array<string | undefined> = [];
    notifications.onActivated((route) => routes.push(route));
    await notifications.notify({
      kind: 'incoming-request',
      title: 't',
      body: 'b',
      tag: 't-42',
      route: '/transfers',
    });
    channel.activated('t-42');
    expect(routes).toEqual(['/transfers']);
  });

  it('reports a failing channel with a stable code, without losing the transfer', async () => {
    const channel = new FakeChannel();
    channel.show = async () => {
      throw new Error('permission revoked behind our back');
    };
    const notifications = service(channel);
    await expect(notifications.notify({ kind: 'transfer-failed', title: 't', body: 'b' })).rejects.toMatchObject({
      code: ERROR_CODES.PLATFORM_UNSUPPORTED,
    });
  });
});
