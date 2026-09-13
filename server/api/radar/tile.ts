import type { VercelRequest, VercelResponse } from '@vercel/node';

import { gridForRunMinute } from '../../lib/gridCache';
import { renderNowcastTile } from '../../lib/nowcast';
import { renderBlendedTile, renderTile } from '../../lib/render';

/** Matches the HRRR sub-hourly step; anything else cannot resolve to a record. */
const STEP_MIN = 15;

function intParam(value: unknown): number | null {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(parsed) ? parsed : null;
}

function stringParam(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const z = intParam(req.query.z);
  const x = intParam(req.query.x);
  const y = intParam(req.query.y);
  if (z === null || x === null || y === null) {
    return res.status(400).json({ error: 'z, x and y are required' });
  }
  if (z < 0 || z > 9) return res.status(400).json({ error: 'z out of range' });
  const span = 2 ** z;
  if (x < 0 || x >= span || y < 0 || y >= span) return res.status(400).json({ error: 'x or y out of range' });

  const obs = stringParam(req.query.obs);

  // Tomorrow.io tile proxy — keeps the API key server-side and adds CDN caching.
  const source = stringParam(req.query.source);
  if (source === 'tomorrow') {
    const apiKey = process.env.TOMORROW_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'TOMORROW_API_KEY not configured' });
    const time = stringParam(req.query.time);
    if (!time) return res.status(400).json({ error: 'time is required for tomorrow.io tiles' });
    try {
      const tileUrl =
        `https://api.tomorrow.io/v4/map/tile/${z}/${x}/${y}` +
        `/precipitationIntensity/${time}.png?apikey=${apiKey}`;
      const upstream = await fetch(tileUrl);
      if (!upstream.ok) {
        return res.status(upstream.status).json({ error: `Tomorrow.io: ${upstream.statusText}` });
      }
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=1800');
      return res.status(200).send(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tomorrow.io proxy failed';
      return res.status(502).json({ error: message });
    }
  }

  if (obs) {
    const lead = intParam(req.query.lead);
    const u = intParam(req.query.u);
    const v = intParam(req.query.v);
    if (lead === null || u === null || v === null) {
      return res.status(400).json({ error: 'obs tiles need u, v and lead' });
    }
    if (Number.isNaN(Date.parse(obs))) return res.status(400).json({ error: 'obs is not a valid timestamp' });
    if (lead <= 0 || lead > 120) return res.status(400).json({ error: 'lead out of range' });
    try {
      const png = await renderNowcastTile(obs, u, v, lead, z, x, y);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
      return res.status(200).send(png);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Nowcast tile render failed';
      return res.status(502).json({ error: message });
    }
  }

  const run = stringParam(req.query.run);
  const minute = intParam(req.query.minute);
  const from = intParam(req.query.from);
  const to = intParam(req.query.to);
  const tRaw = Array.isArray(req.query.t) ? req.query.t[0] : req.query.t;
  const t = typeof tRaw === 'string' ? parseFloat(tRaw) : null;

  // Blended tile: interpolates between two HRRR forecast steps.
  if (run && from !== null && to !== null && t !== null) {
    if (Number.isNaN(Date.parse(run))) return res.status(400).json({ error: 'run is not a valid timestamp' });
    if (from <= 0 || from % STEP_MIN !== 0) return res.status(400).json({ error: `from must be a positive multiple of ${STEP_MIN}` });
    if (to <= 0 || to % STEP_MIN !== 0) return res.status(400).json({ error: `to must be a positive multiple of ${STEP_MIN}` });
    if (!Number.isFinite(t) || t < 0 || t > 1) return res.status(400).json({ error: 't must be 0–1' });
    try {
      const [gridA, gridB] = await Promise.all([gridForRunMinute(run, from), gridForRunMinute(run, to)]);
      const png = renderBlendedTile(gridA, gridB, t, z, x, y);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
      return res.status(200).send(png);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Blended tile render failed';
      return res.status(502).json({ error: message });
    }
  }

  if (!run || minute === null) {
    return res.status(400).json({ error: 'run and minute, or obs, are required' });
  }
  if (Number.isNaN(Date.parse(run))) return res.status(400).json({ error: 'run is not a valid timestamp' });
  if (minute <= 0 || minute % STEP_MIN !== 0) {
    return res.status(400).json({ error: `minute must be a positive multiple of ${STEP_MIN}` });
  }

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
