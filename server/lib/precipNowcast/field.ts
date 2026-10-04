import { PNG } from 'pngjs';

import { dbzForColor } from '../palette';
import { dbzToRainRate } from '../reflectivity';

/** Styled composite drew nothing. This is not a measured rain rate of 0. */
export const CELL_EMPTY = 1;
/** Request, decode, or coverage failure. Not dry weather. */
export const CELL_MISSING = 0;
/** Palette recovered a reflectivity and a rain rate. */
export const CELL_VALUE = 2;

export type CellState = typeof CELL_MISSING | typeof CELL_EMPTY | typeof CELL_VALUE;

/**
 * Local equirectangular grid. Row 0 is north. Column 0 is west.
 * Motion code only needs pixel size in metres; a future precip-rate grid can
 * supply the same shape without changing the solver.
 */
export type FieldGeometry = {
  kind: 'equirectangular';
  west: number;
  north: number;
  dLon: number;
  dLat: number;
  width: number;
  height: number;
  metersPerPixelX: number;
  metersPerPixelY: number;
};

export type FieldSource = {
  id: string;
  product: string;
};

export type ObservationField = {
  validAt: string;
  geometry: FieldGeometry;
  /** NaN unless state is CELL_VALUE. Empty and missing stay NaN. */
  rainRateMmHr: Float32Array;
  state: Uint8Array;
  source: FieldSource;
};

export type FieldSample = {
  rainRateMmHr: number | null;
  echoWeight: number;
  emptyWeight: number;
  missingWeight: number;
};

const METRES_PER_DEG_LAT = 110_540;

export function metersPerDegreeLon(latitude: number): number {
  return 111_320 * Math.cos((latitude * Math.PI) / 180);
}

export function regionGeometry(
  latitude: number,
  longitude: number,
  spanDeg: number,
  width: number,
  height: number,
): FieldGeometry {
  const west = longitude - spanDeg / 2;
  const north = latitude + spanDeg / 2;
  const dLon = spanDeg / width;
  const dLat = spanDeg / height;
  return {
    kind: 'equirectangular',
    west,
    north,
    dLon,
    dLat,
    width,
    height,
    metersPerPixelX: metersPerDegreeLon(latitude) * dLon,
    metersPerPixelY: METRES_PER_DEG_LAT * dLat,
  };
}

export function emptyField(validAt: string, geometry: FieldGeometry, source: FieldSource): ObservationField {
  const n = geometry.width * geometry.height;
  const rainRateMmHr = new Float32Array(n);
  rainRateMmHr.fill(Number.NaN);
  return {
    validAt,
    geometry,
    rainRateMmHr,
    state: new Uint8Array(n),
    source,
  };
}

export function pixelOf(geometry: FieldGeometry, latitude: number, longitude: number): { x: number; y: number } {
  return {
    x: (longitude - geometry.west) / geometry.dLon - 0.5,
    y: (geometry.north - latitude) / geometry.dLat - 0.5,
  };
}

export function index(geometry: FieldGeometry, x: number, y: number): number {
  return y * geometry.width + x;
}

