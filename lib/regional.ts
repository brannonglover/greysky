import { haversineKm } from './tropical';
import type { WeatherAlert } from './types';
import { toWeatherAlert, usableAlertFeatures, type AlertFeature, type AlertResponse } from './weather';

/**
 * Significant NWS alerts around the user's broader region.
 *
 * This exists so the app is *aware* of dangerous weather nearby rather than
 * blind to it until a polygon covers the user. It is deliberately awareness
 * and nothing more: these alerts never notify, never leave the tracking tier,
 * and are always labelled as not affecting the user's location.
 *
 * Geography here is presentation, not a threat model. Being in the same state
 * as a tornado warning says nothing about whether it threatens this user — a
 * warning near Savannah is irrelevant in Atlanta, while a storm crossing
 * eastern Alabama may matter a great deal. That is why neighbouring states are
 * swept too, and why nothing in this module claims relevance.
 *
 * Deciding whether a storm is genuinely *approaching* would need storm motion
 * and polygon geometry. Both are too patchy in the feed to support it: in a
 * nine-state sample only 3 of 43 active alerts carried `eventMotionDescription`
 * and 32 of 43 carried no polygon at all, being zone-referenced. So that is
 * left undone rather than approximated.
 */

const NWS_ALERTS = 'https://api.weather.gov/alerts/active';
const NWS_POINTS = 'https://api.weather.gov/points';
const USER_AGENT = 'GreySkyWeather/3.0 (com.brannonglover.greysky; expo-app)';

export type RegionalAlert = {
  alert: WeatherAlert;
  /** Two-letter state the alert was returned under. */
  state: string;
  /** Distance to the polygon's nearest point, when the alert has one at all. */
  distanceKm: number | null;
};

/**
 * Only products that would matter if they did reach the user. Advisories and
 * statements are excluded — a regional Rip Current Statement is noise.
 */
const SIGNIFICANT = /\b(tornado|severe thunderstorm|flash flood|hurricane|tropical storm|blizzard|ice storm)\b/i;
const WATCH_OR_WARNING = /\b(warning|watch|emergency)\b/i;

/**
 * Bordering states, so the sweep follows weather rather than administrative
 * lines. Only the contiguous states plus AK/HI appear; territories have no
 * land neighbours.
 */
const NEIGHBORS: Record<string, string[]> = {
  AL: ['FL', 'GA', 'TN', 'MS'],
  AR: ['MO', 'TN', 'MS', 'LA', 'TX', 'OK'],
  AZ: ['CA', 'NV', 'UT', 'CO', 'NM'],
  CA: ['OR', 'NV', 'AZ'],
  CO: ['WY', 'NE', 'KS', 'OK', 'NM', 'AZ', 'UT'],
  CT: ['NY', 'MA', 'RI'],
  DC: ['MD', 'VA'],
  DE: ['MD', 'PA', 'NJ'],
  FL: ['AL', 'GA'],
  GA: ['FL', 'AL', 'TN', 'NC', 'SC'],
  IA: ['MN', 'WI', 'IL', 'MO', 'NE', 'SD'],
  ID: ['MT', 'WY', 'UT', 'NV', 'OR', 'WA'],
  IL: ['WI', 'IA', 'MO', 'KY', 'IN'],
  IN: ['MI', 'OH', 'KY', 'IL'],
  KS: ['NE', 'MO', 'OK', 'CO'],
  KY: ['IN', 'OH', 'WV', 'VA', 'TN', 'MO', 'IL'],
  LA: ['TX', 'AR', 'MS'],
  MA: ['NH', 'VT', 'NY', 'CT', 'RI'],
  MD: ['PA', 'DE', 'VA', 'WV', 'DC'],
  ME: ['NH'],
  MI: ['WI', 'IN', 'OH'],
  MN: ['ND', 'SD', 'IA', 'WI'],
  MO: ['IA', 'IL', 'KY', 'TN', 'AR', 'OK', 'KS', 'NE'],
  MS: ['LA', 'AR', 'TN', 'AL'],
  MT: ['ND', 'SD', 'WY', 'ID'],
  NC: ['VA', 'TN', 'GA', 'SC'],
  ND: ['MT', 'SD', 'MN'],
  NE: ['SD', 'IA', 'MO', 'KS', 'CO', 'WY'],
  NH: ['ME', 'VT', 'MA'],
  NJ: ['NY', 'PA', 'DE'],
  NM: ['CO', 'OK', 'TX', 'AZ', 'UT'],
  NV: ['OR', 'ID', 'UT', 'AZ', 'CA'],
  NY: ['VT', 'MA', 'CT', 'NJ', 'PA'],
  OH: ['MI', 'PA', 'WV', 'KY', 'IN'],
  OK: ['KS', 'MO', 'AR', 'TX', 'NM', 'CO'],
  OR: ['WA', 'ID', 'NV', 'CA'],
  PA: ['NY', 'NJ', 'DE', 'MD', 'WV', 'OH'],
  RI: ['CT', 'MA'],
  SC: ['NC', 'GA'],
  SD: ['ND', 'MN', 'IA', 'NE', 'WY', 'MT'],
  TN: ['KY', 'VA', 'NC', 'GA', 'AL', 'MS', 'AR', 'MO'],
  TX: ['NM', 'OK', 'AR', 'LA'],
  UT: ['ID', 'WY', 'CO', 'NM', 'AZ', 'NV'],
  VA: ['MD', 'DC', 'NC', 'TN', 'KY', 'WV'],
  VT: ['NY', 'NH', 'MA'],
  WA: ['ID', 'OR'],
  WI: ['MN', 'IA', 'IL', 'MI'],
  WV: ['PA', 'MD', 'VA', 'KY', 'OH'],
  WY: ['MT', 'SD', 'NE', 'CO', 'UT', 'ID'],
  AK: [],
  HI: [],
};

