import { PNG } from 'pngjs';

import type { SourceImage } from '../nowcast';
import { nowcastDbzAt } from '../nowcast';

/** Same Web Mercator origin as server/lib/nowcast.ts. The map sampler is not modified. */
const ORIGIN = 20037508.342789244;

export function lonToMerc(lon: number): number {
  return (lon * ORIGIN) / 180;
}

export function latToMerc(lat: number): number {
  const y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  return (y * ORIGIN) / 180;
}

/**
 * Where the current advection tile looks up the source pixel.
 * Eastward `u` and northward `v` are metres per minute. The future point
 * samples the image behind the motion, matching renderNowcastTile.
 */
export function advectedSourcePoint(
  mx: number,
  my: number,
  u: number,
  v: number,
  leadMin: number,
): { mx: number; my: number } {
  return { mx: mx - u * leadMin, my: my - v * leadMin };
}

/** Bilinear dBZ sample of one advected frame. Null is outside the image, not dry. */
export function sampleAdvectedDbz(
  source: SourceImage,
  latitude: number,
  longitude: number,
  u: number,
  v: number,
  leadMin: number,
): number | null {
  const shifted = advectedSourcePoint(lonToMerc(longitude), latToMerc(latitude), u, v, leadMin);
  return nowcastDbzAt(source, shifted.mx, shifted.my, 'bilinear');
}

export function paintedSource(
  latitude: number,
  longitude: number,
  rgba: [number, number, number, number],
): SourceImage {
  const png = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < png.width * png.height; i += 1) {
    const o = i * 4;
    png.data[o] = rgba[0];
    png.data[o + 1] = rgba[1];
    png.data[o + 2] = rgba[2];
    png.data[o + 3] = rgba[3];
  }
  const mx = lonToMerc(longitude);
  const my = latToMerc(latitude);
  const pad = 20_000;
  return { png, minx: mx - pad, miny: my - pad, maxx: mx + pad, maxy: my + pad };
}
