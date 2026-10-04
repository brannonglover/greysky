/**
 * HRRR surface fields that might show when a radar-only nowcast can be surprised
 * by convective growth. This does not enter the ensemble.
 *
 * The existing GRIB path range-fetches one message. A field is useful here only
 * if that message is small enough to cache for a model run and share across points.
 */
import { parseGribIndex, parseMessagesFromBuffer } from '@mattnucc/gribberish';
import proj4 from 'proj4';

import type { Grid } from '../hrrr';
import { sampleGridAt } from '../render';
import type { EnvironmentValue } from './caseFile';

const BUCKET = 'https://noaa-hrrr-bdp-pds.s3.amazonaws.com';
const PUBLISH_LAG_MIN = 55;
const DX = 3000;
const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';

export type EnvCandidate = {
  id: string;
  variable: string;
  level: string;
  product: 'wrfsfc' | 'wrfsubhf';
  /** Included in the case sample. Others are inventoried for size only. */
  fetch: boolean;
  units: string;
  convert?: 'kelvin-c' | 'prate-mmhr';
  rationale: string;
};

/**
 * Chosen before the Atlanta values were read.
 * Helicity and bulk shear describe storm organization, not whether a quiet
 * radar pixel is about to grow. Ten-metre wind would only be a convergence
 * proxy and each component is about 2.4 MB.
 */
