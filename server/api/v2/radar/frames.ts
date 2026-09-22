import type { VercelRequest, VercelResponse } from '@vercel/node';

import { createRadarService, type RadarSourceName } from '../../../lib/radar/registry';

/** Displayed window either side of now. */
const PAST_MIN = 60;
const FUTURE_MIN = 60;
/** Requested spacing; providers may return their own cadence. */
const OBSERVED_CADENCE_SEC = 5 * 60;
const FUTURE_CADENCE_SEC = 5 * 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const raw = Array.isArray(req.query.source) ? req.query.source[0] : req.query.source;
  const source: RadarSourceName = raw === 'tomorrow' ? 'tomorrow' : 'default';

  const manifest = await createRadarService(source).getManifest({
    now: Math.round(Date.now() / 1000),
    origin: `https://${req.headers.host}`,
    pastMin: PAST_MIN,
    futureMin: FUTURE_MIN,
    observedCadenceSec: OBSERVED_CADENCE_SEC,
    futureCadenceSec: FUTURE_CADENCE_SEC,
  });

  if (manifest.frames.length === 0) {
    return res.status(502).json({ error: 'No radar sources available' });
  }

  // Frame membership changes as new observations and model runs land.
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
  return res.status(200).json(manifest);
}
