import { PNG } from 'pngjs';
import proj4 from 'proj4';

import type { Grid } from './hrrr';
import { colorForDbz } from './palette';

export const TILE_SIZE = 256;
/** HRRR CONUS grid spacing, metres. */
const DX = 3000;
const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';

/**
 * gribberish emits its proj string with most parameters missing the leading
 * '+' (e.g. "+proj=lcc lon_0=262.5 lat_0=38.5"), which proj4 cannot tokenize.
 */
function normalizeProj(proj: string): string {
  const parts = proj.trim().split(/\s+/).map((token) => (token.startsWith('+') ? token : `+${token}`));
  return `${parts.join(' ')} +units=m +no_defs`;
}

function tileToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

function tileToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * A reusable nearest-cell sampler for one grid. Builds the projection once,
 * which matters because tiles sample it 65,536 times.
 *
 * Returns null for coordinates OUTSIDE the grid — that is "no data", which
 * callers must not confuse with an in-grid value below the reflectivity floor
 * ("no precipitation").
 */
export function gridSampler(grid: Grid): (latitude: number, longitude: number) => number | null {
  const toGrid = proj4(WGS84, normalizeProj(grid.proj));
  const origin = toGrid.forward([grid.lon0, grid.lat0]);
  return (latitude, longitude) => {
    const [gx, gy] = toGrid.forward([longitude, latitude]);
    const i = Math.round((gx - origin[0]) / DX);
    const j = Math.round((gy - origin[1]) / DX);
    if (i < 0 || i >= grid.cols || j < 0 || j >= grid.rows) return null;
    return grid.values[j * grid.cols + i];
  };
}

/** Nearest-cell reflectivity at a coordinate, or null when outside the grid. */
export function sampleGridAt(grid: Grid, latitude: number, longitude: number): number | null {
  const toGrid = proj4(WGS84, normalizeProj(grid.proj));
  const origin = toGrid.forward([grid.lon0, grid.lat0]);
  const [gx, gy] = toGrid.forward([longitude, latitude]);
  const i = Math.round((gx - origin[0]) / DX);
  const j = Math.round((gy - origin[1]) / DX);
  if (i < 0 || i >= grid.cols || j < 0 || j >= grid.rows) return null;
  return grid.values[j * grid.cols + i];
}

export function renderTile(grid: Grid, z: number, x: number, y: number): Buffer {
  const toGrid = proj4(WGS84, normalizeProj(grid.proj));
  const origin = toGrid.forward([grid.lon0, grid.lat0]);
  const png = new PNG({ width: TILE_SIZE, height: TILE_SIZE });

  // Mercator is separable, so latitude only depends on the pixel row.
  const lons = new Float64Array(TILE_SIZE);
  for (let px = 0; px < TILE_SIZE; px++) lons[px] = tileToLon(x + (px + 0.5) / TILE_SIZE, z);

  for (let py = 0; py < TILE_SIZE; py++) {
    const lat = tileToLat(y + (py + 0.5) / TILE_SIZE, z);
    for (let px = 0; px < TILE_SIZE; px++) {
      const [gx, gy] = toGrid.forward([lons[px], lat]);
      const i = Math.round((gx - origin[0]) / DX);
      const j = Math.round((gy - origin[1]) / DX);
      if (i < 0 || i >= grid.cols || j < 0 || j >= grid.rows) continue;
      const color = colorForDbz(grid.values[j * grid.cols + i]);
      if (!color) continue;
      const o = (py * TILE_SIZE + px) * 4;
      png.data[o] = color[0];
      png.data[o + 1] = color[1];
      png.data[o + 2] = color[2];
      png.data[o + 3] = color[3];
    }
  }

  return PNG.sync.write(png);
}

/**
 * Blend two HRRR grids from the same run and render the result.
 * `t` is 0–1: 0 = pure gridA, 1 = pure gridB.
 */
export function renderBlendedTile(
  gridA: Grid,
  gridB: Grid,
  t: number,
  z: number,
  x: number,
  y: number,
): Buffer {
  const toGrid = proj4(WGS84, normalizeProj(gridA.proj));
  const origin = toGrid.forward([gridA.lon0, gridA.lat0]);
  const png = new PNG({ width: TILE_SIZE, height: TILE_SIZE });

  const lons = new Float64Array(TILE_SIZE);
  for (let px = 0; px < TILE_SIZE; px++) lons[px] = tileToLon(x + (px + 0.5) / TILE_SIZE, z);

  const s = 1 - t;
  for (let py = 0; py < TILE_SIZE; py++) {
    const lat = tileToLat(y + (py + 0.5) / TILE_SIZE, z);
    for (let px = 0; px < TILE_SIZE; px++) {
      const [gx, gy] = toGrid.forward([lons[px], lat]);
      const i = Math.round((gx - origin[0]) / DX);
      const j = Math.round((gy - origin[1]) / DX);
      if (i < 0 || i >= gridA.cols || j < 0 || j >= gridA.rows) continue;
      const idx = j * gridA.cols + i;
      const blended = s * gridA.values[idx] + t * gridB.values[idx];
      const color = colorForDbz(blended);
      if (!color) continue;
      const o = (py * TILE_SIZE + px) * 4;
      png.data[o] = color[0];
      png.data[o + 1] = color[1];
      png.data[o + 2] = color[2];
      png.data[o + 3] = color[3];
    }
  }

  return PNG.sync.write(png);
}
