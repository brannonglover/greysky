import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * Runs `callback` when the app returns to the foreground.
 *
 * JS timers are suspended while the app is backgrounded, so anything on an
 * interval is stale on resume and needs an immediate catch-up.
 */
export function useOnAppResume(callback: () => void): void {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    let previous: AppStateStatus = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      const resumed = previous !== 'active' && next === 'active';
      previous = next;
      if (resumed) saved.current();
    });
    return () => subscription.remove();
  }, []);
}