export const ENV_CANDIDATES: readonly EnvCandidate[] = [
  { id: 'cape-surface', variable: 'CAPE', level: 'surface', product: 'wrfsfc', fetch: true, units: 'J/kg', rationale: 'Surface buoyancy available for new growth the recent radar may not contain.' },
  { id: 'cin-surface', variable: 'CIN', level: 'surface', product: 'wrfsfc', fetch: true, units: 'J/kg', rationale: 'Inhibition. Weak CIN means that buoyancy is not being held down.' },
  { id: 'cape-mucape', variable: 'CAPE', level: '255-0 mb above ground', product: 'wrfsfc', fetch: true, units: 'J/kg', rationale: 'Most-unstable CAPE. Catches elevated instability when surface CAPE is low.' },
  { id: 'cin-mucape', variable: 'CIN', level: '255-0 mb above ground', product: 'wrfsfc', fetch: true, units: 'J/kg', rationale: 'Inhibition on the most-unstable parcel.' },
  { id: 'cape-ml', variable: 'CAPE', level: '0-3000 m above ground', product: 'wrfsfc', fetch: false, units: 'J/kg', rationale: 'Mixed-layer CAPE. Inventoried; surface and most-unstable CAPE already cover the question.' },
  { id: 'pwat', variable: 'PWAT', level: 'entire atmosphere (considered as a single layer)', product: 'wrfsfc', fetch: true, units: 'mm', rationale: 'Column moisture. A dry column cannot produce the rates Atlanta observed.' },
  { id: 'dpt-2m', variable: 'DPT', level: '2 m above ground', product: 'wrfsfc', fetch: true, units: 'C', convert: 'kelvin-c', rationale: 'Low-level moisture feeding initiation.' },
  { id: 'rh-2m', variable: 'RH', level: '2 m above ground', product: 'wrfsfc', fetch: false, units: '%', rationale: 'Overlaps dewpoint. Not fetched.' },
  { id: 'lifted-index', variable: '4LFTX', level: '180-0 mb above ground', product: 'wrfsfc', fetch: true, units: 'K', rationale: 'Best lifted index. Another instability sign, kept to see if it says more than CAPE.' },
  { id: 'lftx', variable: 'LFTX', level: '500-1000 mb', product: 'wrfsfc', fetch: false, units: 'K', rationale: 'Surface lifted index. Inventoried; best lifted index is the one fetched.' },
  { id: 'prate', variable: 'PRATE', level: 'surface', product: 'wrfsfc', fetch: true, units: 'mm/hr', convert: 'prate-mmhr', rationale: 'Model precipitation rate at the environment valid time. Shows whether HRRR itself was raining.' },
  { id: 'refc-hourly', variable: 'REFC', level: 'entire atmosphere', product: 'wrfsfc', fetch: true, units: 'dBZ', rationale: 'Hourly composite reflectivity. Compared with sub-hourly steps for model tendency. Not blended into the ensemble.' },
  { id: 'crain', variable: 'CRAIN', level: 'surface', product: 'wrfsfc', fetch: true, units: '0/1', rationale: 'Categorical rain flag. A coarse yes/no from the same file.' },
  { id: 'relv-1km', variable: 'RELV', level: '1000-0 m above ground', product: 'wrfsfc', fetch: true, units: 'm/s', rationale: 'Hourly maximum vertical velocity in the lowest 1 km. The lift field that is actually in the surface file.' },
  { id: 'hlcy-1km', variable: 'HLCY', level: '1000-0 m above ground', product: 'wrfsfc', fetch: false, units: 'm2/s2', rationale: 'Storm-relative helicity. Organizes severe storms. Not a reason a radar echo grows. About 1.9 MB.' },
  { id: 'vucsh-1km', variable: 'VUCSH', level: '0-1000 m above ground', product: 'wrfsfc', fetch: false, units: '1/s', rationale: 'Bulk shear. Same reason as helicity, and about 2.4 MB.' },
  { id: 'vvcsh-1km', variable: 'VVCSH', level: '0-1000 m above ground', product: 'wrfsfc', fetch: false, units: '1/s', rationale: 'Bulk shear, v component. Not fetched.' },
  { id: 'ugrd-10m', variable: 'UGRD', level: '10 m above ground', product: 'wrfsfc', fetch: false, units: 'm/s', rationale: 'Would support a convergence estimate only together with VGRD. About 2.4 MB each.' },
  { id: 'vgrd-10m', variable: 'VGRD', level: '10 m above ground', product: 'wrfsfc', fetch: false, units: 'm/s', rationale: 'Paired with UGRD. Not fetched.' },
  { id: 'uphl', variable: 'UPHL', level: '5000-2000 m above ground', product: 'wrfsubhf', fetch: true, units: 'm2/s2', rationale: 'Updraft helicity on the sub-hourly file. Small message. Checked because it is cheap, not because rotation is the growth question.' },
  { id: 'refc-subhourly', variable: 'REFC', level: 'entire atmosphere', product: 'wrfsubhf', fetch: true, units: 'dBZ', rationale: 'Sub-hourly reflectivity near issue time and 30 minutes earlier, for model tendency before the burst.' },
];

export function cycleForIssue(issuedAtMs: number): { run: Date; forecastHour: number; validAt: string } {
  const latest = new Date(issuedAtMs - PUBLISH_LAG_MIN * 60_000);
  latest.setUTCMinutes(0, 0, 0);
  const ageMin = (issuedAtMs - latest.getTime()) / 60_000;
  const forecastHour = Math.max(0, Math.floor(ageMin / 60));
  const valid = new Date(latest.getTime() + forecastHour * 3_600_000);
  return { run: latest, forecastHour, validAt: valid.toISOString() };
}

export function subhourlyMinutes(issuedAtMs: number, run: Date): { atIssue: number; earlier: number } {
  const ageMin = (issuedAtMs - run.getTime()) / 60_000;
  const atIssue = Math.max(15, Math.floor(ageMin / 15) * 15);
  return { atIssue, earlier: Math.max(15, atIssue - 30) };
}

function runKey(run: Date): { day: string; hour: string } {
  const iso = run.toISOString();
  return { day: `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}`, hour: iso.slice(11, 13) };
}

export function surfaceFile(run: Date, forecastHour: number): string {
  const { day, hour } = runKey(run);
  return `${BUCKET}/hrrr.${day}/conus/hrrr.t${hour}z.wrfsfcf${String(forecastHour).padStart(2, '0')}.grib2`;
}

