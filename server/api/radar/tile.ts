import type { VercelRequest, VercelResponse } from '@vercel/node';

import { gridForRunMinute } from '../../lib/gridCache';
import { renderTile } from '../../lib/render';

/** Matches the HRRR sub-hourly step; anything else cannot resolve to a record. */
const STEP_MIN = 15;

function intParam(value: unknown): number | null {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(parsed) ? parsed : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const run = Array.isArray(req.query.run) ? req.query.run[0] : req.query.run;
  const minute = intParam(req.query.minute);
  const z = intParam(req.query.z);
  const x = intParam(req.query.x);
  const y = intParam(req.query.y);

  if (!run || minute === null || z === null || x === null || y === null) {
    return res.status(400).json({ error: 'run, minute, z, x and y are required' });
  }
  if (Number.isNaN(Date.parse(run))) return res.status(400).json({ error: 'run is not a valid timestamp' });
  if (minute <= 0 || minute % STEP_MIN !== 0) {
    return res.status(400).json({ error: `minute must be a positive multiple of ${STEP_MIN}` });
  }
  if (z < 0 || z > 9) return res.status(400).json({ error: 'z out of range' });
  const span = 2 ** z;
  if (x < 0 || x >= span || y < 0 || y >= span) return res.status(400).json({ error: 'x or y out of range' });

  try {
    const grid = await gridForRunMinute(run, minute);
    const png = renderTile(grid, z, x, y);
    res.setHeader('Content-Type', 'image/png');
    // A published run's forecast never changes, so this is safe to keep forever.
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    return res.status(200).send(png);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tile render failed';
    return res.status(502).json({ error: message });
  }
}
