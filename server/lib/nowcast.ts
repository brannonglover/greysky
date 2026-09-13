import { PNG } from 'pngjs';

import { WMS_BASE, LAYER, type ObservedFrame } from './mrms';

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
const MOTION_W = 320;
const MOTION_H = 160;
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

type SourceImage = {
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

function tileBounds(z: number, x: number, y: number): { minx: number; miny: number; maxx: number; maxy: number } {
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

function sourceFor(isoTime: string): Promise<SourceImage> {
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

async function estimateMotion(earlier: string, later: string): Promise<{ u: number; v: number }> {
  const [a, b] = await Promise.all([
    getMap(earlier, CONUS, MOTION_W, MOTION_H),
    getMap(later, CONUS, MOTION_W, MOTION_H),
  ]);
  const before = wetMask(a, MOTION_W, MOTION_H);
  const after = wetMask(b, MOTION_W, MOTION_H);
  let best = { dx: 0, dy: 0, score: overlap(before, after, MOTION_W, MOTION_H, 0, 0) };
  const max = 8;
  for (let dy = -max; dy <= max; dy += 1) {
    for (let dx = -max; dx <= max; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const score = overlap(before, after, MOTION_W, MOTION_H, dx, dy);
      if (score > best.score) best = { dx, dy, score };
    }
  }
  const dtMin = (Date.parse(later) - Date.parse(earlier)) / 60_000;
  if (!Number.isFinite(dtMin) || dtMin < 4) return { u: 0, v: 0 };
  const metersPerPxX = (CONUS.maxx - CONUS.minx) / MOTION_W;
  const metersPerPxY = (CONUS.maxy - CONUS.miny) / MOTION_H;
  // +dx is east in the image; +dy is south, so northward v flips.
  return { u: (best.dx * metersPerPxX) / dtMin, v: (-best.dy * metersPerPxY) / dtMin };
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

export async function renderNowcastTile(
  isoTime: string,
  u: number,
  v: number,
  leadMin: number,
  z: number,
  x: number,
  y: number,
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
      const color = sample(source, mx - dx, my - dy);
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
