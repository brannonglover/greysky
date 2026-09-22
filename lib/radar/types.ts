/**
 * Radar frame contract.
 *
 * Mirrored by server/lib/radar/types.ts — the service is the source of truth
 * and this is the client's view of the same shapes. Keep the two in step the
 * same way palette.ts and radarPalette.ts are kept in step.
 *
 * The UI consumes these and nothing else. Nothing here names MRMS, HRRR or any
 * other provider, so swapping a provider cannot reach the map or the timeline.
 */

export type RadarFrameKind = 'observed' | 'nowcast' | 'forecast';

/**
 * How a frame's imagery is fetched.
 *
 * Deliberately a union rather than a single `tileUrl`: observed frames are WMS
 * layers the device loads straight from NOAA GeoServer, forecast frames are XYZ
 * templates from our own service. Only the map adapter reads this — transport
 * is a rendering concern, not a provider identity.
 */
export type RadarTileSource =
  | {
      kind: 'xyz';
      urlTemplate: string;
      tileSize?: number;
      minzoom?: number;
      maxzoom?: number;
    }
  | {
      kind: 'wms';
      url: string;
      params: Record<string, string>;
      tileSize?: number;
      minzoom?: number;
      maxzoom?: number;
    };

/**
 * How a transition frame was composed. `kind` carries the dominant source so
 * the timeline has something to style; this is the real mix, kept for
 * debugging, telemetry and tuning the transition curve.
 *
 * The map and timeline must not branch on any of it.
 */
export type RadarFrameBlend = {
  /** Interpolation space used. Diagnostic only; the UI must not branch on it. */
  mode: 'dbz' | 'z' | 'rainrate';
  nowcastWeight: number;
  forecastWeight: number;
  nowcastProvider: string;
  forecastProvider: string;
};

export type RadarFrame = {
  /** Stable identity: cache key, React key, dedupe key. */
  id: string;
  /** Unix seconds this frame is valid for. */
  timestamp: number;
  kind: RadarFrameKind;
  source: RadarTileSource;
  /** Attribution and debugging only. The UI must never branch on it. */
  providerId: string;
  /** Minutes past the last observation. Undefined for observed frames. */
  leadMinutes?: number;
  /** When the frame stops being meaningful; drives cache eviction. */
  expiresAt?: number;
  /** Present only on frames mixing a nowcast with a forecast. */
  blend?: RadarFrameBlend;
};

export type RadarLegendStop = { dbz: number; color: string };

export type RadarManifest = {
  version: 2;
  /** Unix seconds the manifest was assembled. */
  generated: number;
  window: { pastMin: number; futureMin: number };
  /**
   * Timestamp of the newest real observation, which is typically two to four
   * minutes behind `generated`. The timeline anchors the observed/future
   * boundary here rather than at wall-clock now, because that gap is real.
   */
  observedThrough: number | null;
  legend: RadarLegendStop[];
  frames: RadarFrame[];
  /** Provider attribution lines, deduplicated, for the map's credit control. */
  attribution: string[];
};

export function isFutureKind(kind: RadarFrameKind): boolean {
  return kind === 'nowcast' || kind === 'forecast';
}

export const DEFAULT_RADAR_WINDOW = { pastMin: 60, futureMin: 60 };

/** Start and end of the displayed window, in unix seconds. */
export function radarWindow(
  window: { pastMin: number; futureMin: number } = DEFAULT_RADAR_WINDOW,
  nowSec: number = Date.now() / 1000,
): { start: number; end: number } {
  return {
    start: nowSec - window.pastMin * 60,
    end: nowSec + window.futureMin * 60,
  };
}

/** Index of the frame closest to now. Returns 0 for an empty list. */
export function radarNowIndex(
  frames: Pick<RadarFrame, 'timestamp'>[],
  nowSec: number = Date.now() / 1000,
): number {
  if (frames.length === 0) return 0;
  let best = 0;
  for (let i = 1; i < frames.length; i += 1) {
    if (Math.abs(frames[i].timestamp - nowSec) < Math.abs(frames[best].timestamp - nowSec)) {
      best = i;
    }
  }
  return best;
}
