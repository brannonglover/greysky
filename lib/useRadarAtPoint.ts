import { useCallback, useEffect, useRef, useState } from 'react';

import { sampleRadarAtPoint, type RadarSample } from '@/lib/radarAtPoint';
import { useOnAppResume } from '@/lib/useOnAppResume';

/** Point sampling is slow enough that a coords change can land out of order. */
export function useRadarAtPoint(
  coords: { latitude: number; longitude: number } | null,
): RadarSample[] {
  const [radar, setRadar] = useState<RadarSample[]>([]);
  const requestId = useRef(0);

  const load = useCallback(() => {
    if (!coords) return;
    const id = ++requestId.current;
    sampleRadarAtPoint(coords.latitude, coords.longitude)
      .then((samples) => {
        if (id === requestId.current) setRadar(samples);
      })
      .catch(() => {
        if (id === requestId.current) setRadar([]);
      });
  }, [coords]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 75_000);
    return () => clearInterval(timer);
  }, [load]);

  useOnAppResume(load);

  return radar;
}
