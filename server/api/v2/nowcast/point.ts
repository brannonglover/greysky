import type { VercelRequest, VercelResponse } from '@vercel/node';

import { observedTimes } from '../../../lib/mrms';
import { POINT, pointNowcast } from '../../../lib/precipNowcast/point';

function floatParam(value: unknown): number | null {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Internal point nowcast. Does not replace /api/radar/point.
 * `threshold` selects the onset/ending line. It is not user-facing copy.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const lat = floatParam(req.query.lat);
  const lon = floatParam(req.query.lon);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }
  const radiusKm = floatParam(req.query.radiusKm);
  const threshold = floatParam(req.query.threshold);
  const endingDryMin = floatParam(req.query.endingDryMin);
  const issued = Array.isArray(req.query.issuedAt) ? req.query.issuedAt[0] : req.query.issuedAt;
  const issuedAtMs = typeof issued === 'string' && issued ? Date.parse(issued) : Date.now();
  if (!Number.isFinite(issuedAtMs)) return res.status(400).json({ error: 'issuedAt is not a time' });

  let times: string[];
  try {
    times = await observedTimes();
  } catch {
    return res.status(502).json({ error: 'MRMS times unavailable' });
  }
  const product = await pointNowcast({
    latitude: lat,
    longitude: lon,
    issuedAtMs,
    times,
    radiusKm: radiusKm ?? undefined,
    eventThresholdMmHr: threshold ?? undefined,
    endingDryMin: endingDryMin ?? undefined,
  });
  if ('error' in product) return res.status(502).json(product);

  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json(product);
}

export { POINT };