/**
 * The state containing a point, straight from NWS rather than a local lookup
 * table, so it always agrees with the alert feed's own areas.
 */
export async function fetchPointState(latitude: number, longitude: number): Promise<string | null> {
  try {
    const response = await fetch(`${NWS_POINTS}/${latitude.toFixed(4)},${longitude.toFixed(4)}`, {
      headers: { Accept: 'application/geo+json', 'User-Agent': USER_AGENT },
    });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      properties?: { relativeLocation?: { properties?: { state?: string } } };
    };
    const state = json.properties?.relativeLocation?.properties?.state;
    return typeof state === 'string' && state.length === 2 ? state : null;
  } catch {
    return null;
  }
}

/** Every coordinate pair in a GeoJSON geometry, whatever its nesting. */
function* coordinates(node: unknown): Generator<[number, number]> {
  if (!Array.isArray(node)) return;
  if (typeof node[0] === 'number' && typeof node[1] === 'number') {
    yield [node[0], node[1]];
    return;
  }
  for (const child of node) yield* coordinates(child);
}

/**
 * Distance to the nearest vertex of the alert's polygon.
 *
 * Deliberately returns null when the alert has no geometry. Most alerts are
 * zone-referenced with no polygon, and inventing a distance for those would be
 * worse than omitting it.
 */
function distanceToAlert(feature: AlertFeature, latitude: number, longitude: number): number | null {
  if (!feature.geometry) return null;
  let nearest = Number.POSITIVE_INFINITY;
  for (const [lon, lat] of coordinates(feature.geometry.coordinates)) {
    nearest = Math.min(nearest, haversineKm(latitude, longitude, lat, lon));
  }
  return Number.isFinite(nearest) ? nearest : null;
}

/**
 * Significant alerts across the user's state and its neighbours, excluding
 * anything the point query already returned as affecting them directly.
 */
export async function fetchRegionalAlerts(
  latitude: number,
  longitude: number,
  excludeIds: string[],
  state?: string | null,
): Promise<RegionalAlert[]> {
  try {
    const home = state ?? (await fetchPointState(latitude, longitude));
    if (!home) return [];

    const area = [home, ...(NEIGHBORS[home] ?? [])].join(',');
    const response = await fetch(`${NWS_ALERTS}?area=${area}`, {
      headers: { Accept: 'application/geo+json, application/json', 'User-Agent': USER_AGENT },
    });
    if (!response.ok) return [];

    const json = (await response.json()) as AlertResponse;
    const exclude = new Set(excludeIds);

    return usableAlertFeatures(json)
      .filter((feature) => {
        if (exclude.has(feature.id)) return false;
        const text = `${feature.properties.event ?? ''} ${feature.properties.headline ?? ''}`;
        return SIGNIFICANT.test(text) && WATCH_OR_WARNING.test(text);
      })
      .map((feature) => ({
        alert: toWeatherAlert(feature),
        // areaDesc lists counties rather than the state, so fall back to the
        // home state only for display grouping.
        state: stateFromAreaDesc(feature.properties.areaDesc) ?? home,
        distanceKm: distanceToAlert(feature, latitude, longitude),
      }))
      .sort(bySeverityThenDistance)
      .slice(0, 12);
  } catch {
    return [];
  }
}

/** areaDesc reads like "Fulton, GA; Cobb, GA" — take the first state token. */
function stateFromAreaDesc(areaDesc?: string): string | null {
  const match = /,\s*([A-Z]{2})\b/.exec(areaDesc ?? '');
  return match ? match[1] : null;
}

const SEVERITY_ORDER: Record<WeatherAlert['severity'], number> = {
  Extreme: 0,
  Severe: 1,
  Moderate: 2,
  Minor: 3,
  Unknown: 4,
};

function bySeverityThenDistance(a: RegionalAlert, b: RegionalAlert): number {
  const bySeverity = SEVERITY_ORDER[a.alert.severity] - SEVERITY_ORDER[b.alert.severity];
  if (bySeverity !== 0) return bySeverity;
  // Alerts without a polygon sort after those we can actually place.
  return (a.distanceKm ?? Number.MAX_SAFE_INTEGER) - (b.distanceKm ?? Number.MAX_SAFE_INTEGER);
}
