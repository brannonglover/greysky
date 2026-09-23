/**
 * Tropical cyclones from the National Hurricane Center.
 *
 * Two upstream documents feed this. `CurrentStorms.json` is a clean JSON list
 * of active systems with their present position and intensity. The forecast
 * track only exists inside the forecast/advisory *text* product — a fixed-width
 * teletype format that NHC could change without notice — so the parsing lives
 * here on the server rather than in the app, where a format shift would need a
 * new build to fix. Clients get the normalised shape below.
 */

const CURRENT_STORMS_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const USER_AGENT = 'GreySkyWeather/3.0 (com.brannonglover.greysky; tropical service)';

/** One quadrant set of wind radii, in nautical miles, NE/SE/SW/NW. */
export type WindRadii = {
  ne: number;
  se: number;
  sw: number;
  nw: number;
};

export type TrackPoint = {
  /** Epoch ms, resolved from the advisory's DD/HHMMZ stamp. */
  time: number;
  latitude: number;
  longitude: number;
  maxWindKt: number;
  gustKt: number;
  /** Absent quadrant sets mean the system has no winds of that strength. */
  radii34: WindRadii | null;
  radii50: WindRadii | null;
  radii64: WindRadii | null;
  /** Days 4–5 come from the extended OUTLOOK, which carries larger error. */
  outlook: boolean;
  /** True for the analysis point — where the storm is now, not a forecast. */
  analysis: boolean;
};

export type TropicalStorm = {
  id: string;
  name: string;
  /** NHC code: HU, TS, TD, STS, PTC, ... */
  classification: string;
  latitude: number;
  longitude: number;
  maxWindKt: number;
  pressureMb: number | null;
  movementDir: number | null;
  movementSpeedKt: number | null;
  /** Epoch ms of the advisory this position came from. */
  lastUpdate: number;
  advisoryNumber: string | null;
  advisoryUrl: string | null;
  /** False when the forecast advisory could not be fetched or parsed. */
  trackAvailable: boolean;
  track: TrackPoint[];
};

/**
 * A track carrying only the analysis point says where the storm is but not
 * where it is going, which is not enough to claim a forecast is available.
 */
export function hasForecastTrack(track: TrackPoint[]): boolean {
  return track.some((point) => !point.analysis);
}

export type TropicalResponse = {
  generated: number;
  storms: TropicalStorm[];
};

// ---------------------------------------------------------------------------
// Advisory text parsing
// ---------------------------------------------------------------------------

/** Advisories are served inside a <pre> block; fixtures are the bare text. */
export function extractAdvisoryText(document: string): string {
  const pre = /<pre>([\s\S]*?)<\/pre>/i.exec(document);
  const body = pre ? pre[1] : document;
  return body
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

const POINT_HEADER =
  /^(FORECAST|OUTLOOK) VALID\s+(\d{2})\/(\d{2})(\d{2})Z\s+(\d+(?:\.\d+)?)([NS])\s+(\d+(?:\.\d+)?)([EW])/gm;

const MAX_WIND = /MAX WIND\s+(\d+)\s*KT\.*\s*GUSTS\s+(\d+)\s*KT/i;

function radiiFor(block: string, strength: 34 | 50 | 64): WindRadii | null {
  // Leading dots pad the initial block ("34 KT....... 90NE"); forecast blocks
  // use a shorter run ("34 KT... 90NE"). The count carries no meaning.
  const match = new RegExp(
    `^${strength} KT[.\\s]*?(\\d+)NE\\s+(\\d+)SE\\s+(\\d+)SW\\s+(\\d+)NW`,
    'm',
  ).exec(block);
  if (!match) return null;
  const radii = {
    ne: Number(match[1]),
    se: Number(match[2]),
    sw: Number(match[3]),
    nw: Number(match[4]),
  };
  // An all-zero set means the system has no winds of that strength anywhere.
  return radii.ne || radii.se || radii.sw || radii.nw ? radii : null;
}

/**
 * Advisories stamp times as day-of-month and UTC hour only, with no month or
 * year. Resolve each forward from the previous point so a track that runs past
 * the end of a month rolls into the next one instead of jumping backwards.
 */
function resolveUtc(day: number, hour: number, minute: number, afterMs: number): number {
  const ref = new Date(afterMs);
  for (let monthOffset = 0; monthOffset <= 1; monthOffset += 1) {
    const candidate = Date.UTC(
      ref.getUTCFullYear(),
      ref.getUTCMonth() + monthOffset,
      day,
      hour,
      minute,
    );
    // A forecast point is never behind the time it was issued from; the small
    // slack absorbs the initial position sharing a stamp with the advisory.
    if (candidate >= afterMs - 60 * 60_000) return candidate;
  }
  return Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, day, hour, minute);
}