/** Bilinear rain-rate sample. Missing neighbors are left out. Empty neighbors count as observed absence, not as a stored 0. */
export function sampleField(field: ObservationField, x: number, y: number): FieldSample {
  const { width, height } = field.geometry;
  if (x < -0.5 || y < -0.5 || x > width - 0.5 || y > height - 0.5) {
    return { rainRateMmHr: null, echoWeight: 0, emptyWeight: 0, missingWeight: 1 };
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  let echo = 0;
  let empty = 0;
  let missing = 0;
  let rateSum = 0;
  const corners = [
    [x0, y0, (1 - tx) * (1 - ty)],
    [x0 + 1, y0, tx * (1 - ty)],
    [x0, y0 + 1, (1 - tx) * ty],
    [x0 + 1, y0 + 1, tx * ty],
  ] as const;
  for (const [cx, cy, weight] of corners) {
    if (weight <= 0) continue;
    if (cx < 0 || cy < 0 || cx >= width || cy >= height) {
      missing += weight;
      continue;
    }
    const i = cy * width + cx;
    const state = field.state[i];
    if (state === CELL_VALUE) {
      echo += weight;
      rateSum += field.rainRateMmHr[i] * weight;
    } else if (state === CELL_EMPTY) {
      empty += weight;
    } else {
      missing += weight;
    }
  }
  const observed = echo + empty;
  if (observed < 0.5) {
    return { rainRateMmHr: null, echoWeight: echo, emptyWeight: empty, missingWeight: missing };
  }
  return {
    rainRateMmHr: rateSum / observed,
    echoWeight: echo,
    emptyWeight: empty,
    missingWeight: missing,
  };
}

export function paintGaussian(
  field: ObservationField,
  cx: number,
  cy: number,
  sigma: number,
  peakMmHr: number,
): void {
  const { width, height } = field.geometry;
  const radius = sigma * 3;
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(height - 1, Math.ceil(cy + radius)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(width - 1, Math.ceil(cx + radius)); x += 1) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      const rate = peakMmHr * Math.exp(-d2 / (2 * sigma * sigma));
      if (rate < 0.05) continue;
      const i = y * width + x;
      field.state[i] = CELL_VALUE;
      field.rainRateMmHr[i] = rate;
    }
  }
}

/** Feature motion: positive dxPx is east, positive dyPx is south. Fractional shifts are bilinear. */
export function shiftField(source: ObservationField, dxPx: number, dyPx: number): ObservationField {
  const next = emptyField(source.validAt, source.geometry, source.source);
  const { width, height } = source.geometry;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sample = sampleField(source, x - dxPx, y - dyPx);
      const i = y * width + x;
      if (sample.rainRateMmHr == null) {
        next.state[i] = CELL_MISSING;
        continue;
      }
      if (sample.echoWeight < 0.05) {
        next.state[i] = CELL_EMPTY;
        continue;
      }
      next.state[i] = CELL_VALUE;
      next.rainRateMmHr[i] = sample.rainRateMmHr;
    }
  }
  return next;
}

export function scaleValues(source: ObservationField, factor: number): ObservationField {
  const next = emptyField(source.validAt, source.geometry, source.source);
  next.state.set(source.state);
  for (let i = 0; i < source.rainRateMmHr.length; i += 1) {
    if (source.state[i] === CELL_VALUE) next.rainRateMmHr[i] = source.rainRateMmHr[i] * factor;
  }
  return next;
}

/**
 * Styled MRMS composite. Transparent and off-palette pixels stay empty or
 * missing. They are never written as 0 mm/hr. A failed image is an all-missing field.
 */
export function fieldFromPng(
  png: PNG,
  validAt: string,
  geometry: FieldGeometry,
  source: FieldSource,
): ObservationField {
  const field = emptyField(validAt, geometry, source);
  const { width, height } = geometry;
  if (png.width !== width || png.height !== height) {
    field.state.fill(CELL_MISSING);
    return field;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      const alpha = png.data[o + 3];
      const i = y * width + x;
      if (alpha < 24) {
        field.state[i] = CELL_EMPTY;
        continue;
      }
      const dbz = dbzForColor(png.data[o], png.data[o + 1], png.data[o + 2], alpha);
      if (dbz == null) {
        field.state[i] = CELL_MISSING;
        continue;
      }
      field.state[i] = CELL_VALUE;
      field.rainRateMmHr[i] = dbzToRainRate(dbz);
    }
  }
  return field;
}

/** Solver view. Empty becomes a local background of 0. Missing stays NaN. The field itself is not modified. */
export function flowRates(field: ObservationField): Float32Array {
  const out = new Float32Array(field.rainRateMmHr.length);
  out.fill(Number.NaN);
  for (let i = 0; i < field.state.length; i += 1) {
    if (field.state[i] === CELL_VALUE) out[i] = field.rainRateMmHr[i];
    else if (field.state[i] === CELL_EMPTY) out[i] = 0;
  }
  return out;
}
