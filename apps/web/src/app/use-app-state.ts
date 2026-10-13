/**
 * Bridges the plain `AppController` to React. The controller owns the state; React
 * only re-renders when the controller says something changed. No state is copied,
 * so the UI can never drift from the engine's view of the world.
 */
import { useSyncExternalStore } from 'react';
import type { AppController, AppState } from './controller.js';

export function useAppState(controller: AppController): AppState {
  return useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.state,
  );
}
