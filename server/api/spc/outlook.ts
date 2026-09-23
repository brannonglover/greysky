import type { VercelRequest, VercelResponse } from '@vercel/node';

import { outlookForPoint } from '../../lib/spc';

/**
 * SPC severe-weather outlook resolved for one location.
 *
 * Point-in-polygon runs here rather than on the device: the national outlook
 * can span most of the country on an active day, while one location's answer
 * is a couple of hundred bytes. The parsed products are held in process, so a
 * burst of requests costs a single fetch upstream.
 */
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

  try {
    const days = await outlookForPoint(lat, lon);
    // SPC reissues the day-1 outlook five times daily; a quarter hour keeps the
    // response fresh without hammering upstream for a product that rarely moves.
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
    return res.status(200).json({ generated: Date.now(), days });
  } catch (error) {
    // No risk at this location is a normal empty list. Reaching here means SPC
    // itself is unavailable, which must not be reported as "you are safe".
    const message = error instanceof Error ? error.message : 'Outlook service unavailable';
    return res.status(502).json({ error: message });
  }
}
