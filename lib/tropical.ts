import { RADAR_API } from '@/lib/radar/api';

/**
 * Tropical cyclones, and what they mean for one point on the ground.
 *
 * The fragile half of this — fetching NHC and parsing the fixed-width advisory
 * text — lives in the server service. What is left here is pure geometry
 * against the user's coordinates, which is cheap and needs no network.
 *
 * The question this module answers is deliberately *not* "how far away is the
 * centre". A hurricane's damaging winds routinely extend a hundred nautical
 * miles from the eye, so the signal that matters is whether the forecast wind
 * field is expected to cover the user, and when.
 */

export type WindRadii = { ne: number; se: number; sw: number; nw: number };

export type TrackPoint = {
  time: number;
  latitude: number;
  longitude: number;
  maxWindKt: number;
  gustKt: number;
  radii34: WindRadii | null;
  radii50: WindRadii | null;
  radii64: WindRadii | null;
  outlook: boolean;
  analysis: boolean;
};

export type TropicalStorm = {
  id: string;
  name: string;
  classification: string;
  latitude: number;
  longitude: number;
  maxWindKt: number;
  pressureMb: number | null;
  movementDir: number | null;
  movementSpeedKt: number | null;
  lastUpdate: number;
  advisoryNumber: string | null;
  advisoryUrl: string | null;
  trackAvailable: boolean;
  track: TrackPoint[];
};

/** Strongest wind band the forecast brings over the user's location. */
export type ExposureStrength = 'ts' | 'strong-ts' | 'hurricane';

export type StormExposure = {
  startsAt: number;
  endsAt: number;
  strength: ExposureStrength;
  /** Storm intensity while it covers the user, not its lifetime peak. */
  peakWindKt: number;
  /** True when the window opens beyond day 3, where track error is largest. */
  fromOutlook: boolean;
};

export type StormThreat = {
  /** Great-circle distance to the current centre, kilometres. */
  distanceKm: number;
  /** Compass bearing from the user to the storm, degrees. */
  bearing: number;
  /**
   * When and how hard the forecast wind field covers the user. Null means the
   * forecast never brings tropical-storm-force winds to this location — which
   * is the common case, and must not be presented as a threat.
   */
  exposure: StormExposure | null;
  /** Nearest the centre is forecast to come. Context only, never the headline. */
  closest: { distanceKm: number; time: number; maxWindKt: number } | null;
};

export type TropicalReport = {
  storm: TropicalStorm;
  threat: StormThreat;
};

