import type { VercelRequest, VercelResponse } from '@vercel/node';

import { gridForFrame } from '../../lib/gridCache';
import { forecastFrames } from '../../lib/hrrr';
import { observedColorAt, observedTimes, selectObserved } from '../../lib/mrms';
import { dbzForColor } from '../../lib/palette';
import { sampleGridAt } from '../../lib/render';

const PAST_MIN = 60;
const FUTURE_MIN = 60;
/** Coarser than the map timeline; the precipitation chart only needs a trend. */
const OBSERVED_CADENCE_MIN = 10;

export type PointSample = {
  time: number;
  kind: 'observed' | 'forecast';
  dbz: number | null;
};

function floatParam(value: unknown): number | null {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const lat = floatParam(req.query.lat);
  const lon = floatParam(req.query.lon);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }

  const now = Date.now();

  const observedPromise = observedTimes()
    .then((times) => selectObserved(times, PAST_MIN, OBSERVED_CADENCE_MIN, now))
    .then((frames) =>
      Promise.all(
        frames.map(async (frame): Promise<PointSample> => {
          const color = await observedColorAt(frame.isoTime, lat, lon).catch(() => null);
          return {
            time: frame.time,
            kind: 'observed',
            dbz: color ? dbzForColor(color.r, color.g, color.b, color.a) : null,
          };
        }),
      ),
    )
    .catch((): PointSample[] => []);

  const forecastPromise = forecastFrames(FUTURE_MIN, new Date(now))
    .then((frames) =>
      Promise.all(
        frames.map(async (frame): Promise<PointSample> => {
          const grid = await gridForFrame(frame);
          const dbz = sampleGridAt(grid, lat, lon);
          return { time: frame.time, kind: 'forecast', dbz: dbz === null || dbz < 5 ? null : dbz };
        }),
      ),
    )
    .catch((): PointSample[] => []);

  const [observed, forecast] = await Promise.all([observedPromise, forecastPromise]);
  const samples = [...observed, ...forecast].sort((a, b) => a.time - b.time);

  if (samples.length === 0) return res.status(502).json({ error: 'No radar sources available' });

  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
  return res.status(200).json({ generated: Math.round(now / 1000), samples });
}
