/**
 * Severe-weather outlooks from NOAA's Storm Prediction Center.
 *
 * SPC is the authoritative source for severe-thunderstorm and tornado risk one
 * to three days out, well before any watch or warning exists. Its outlooks are
 * published as GeoJSON risk polygons, so answering "is my location at risk"
 * means a point-in-polygon test rather than any kind of inference — tornado
 * probability in particular must come from here and never be guessed at from
 * ordinary forecast data.
 *
 * The evaluation runs server-side so clients receive only their own risk: a
 * couple of hundred bytes, whatever the day looks like nationally.
 */

const BASE = 'https://www.spc.noaa.gov/products/outlook';
const USER_AGENT = 'GreySkyWeather/3.0 (com.brannonglover.greysky; outlook service)';

/** SPC categorical risk, ordered. TSTM is ordinary thunder, not severe. */
export const CATEGORIES = ['TSTM', 'MRGL', 'SLGT', 'ENH', 'MDT', 'HIGH'] as const;
export type CategoryCode = (typeof CATEGORIES)[number];

export function categoryRank(code: CategoryCode): number {
  return CATEGORIES.indexOf(code);
}

/** Below this the outlook is ordinary thunderstorms, which we never surface. */
export function isSevereCategory(code: CategoryCode): boolean {
  return categoryRank(code) >= categoryRank('MRGL');
}

export type HazardRisk = {
  /** Fractional probability within 25 miles of a point, e.g. 0.15. */
  probability: number;
  /** Inside SPC's hatched area — significant severe of that hazard. */
  significant: boolean;
};

