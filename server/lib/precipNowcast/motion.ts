/**
 * Block pyramidal Lucas-Kanade on rain rate.
 *
 * Velocity is metres per second, east and north, divided by the real dt of
 * each frame pair. A flat patch is unknown, not a stored zero. A measured
 * zero (stationary echo with texture) stays a solved vector.
 *
 * Each block is mean-normalised before the solve so a uniform brightening
 * does not masquerade as motion. Evolution is estimated afterwards, from the
 * residual of this alignment.
 */

import { flowRates, type ObservationField } from './field';

export const MOTION = {
  blockPx: 16,
  stepPx: 8,
  minSupport: 20,
  /** Mean structure-tensor eigenvalue inside the block, (mm/hr per pixel)^2. */
  minMeanEigenvalue: 0.002,
  maxResidual: 0.55,
  maxPairSec: 300,
  minPairSec: 30,
  fallbackRadiusPx: 72,
  minPrevailing: 3,
  pyramidLevels: 3,
} as const;

export type VectorSource = 'solved' | 'nearby' | 'prevailing' | 'unknown';

export type MotionVector = {
  eastMs: number;
  northMs: number;
  quality: number;
  support: number;
  minEigenvalue: number;
  residual: number;
  source: VectorSource;
};

export type MotionField = {
  columns: number;
  rows: number;
  vectors: MotionVector[];
  pairsUsed: number;
  pairsRejected: number;
  pairDtSec: number[];
};

export type VectorError = {
  speedErrorMs: number;
  directionErrorDeg: number | null;
  estimated: { eastMs: number; northMs: number };
  source: VectorSource;
  quality: number;
};

type Grid = { rate: Float32Array; width: number; height: number };

function unknownVector(): MotionVector {
  return {
    eastMs: Number.NaN,
    northMs: Number.NaN,
    quality: 0,
    support: 0,
    minEigenvalue: 0,
    residual: Number.NaN,
    source: 'unknown',
  };
}

function downsample(grid: Grid): Grid {
  const width = Math.floor(grid.width / 2);
  const height = Math.floor(grid.height / 2);
  const rate = new Float32Array(width * height);
  rate.fill(Number.NaN);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let n = 0;
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const value = grid.rate[(y * 2 + dy) * grid.width + (x * 2 + dx)];
          if (Number.isFinite(value)) {
            sum += value;
            n += 1;
          }
        }
      }
      if (n > 0) rate[y * width + x] = sum / n;
    }
  }
  return { rate, width, height };
}

function pyramid(grid: Grid, levels: number): Grid[] {
  const out = [grid];
  while (out.length < levels) {
    const last = out[out.length - 1];
    if (last.width < 24 || last.height < 24) break;
    out.push(downsample(last));
  }
  return out;
}

function sample(grid: Grid, x: number, y: number): number | null {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  let sum = 0;
  let weight = 0;
  const corners = [
    [x0, y0, (1 - tx) * (1 - ty)],
    [x0 + 1, y0, tx * (1 - ty)],
    [x0, y0 + 1, (1 - tx) * ty],
    [x0 + 1, y0 + 1, tx * ty],
  ] as const;
  for (const [cx, cy, w] of corners) {
    if (w <= 0 || cx < 0 || cy < 0 || cx >= grid.width || cy >= grid.height) continue;
    const value = grid.rate[cy * grid.width + cx];
    if (!Number.isFinite(value)) continue;
    sum += value * w;
    weight += w;
  }
  if (weight < 0.5) return null;
  return sum / weight;
}

function solve(a00: number, a01: number, a11: number, b0: number, b1: number): { x: number; y: number } | null {
  const det = a00 * a11 - a01 * a01;
  if (!(Math.abs(det) > 1e-8)) return null;
  return { x: (a11 * b0 - a01 * b1) / det, y: (a00 * b1 - a01 * b0) / det };
}