function signed(value: string, hemisphere: string): number {
  const magnitude = Number(value);
  return hemisphere === 'S' || hemisphere === 'W' ? -magnitude : magnitude;
}

const ANALYSIS_POSITION =
  /CENTER LOCATED NEAR\s+(\d+(?:\.\d+)?)([NS])\s+(\d+(?:\.\d+)?)([EW])\s+AT\s+(\d{2})\/(\d{2})(\d{2})Z/;

const ANALYSIS_WIND = /MAX SUSTAINED WINDS\s+(\d+)\s*KT WITH GUSTS TO\s+(\d+)\s*KT/;

/**
 * Where the storm is right now, with the wind radii measured around it.
 *
 * This point matters as much as the forecast ones: a system already overhead
 * has no future leg that brings it closer, so without the analysis radii the
 * exposure window for someone currently inside the wind field would come back
 * empty. Position is also in CurrentStorms.json, but the radii are not.
 */
function parseAnalysisPoint(text: string, firstForecastIndex: number): TrackPoint | null {
  const position = ANALYSIS_POSITION.exec(text);
  if (!position) return null;

  const wind = ANALYSIS_WIND.exec(text);
  const windIndex = wind?.index ?? 0;
  // Radii sit between the intensity line and the first forecast block.
  const block = text.slice(windIndex, firstForecastIndex);

  return {
    time: Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      Number(position[5]),
      Number(position[6]),
      Number(position[7]),
    ),
    latitude: signed(position[1], position[2]),
    longitude: signed(position[3], position[4]),
    maxWindKt: wind ? Number(wind[1]) : 0,
    gustKt: wind ? Number(wind[2]) : 0,
    radii34: radiiFor(block, 34),
    radii50: radiiFor(block, 50),
    radii64: radiiFor(block, 64),
    outlook: false,
    analysis: true,
  };
}

/**
 * The track from one advisory text: the analysis position followed by every
 * forecast and extended-outlook position.
 */
export function parseForecastTrack(document: string, issuedMs: number): TrackPoint[] {
  const text = extractAdvisoryText(document);
  const headers = [...text.matchAll(POINT_HEADER)];
  const points: TrackPoint[] = [];
  let previous = issuedMs;

  const analysis = parseAnalysisPoint(text, headers[0]?.index ?? text.length);
  if (analysis) {
    // Resolve the analysis stamp the same way as the forecast points, so a
    // late-month advisory cannot place it in the wrong month.
    const stamp = new Date(analysis.time);
    analysis.time = resolveUtc(
      stamp.getUTCDate(),
      stamp.getUTCHours(),
      stamp.getUTCMinutes(),
      issuedMs - 12 * 60 * 60_000,
    );
    points.push(analysis);
    previous = analysis.time;
  }

  for (let i = 0; i < headers.length; i += 1) {
    const header = headers[i];
    const start = (header.index ?? 0) + header[0].length;
    const end = headers[i + 1]?.index ?? text.length;
    const block = text.slice(start, end);

    const time = resolveUtc(Number(header[2]), Number(header[3]), Number(header[4]), previous);
    const wind = MAX_WIND.exec(block);

    points.push({
      time,
      latitude: signed(header[5], header[6]),
      longitude: signed(header[7], header[8]),
      maxWindKt: wind ? Number(wind[1]) : 0,
      gustKt: wind ? Number(wind[2]) : 0,
      radii34: radiiFor(block, 34),
      radii50: radiiFor(block, 50),
      radii64: radiiFor(block, 64),
      outlook: header[1] === 'OUTLOOK',
      analysis: false,
    });
    previous = time;
  }

  return points;
}

