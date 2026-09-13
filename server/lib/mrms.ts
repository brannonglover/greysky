export const WMS_BASE = 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_cref_qcd/ows';
export const LAYER = 'conus_cref_qcd';

export type ObservedFrame = {
  time: number;
  /** ISO timestamp to pass as the WMS TIME parameter. */
  isoTime: string;
};

/**
 * NOAA publishes the MRMS QC'd composite roughly every two minutes and keeps a
 * two hour rolling window, advertised as the layer's time dimension. Sixty
 * frames is far more than the timeline can animate, so callers subsample.
 */
export async function observedTimes(): Promise<string[]> {
  const res = await fetch(`${WMS_BASE}?service=wms&version=1.3.0&request=GetCapabilities`);
  if (!res.ok) throw new Error(`MRMS capabilities unavailable: ${res.status}`);
  const xml = await res.text();
  const match = /<Dimension name="time"[^>]*>([\s\S]*?)<\/Dimension>/i.exec(xml);
  if (!match) throw new Error('No time dimension advertised for MRMS layer');
  return match[1]
    .trim()
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Pick frames back to `windowMin` ago, snapped to the :05 grid (cadenceMin
 * boundaries) so the timeline shows clean intervals. Each slot uses the closest
 * MRMS observation within half a cadence.
 */
export function selectObserved(times: string[], windowMin: number, cadenceMin: number, now = Date.now()): ObservedFrame[] {
  const cutoff = now - windowMin * 60_000;
  const candidates = times
    .map((isoTime) => ({ isoTime, ms: Date.parse(isoTime) }))
    .filter((entry) => Number.isFinite(entry.ms) && entry.ms >= cutoff && entry.ms <= now)
    .sort((a, b) => a.ms - b.ms);

  if (candidates.length === 0) return [];

  const slotMs = cadenceMin * 60_000;
  const tolerance = slotMs / 2;
  const firstSlot = Math.ceil(cutoff / slotMs) * slotMs;

  const picked: ObservedFrame[] = [];
  for (let slot = firstSlot; slot <= now; slot += slotMs) {
    let best: { isoTime: string; ms: number } | null = null;
    let bestDist = Infinity;
    for (const c of candidates) {
      const dist = Math.abs(c.ms - slot);
      if (dist < bestDist && dist <= tolerance) {
        best = c;
        bestDist = dist;
      }
    }
    if (!best) continue;
    if (picked.length > 0 && picked[picked.length - 1].isoTime === best.isoTime) continue;
    picked.push({
      time: Math.round(slot / 1000),
      isoTime: best.isoTime,
    });
  }
  return picked;
}

export type WmsConfig = {
  url: string;
  params: Record<string, string>;
};

/** Shaped for Leaflet's L.tileLayer.wms(url, params). */
export function wmsConfig(isoTime: string): WmsConfig {
  return {
    url: WMS_BASE,
    params: {
      layers: LAYER,
      format: 'image/png',
      transparent: 'true',
      version: '1.3.0',
      time: isoTime,
    },
  };
}

/**
 * The coverage is served as a styled RGB raster, so GetFeatureInfo reports
 * colour bands rather than dBZ. Inverting through the sampled palette is still
 * far cheaper than fetching and decoding a whole tile for one point.
 */
export async function observedColorAt(
  isoTime: string,
  latitude: number,
  longitude: number,
): Promise<{ r: number; g: number; b: number; a: number } | null> {
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
  if (!res.ok) return null;
  const json = (await res.json()) as {
    features?: Array<{ properties?: Record<string, number> }>;
  };
  const props = json.features?.[0]?.properties;
  if (!props) return null;
  return {
    r: props.RED_BAND ?? 0,
    g: props.GREEN_BAND ?? 0,
    b: props.BLUE_BAND ?? 0,
    a: props.ALPHA_BAND ?? 0,
  };
}
