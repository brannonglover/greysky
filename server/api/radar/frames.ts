import type { VercelRequest, VercelResponse } from '@vercel/node';

import { forecastFrames } from '../../lib/hrrr';
import { observedTimes, selectObserved, wmsConfig } from '../../lib/mrms';
import { legendStops } from '../../lib/palette';

const PAST_MIN = 60;
const FUTURE_MIN = 60;
const OBSERVED_CADENCE_MIN = 5;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const now = Date.now();

  // A failure on either half should still yield a usable timeline.
  const [observed, forecast] = await Promise.all([
    observedTimes()
      .then((times) => selectObserved(times, PAST_MIN, OBSERVED_CADENCE_MIN, now))
      .catch(() => []),
    forecastFrames(FUTURE_MIN, new Date(now)).catch(() => []),
  ]);

  if (observed.length === 0 && forecast.length === 0) {
    return res.status(502).json({ error: 'No radar sources available' });
  }

  const origin = `https://${req.headers.host}`;
  const frames = [
    ...observed.map((frame) => ({
      time: frame.time,
      kind: 'observed' as const,
      wms: wmsConfig(frame.isoTime),
    })),
    ...forecast.map((frame) => ({
      time: frame.time,
      kind: 'forecast' as const,
      urlTemplate:
        `${origin}/api/radar/tile` +
        `?run=${encodeURIComponent(frame.run)}&minute=${frame.forecastMinute}` +
        `&z={z}&x={x}&y={y}`,
    })),
  ].sort((a, b) => a.time - b.time);

  // Frame membership changes as new observations and runs land; keep it short.
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
  return res.status(200).json({
    generated: Math.round(now / 1000),
    window: { pastMin: PAST_MIN, futureMin: FUTURE_MIN },
    legend: legendStops(),
    frames,
  });
}
