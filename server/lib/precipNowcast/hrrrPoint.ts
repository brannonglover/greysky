import { forecastFrames, type ForecastFrame } from '../hrrr';
import { gridForFrame } from '../gridCache';
import { MIN_DBZ } from '../palette';
import { dbzToRainRate } from '../reflectivity';
import { sampleGridAt } from '../render';

const STEP_PAD_SEC = 15 * 60;

export type HrrrLeadRate = {
  leadMinutes: number;
  rainRateMmHr: number | null;
  validAt: string;
};

function rateFromDbz(dbz: number | null): number | null {
  if (dbz == null || !Number.isFinite(dbz)) return null;
  if (dbz < MIN_DBZ) return 0;
  return dbzToRainRate(dbz);
}

async function reflectivityAt(frame: ForecastFrame, latitude: number, longitude: number): Promise<number | null> {
  const grid = await gridForFrame(frame);
  const dbz = sampleGridAt(grid, latitude, longitude);
  if (dbz == null || !Number.isFinite(dbz)) return null;
  return dbz;
}

/**
 * HRRR composite reflectivity at one point.
 * Between published 15-minute steps the dBZ values are blended linearly,
 * which is what the forecast tiles already do. Outside the grid is missing.
 * A published no-echo value stays 0. A failed run stays null.
 */
export async function hrrrLeadRates(args: {
  latitude: number;
  longitude: number;
  issuedAtMs: number;
  leads: readonly number[];
}): Promise<{ analysisRateMmHr: number | null; leads: HrrrLeadRate[]; diagnostics: Record<string, string | number | boolean | null> }> {
  const diagnostics: Record<string, string | number | boolean | null> = {
    source: 'hrrr-refc',
    timeBlend: 'linear-dbz-between-15min-steps',
  };
  let frames: ForecastFrame[] = [];
  try {
    frames = await forecastFrames(Math.max(...args.leads) + 15, new Date(args.issuedAtMs));
  } catch (error) {
    diagnostics.error = error instanceof Error ? error.message : 'HRRR unavailable';
    return {
      analysisRateMmHr: null,
      leads: args.leads.map((leadMinutes) => ({
        leadMinutes,
        rainRateMmHr: null,
        validAt: new Date(args.issuedAtMs + leadMinutes * 60_000).toISOString(),
      })),
      diagnostics,
    };
  }
  diagnostics.frames = frames.length;
  diagnostics.run = frames[0]?.run ?? null;

  const cache = new Map<number, number | null>();
  const dbzAt = async (frame: ForecastFrame): Promise<number | null> => {
    const hit = cache.get(frame.time);
    if (hit !== undefined) return hit;
    const value = await reflectivityAt(frame, args.latitude, args.longitude).catch(() => null);
    cache.set(frame.time, value);
    return value;
  };

  const blended = async (targetSec: number): Promise<number | null> => {
    if (frames.length === 0) return null;
    let prev: ForecastFrame | null = null;
    let next: ForecastFrame | null = null;
    for (const frame of frames) {
      if (frame.time <= targetSec) prev = frame;
      if (frame.time >= targetSec) {
        next = frame;
        break;
      }
    }
    if (prev && next && prev.time === next.time) return dbzAt(prev);
    if (prev && next) {
      const left = await dbzAt(prev);
      const right = await dbzAt(next);
      if (left == null || right == null) return null;
      const span = next.time - prev.time;
      const t = span <= 0 ? 0 : (targetSec - prev.time) / span;
      return left + (right - left) * t;
    }
    const only = prev ?? next;
    if (!only || Math.abs(only.time - targetSec) > STEP_PAD_SEC) return null;
    return dbzAt(only);
  };

  const analysisDbz = await blended(Math.round(args.issuedAtMs / 1000));
  const leads: HrrrLeadRate[] = [];
  for (const leadMinutes of args.leads) {
    const targetMs = args.issuedAtMs + leadMinutes * 60_000;
    const dbz = await blended(Math.round(targetMs / 1000));
    leads.push({
      leadMinutes,
      rainRateMmHr: rateFromDbz(dbz),
      validAt: new Date(targetMs).toISOString(),
    });
  }
  return { analysisRateMmHr: rateFromDbz(analysisDbz), leads, diagnostics };
}