export function subhourlyFile(run: Date, minute: number): string {
  const { day, hour } = runKey(run);
  const fileIndex = Math.max(1, Math.ceil(minute / 60));
  return `${BUCKET}/hrrr.${day}/conus/hrrr.t${hour}z.wrfsubhf${String(fileIndex).padStart(2, '0')}.grib2`;
}

type IndexRow = { variable: string; level: string; forecast: string; offset: number; next: number | null };

async function readIndex(url: string): Promise<{ rows: IndexRow[]; bytes: number }> {
  const started = Date.now();
  const res = await fetch(`${url}.idx`);
  if (!res.ok) throw new Error(`Index unavailable: ${url}.idx`);
  const text = await res.text();
  const entries = parseGribIndex(text) as Array<{ var?: string; level?: string; forecastTime?: string; offset: number }>;
  const rows = entries.map((entry, index) => ({
    variable: entry.var ?? '',
    level: entry.level ?? '',
    forecast: entry.forecastTime ?? '',
    offset: entry.offset,
    next: entries[index + 1]?.offset ?? null,
  }));
  return { rows, bytes: Date.now() - started };
}

function matchRow(rows: IndexRow[], variable: string, level: string, forecastIncludes?: string): IndexRow | null {
  return (
    rows.find((row) => row.variable === variable && row.level === level && (forecastIncludes == null || row.forecast.startsWith(forecastIncludes))) ??
    null
  );
}

const grids = new Map<string, { grid: Grid; bytes: number; ms: number }>();

function normalizeProj(proj: string): string {
  const parts = proj.trim().split(/\s+/).map((token) => (token.startsWith('+') ? token : `+${token}`));
  return `${parts.join(' ')} +units=m +no_defs`;
}

async function loadMessage(url: string, row: IndexRow): Promise<{ grid: Grid; bytes: number; ms: number }> {
  const key = `${url}:${row.offset}`;
  const cached = grids.get(key);
  if (cached) return cached;
  let end = row.next != null ? row.next - 1 : row.offset + 4_000_000;
  if (row.next == null) {
    const head = await fetch(url, { method: 'HEAD' });
    const length = Number(head.headers.get('content-length'));
    if (Number.isFinite(length) && length > row.offset) end = length - 1;
  }
  const started = Date.now();
  const res = await fetch(url, { headers: { Range: `bytes=${row.offset}-${end}` } });
  if (!res.ok && res.status !== 206) throw new Error(`Range fetch failed ${res.status}`);
  const bytes = Number(res.headers.get('content-length')) || end - row.offset + 1;
  const message = parseMessagesFromBuffer(new Uint8Array(await res.arrayBuffer()))[0];
  if (!message) throw new Error('No GRIB message');
  const { rows, cols } = message.gridShape;
  const ll = message.latlng;
  const grid: Grid = {
    values: message.data,
    rows,
    cols,
    proj: message.proj,
    lat0: ll.latitude[0],
    lon0: ll.longitude[0] > 180 ? ll.longitude[0] - 360 : ll.longitude[0],
  };
  const loaded = { grid, bytes, ms: Date.now() - started };
  grids.set(key, loaded);
  return loaded;
}

function convert(value: number | null, kind?: EnvCandidate['convert']): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (kind === 'kelvin-c') return value > 100 ? value - 273.15 : value;
  if (kind === 'prate-mmhr') return value * 3600;
  return value;
}

