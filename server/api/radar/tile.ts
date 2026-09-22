import type { VercelRequest, VercelResponse } from '@vercel/node';

import { gridForRunMinute } from '../../lib/gridCache';
import { renderNowcastTile } from '../../lib/nowcast';
import { renderBlendedTile, renderTile } from '../../lib/render';
import {
  DEFAULT_BLEND_MODE,
  isBlendMode,
  renderTransitionTile,
  type HrrrSide,
} from '../../lib/transitionTile';

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

  // ---------- Transition tiles: nowcast blended into HRRR ----------
  if (stringParam(req.query.blend)) {
    const t0 = Date.now();
    const wRaw = Array.isArray(req.query.w) ? req.query.w[0] : req.query.w;
    const weight = typeof wRaw === 'string' ? parseFloat(wRaw) : NaN;
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
      return res.status(400).json({ error: 'w must be 0-1' });
    }

    const nObs = stringParam(req.query.n_obs);
    const nU = intParam(req.query.n_u);
    const nV = intParam(req.query.n_v);
    const nLead = intParam(req.query.n_lead);
    if (!nObs || nU === null || nV === null || nLead === null) {
      return res.status(400).json({ error: 'blend needs n_obs, n_u, n_v and n_lead' });
    }
    if (Number.isNaN(Date.parse(nObs))) return res.status(400).json({ error: 'n_obs is not a timestamp' });
    if (nLead <= 0 || nLead > 180) return res.status(400).json({ error: 'n_lead out of range' });

    const fRun = stringParam(req.query.f_run);
    if (!fRun || Number.isNaN(Date.parse(fRun))) {
      return res.status(400).json({ error: 'blend needs a valid f_run' });
    }
    const fMinute = intParam(req.query.f_minute);
    const fFrom = intParam(req.query.f_from);
    const fTo = intParam(req.query.f_to);
    const fTRaw = Array.isArray(req.query.f_t) ? req.query.f_t[0] : req.query.f_t;
    const fT = typeof fTRaw === 'string' ? parseFloat(fTRaw) : null;

    try {
      let gridMs = 0;
      const gridStart = Date.now();
      let hrrr: HrrrSide;
      if (fMinute !== null) {
        if (fMinute <= 0 || fMinute % STEP_MIN !== 0) {
          return res.status(400).json({ error: `f_minute must be a positive multiple of ${STEP_MIN}` });
        }
        hrrr = { grid: await gridForRunMinute(fRun, fMinute) };
      } else if (fFrom !== null && fTo !== null && fT !== null && Number.isFinite(fT)) {
        if (fFrom <= 0 || fFrom % STEP_MIN !== 0 || fTo <= 0 || fTo % STEP_MIN !== 0) {
          return res.status(400).json({ error: `f_from and f_to must be positive multiples of ${STEP_MIN}` });
        }
        if (fT < 0 || fT > 1) return res.status(400).json({ error: 'f_t must be 0-1' });
        const [from, to] = await Promise.all([
          gridForRunMinute(fRun, fFrom),
          gridForRunMinute(fRun, fTo),
        ]);
        hrrr = { from, to, t: fT };
      } else {
        return res.status(400).json({ error: 'blend needs f_minute, or f_from + f_to + f_t' });
      }
      gridMs = Date.now() - gridStart;

      const modeRaw = stringParam(req.query.mode);
      const mode = isBlendMode(modeRaw) ? modeRaw : DEFAULT_BLEND_MODE;

      const renderStart = Date.now();
      const png = await renderTransitionTile(
        { isoTime: nObs, u: nU, v: nV, leadMin: nLead },
        hrrr,
        weight,
        z,
        x,
        y,
        mode,
      );
      const renderMs = Date.now() - renderStart;
      const totalMs = Date.now() - t0;

      res.setHeader('Content-Type', 'image/png');
      // The URL names the observation, the run, the steps and the weight, so
      // the bytes for a given URL never change. Long-lived caching therefore
      // costs no freshness: a newer observation simply produces new URLs.
      res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
      res.setHeader(
        'Server-Timing',
        `grid;dur=${gridMs}, render;dur=${renderMs}, total;dur=${totalMs}`,
      );
      res.setHeader('X-Radar-Tile', 'blend');
      res.setHeader('X-Radar-Weight', String(weight));
      res.setHeader('X-Radar-Blend-Mode', mode);
      return res.status(200).send(png);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transition tile render failed';
      return res.status(502).json({ error: message });
    }
  }

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
