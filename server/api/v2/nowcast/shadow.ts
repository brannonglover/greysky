import type { VercelRequest, VercelResponse } from '@vercel/node';

import { observedTimes } from '../../../lib/mrms';
import { decide } from '../../../lib/precipNowcast/decision';
import { pointNowcast } from '../../../lib/precipNowcast/point';

function floatParam(value: unknown): number | null {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Shadow decision beside the point nowcast. Nothing in the app reads this.
 * The phrase is experimental and is not production wording.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const lat = floatParam(req.query.lat);
  const lon = floatParam(req.query.lon);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }
  const issued = Array.isArray(req.query.issuedAt) ? req.query.issuedAt[0] : req.query.issuedAt;
  const issuedAtMs = typeof issued === 'string' && issued ? Date.parse(issued) : Date.now();
  if (!Number.isFinite(issuedAtMs)) return res.status(400).json({ error: 'issuedAt is not a time' });

  let times: string[];
  try {
    times = await observedTimes();
  } catch {
    return res.status(502).json({ error: 'MRMS times unavailable' });
  }
  const product = await pointNowcast({ latitude: lat, longitude: lon, issuedAtMs, times });
  if ('error' in product) return res.status(502).json(product);

  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json({ forecast: product, decision: decide(product) });
}
