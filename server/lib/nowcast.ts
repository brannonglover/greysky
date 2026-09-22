import { PNG } from 'pngjs';

import { WMS_BASE, LAYER, type ObservedFrame } from './mrms';
import { colorForDbz, dbzForColor } from './palette';

const ORIGIN = 20037508.342789244;
const TILE_SIZE = 256;
/** CONUS in Web Mercator — west of the Rockies through Maine, Gulf to Canada. */
const CONUS = {
  minx: lonToMerc(-125),
  maxx: lonToMerc(-66),
  miny: latToMerc(24),
  maxy: latToMerc(50),
};
const SOURCE_W = 1600;
const SOURCE_H = 800;
/**
 * Motion is estimated on this grid. It must be fine enough that the echo
 * actually moves more than a pixel over MOTION_LOOKBACK_MIN, or the integer
 * shift search resolves nothing and reports zero motion.
 *
 * At 320x160 a CONUS pixel is ~20 km, so 40 minutes of a typical 20-50 km/h
 * storm is well under one pixel and the nowcast silently froze into a static
 * copy of the last observation. At 640x320 (~10 km/px) the same motion spans
 * 1-3 px and is recoverable.
 */
const MOTION_W = 640;
const MOTION_H = 320;
const STEP_MIN = 5;
const MOTION_LOOKBACK_MIN = 40;

export type NowcastFrame = {
  time: number;
  isoTime: string;
  leadMin: number;
  /** Eastward meters per minute in Web Mercator. */
  u: number;
  /** Northward meters per minute in Web Mercator. */
  v: number;
};

export type SourceImage = {
  png: PNG;
  minx: number;
  miny: number;
  maxx: number;
  maxy: number;
};

const sources = new Map<string, Promise<SourceImage>>();

function lonToMerc(lon: number): number {
  return (lon * ORIGIN) / 180;
}

function latToMerc(lat: number): number {
  const y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  return (y * ORIGIN) / 180;
}

export function tileBounds(z: number, x: number, y: number): { minx: number; miny: number; maxx: number; maxy: number } {
  const n = 2 ** z;
  const size = (2 * ORIGIN) / n;
  return {
    minx: x * size - ORIGIN,
    maxx: (x + 1) * size - ORIGIN,
    maxy: ORIGIN - y * size,
    miny: ORIGIN - (y + 1) * size,
  };
}

