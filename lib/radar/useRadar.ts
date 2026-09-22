import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { useOnAppResume } from '@/lib/useOnAppResume';
import { getRadarManifest, peekRadarManifest } from './manifest';
import type { Playhead } from './playhead';
import type { RadarManifest } from './types';

/** How often to re-ask for frames; the service's own cache is 60s. */
const REFRESH_MS = 75_000;

/**
 * Manifest state: low frequency, so ordinary React state is right here.
 * Deliberately separate from the playhead, which changes far too often to
 * belong in a render.
 */
export function useRadarManifest(): {
  manifest: RadarManifest | null;
  error: string | null;
  reload: () => void;
} {
  const [manifest, setManifest] = useState<RadarManifest | null>(peekRadarManifest);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback((force = true) => {
    getRadarManifest(force)
      .then((next) => {
        if (!mounted.current) return;
        setManifest(next);
        setError(null);
      })
      .catch(() => {
        if (!mounted.current) return;
        // Keep showing whatever is already on screen; only a cold failure
        // is worth surfacing.
        setManifest((current) => {
          if (!current) setError('Radar is unavailable right now.');
          return current;
        });
      });
  }, []);

  useEffect(() => {
    reload(false);
    const timer = setInterval(() => reload(true), REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  useOnAppResume(() => reload(true));

  return { manifest, error, reload };
}

/**
 * Subscribe a component to the playhead. Only components that actually display
 * the current index should call this — the map and the clock, not the screen.
 */
export function usePlayheadIndex(playhead: Playhead): number {
  return useSyncExternalStore(
    useCallback((listener) => playhead.subscribe(listener), [playhead]),
    useCallback(() => playhead.index, [playhead]),
    useCallback(() => playhead.index, [playhead]),
  );
}

/**
 * Drives the animation. The interval mutates the playhead directly, so a
 * playing timeline costs no renders outside the subscribed components.
 */
export function usePlayback(playhead: Playhead, playing: boolean, intervalMs: number): void {
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => playhead.advance(), intervalMs);
    return () => clearInterval(timer);
  }, [playhead, playing, intervalMs]);
}
