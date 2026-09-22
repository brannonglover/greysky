import type { VercelRequest, VercelResponse } from '@vercel/node';

import { createRadarService, type RadarSourceName } from '../../lib/radar/registry';
import type { RadarManifest } from '../../lib/radar/types';

/**
 * v1 radar manifest — frozen contract for already-released app builds.
 *
 * Both versions are now produced by the same RadarFrameService; this endpoint
 * only downgrades the v2 manifest to the older wire shape. Nothing here should
 * gain features. New work goes to /api/v2/radar/frames.
 */

const PAST_MIN = 60;
const FUTURE_MIN = 60;
const OBSERVED_CADENCE_SEC = 5 * 60;
const FUTURE_CADENCE_SEC = 5 * 60;

type V1Frame = {
  time: number;
  kind: 'observed' | 'forecast';
  wms?: { url: string; params: Record<string, string> };
  urlTemplate?: string;
};

/**
 * v1 has no concept of a nowcast, so advection frames collapse into
 * 'forecast' — which is exactly what v1 called them before the split.
 */
function downgrade(manifest: RadarManifest) {
  const frames: V1Frame[] = manifest.frames.map((frame) => {
    const base = {
      time: frame.timestamp,
      kind: (frame.kind === 'observed' ? 'observed' : 'forecast') as V1Frame['kind'],
    };
    return frame.source.kind === 'wms'
      ? { ...base, wms: { url: frame.source.url, params: frame.source.params } }
      : { ...base, urlTemplate: frame.source.urlTemplate };
  });

  return {
    generated: manifest.generated,
    window: manifest.window,
    legend: manifest.legend,
    frames,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const raw = Array.isArray(req.query.source) ? req.query.source[0] : req.query.source;
  const source: RadarSourceName = raw === 'tomorrow' ? 'tomorrow' : 'default';

  // Preserved from the original handler so released clients keep getting the
  // same error they already handle.
  if (source === 'tomorrow' && !process.env.TOMORROW_API_KEY) {
    return res.status(500).json({ error: 'TOMORROW_API_KEY not configured' });
  }

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

  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
  return res.status(200).json(downgrade(manifest));
}
