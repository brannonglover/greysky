/**
 * How responsibility shifts from the observation-anchored nowcast to HRRR.
 *
 * None of these numbers are meteorological constants. They are a starting
 * point to be tuned against actual radar playback, which is why the curve is
 * data rather than code.
 */

import type { BlendMode } from '../transitionTile';

export type TransitionConfig = {
  /** Interpolation space for blended frames. Internal; never user-facing. */
  blendMode: BlendMode;
  /** Below this lead, frames are pure nowcast. */
  nowcastOnlyUntilMin: number;
  /** At or above this lead, frames are pure HRRR. */
  forecastOnlyFromMin: number;
  /**
   * Control points as [leadMinutes, forecastWeight], ascending by lead.
   * Interpolated linearly between points.
   */
  curve: Array<[number, number]>;
};

export const DEFAULT_TRANSITION: TransitionConfig = {
  blendMode: 'rainrate',
  nowcastOnlyUntilMin: 15,
  forecastOnlyFromMin: 45,
  curve: [
    [15, 0],
    [20, 0.1],
    [25, 0.25],
    [30, 0.5],
    [35, 0.75],
    [40, 0.9],
    [45, 1],
  ],
};

/**
 * Weight on the forecast provider at a given lead, 0 = pure nowcast,
 * 1 = pure forecast.
 */
export function forecastWeight(leadMin: number, config: TransitionConfig = DEFAULT_TRANSITION): number {
  if (leadMin <= config.nowcastOnlyUntilMin) return 0;
  if (leadMin >= config.forecastOnlyFromMin) return 1;

  const points = config.curve;
  if (points.length === 0) return leadMin >= config.forecastOnlyFromMin ? 1 : 0;

  if (leadMin <= points[0][0]) return clamp(points[0][1]);
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (leadMin >= x0 && leadMin <= x1) {
      const span = x1 - x0;
      const t = span <= 0 ? 0 : (leadMin - x0) / span;
      return clamp(y0 + (y1 - y0) * t);
    }
  }
  return clamp(points[points.length - 1][1]);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Rounded to the precision carried in tile URLs, so keys stay stable. */
export function quantizeWeight(weight: number): number {
  return Math.round(weight * 100) / 100;
}