function refine(
  earlier: Grid,
  later: Grid,
  x0: number,
  y0: number,
  block: number,
  guessX: number,
  guessY: number,
): { vx: number; vy: number; support: number; minEigenvalue: number; residual: number } | null {
  let vx = guessX;
  let vy = guessY;
  let support = 0;
  let minEigenvalue = 0;
  let residual = Number.POSITIVE_INFINITY;
  const xStart = Math.max(1, Math.round(x0 - block / 2));
  const yStart = Math.max(1, Math.round(y0 - block / 2));
  const xEnd = Math.min(later.width - 2, Math.round(x0 + block / 2));
  const yEnd = Math.min(later.height - 2, Math.round(y0 + block / 2));

  for (let iteration = 0; iteration < 8; iteration += 1) {
    let mean1 = 0;
    let mean2 = 0;
    let count = 0;
    for (let y = yStart; y <= yEnd; y += 1) {
      for (let x = xStart; x <= xEnd; x += 1) {
        const i2 = later.rate[y * later.width + x];
        const i1 = sample(earlier, x - vx, y - vy);
        if (!Number.isFinite(i2) || i1 == null) continue;
        mean1 += i1;
        mean2 += i2;
        count += 1;
      }
    }
    if (count < MOTION.minSupport) return null;
    mean1 /= count;
    mean2 /= count;
    const scale1 = Math.abs(mean1) > 0.2 ? mean1 : 1;
    const scale2 = Math.abs(mean2) > 0.2 ? mean2 : 1;

    let a00 = 0;
    let a01 = 0;
    let a11 = 0;
    let b0 = 0;
    let b1 = 0;
    let absIt = 0;
    support = 0;
    for (let y = yStart; y <= yEnd; y += 1) {
      for (let x = xStart; x <= xEnd; x += 1) {
        const i2raw = later.rate[y * later.width + x];
        const sx = x - vx;
        const sy = y - vy;
        const i1raw = sample(earlier, sx, sy);
        const i1x = sample(earlier, sx + 1, sy);
        const i1xm = sample(earlier, sx - 1, sy);
        const i1y = sample(earlier, sx, sy + 1);
        const i1ym = sample(earlier, sx, sy - 1);
        if (i1raw == null || i1x == null || i1xm == null || i1y == null || i1ym == null || !Number.isFinite(i2raw)) {
          continue;
        }
        const ix = (i1x - i1xm) / (2 * scale1);
        const iy = (i1y - i1ym) / (2 * scale1);
        // I2(x) ≈ I1(x - u). The residual is I1 - I2, so a positive solve is feature motion.
        const it = i1raw / scale1 - i2raw / scale2;
        a00 += ix * ix;
        a01 += ix * iy;
        a11 += iy * iy;
        b0 += ix * it;
        b1 += iy * it;
        absIt += Math.abs(it);
        support += 1;
      }
    }
    if (support < MOTION.minSupport) return null;
    const det = a00 * a11 - a01 * a01;
    const trace = a00 + a11;
    const disc = Math.sqrt(Math.max(0, trace * trace - 4 * det));
    minEigenvalue = (trace - disc) / 2 / support;
    const delta = solve(a00, a01, a11, b0, b1);
    residual = absIt / support;
    if (!delta) break;
    const step = Math.hypot(delta.x, delta.y);
    const clamp = step > 2 ? 2 / step : 1;
    vx += delta.x * clamp;
    vy += delta.y * clamp;
    if (step < 0.02) break;
  }
  return { vx, vy, support, minEigenvalue, residual };
}

function blockCenters(width: number, height: number): Array<{ x: number; y: number }> {
  const centers: Array<{ x: number; y: number }> = [];
  for (let y = MOTION.blockPx / 2; y < height - MOTION.blockPx / 2; y += MOTION.stepPx) {
    for (let x = MOTION.blockPx / 2; x < width - MOTION.blockPx / 2; x += MOTION.stepPx) {
      centers.push({ x, y });
    }
  }
  return centers;
}

function pairMotion(earlier: ObservationField, later: ObservationField, dtSec: number): MotionVector[] {
  const fine1 = flowRates(earlier);
  const fine2 = flowRates(later);
  const { width, height } = later.geometry;
  const pyr1 = pyramid({ rate: fine1, width, height }, MOTION.pyramidLevels);
  const pyr2 = pyramid({ rate: fine2, width, height }, MOTION.pyramidLevels);
  const levels = Math.min(pyr1.length, pyr2.length);
  const centers = blockCenters(width, height);
  return centers.map((center) => {
    let vx = 0;
    let vy = 0;
    let last: ReturnType<typeof refine> = null;
    for (let level = levels - 1; level >= 0; level -= 1) {
      const scale = 2 ** level;
      const solved = refine(pyr1[level], pyr2[level], center.x / scale, center.y / scale, Math.max(8, MOTION.blockPx / scale), vx / scale, vy / scale);
      if (!solved) continue;
      vx = solved.vx * scale;
      vy = solved.vy * scale;
      if (level === 0) last = solved;
    }
    if (!last || last.minEigenvalue < MOTION.minMeanEigenvalue || last.residual > MOTION.maxResidual) {
      return unknownVector();
    }
    const eastMs = (vx * later.geometry.metersPerPixelX) / dtSec;
    const northMs = (-vy * later.geometry.metersPerPixelY) / dtSec;
    const quality = Math.max(0, Math.min(1, last.minEigenvalue / (last.minEigenvalue + 0.2) * (1 - last.residual)));
    return {
      eastMs,
      northMs,
      quality,
      support: last.support,
      minEigenvalue: last.minEigenvalue,
      residual: last.residual,
      source: 'solved' as const,
    };
  });
}

