import { intensityFromMmHr } from '@/lib/precip';
import { RADAR_API } from '@/lib/radar/api';
import { dbzToRainRate } from '@/lib/radar/reflectivity';

export type RadarSample = {
  time: number;
  intensity: number;
  kind: 'observed' | 'forecast';
};

type PointResponse = {
  samples?: Array<{ time: number; kind: 'observed' | 'forecast'; dbz: number | null }>;
};

/** Below this the return is noise rather than measurable rain. */
const MIN_RAIN_DBZ = 10;

function dbzToMmHr(dbz: number): number {
  return dbz < MIN_RAIN_DBZ ? 0 : dbzToRainRate(dbz);
}

/**
 * Reflectivity at the pin across the same window the radar map covers. The
 * service reads observed values out of NOAA's WMS and forecast values straight
 * from the HRRR grid, so this now extends an hour ahead as well as behind.
 */
export async function sampleRadarAtPoint(latitude: number, longitude: number): Promise<RadarSample[]> {
  const response = await fetch(
    `${RADAR_API}/api/radar/point?lat=${latitude.toFixed(4)}&lon=${longitude.toFixed(4)}`,
  );
  if (!response.ok) throw new Error('Radar point sampling unavailable');
  const json = (await response.json()) as PointResponse;
  if (!Array.isArray(json.samples)) return [];
  return json.samples
    .map((sample) => ({
      time: sample.time,
      kind: sample.kind,
      intensity: sample.dbz == null ? 0 : intensityFromMmHr(dbzToMmHr(sample.dbz)),
    }))
    .sort((a, b) => a.time - b.time);
}

export function radarIntensityAt(samples: RadarSample[], targetSec: number): number | null {
  if (!samples.length) return null;
  const sorted = samples;
  const minT = sorted[0].time;
  const maxT = sorted[sorted.length - 1].time;
  if (targetSec < minT - 15 * 60 || targetSec > maxT + 15 * 60) return null;
  if (targetSec <= minT) return sorted[0].intensity;
  if (targetSec >= maxT) return sorted[sorted.length - 1].intensity;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const left = sorted[i];
    const right = sorted[i + 1];
    if (targetSec >= left.time && targetSec <= right.time) {
      const span = Math.max(1, right.time - left.time);
      const t = (targetSec - left.time) / span;
      return left.intensity + (right.intensity - left.intensity) * t;
    }
  }
  return sorted[0].intensity;
}

/** Matches a light echo on the 0–1 intensity scale (~10 dBZ / measurable rain). */
export const RADAR_WET_INTENSITY = 0.12;

export function radarWetAt(samples: RadarSample[], targetSec: number): boolean | null {
  const intensity = radarIntensityAt(samples, targetSec);
  if (intensity == null) return null;
  return intensity > RADAR_WET_INTENSITY;
}

export function radarIsWet(samples: RadarSample[]): boolean {
  return samples.some((sample) => sample.intensity > RADAR_WET_INTENSITY);
}
