import type { VercelRequest, VercelResponse } from '@vercel/node';

import { forecastFrames } from '../../lib/hrrr';
import { observedTimes, selectObserved, wmsConfig } from '../../lib/mrms';
import { nowcastFrames } from '../../lib/nowcast';
import { legendStops } from '../../lib/palette';

const PAST_MIN = 60;
const FUTURE_MIN = 60;
const OBSERVED_CADENCE_MIN = 5;
/** Interpolated forecast frames are generated at this cadence. */
const FORECAST_CADENCE_SEC = 5 * 60;
/** HRRR sub-hourly step; used to request extra horizon and bridge gaps. */
const HRRR_STEP_MIN = 15;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const now = Date.now();

  // ---------- Tomorrow.io mode ----------
  const source = typeof req.query.source === 'string' ? req.query.source : undefined;
  if (source === 'tomorrow') {
    if (!process.env.TOMORROW_API_KEY) {
      return res.status(500).json({ error: 'TOMORROW_API_KEY not configured' });
    }
    const origin = `https://${req.headers.host}`;
    const nowSec = Math.round(now / 1000);
    const step = 5 * 60;
    const frames: Array<{ time: number; kind: string; urlTemplate: string }> = [];

    for (let offset = -PAST_MIN * 60; offset <= FUTURE_MIN * 60; offset += step) {
      const snapped = Math.round((nowSec + offset) / step) * step;
      const iso = new Date(snapped * 1000).toISOString();
      frames.push({
        time: snapped,
        kind: offset <= 0 ? 'observed' : 'forecast',
        urlTemplate:
          `${origin}/api/radar/tile?source=tomorrow` +
          `&time=${encodeURIComponent(iso)}&z={z}&x={x}&y={y}`,
      });
    }

    // Deduplicate in case of rounding collisions
    const unique = new Map<number, (typeof frames)[0]>();
    for (const f of frames) if (!unique.has(f.time)) unique.set(f.time, f);

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({
      generated: nowSec,
      window: { pastMin: PAST_MIN, futureMin: FUTURE_MIN },
      legend: legendStops(),
      frames: [...unique.values()].sort((a, b) => a.time - b.time),
    });
  }

  // ---------- Default mode: MRMS observed + HRRR forecast ----------

  const observed = await observedTimes()
    .then((times) => selectObserved(times, PAST_MIN, OBSERVED_CADENCE_MIN, now))
    .catch(() => []);

  // HRRR is a real numerical weather model that shows precipitation
  // evolving naturally (forming, intensifying, dissipating).  Prefer it over
  // simple advection which only slides the last observation.  Fall back to
  // the nowcast if no HRRR run is available yet.
  // Request one extra HRRR step so interpolated frames fill the full window.
  const forecast = await forecastFrames(FUTURE_MIN + HRRR_STEP_MIN, new Date(now))
    .then((frames) => (frames.length > 0 ? { kind: 'hrrr' as const, frames } : null))
    .catch(() => null)
    .then(async (hrrr) => {
      if (hrrr) return hrrr;
      const frames = await nowcastFrames(observed, FUTURE_MIN, now).catch(() => []);
      return { kind: 'nowcast' as const, frames };
    });

  if (observed.length === 0 && forecast.frames.length === 0) {
    return res.status(502).json({ error: 'No radar sources available' });
  }

  const origin = `https://${req.headers.host}`;
  const future: Array<{ time: number; kind: 'forecast'; urlTemplate: string }> = [];

  if (forecast.kind === 'hrrr' && forecast.frames.length > 0) {
    const runEnc = encodeURIComponent(forecast.frames[0].run);

    // Bridge the gap between the last observation and the first HRRR step by
    // interpolating from the HRRR step immediately before "now".
    if (observed.length > 0) {
      const lastObsTime = observed[observed.length - 1].time;
      const f0 = forecast.frames[0];
      const anchorMin = f0.forecastMinute - HRRR_STEP_MIN;
      if (anchorMin > 0 && f0.time - lastObsTime > FORECAST_CADENCE_SEC) {
        const runMs = Date.parse(f0.run);
        const anchorTime = Math.round((runMs + anchorMin * 60_000) / 1000);
        const span = f0.time - anchorTime;
        for (let dt = FORECAST_CADENCE_SEC; dt < span; dt += FORECAST_CADENCE_SEC) {
          const bt = anchorTime + dt;
          if (bt <= lastObsTime) continue;
          future.push({
            time: bt,
            kind: 'forecast',
            urlTemplate:
              `${origin}/api/radar/tile?run=${runEnc}` +
              `&from=${anchorMin}&to=${f0.forecastMinute}&t=${(dt / span).toFixed(2)}` +
              `&z={z}&x={x}&y={y}`,
          });
        }
      }
    }

    for (let i = 0; i < forecast.frames.length; i++) {
      const frame = forecast.frames[i];
      // Keyframe – direct HRRR tile
      future.push({
        time: frame.time,
        kind: 'forecast',
        urlTemplate:
          `${origin}/api/radar/tile?run=${runEnc}&minute=${frame.forecastMinute}` +
          `&z={z}&x={x}&y={y}`,
      });
      // Interpolated frames between this and the next keyframe
      if (i < forecast.frames.length - 1) {
        const next = forecast.frames[i + 1];
        const span = next.time - frame.time;
        for (let dt = FORECAST_CADENCE_SEC; dt < span; dt += FORECAST_CADENCE_SEC) {
          const t = (dt / span).toFixed(2);
          future.push({
            time: frame.time + dt,
            kind: 'forecast',
            urlTemplate:
              `${origin}/api/radar/tile?run=${runEnc}` +
              `&from=${frame.forecastMinute}&to=${next.forecastMinute}&t=${t}` +
              `&z={z}&x={x}&y={y}`,
          });
        }
      }
    }
  } else {
    for (const frame of forecast.frames) {
      if ('isoTime' in frame) {
        const nf = frame as import('../../lib/nowcast').NowcastFrame;
        future.push({
          time: nf.time,
          kind: 'forecast',
          urlTemplate:
            `${origin}/api/radar/tile` +
            `?obs=${encodeURIComponent(nf.isoTime)}` +
            `&u=${nf.u}&v=${nf.v}&lead=${nf.leadMin}` +
            `&z={z}&x={x}&y={y}`,
        });
      }
    }
  }

  // Trim forecast frames to the displayed window so the timeline never has an
  // empty tail past the last dot.
  const cutoffSec = Math.round(now / 1000) + FUTURE_MIN * 60;

  const frames = [
    ...observed.map((frame) => ({
      time: frame.time,
      kind: 'observed' as const,
      wms: wmsConfig(frame.isoTime),
    })),
    ...future.filter((f) => f.time <= cutoffSec),
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
