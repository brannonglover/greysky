import type { VercelRequest, VercelResponse } from '@vercel/node';

import { fetchTropicalStorms } from '../../lib/tropical';

/**
 * Active tropical cyclones with their official NHC forecast tracks.
 *
 * The response is deliberately point-independent: threat geometry against the
 * user's location is cheap pure maths and happens on the client, so one cached
 * copy serves everybody. NHC issues full advisories every six hours with
 * intermediate updates between, so a ten-minute edge cache is well inside the
 * upstream's own cadence.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const storms = await fetchTropicalStorms();
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
    return res.status(200).json({ generated: Date.now(), storms });
  } catch (error) {
    // A quiet season is a normal empty list, not an error — this path means
    // NHC itself is unreachable, so say so rather than implying "no storms".
    const message = error instanceof Error ? error.message : 'Tropical service unavailable';
    return res.status(502).json({ error: message });
  }
}
