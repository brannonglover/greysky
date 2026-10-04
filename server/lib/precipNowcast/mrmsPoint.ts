import { WMS_BASE, LAYER } from '../mrms';
import { MIN_DBZ, dbzForColor } from '../palette';
import { dbzToRainRate } from '../reflectivity';

export type PointRate = {
  /** Null when the request failed. 0 when the pixel was read and had no echo. */
  rainRateMmHr: number | null;
  dbz: number | null;
};

/**
 * One MRMS composite pixel, read the same way as /api/radar/point, except a
 * failed request stays missing instead of collapsing to zero.
 * Echo below the palette floor is no rain. That floor is the styled product's
 * limit, not a score threshold.
 */
export async function sampleMrmsPoint(isoTime: string, latitude: number, longitude: number): Promise<PointRate> {
  const pad = 0.05;
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetFeatureInfo',
    layers: LAYER,
    query_layers: LAYER,
    crs: 'EPSG:4326',
    bbox: `${latitude - pad},${longitude - pad},${latitude + pad},${longitude + pad}`,
    width: '101',
    height: '101',
    i: '50',
    j: '50',
    info_format: 'application/json',
    time: isoTime,
  });
  const res = await fetch(`${WMS_BASE}?${params.toString()}`);
  if (!res.ok) return { rainRateMmHr: null, dbz: null };
  let json: { features?: Array<{ properties?: Record<string, number> }> };
  try {
    json = (await res.json()) as { features?: Array<{ properties?: Record<string, number> }> };
  } catch {
    return { rainRateMmHr: null, dbz: null };
  }
  const props = json.features?.[0]?.properties;
  // A parsed 200 with no feature is an empty echo on this styled layer, same as
  // a transparent pixel. Transport and parse failures above stay missing.
  if (!props) return { rainRateMmHr: 0, dbz: null };
  const dbz = dbzForColor(props.RED_BAND ?? 0, props.GREEN_BAND ?? 0, props.BLUE_BAND ?? 0, props.ALPHA_BAND ?? 0);
  if (dbz == null || dbz < MIN_DBZ) return { rainRateMmHr: 0, dbz };
  return { rainRateMmHr: dbzToRainRate(dbz), dbz };
}

/** Closest timestamp to `targetMs`, or null when nothing is inside the tolerance. */
export function nearestIso(times: readonly string[], targetMs: number, toleranceMs: number): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const time of times) {
    const dist = Math.abs(Date.parse(time) - targetMs);
    if (!Number.isFinite(dist) || dist > bestDist) continue;
    best = time;
    bestDist = dist;
  }
  if (best == null || bestDist > toleranceMs) return null;
  return best;
}