function nearby(grid: Grid, latitude: number, longitude: number, radiusKm: number, kind?: EnvCandidate['convert']) {
  const point = convert(sampleGridAt(grid, latitude, longitude), kind);
  const toGrid = proj4(WGS84, normalizeProj(grid.proj));
  const origin = toGrid.forward([grid.lon0, grid.lat0]);
  const [gx, gy] = toGrid.forward([longitude, latitude]);
  const i0 = Math.round((gx - origin[0]) / DX);
  const j0 = Math.round((gy - origin[1]) / DX);
  const reach = Math.ceil((radiusKm * 1000) / DX);
  const values: number[] = [];
  for (let j = j0 - reach; j <= j0 + reach; j += 1) {
    for (let i = i0 - reach; i <= i0 + reach; i += 1) {
      if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) continue;
      if ((i - i0) ** 2 + (j - j0) ** 2 > reach * reach) continue;
      const converted = convert(grid.values[j * grid.cols + i], kind);
      if (converted != null && Number.isFinite(converted)) values.push(converted);
    }
  }
  const nearbyMean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const nearbyMax = values.length ? Math.max(...values) : null;
  return { point, nearbyMean, nearbyMax };
}

export type FieldCost = { id: string; bytes: number | null; ms: number; fetched: boolean };

export async function sampleEnvironment(args: {
  latitude: number;
  longitude: number;
  issuedAtMs: number;
  radiusKm?: number;
}): Promise<{ values: EnvironmentValue[]; costs: FieldCost[]; run: string; validAt: string; error: string | null }> {
  const radiusKm = args.radiusKm ?? 50;
  const cycle = cycleForIssue(args.issuedAtMs);
  const costs: FieldCost[] = [];
  const values: EnvironmentValue[] = [];
  try {
    const surfaceUrl = surfaceFile(cycle.run, cycle.forecastHour);
    const surface = await readIndex(surfaceUrl);
    const minutes = subhourlyMinutes(args.issuedAtMs, cycle.run);
    const subUrl = subhourlyFile(cycle.run, minutes.atIssue);
    const earlierUrl = subhourlyFile(cycle.run, minutes.earlier);
    const sub = await readIndex(subUrl);
    const earlier = earlierUrl === subUrl ? sub : await readIndex(earlierUrl);

    for (const candidate of ENV_CANDIDATES) {
      const table = candidate.product === 'wrfsfc' ? surface.rows : sub.rows;
      const row = matchRow(table, candidate.variable, candidate.level, candidate.product === 'wrfsubhf' && candidate.id !== 'refc-subhourly' ? `${minutes.atIssue} min` : undefined);
      const bytes = row && row.next != null ? row.next - row.offset : null;
      if (!candidate.fetch || !row) {
        costs.push({ id: candidate.id, bytes, ms: 0, fetched: false });
        continue;
      }
      if (candidate.id === 'refc-subhourly') {
        const at = matchRow(sub.rows, 'REFC', 'entire atmosphere', `${minutes.atIssue} min`);
        const before = matchRow(earlier.rows, 'REFC', 'entire atmosphere', `${minutes.earlier} min`);
        for (const [label, found, url, validMinute] of [
          ['refc-at-issue', at, subUrl, minutes.atIssue],
          ['refc-30min-earlier', before, earlierUrl, minutes.earlier],
        ] as const) {
          if (!found) {
            costs.push({ id: label, bytes: null, ms: 0, fetched: false });
            continue;
          }
          try {
            const loaded = await loadMessage(url, found);
            const summary = nearby(loaded.grid, args.latitude, args.longitude, radiusKm);
            costs.push({ id: label, bytes: loaded.bytes, ms: loaded.ms, fetched: true });
            values.push({
              id: label,
              variable: 'REFC',
              level: 'entire atmosphere',
              product: 'wrfsubhf',
              validAt: new Date(cycle.run.getTime() + validMinute * 60_000).toISOString(),
              units: 'dBZ',
              ...summary,
              radiusKm,
            });
          } catch (error) {
            costs.push({ id: label, bytes: found.next != null ? found.next - found.offset : null, ms: 0, fetched: false });
            console.error(`skip ${label}: ${error instanceof Error ? error.message : error}`);
          }
        }
        continue;
      }
      const messageUrl = candidate.product === 'wrfsfc' ? surfaceUrl : subUrl;
      let loaded: { grid: Grid; bytes: number; ms: number };
      try {
        loaded = await loadMessage(messageUrl, row);
      } catch (error) {
        costs.push({ id: candidate.id, bytes, ms: 0, fetched: false });
        console.error(`skip ${candidate.id}: ${error instanceof Error ? error.message : error}`);
        continue;
      }
      const summary = nearby(loaded.grid, args.latitude, args.longitude, radiusKm, candidate.convert);
      costs.push({ id: candidate.id, bytes: loaded.bytes, ms: loaded.ms, fetched: true });
      values.push({
        id: candidate.id,
        variable: candidate.variable,
        level: candidate.level,
        product: candidate.product,
        validAt: cycle.validAt,
        units: candidate.units,
        ...summary,
        radiusKm,
      });
    }
    return { values, costs, run: cycle.run.toISOString(), validAt: cycle.validAt, error: null };
  } catch (error) {
    return {
      values,
      costs,
      run: cycle.run.toISOString(),
      validAt: cycle.validAt,
      error: error instanceof Error ? error.message : 'environment failed',
    };
  }
}

