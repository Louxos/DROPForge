/**
 * Small typed event emitter used across the modules.
 *
 * Usage: `new Emitter<{ progress: Progress; closed: Reason }>()` then
 * `events.on('progress', handler)` / `events.emit('progress', value)`.
 * A listener that throws is logged and skipped: one broken subscriber must never
 * break the transfer engine.
 */

/**
 * An event map: keys are event names, values are payload types. Interfaces do
 * not have implicit index signatures, so the constraint is `object` rather than
 * `Record<string, unknown>`.
 */
export type EventMap = object;
export type Listener<T> = (value: T) => void;
export type Unsubscribe = () => void;

export class Emitter<Events extends EventMap> {
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => {
      set?.delete(listener as Listener<never>);
    };
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
    const off = this.on(event, (value) => {
      off();
      listener(value);
    });
    return off;
  }

  emit<K extends keyof Events>(event: K, value: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        (listener as Listener<Events[K]>)(value);
      } catch (error) {
        console.error('[dropforge] event listener failed', error);
      }
    }
  }

  listenerCount(event: keyof Events): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  clear(event?: keyof Events): void {
    if (event === undefined) this.listeners.clear();
    else this.listeners.delete(event);
  }
}
