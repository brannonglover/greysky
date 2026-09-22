import { RADAR_API } from './api';
import type { RadarManifest } from './types';

/**
 * Manifest fetching with a shared cache.
 *
 * The radar tab and the home-screen thumbnail both want the same manifest. The
 * previous code had each run its own fetch on its own timer; here a single
 * module-level cache serves both and in-flight requests are deduplicated, so a
 * mount never triggers a second network call for data already arriving.
 */

/**
 * Which provider set the service composes. 'default' is MRMS observed with
 * HRRR forecast; 'tomorrow' routes to Tomorrow.io. Both are now provider
 * implementations behind the same manifest, so this only picks a registry
 * entry — no client code branches on it.
 */
export const RADAR_SOURCE: 'default' | 'tomorrow' = 'default';

/** Matches the service's own s-maxage, so we re-ask about as often as it changes. */
const TTL_MS = 60_000;

let cached: { at: number; manifest: RadarManifest } | null = null;
let inflight: Promise<RadarManifest> | null = null;

async function request(): Promise<RadarManifest> {
  const query = RADAR_SOURCE === 'tomorrow' ? '?source=tomorrow' : '';
  const response = await fetch(`${RADAR_API}/api/v2/radar/frames${query}`);
  if (!response.ok) throw new Error(`Radar unavailable (${response.status})`);

  const json = (await response.json()) as Partial<RadarManifest>;
  if (!Array.isArray(json.frames) || json.frames.length === 0) {
    throw new Error('Radar returned no frames');
  }

  return {
    version: 2,
    generated: json.generated ?? Math.round(Date.now() / 1000),
    window: json.window ?? { pastMin: 60, futureMin: 60 },
    observedThrough: json.observedThrough ?? null,
    legend: json.legend ?? [],
    frames: json.frames,
    attribution: json.attribution ?? [],
  };
}

export function getRadarManifest(force = false): Promise<RadarManifest> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) {
    return Promise.resolve(cached.manifest);
  }
  if (inflight) return inflight;

  inflight = request()
    .then((manifest) => {
      cached = { at: Date.now(), manifest };
      return manifest;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** Last manifest seen, if any. Lets a mount paint before its fetch resolves. */
export function peekRadarManifest(): RadarManifest | null {
  return cached?.manifest ?? null;
}