export function inventoryFromCosts(costs: readonly FieldCost[]) {
  return ENV_CANDIDATES.map((candidate) => {
    const cost = costs.find((item) => item.id === candidate.id || (candidate.id === 'refc-subhourly' && item.id === 'refc-at-issue'));
    return {
      id: candidate.id,
      variable: candidate.variable,
      level: candidate.level,
      product: candidate.product,
      bytes: cost?.bytes ?? null,
      fetched: candidate.fetch,
      rationale: candidate.rationale,
    };
  });
}

/**
 * No combined score. The sample is too small to weight these fields,
 * and a screen was not fitted to Atlanta or Marietta.
 */
export function vulnerabilityScore(): null {
  return null;
}

/** One-time 10 m wind convergence. Not part of the default fetch: each component is about 2.4 MB. */
export async function sampleConvergence(args: {
  latitude: number;
  longitude: number;
  issuedAtMs: number;
}): Promise<{ convergencePerSec: number | null; bytes: number; ms: number } | null> {
  const cycle = cycleForIssue(args.issuedAtMs);
  const url = surfaceFile(cycle.run, cycle.forecastHour);
  const index = await readIndex(url);
  const u = matchRow(index.rows, 'UGRD', '10 m above ground');
  const v = matchRow(index.rows, 'VGRD', '10 m above ground');
  if (!u || !v) return null;
  const started = Date.now();
  const ug = await loadMessage(url, u);
  const vg = await loadMessage(url, v);
  const toGrid = proj4(WGS84, normalizeProj(ug.grid.proj));
  const origin = toGrid.forward([ug.grid.lon0, ug.grid.lat0]);
  const [gx, gy] = toGrid.forward([args.longitude, args.latitude]);
  const i = Math.round((gx - origin[0]) / DX);
  const j = Math.round((gy - origin[1]) / DX);
  const at = (grid: Grid, ii: number, jj: number) => {
    if (ii < 0 || jj < 0 || ii >= grid.cols || jj >= grid.rows) return null;
    const value = grid.values[jj * grid.cols + ii];
    return Number.isFinite(value) ? value : null;
  };
  const uEast = at(ug.grid, i + 1, j);
  const uWest = at(ug.grid, i - 1, j);
  const vNorth = at(vg.grid, i, j + 1);
  const vSouth = at(vg.grid, i, j - 1);
  if (uEast == null || uWest == null || vNorth == null || vSouth == null) {
    return { convergencePerSec: null, bytes: ug.bytes + vg.bytes, ms: Date.now() - started };
  }
  const divergence = (uEast - uWest) / (2 * DX) + (vNorth - vSouth) / (2 * DX);
  return { convergencePerSec: -divergence, bytes: ug.bytes + vg.bytes, ms: ug.ms + vg.ms };
}