const NM_TO_KM = 1.852;
const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const dLat = toRadians(bLat - aLat);
  const dLon = toRadians(bLon - aLon);
  const lat1 = toRadians(aLat);
  const lat2 = toRadians(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const lat1 = toRadians(aLat);
  const lat2 = toRadians(bLat);
  const dLon = toRadians(bLon - aLon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/** Saffir–Simpson category, or null for anything below hurricane strength. */
export function saffirSimpson(maxWindKt: number): number | null {
  if (maxWindKt >= 137) return 5;
  if (maxWindKt >= 113) return 4;
  if (maxWindKt >= 96) return 3;
  if (maxWindKt >= 83) return 2;
  if (maxWindKt >= 64) return 1;
  return null;
}

export function stormKindLabel(storm: TropicalStorm): string {
  const category = saffirSimpson(storm.maxWindKt);
  // The card shows the category as its own chip, so repeating it here would
  // read as "Category 4 hurricane  CAT 4".
  if (category !== null) return 'Hurricane';
  switch (storm.classification) {
    case 'TD':
      return 'Tropical depression';
    case 'TS':
      return 'Tropical storm';
    case 'STS':
      return 'Subtropical storm';
    case 'STD':
      return 'Subtropical depression';
    case 'PTC':
      return 'Potential tropical cyclone';
    case 'EX':
      return 'Post-tropical cyclone';
    default:
      return 'Tropical system';
  }
}

export function exposureLabel(strength: ExposureStrength): string {
  switch (strength) {
    case 'hurricane':
      return 'Hurricane-force winds';
    case 'strong-ts':
      return 'Damaging tropical-storm winds';
    default:
      return 'Tropical-storm-force winds';
  }
}

/**
 * The wind radius facing the user. NHC reports a separate radius per quadrant
 * because the wind field is rarely symmetric, so taking the largest would
 * routinely claim exposure for places on the storm's quiet side.
 */
function radiusTowardKm(radii: WindRadii, bearingFromStorm: number): number {
  const quadrant =
    bearingFromStorm < 90 ? radii.ne
      : bearingFromStorm < 180 ? radii.se
      : bearingFromStorm < 270 ? radii.sw
      : radii.nw;
  return quadrant * NM_TO_KM;
}

function strengthAt(point: TrackPoint, latitude: number, longitude: number): ExposureStrength | null {
  const distance = haversineKm(latitude, longitude, point.latitude, point.longitude);
  const bearing = bearingDeg(point.latitude, point.longitude, latitude, longitude);
  const within = (radii: WindRadii | null) =>
    radii !== null && distance <= radiusTowardKm(radii, bearing);

  if (within(point.radii64)) return 'hurricane';
  if (within(point.radii50)) return 'strong-ts';
  if (within(point.radii34)) return 'ts';
  return null;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function lerpRadii(from: WindRadii | null, to: WindRadii | null, t: number): WindRadii | null {
  if (!from) return to ? { ne: to.ne * t, se: to.se * t, sw: to.sw * t, nw: to.nw * t } : null;
  if (!to) return { ne: from.ne * (1 - t), se: from.se * (1 - t), sw: from.sw * (1 - t), nw: from.nw * (1 - t) };
  return {
    ne: lerp(from.ne, to.ne, t),
    se: lerp(from.se, to.se, t),
    sw: lerp(from.sw, to.sw, t),
    nw: lerp(from.nw, to.nw, t),
  };
}

function interpolate(from: TrackPoint, to: TrackPoint, t: number): TrackPoint {
  return {
    time: lerp(from.time, to.time, t),
    latitude: lerp(from.latitude, to.latitude, t),
    longitude: lerp(from.longitude, to.longitude, t),
    maxWindKt: lerp(from.maxWindKt, to.maxWindKt, t),
    gustKt: lerp(from.gustKt, to.gustKt, t),
    radii34: lerpRadii(from.radii34, to.radii34, t),
    radii50: lerpRadii(from.radii50, to.radii50, t),
    radii64: lerpRadii(from.radii64, to.radii64, t),
    outlook: t < 0.5 ? from.outlook : to.outlook,
    analysis: false,
  };
}

/**
 * Advisory points sit 12–24 hours apart. Walking between them in steps keeps
 * the wind field from skipping over a location entirely — a fast storm can
 * cross a whole state between two forecast positions.
 */
const STEPS_PER_LEG = 24;

const STRENGTH_RANK: Record<ExposureStrength, number> = {
  ts: 0,
  'strong-ts': 1,
  hurricane: 2,
};

export function stormThreat(
  storm: TropicalStorm,
  latitude: number,
  longitude: number,
): StormThreat {
  const distanceKm = haversineKm(latitude, longitude, storm.latitude, storm.longitude);
  const bearing = bearingDeg(latitude, longitude, storm.latitude, storm.longitude);
  const track = storm.track;

  if (track.length === 0) {
    return { distanceKm, bearing, exposure: null, closest: null };
  }

  const samples: TrackPoint[] = [track[0]];
  for (let i = 0; i < track.length - 1; i += 1) {
    for (let step = 1; step <= STEPS_PER_LEG; step += 1) {
      samples.push(interpolate(track[i], track[i + 1], step / STEPS_PER_LEG));
    }
  }

  let closest: { distanceKm: number; time: number; maxWindKt: number } | null = null;
  for (const point of samples) {
    const separation = haversineKm(latitude, longitude, point.latitude, point.longitude);
    if (closest === null || separation < closest.distanceKm) {
      closest = { distanceKm: separation, time: point.time, maxWindKt: point.maxWindKt };
    }
  }

  const covered = samples
    .map((point) => ({ point, strength: strengthAt(point, latitude, longitude) }))
    .filter((entry): entry is { point: TrackPoint; strength: ExposureStrength } => entry.strength !== null);

  if (covered.length === 0) {
    return { distanceKm, bearing, closest, exposure: null };
  }

  const first = covered[0];
  const last = covered[covered.length - 1];
  const strength = covered.reduce<ExposureStrength>(
    (worst, entry) => (STRENGTH_RANK[entry.strength] > STRENGTH_RANK[worst] ? entry.strength : worst),
    'ts',
  );

  return {
    distanceKm,
    bearing,
    closest,
    exposure: {
      startsAt: first.point.time,
      // A single covering sample is a brush past, not a zero-length window.
      endsAt: Math.max(last.point.time, first.point.time),
      strength,
      peakWindKt: Math.round(Math.max(...covered.map((entry) => entry.point.maxWindKt))),
      fromOutlook: first.point.outlook,
    },
  };
}

/**
 * Active systems with the user's exposure resolved. Returns an empty list when
 * the service is unreachable — the same contract as fetchAlerts, so a tropical
 * outage degrades the Storms tab instead of breaking it.
 */
export async function fetchTropicalReports(
  latitude: number,
  longitude: number,
): Promise<TropicalReport[]> {
  try {
    const response = await fetch(`${RADAR_API}/api/tropical/storms`);
    if (!response.ok) return [];
    const json = (await response.json()) as { storms?: TropicalStorm[] };
    return (json.storms ?? []).map((storm) => ({
      storm,
      threat: stormThreat(storm, latitude, longitude),
    }));
  } catch {
    return [];
  }
}