function columnsOf(width: number): number {
  let n = 0;
  for (let x = MOTION.blockPx / 2; x < width - MOTION.blockPx / 2; x += MOTION.stepPx) n += 1;
  return n;
}

function fillUnknown(vectors: MotionVector[], columns: number, rows: number): void {
  const reliable = vectors.filter((vector) => vector.source === 'solved' && Number.isFinite(vector.eastMs));
  if (!reliable.length) return;
  const eigenCut = reliable.map((vector) => vector.minEigenvalue).sort((a, b) => a - b)[Math.floor(reliable.length / 2)];
  const donors = reliable.filter((vector) => vector.minEigenvalue >= eigenCut);
  const pending = vectors.map((vector, index) => (vector.source === 'unknown' ? index : -1)).filter((index) => index >= 0);
  for (const index of pending) {
    const x = index % columns;
    const y = Math.floor(index / columns);
    let east = 0;
    let north = 0;
    let weight = 0;
    for (let other = 0; other < vectors.length; other += 1) {
      const vector = vectors[other];
      if (!donors.includes(vector)) continue;
      const ox = other % columns;
      const oy = Math.floor(other / columns);
      const dist = Math.hypot(ox - x, oy - y) * MOTION.stepPx;
      if (dist > MOTION.fallbackRadiusPx || dist === 0) continue;
      const w = Math.max(vector.minEigenvalue, 1e-6) / dist;
      east += vector.eastMs * w;
      north += vector.northMs * w;
      weight += w;
    }
    if (weight > 0) {
      vectors[index] = {
        ...vectors[index],
        eastMs: east / weight,
        northMs: north / weight,
        quality: 0.25,
        source: 'nearby',
      };
    }
  }
  if (donors.length < MOTION.minPrevailing) return;
  const easts = donors.map((vector) => vector.eastMs).sort((a, b) => a - b);
  const norths = donors.map((vector) => vector.northMs).sort((a, b) => a - b);
  const mid = Math.floor(donors.length / 2);
  const east = easts[mid];
  const north = norths[mid];
  for (let index = 0; index < vectors.length; index += 1) {
    if (vectors[index].source !== 'unknown') continue;
    vectors[index] = { ...vectors[index], eastMs: east, northMs: north, quality: 0.1, source: 'prevailing' };
  }
  void rows;
}

function averagePairs(pairs: MotionVector[][]): MotionVector[] {
  const count = pairs[0]?.length ?? 0;
  const out: MotionVector[] = [];
  for (let index = 0; index < count; index += 1) {
    let east = 0;
    let north = 0;
    let weight = 0;
    let support = 0;
    let eigen = 0;
    let residual = 0;
    for (const pair of pairs) {
      const vector = pair[index];
      if (!vector || vector.source !== 'solved' || !Number.isFinite(vector.eastMs)) continue;
      const w = Math.max(0.05, vector.quality);
      east += vector.eastMs * w;
      north += vector.northMs * w;
      weight += w;
      support += vector.support;
      eigen += vector.minEigenvalue;
      residual += vector.residual;
    }
    if (!(weight > 0)) {
      out.push(unknownVector());
      continue;
    }
    const n = pairs.length;
    out.push({
      eastMs: east / weight,
      northMs: north / weight,
      quality: Math.min(1, weight),
      support: Math.round(support / n),
      minEigenvalue: eigen / n,
      residual: residual / n,
      source: 'solved',
    });
  }
  return out;
}

/**
 * Motion from a time-ordered regional history. Pairs farther apart than
 * MOTION.maxPairSec are ignored. Missing frames are simply absent; nothing
 * is inserted as a dry field.
 */