/** Advisory number from the product header, e.g. "14" or "14A". */
export function parseAdvisoryNumber(document: string): string | null {
  const match = /FORECAST\/ADVISORY NUMBER\s+(\d+[A-Z]?)/i.exec(extractAdvisoryText(document));
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// CurrentStorms.json
// ---------------------------------------------------------------------------

type RawLink = { url?: string; advNum?: string };

type RawStorm = {
  id?: string;
  name?: string;
  classification?: string;
  intensity?: string;
  pressure?: string;
  latitudeNumeric?: number;
  longitudeNumeric?: number;
  movementDir?: number | null;
  movementSpeed?: number | null;
  lastUpdate?: string;
  publicAdvisory?: RawLink;
  forecastAdvisory?: RawLink;
};

function numeric(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The public advisory is the readable product we link the user to; the
 * forecast advisory is the fixed-width one carrying the track. They are
 * separate URLs in the feed, so neither is derived from the other.
 */
type NormalisedStorm = { storm: TropicalStorm; forecastUrl: string | null };

function normalise(raw: RawStorm): NormalisedStorm | null {
  const id = raw.id?.trim();
  const latitude = numeric(raw.latitudeNumeric);
  const longitude = numeric(raw.longitudeNumeric);
  if (!id || latitude === null || longitude === null) return null;

  const lastUpdate = Date.parse(raw.lastUpdate ?? '');

  return {
    storm: {
      id,
      name: raw.name?.trim() || 'Unnamed system',
      classification: raw.classification?.trim().toUpperCase() || 'LO',
      latitude,
      longitude,
      maxWindKt: numeric(raw.intensity) ?? 0,
      pressureMb: numeric(raw.pressure),
      movementDir: numeric(raw.movementDir),
      movementSpeedKt: numeric(raw.movementSpeed),
      lastUpdate: Number.isFinite(lastUpdate) ? lastUpdate : Date.now(),
      advisoryNumber: raw.forecastAdvisory?.advNum?.trim() || null,
      advisoryUrl: raw.publicAdvisory?.url ?? raw.forecastAdvisory?.url ?? null,
      trackAvailable: false,
      track: [],
    },
    forecastUrl: raw.forecastAdvisory?.url ?? null,
  };
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html, text/plain, application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${url} responded ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Active systems with their official forecast tracks.
 *
 * The storm list is fetched first and normalised on its own, then each advisory
 * is fetched independently. One unreachable or unparseable advisory costs only
 * that storm its track — every other storm, and that storm's current position
 * and intensity, still come back.
 */
export async function fetchTropicalStorms(timeoutMs = 8000): Promise<TropicalStorm[]> {
  const listing = await fetchText(CURRENT_STORMS_URL, timeoutMs);
  const parsed = JSON.parse(listing) as { activeStorms?: RawStorm[] };
  const entries = (parsed.activeStorms ?? [])
    .map(normalise)
    .filter((entry): entry is NormalisedStorm => entry !== null);

  const advisories = await Promise.allSettled(
    entries.map(async ({ storm, forecastUrl }) => {
      if (!forecastUrl) throw new Error(`${storm.id} has no forecast advisory URL`);
      return parseForecastTrack(await fetchText(forecastUrl, timeoutMs), storm.lastUpdate);
    }),
  );

  return entries.map(({ storm }, index) => {
    const result = advisories[index];
    if (result.status !== 'fulfilled') return storm;
    // An advisory that yielded only an analysis point still contributes its
    // wind radii, but it cannot claim a forecast track.
    return {
      ...storm,
      trackAvailable: hasForecastTrack(result.value),
      track: result.value,
    };
  });
}
