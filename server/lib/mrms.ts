const WMS_BASE = 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_cref_qcd/ows';
const LAYER = 'conus_cref_qcd';

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
 * Pick frames back to `windowMin` ago, thinned to roughly `cadenceMin` apart so
 * the animation stays a manageable length.
 */
export function selectObserved(times: string[], windowMin: number, cadenceMin: number, now = Date.now()): ObservedFrame[] {
  const cutoff = now - windowMin * 60_000;
  const candidates = times
    .map((isoTime) => ({ isoTime, ms: Date.parse(isoTime) }))
    .filter((entry) => Number.isFinite(entry.ms) && entry.ms >= cutoff && entry.ms <= now)
    .sort((a, b) => a.ms - b.ms);

  const picked: ObservedFrame[] = [];
  // Walk newest to oldest so the most recent observation is always included.
  for (let i = candidates.length - 1; i >= 0; i--) {
    const entry = candidates[i];
    const last = picked[picked.length - 1];
    if (last && last.time * 1000 - entry.ms < cadenceMin * 60_000) continue;
    picked.push({ time: Math.round(entry.ms / 1000), isoTime: entry.isoTime });
  }
  return picked.reverse();
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