export function estimateMotion(frames: readonly ObservationField[]): MotionField {
  const latest = frames[frames.length - 1];
  const columns = latest ? columnsOf(latest.geometry.width) : 0;
  const rows = latest ? Math.round(blockCenters(latest.geometry.width, latest.geometry.height).length / Math.max(1, columns)) : 0;
  const pairDtSec: number[] = [];
  let pairsRejected = 0;
  const solved: MotionVector[][] = [];
  for (let i = 1; i < frames.length; i += 1) {
    const dtSec = (Date.parse(frames[i].validAt) - Date.parse(frames[i - 1].validAt)) / 1000;
    if (!Number.isFinite(dtSec) || dtSec < MOTION.minPairSec || dtSec > MOTION.maxPairSec) {
      pairsRejected += 1;
      continue;
    }
    pairDtSec.push(dtSec);
    solved.push(pairMotion(frames[i - 1], frames[i], dtSec));
  }
  const vectors = solved.length ? averagePairs(solved) : [];
  if (vectors.length) fillUnknown(vectors, columns, rows);
  return { columns, rows, vectors, pairsUsed: solved.length, pairsRejected, pairDtSec };
}

export function vectorAtPixel(motion: MotionField, x: number, y: number): MotionVector | null {
  if (!motion.columns || !motion.vectors.length) return null;
  const col = (x - MOTION.blockPx / 2) / MOTION.stepPx;
  const row = (y - MOTION.blockPx / 2) / MOTION.stepPx;
  const x0 = Math.floor(col);
  const y0 = Math.floor(row);
  const tx = col - x0;
  const ty = row - y0;
  let east = 0;
  let north = 0;
  let weight = 0;
  let quality = 0;
  let source: VectorSource = 'solved';
  const corners = [
    [x0, y0, (1 - tx) * (1 - ty)],
    [x0 + 1, y0, tx * (1 - ty)],
    [x0, y0 + 1, (1 - tx) * ty],
    [x0 + 1, y0 + 1, tx * ty],
  ] as const;
  for (const [cx, cy, w] of corners) {
    if (w <= 0 || cx < 0 || cy < 0 || cx >= motion.columns || cy >= motion.rows) continue;
    const vector = motion.vectors[cy * motion.columns + cx];
    if (!vector || vector.source === 'unknown' || !Number.isFinite(vector.eastMs)) continue;
    east += vector.eastMs * w;
    north += vector.northMs * w;
    quality += vector.quality * w;
    weight += w;
    if (vector.source === 'prevailing') source = 'prevailing';
    else if (vector.source === 'nearby' && source === 'solved') source = 'nearby';
  }
  if (weight < 0.5) return null;
  return {
    eastMs: east / weight,
    northMs: north / weight,
    quality: quality / weight,
    support: 0,
    minEigenvalue: 0,
    residual: 0,
    source,
  };
}

export function compareVelocity(
  estimated: { eastMs: number; northMs: number },
  truth: { eastMs: number; northMs: number },
): { speedErrorMs: number; directionErrorDeg: number | null } {
  const speedErrorMs = Math.abs(Math.hypot(estimated.eastMs, estimated.northMs) - Math.hypot(truth.eastMs, truth.northMs));
  const truthSpeed = Math.hypot(truth.eastMs, truth.northMs);
  const estSpeed = Math.hypot(estimated.eastMs, estimated.northMs);
  if (truthSpeed < 2 || estSpeed < 1e-6) return { speedErrorMs, directionErrorDeg: null };
  const dot = (estimated.eastMs * truth.eastMs + estimated.northMs * truth.northMs) / (truthSpeed * estSpeed);
  const directionErrorDeg = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
  return { speedErrorMs, directionErrorDeg };
}

/** Median solved vector whose block center lies inside the pixel radius. */
export function medianNear(motion: MotionField, x: number, y: number, radiusPx: number): MotionVector | null {
  const picked: MotionVector[] = [];
  motion.vectors.forEach((vector, index) => {
    if (vector.source !== 'solved' || !Number.isFinite(vector.eastMs)) return;
    const cx = (index % motion.columns) * MOTION.stepPx + MOTION.blockPx / 2;
    const cy = Math.floor(index / motion.columns) * MOTION.stepPx + MOTION.blockPx / 2;
    if (Math.hypot(cx - x, cy - y) <= radiusPx) picked.push(vector);
  });
  if (!picked.length) return null;
  const east = picked.map((vector) => vector.eastMs).sort((a, b) => a - b);
  const north = picked.map((vector) => vector.northMs).sort((a, b) => a - b);
  const mid = Math.floor(picked.length / 2);
  return { ...picked[mid], eastMs: east[mid], northMs: north[mid] };
}
