import UPNG from 'upng-js';

import { intensityFromMmHr } from '@/lib/precip';
import { DARK_SKY_RAIN } from '@/lib/radarPalette';
import type { RainFrame } from '@/lib/weather';

export type RadarSample = {
  time: number;
  intensity: number;
};

function dbzToMmHr(dbz: number): number {
  if (dbz < 10) return 0;
  const z = 10 ** (dbz / 10);
  return (z / 200) ** (1 / 1.6);
}

function rgbaToDbz(r: number, g: number, b: number, a: number): number {
  if (a < 24) return 0;
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const swatch of DARK_SKY_RAIN) {
    if (swatch.a < 24) continue;
    const dist =
      (r - swatch.r) ** 2 + (g - swatch.g) ** 2 + (b - swatch.b) ** 2 + ((a - swatch.a) / 2) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = swatch.dbz;
    }
  }
  return bestDist > 48_000 ? 0 : best;
}

function sampleCenterIntensity(rgba: Uint8Array, width: number, height: number): number {
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  let sum = 0;
  let count = 0;
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const x = Math.min(width - 1, Math.max(0, cx + dx));
      const y = Math.min(height - 1, Math.max(0, cy + dy));
      const i = (y * width + x) * 4;
      const dbz = rgbaToDbz(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]);
      sum += intensityFromMmHr(dbzToMmHr(dbz));
      count += 1;
    }
  }
  return count ? sum / count : 0;
}

export function radarCoordTileUrl(frame: RainFrame, latitude: number, longitude: number, zoom = 7): string {
  return `${frame.host}${frame.path}/256/${zoom}/${latitude.toFixed(4)}/${longitude.toFixed(4)}/8/1_1.png`;
}

async function sampleFrame(frame: RainFrame, latitude: number, longitude: number): Promise<RadarSample> {
  const response = await fetch(radarCoordTileUrl(frame, latitude, longitude));
  if (!response.ok) return { time: frame.time, intensity: 0 };
  const buffer = await response.arrayBuffer();
  const img = UPNG.decode(buffer);
  const rgba = new Uint8Array(UPNG.toRGBA8(img)[0]);
  return { time: frame.time, intensity: sampleCenterIntensity(rgba, img.width, img.height) };
}

/** Radar reflectivity at the pin, using the same Dark Sky tiles as the map. */
export async function sampleRadarAtPoint(
  latitude: number,
  longitude: number,
  frames: RainFrame[],
): Promise<RadarSample[]> {
  const samples = await Promise.all(frames.map((frame) => sampleFrame(frame, latitude, longitude).catch(() => ({ time: frame.time, intensity: 0 }))));
  return samples.sort((a, b) => a.time - b.time);
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

export function radarIsWet(samples: RadarSample[]): boolean {
  return samples.some((sample) => sample.intensity > 0.12);
}
