import type { BlendMode } from '../transitionTile';

/**
 * Radar contracts, server side.
 *
 * This file is the source of truth; lib/radar/types.ts in the app mirrors the
 * wire shapes. Provider interfaces live here only — the client never sees them.
 */

export type RadarFrameKind = 'observed' | 'nowcast' | 'forecast';

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
 * How a transition frame was composed. `kind` reports the dominant source so
 * the timeline can style it, but the real mix lives here for debugging,
 * telemetry and tuning. The map and timeline must not branch on any of it.
 */
export type RadarFrameBlend = {
  /** Interpolation space used. Diagnostic only; the UI must not branch on it. */
  mode: BlendMode;
  nowcastWeight: number;
  forecastWeight: number;
  nowcastProvider: string;
  forecastProvider: string;
};

export type RadarFrame = {
  id: string;
  timestamp: number;
  kind: RadarFrameKind;
  source: RadarTileSource;
  providerId: string;
  /** Minutes ahead of now. Undefined for observed frames. */
  leadMinutes?: number;
  expiresAt?: number;
  blend?: RadarFrameBlend;
};

export type RadarLegendStop = { dbz: number; color: string };

export type RadarManifest = {
  version: 2;
  generated: number;
  window: { pastMin: number; futureMin: number };
  observedThrough: number | null;
  legend: RadarLegendStop[];
  frames: RadarFrame[];
  attribution: string[];
};

/** Everything a provider needs to decide what to return. */
export type RadarFrameRequest = {
  /** Unix seconds. Passed in rather than read so requests are reproducible. */
  now: number;
  /** How far back (observed) or forward (future) to reach. */
  windowMinutes: number;
  /** Requested spacing. A provider may return its own cadence instead. */
  cadenceSeconds: number;
  /**
   * Absolute origin for tile URLs this provider generates, e.g.
   * "https://grey-sky-radar.vercel.app". Providers must not guess it.
   */
  origin: string;
};

export interface RadarProvider {
  readonly id: string;
  /** Credit line surfaced in the manifest. */
  readonly attribution: string;
  /**
   * Cheap liveness probe so the service can fail over without paying for a
   * full frame build.
   */
  isAvailable(now: number): Promise<boolean>;
}

export interface ObservedRadarProvider extends RadarProvider {
  readonly kind: 'observed';
  /**
   * Timestamps actually published upstream, newest last. This is what makes
   * the timeline data-driven: cadence is discovered here, never assumed by
   * the UI.
   */
  availableTimes(req: RadarFrameRequest): Promise<number[]>;
  getFrames(req: RadarFrameRequest): Promise<RadarFrame[]>;
}

/** Lead-time span, in minutes ahead of now, that a provider can cover. */
export type LeadRange = { fromMin: number; toMin: number };

/** Tile query parameters for one frame, excluding z/x/y. */
export type TileQuery = Record<string, string>;

/**
 * One future provider's contribution at a single valid time.
 *
 * Providers return these rather than finished frames so the service can
 * compose two of them into a single blended tile request. A provider that is
 * used alone still goes through the same path.
 */
export type FutureSample = {
  /** Unix seconds the sample is valid for. */
  validTime: number;
  /** Minutes ahead of now. */
  leadMinutes: number;
  query: TileQuery;
};

export interface FutureRadarProvider extends RadarProvider {
  readonly kind: 'nowcast' | 'forecast';
  /**
   * Which part of the timeline this provider can serve. Providers overlap on
   * purpose — the transition window needs both sides available at the same
   * valid times.
   */
  readonly leadRange: LeadRange;
  /**
   * Observations are an input, not a side channel. HRRR ignores them;
   * advection and (later) pySTEPS both require them. One signature serves
   * every future provider, which is what keeps them swappable.
   */
  samples(req: RadarFrameRequest & { observed: RadarFrame[] }): Promise<FutureSample[]>;
}
