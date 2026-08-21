import { parseGribIndex, parseMessagesFromBuffer } from '@mattnucc/gribberish';

const BUCKET = 'https://noaa-hrrr-bdp-pds.s3.amazonaws.com';

/** Sub-hourly HRRR output is written every 15 minutes. */
const STEP_MIN = 15;
/** hrrr.tHHz.wrfsubhfNN.grib2 holds forecast minutes (NN-1)*60+15 .. NN*60. */
const STEPS_PER_FILE = 4;
/** NCEP publishes a run roughly 50 minutes after its init hour; probe back from there. */
const PUBLISH_LAG_MIN = 55;
const MAX_RUN_PROBES = 4;

export type ForecastFrame = {
  /** Unix seconds the forecast is valid for. */
  time: number;
  /** Model init time, ISO. Part of the tile cache key so old runs never alias. */
  run: string;
  forecastMinute: number;
  url: string;
  byteStart: number;
  byteEnd: number;
};

export type Grid = {
  values: number[];
  rows: number;
  cols: number;
  proj: string;
  lat0: number;
  lon0: number;
};

function runKey(run: Date): { day: string; hour: string } {
  const iso = run.toISOString();
  return { day: `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}`, hour: iso.slice(11, 13) };
}

function fileUrl(run: Date, fileIndex: number): string {
  const { day, hour } = runKey(run);
  return `${BUCKET}/hrrr.${day}/conus/hrrr.t${hour}z.wrfsubhf${String(fileIndex).padStart(2, '0')}.grib2`;
}

async function exists(url: string): Promise<boolean> {
  const res = await fetch(url, { method: 'HEAD' });
  return res.ok;
}

/** Newest run that has actually been published, probing backwards hour by hour. */
export async function latestRun(now = new Date()): Promise<Date> {
  const start = new Date(now.getTime() - PUBLISH_LAG_MIN * 60_000);
  start.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < MAX_RUN_PROBES; i++) {
    const candidate = new Date(start.getTime() - i * 3_600_000);
    if (await exists(`${fileUrl(candidate, 1)}.idx`)) return candidate;
  }
  throw new Error('No published HRRR run found');
}

type IndexEntry = { offset: number; length?: number };

async function refcIndex(url: string): Promise<Map<number, IndexEntry>> {
  const res = await fetch(`${url}.idx`);
  if (!res.ok) throw new Error(`HRRR index unavailable: ${url}.idx`);
  const entries = parseGribIndex(await res.text());
  const byMinute = new Map<number, IndexEntry>();
  for (const entry of entries) {
    if (entry.var !== 'REFC') continue;
    // forecastTime reads like "15 min fcst" / "60 min fcst".
    const match = /^(\d+)\s*min/.exec(entry.forecastTime ?? '');
    if (!match) continue;
    byMinute.set(Number(match[1]), { offset: entry.offset, length: entry.length });
  }
  return byMinute;
}

/**
 * Forecast frames valid strictly after `now`, through `horizonMin` ahead.
 * Because a run publishes ~1h late, the still-future steps usually straddle two
 * wrfsubh files, so we resolve each file's index independently.
 */
export async function forecastFrames(horizonMin = 60, now = new Date()): Promise<ForecastFrame[]> {
  const run = await latestRun(now);
  const runMs = run.getTime();
  const nowMs = now.getTime();

  const firstStep = Math.floor((nowMs - runMs) / 60_000 / STEP_MIN) * STEP_MIN + STEP_MIN;
  const wanted: number[] = [];
  for (let m = firstStep; m <= (nowMs - runMs) / 60_000 + horizonMin; m += STEP_MIN) {
    if (m > 0) wanted.push(m);
  }

  const needed = [...new Set(wanted.map((m) => Math.ceil(m / (STEP_MIN * STEPS_PER_FILE))))];
  const indexes = new Map<number, Map<number, IndexEntry>>();
  await Promise.all(
    needed.map(async (fileIndex) => {
      try {
        indexes.set(fileIndex, await refcIndex(fileUrl(run, fileIndex)));
      } catch {
        // A file at the edge of the run may not be published yet; skip it.
      }
    }),
  );

  const frames: ForecastFrame[] = [];
  for (const minute of wanted) {
    const fileIndex = Math.ceil(minute / (STEP_MIN * STEPS_PER_FILE));
    const entry = indexes.get(fileIndex)?.get(minute);
    if (!entry) continue;
    frames.push({
      time: Math.round((runMs + minute * 60_000) / 1000),
      run: run.toISOString(),
      forecastMinute: minute,
      url: fileUrl(run, fileIndex),
      byteStart: entry.offset,
      byteEnd: entry.length ? entry.offset + entry.length - 1 : entry.offset + 4_000_000,
    });
  }
  return frames;
}

/**
 * Rebuild a frame's byte range from the run and forecast minute carried in a
 * tile URL, so tile requests do not depend on the frames listing.
 */
export async function resolveFrame(runIso: string, minute: number): Promise<ForecastFrame> {
  const run = new Date(runIso);
  if (Number.isNaN(run.getTime())) throw new Error('Invalid run');
  if (!Number.isInteger(minute) || minute <= 0 || minute % STEP_MIN !== 0) throw new Error('Invalid minute');

  const fileIndex = Math.ceil(minute / (STEP_MIN * STEPS_PER_FILE));
  const url = fileUrl(run, fileIndex);
  const entry = (await refcIndex(url)).get(minute);
  if (!entry) throw new Error(`No REFC record for +${minute} min`);
  return {
    time: Math.round((run.getTime() + minute * 60_000) / 1000),
    run: run.toISOString(),
    forecastMinute: minute,
    url,
    byteStart: entry.offset,
    byteEnd: entry.length ? entry.offset + entry.length - 1 : entry.offset + 4_000_000,
  };
}

/** Range-fetch and decode a single REFC record. ~240 KB and ~130 ms for CONUS. */
export async function loadGrid(frame: Pick<ForecastFrame, 'url' | 'byteStart' | 'byteEnd'>): Promise<Grid> {
  const res = await fetch(frame.url, { headers: { Range: `bytes=${frame.byteStart}-${frame.byteEnd}` } });
  if (!res.ok && res.status !== 206) throw new Error(`HRRR range fetch failed: ${res.status}`);
  const message = parseMessagesFromBuffer(new Uint8Array(await res.arrayBuffer()))[0];
  if (!message) throw new Error('No GRIB message in range');
  const { rows, cols } = message.gridShape;
  const ll = message.latlng;
  return {
    values: message.data,
    rows,
    cols,
    proj: message.proj,
    lat0: ll.latitude[0],
    lon0: ll.longitude[0] > 180 ? ll.longitude[0] - 360 : ll.longitude[0],
  };
}