export type DayOutlook = {
  day: 1 | 2 | 3;
  issued: number;
  validFrom: number;
  validTo: number;
  categorical: { code: CategoryCode; label: string } | null;
  tornado: HazardRisk | null;
  wind: HazardRisk | null;
  hail: HazardRisk | null;
  /** Days 2–3 may publish a combined "any severe" probability instead. */
  anySevere: HazardRisk | null;
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type Ring = number[][];

type Geometry =
  | { type: 'Polygon'; coordinates: Ring[] }
  | { type: 'MultiPolygon'; coordinates: Ring[][] }
  | { type: 'GeometryCollection'; geometries: Geometry[] }
  | { type: string; coordinates?: unknown; geometries?: Geometry[] };

type Feature = {
  properties?: Record<string, unknown>;
  geometry?: Geometry | null;
};

type FeatureCollection = { features?: Feature[] };

/** SPC stamps times as YYYYMMDDHHMM in UTC. */
function parseStamp(value: unknown): number {
  const text = String(value ?? '');
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(text);
  if (!m) return Number.NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

/**
 * SPC leaves old products on the server when one is not currently issued, and
 * serves them with a 200. `day2otlk_prob` has been returning a January 2020
 * outlook — complete with plausible 5% and 15% severe polygons — for years. An
 * expired product must be discarded, or the app will report six-year-old risk
 * as though it were today's.
 */
export function isCurrent(collection: FeatureCollection, nowMs: number): boolean {
  const first = collection.features?.[0]?.properties;
  if (!first) return false;
  const expire = parseStamp(first.EXPIRE);
  return Number.isFinite(expire) && expire > nowMs;
}

/**
 * Ray casting, counting crossings across every ring of a polygon. Interior
 * rings flip the parity back out, so a point inside a hole reads as outside —
 * which is the whole point of a hole.
 */
function pointInRings(rings: Ring[], lon: number, lat: number): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

export function pointInGeometry(geometry: Geometry | null | undefined, lon: number, lat: number): boolean {
  if (!geometry) return false;
  switch (geometry.type) {
    case 'Polygon':
      return pointInRings((geometry.coordinates ?? []) as Ring[], lon, lat);
    case 'MultiPolygon':
      return ((geometry.coordinates ?? []) as Ring[][]).some((rings) =>
        pointInRings(rings, lon, lat),
      );
    case 'GeometryCollection':
      return (geometry.geometries ?? []).some((child) => pointInGeometry(child, lon, lat));
    default:
      return false;
  }
}

/**
 * Features that actually represent a risk.
 *
 * `DN: 0` marks SPC's "Less Than 2% All Areas" placeholder — a no-risk record,
 * usually carrying an empty GeometryCollection — which must never be read as a
 * hazard.
 */
function riskFeatures(collection: FeatureCollection): Feature[] {
  return (collection.features ?? []).filter((feature) => {
    const dn = Number(feature.properties?.DN);
    return Number.isFinite(dn) && dn > 0;
  });
}

/** The highest categorical risk covering the point, or null. */
export function categoricalAt(
  collection: FeatureCollection,
  lon: number,
  lat: number,
): { code: CategoryCode; label: string } | null {
  let best: { code: CategoryCode; label: string } | null = null;

  for (const feature of riskFeatures(collection)) {
    const code = String(feature.properties?.LABEL ?? '') as CategoryCode;
    if (!CATEGORIES.includes(code)) continue;
    if (!pointInGeometry(feature.geometry, lon, lat)) continue;
    if (!best || categoryRank(code) > categoryRank(best.code)) {
      best = { code, label: String(feature.properties?.LABEL2 ?? code) };
    }
  }

  return best;
}

/**
 * The hazard probability covering the point, plus whether it falls in the
 * hatched significant area.
 *
 * Probability products mix numeric labels with non-probability markers in the
 * same collection: `SIGN` delimits the hatched area, and `CIG1` ("Conditional
 * Intensity Group") appears in hail. Only numeric labels are probabilities.
 */
export function hazardAt(
  collection: FeatureCollection,
  lon: number,
  lat: number,
): HazardRisk | null {
  let probability = 0;
  let significant = false;

  for (const feature of riskFeatures(collection)) {
    const label = String(feature.properties?.LABEL ?? '');
    const covers = () => pointInGeometry(feature.geometry, lon, lat);

    if (label === 'SIGN') {
      if (covers()) significant = true;
      continue;
    }

    const value = Number(label);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (covers() && value > probability) probability = value;
  }

  if (probability === 0 && !significant) return null;
  return { probability, significant };
}

/** Validity window from whichever product supplied the data. */
function windowOf(collection: FeatureCollection): Pick<DayOutlook, 'issued' | 'validFrom' | 'validTo'> {
  const props = collection.features?.[0]?.properties ?? {};
  return {
    issued: parseStamp(props.ISSUE),
    validFrom: parseStamp(props.VALID),
    validTo: parseStamp(props.EXPIRE),
  };
}

export type ProductSet = {
  cat?: FeatureCollection;
  torn?: FeatureCollection;
  wind?: FeatureCollection;
  hail?: FeatureCollection;
  prob?: FeatureCollection;
};

/**
 * Resolve one day's outlook at a point. Products that are missing or expired
 * are simply absent — a stale hazard product never contributes.
 */
export function outlookAt(
  day: 1 | 2 | 3,
  products: ProductSet,
  lon: number,
  lat: number,
  nowMs: number,
): DayOutlook | null {
  const fresh = <T extends FeatureCollection | undefined>(c: T): T | undefined =>
    c && isCurrent(c, nowMs) ? c : undefined;

  const cat = fresh(products.cat);
  const torn = fresh(products.torn);
  const wind = fresh(products.wind);
  const hail = fresh(products.hail);
  const prob = fresh(products.prob);

  const source = cat ?? torn ?? wind ?? hail ?? prob;
  if (!source) return null;

  const found = cat ? categoricalAt(cat, lon, lat) : null;
  const tornado = torn ? hazardAt(torn, lon, lat) : null;
  const windRisk = wind ? hazardAt(wind, lon, lat) : null;
  const hailRisk = hail ? hazardAt(hail, lon, lat) : null;
  // Days 2–3 fall back to a combined probability when the individual hazard
  // products are not issued.
  const anySevere = prob && !tornado && !windRisk && !hailRisk ? hazardAt(prob, lon, lat) : null;

  // TSTM means ordinary thunderstorms are expected, which is not severe
  // weather and must never reach the user as a risk. SPC's general-thunder
  // area is enormous — on an active day it covers much of the country — so
  // surfacing it would bury the outlooks that matter. Only keep it if a real
  // hazard probability came with it.
  const anyHazard = Boolean(tornado || windRisk || hailRisk || anySevere);
  const categorical = found && (isSevereCategory(found.code) || anyHazard) ? found : null;

  if (!categorical && !anyHazard) return null;

  return {
    day,
    ...windowOf(source),
    categorical,
    tornado,
    wind: windRisk,
    hail: hailRisk,
    anySevere,
  };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

const KINDS: Record<1 | 2 | 3, (keyof ProductSet)[]> = {
  1: ['cat', 'torn', 'wind', 'hail'],
  2: ['cat', 'torn', 'wind', 'hail', 'prob'],
  3: ['cat', 'prob'],
};

/**
 * Parsed products, held between requests and re-fetched only once the newest
 * one we hold has expired. SPC reissues day 1 five times daily, so this keeps
 * one fetch serving every user in that window.
 */
let cache: { products: Record<number, ProductSet>; expires: number } | null = null;

async function fetchProduct(day: number, kind: string): Promise<FeatureCollection | undefined> {
  try {
    const response = await fetch(`${BASE}/day${day}otlk_${kind}.nolyr.geojson`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json, application/json' },
    });
    if (!response.ok) return undefined;
    return (await response.json()) as FeatureCollection;
  } catch {
    return undefined;
  }
}

export async function loadProducts(nowMs: number): Promise<Record<number, ProductSet>> {
  if (cache && cache.expires > nowMs) return cache.products;

  const wanted: { day: 1 | 2 | 3; kind: keyof ProductSet }[] = [];
  for (const day of [1, 2, 3] as const) {
    for (const kind of KINDS[day]) wanted.push({ day, kind });
  }

  // One unavailable product costs only itself, never the whole outlook.
  const settled = await Promise.allSettled(
    wanted.map(async ({ day, kind }) => ({ day, kind, doc: await fetchProduct(day, kind) })),
  );

  const products: Record<number, ProductSet> = { 1: {}, 2: {}, 3: {} };
  let soonestExpiry = Number.POSITIVE_INFINITY;

  for (const result of settled) {
    if (result.status !== 'fulfilled' || !result.value.doc) continue;
    const { day, kind, doc } = result.value;
    products[day][kind] = doc;
    if (isCurrent(doc, nowMs)) {
      const expire = parseStamp(doc.features?.[0]?.properties?.EXPIRE);
      if (Number.isFinite(expire)) soonestExpiry = Math.min(soonestExpiry, expire);
    }
  }

  // Re-fetch at the next issuance boundary at the latest, and never hold more
  // than fifteen minutes so a new day-1 issuance is picked up promptly.
  const expires = Math.min(
    Number.isFinite(soonestExpiry) ? soonestExpiry : nowMs + 15 * 60_000,
    nowMs + 15 * 60_000,
  );
  cache = { products, expires };
  return products;
}

/** Every day's outlook that carries a risk at this point. */
export async function outlookForPoint(
  latitude: number,
  longitude: number,
  nowMs = Date.now(),
): Promise<DayOutlook[]> {
  const products = await loadProducts(nowMs);
  const days: DayOutlook[] = [];
  for (const day of [1, 2, 3] as const) {
    const outlook = outlookAt(day, products[day] ?? {}, longitude, latitude, nowMs);
    if (outlook) days.push(outlook);
  }
  return days;
}