async function getMap(isoTime: string, bbox: { minx: number; miny: number; maxx: number; maxy: number }, width: number, height: number): Promise<PNG> {
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: LAYER,
    format: 'image/png',
    transparent: 'true',
    crs: 'EPSG:3857',
    bbox: `${bbox.minx},${bbox.miny},${bbox.maxx},${bbox.maxy}`,
    width: String(width),
    height: String(height),
    time: isoTime,
  });
  const res = await fetch(`${WMS_BASE}?${params.toString()}`);
  if (!res.ok) throw new Error(`Nowcast source unavailable (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) {
    throw new Error('Nowcast source was not a PNG');
  }
  return PNG.sync.read(buf);
}

export function sourceFor(isoTime: string): Promise<SourceImage> {
  const hit = sources.get(isoTime);
  if (hit) return hit;
  const pending = getMap(isoTime, CONUS, SOURCE_W, SOURCE_H)
    .then((png) => ({ png, ...CONUS }))
    .catch((error: unknown) => {
      sources.delete(isoTime);
      throw error;
    });
  sources.set(isoTime, pending);
  while (sources.size > 3) {
    const oldest = sources.keys().next().value;
    if (oldest === undefined) break;
    sources.delete(oldest);
  }
  return pending;
}

function wetMask(png: PNG, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(png.height - 1, Math.floor(((y + 0.5) / height) * png.height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(png.width - 1, Math.floor(((x + 0.5) / width) * png.width));
      const a = png.data[(sy * png.width + sx) * 4 + 3];
      if (a > 40) mask[y * width + x] = 1;
    }
  }
  return mask;
}

function overlap(a: Uint8Array, b: Uint8Array, width: number, height: number, dx: number, dy: number): number {
  let hit = 0;
  let union = 0;
  for (let y = 0; y < height; y += 1) {
    const y2 = y + dy;
    if (y2 < 0 || y2 >= height) continue;
    for (let x = 0; x < width; x += 1) {
      const x2 = x + dx;
      if (x2 < 0 || x2 >= width) continue;
      const left = a[y * width + x];
      const right = b[y2 * width + x2];
      if (left || right) union += 1;
      if (left && right) hit += 1;
    }
  }
  return union === 0 ? 0 : hit / union;
}

/** Scaled with the grid so the search covers the same ground distance. */
export const MOTION_MAX_SHIFT = 16;

/** The grid motion is estimated on. Exported so tests pin the real values. */
export const MOTION_GRID = { width: MOTION_W, height: MOTION_H };

/** Metres per pixel of the motion grid, for converting a shift to a velocity. */
export function motionPixelSize(width: number, height: number): { x: number; y: number } {
  return {
    x: (CONUS.maxx - CONUS.minx) / width,
    y: (CONUS.maxy - CONUS.miny) / height,
  };
}

/**
 * Integer shift that best aligns two echo masks.
 *
 * Pure and exported so the regression test can drive it with synthetic storms
 * instead of the network.
 */
export function estimateShift(
  before: Uint8Array,
  after: Uint8Array,
  width: number,
  height: number,
  maxShift: number = MOTION_MAX_SHIFT,
): { dx: number; dy: number; score: number } {
  let best = { dx: 0, dy: 0, score: overlap(before, after, width, height, 0, 0) };
  for (let dy = -maxShift; dy <= maxShift; dy += 1) {
    for (let dx = -maxShift; dx <= maxShift; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const score = overlap(before, after, width, height, dx, dy);
      if (score > best.score) best = { dx, dy, score };
    }
  }
  return best;
}

/** +dx is east in the image; +dy is south, so northward v flips. */
export function shiftToMotion(
  dx: number,
  dy: number,
  width: number,
  height: number,
  dtMin: number,
): { u: number; v: number } {
  const px = motionPixelSize(width, height);
  return { u: (dx * px.x) / dtMin, v: (-dy * px.y) / dtMin };
}

async function estimateMotion(earlier: string, later: string): Promise<{ u: number; v: number }> {
  const [a, b] = await Promise.all([
    getMap(earlier, CONUS, MOTION_W, MOTION_H),
    getMap(later, CONUS, MOTION_W, MOTION_H),
  ]);
  const before = wetMask(a, MOTION_W, MOTION_H);
  const after = wetMask(b, MOTION_W, MOTION_H);
  const best = estimateShift(before, after, MOTION_W, MOTION_H);

  const dtMin = (Date.parse(later) - Date.parse(earlier)) / 60_000;
  if (!Number.isFinite(dtMin) || dtMin < 4) return { u: 0, v: 0 };
  return shiftToMotion(best.dx, best.dy, MOTION_W, MOTION_H, dtMin);
}

/**
 * Future frames that continue the last MRMS image along the motion of the
 * last ~20 minutes, aligned to the :05 grid so past and future timestamps
 * are evenly spaced on the timeline.
 */
export async function nowcastFrames(observed: ObservedFrame[], horizonMin: number, now = Date.now()): Promise<NowcastFrame[]> {
  if (observed.length === 0) return [];
  const latest = observed[observed.length - 1];
  const lookbackMs = MOTION_LOOKBACK_MIN * 60_000;
  const earlier =
    [...observed].reverse().find((frame) => latest.time * 1000 - frame.time * 1000 >= lookbackMs) ?? observed[0];
  const motion =
    earlier.isoTime === latest.isoTime ? { u: 0, v: 0 } : await estimateMotion(earlier.isoTime, latest.isoTime);
  const frames: NowcastFrame[] = [];
  const stepMs = STEP_MIN * 60_000;
  const cutoffMs = now + horizonMin * 60_000;
  const latestMs = Date.parse(latest.isoTime);
  const firstSlot = Math.ceil(now / stepMs) * stepMs;

  for (let slot = firstSlot; slot <= cutoffMs; slot += stepMs) {
    if (slot <= now) continue;
    const lead = Math.round((slot - latestMs) / 60_000);
    if (lead <= 0 || lead > horizonMin + MOTION_LOOKBACK_MIN) continue;
    frames.push({
      time: Math.round(slot / 1000),
      isoTime: latest.isoTime,
      leadMin: lead,
      u: Math.round(motion.u),
      v: Math.round(motion.v),
    });
  }
  return frames;
}

function sample(source: SourceImage, mx: number, my: number): [number, number, number, number] | null {
  const { png, minx, miny, maxx, maxy } = source;
  const u = (mx - minx) / (maxx - minx);
  const v = (maxy - my) / (maxy - miny);
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const px = Math.min(png.width - 1, Math.max(0, Math.round(u * (png.width - 1))));
  const py = Math.min(png.height - 1, Math.max(0, Math.round(v * (png.height - 1))));
  const o = (py * png.width + px) * 4;
  if (png.data[o + 3] < 16) return null;
  return [png.data[o], png.data[o + 1], png.data[o + 2], png.data[o + 3]];
}

/**
 * Reflectivity of the advected MRMS field at a Web Mercator point.
 *
 * Tri-state on purpose:
 *   null -> outside the cached CONUS image: NO DATA
 *   0    -> inside the image, nothing drawn: no precipitation
 *   >0   -> measured reflectivity, recovered through the palette
 *
 * Blending must keep those apart. Treating "no data" as 0 dBZ would quietly
 * halve real echoes wherever only one source covers the pixel.
 *
 * Caveat: inside the CONUS box a transparent pixel means "nothing rendered",
 * which conflates genuine no-precipitation with gaps in radar coverage. The
 * rendered PNG carries no way to tell them apart; recovering that distinction
 * would need the MRMS GRIB2 itself.
 */
export type Sampling = 'nearest' | 'bilinear';

export const DEFAULT_SAMPLING: Sampling = 'bilinear';

/** Reflectivity of one source pixel; 0 where nothing is drawn. */
function dbzAtPixel(png: SourceImage['png'], px: number, py: number): number {
  const o = (py * png.width + px) * 4;
  const alpha = png.data[o + 3];
  if (alpha < 16) return 0;
  // Off-palette pixels are antialiased echo edges, not missing data.
  return dbzForColor(png.data[o], png.data[o + 1], png.data[o + 2], alpha) ?? 0;
}

export function nowcastDbzAt(
  source: SourceImage,
  mx: number,
  my: number,
  sampling: Sampling = DEFAULT_SAMPLING,
): number | null {
  const { png, minx, miny, maxx, maxy } = source;
  const u = (mx - minx) / (maxx - minx);
  const v = (maxy - my) / (maxy - miny);
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;

  const fx = u * (png.width - 1);
  const fy = v * (png.height - 1);

  if (sampling === 'nearest') {
    const px = Math.min(png.width - 1, Math.max(0, Math.round(fx)));
    const py = Math.min(png.height - 1, Math.max(0, Math.round(fy)));
    return dbzAtPixel(png, px, py);
  }

  /*
   * Bilinear, and deliberately on dBZ rather than on colour.
   *
   * Advection shifts the field by well under a pixel per frame at typical
   * zooms (~0.5 px at z6), and nearest-neighbour rounding makes edge pixels
   * flip between neighbouring samples from frame to frame — precipitation
   * shimmers instead of translating. Interpolating moves it continuously.
   *
   * Interpolating the rendered RGBA instead would land between palette
   * entries and invent reflectivities the ramp never meant, so the four
   * neighbours are converted to dBZ first.
   */
  const x0 = Math.min(png.width - 1, Math.max(0, Math.floor(fx)));
  const y0 = Math.min(png.height - 1, Math.max(0, Math.floor(fy)));
  const x1 = Math.min(png.width - 1, x0 + 1);
  const y1 = Math.min(png.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;

  const d00 = dbzAtPixel(png, x0, y0);
  const d10 = dbzAtPixel(png, x1, y0);
  const d01 = dbzAtPixel(png, x0, y1);
  const d11 = dbzAtPixel(png, x1, y1);

  const top = d00 + (d10 - d00) * tx;
  const bottom = d01 + (d11 - d01) * tx;
  return top + (bottom - top) * ty;
}

export async function renderNowcastTile(
  isoTime: string,
  u: number,
  v: number,
  leadMin: number,
  z: number,
  x: number,
  y: number,
  sampling: Sampling = DEFAULT_SAMPLING,
): Promise<Buffer> {
  const source = await sourceFor(isoTime);
  const bbox = tileBounds(z, x, y);
  const png = new PNG({ width: TILE_SIZE, height: TILE_SIZE });
  const dx = u * leadMin;
  const dy = v * leadMin;
  const spanX = bbox.maxx - bbox.minx;
  const spanY = bbox.maxy - bbox.miny;

  for (let py = 0; py < TILE_SIZE; py += 1) {
    const my = bbox.maxy - ((py + 0.5) / TILE_SIZE) * spanY;
    for (let px = 0; px < TILE_SIZE; px += 1) {
      const mx = bbox.minx + ((px + 0.5) / TILE_SIZE) * spanX;
      const dbz = nowcastDbzAt(source, mx - dx, my - dy, sampling);
      if (dbz === null) continue;
      const color = colorForDbz(dbz);
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
