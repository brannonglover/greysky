/**
 * Local radar precursors. Computed from the regional fields already used for
 * motion. This does not change ensemble spread or the 2 km point neighborhood.
 *
 * Initiation is rain where the motion-aligned previous field was dry.
 * Existing-cell growth is rain that was already wet and got heavier.
 * A cell must initiate on two pairs, and a component must cover three cells,
 * before it counts as persistent. Those gates were not fitted to a storm.
 */
import { CELL_MISSING, CELL_VALUE, pixelOf, sampleField, type ObservationField } from './field';
import { MOTION, vectorAtPixel, type MotionField, type MotionVector } from './motion';
import { RAIN_THRESHOLD_MM_HR } from './thresholds';

export const PRECURSOR = {
  circlesKm: [10, 20] as const,
  corridorHalfWidthKm: 8,
  horizonMin: 60,
  persistencePairs: 2,
  minComponentCells: 3,
  /** Research label only: existing rain that later jumps by this much. */
  intensifyMmHr: 5,
  lightMmHr: 0.6,
  moderateMmHr: 2.5,
  heavyMmHr: 7.5,
} as const;

export type OutcomeLabel =
  | 'missing'
  | 'remained-dry'
  | 'trace-only'
  | 'meaningful-rain'
  | 'moderate-rain'
  | 'heavy-rain'
  | 'intensified'
  | 'weakened';

export function classifyOutcome(analysisMmHr: number | null, laterMmHr: number | null): OutcomeLabel {
  if (laterMmHr == null || !Number.isFinite(laterMmHr)) return 'missing';
  const analysis = analysisMmHr != null && Number.isFinite(analysisMmHr) ? analysisMmHr : 0;
  if (analysis >= PRECURSOR.lightMmHr && laterMmHr >= analysis + PRECURSOR.intensifyMmHr) return 'intensified';
  if (analysis >= PRECURSOR.lightMmHr && laterMmHr < PRECURSOR.lightMmHr) return 'weakened';
  if (laterMmHr >= PRECURSOR.heavyMmHr) return 'heavy-rain';
  if (laterMmHr >= PRECURSOR.moderateMmHr) return 'moderate-rain';
  if (laterMmHr >= PRECURSOR.lightMmHr) return 'meaningful-rain';
  if (laterMmHr > RAIN_THRESHOLD_MM_HR) return 'trace-only';
  return 'remained-dry';
}

function blocks(width: number): number {
  let n = 0;
  for (let x = MOTION.blockPx / 2; x < width - MOTION.blockPx / 2; x += MOTION.stepPx) n += 1;
  return n;
}

export function uniformMotion(width: number, height: number, eastMs: number, northMs: number): MotionField {
  const columns = blocks(width);
  const rows = blocks(height);
  const vector: MotionVector = {
    eastMs,
    northMs,
    quality: 1,
    support: 100,
    minEigenvalue: 1,
    residual: 0,
    source: 'solved',
  };
  return {
    columns,
    rows,
    vectors: Array.from({ length: columns * rows }, () => ({ ...vector })),
    pairsUsed: 1,
    pairsRejected: 0,
    pairDtSec: [120],
  };
}

function rateAt(field: ObservationField, x: number, y: number): number | null {
  const index = y * field.geometry.width + x;
  if (x < 0 || y < 0 || x >= field.geometry.width || y >= field.geometry.height) return null;
  if (field.state[index] === CELL_MISSING) return null;
  if (field.state[index] !== CELL_VALUE) return 0;
  const rate = field.rainRateMmHr[index];
  return Number.isFinite(rate) ? rate : null;
}

function advectedRate(older: ObservationField, motion: MotionField, x: number, y: number, dtSec: number): number | null {
  const velocity = vectorAtPixel(motion, x, y);
  if (velocity && Number.isFinite(velocity.eastMs)) {
    const sx = x - (velocity.eastMs * dtSec) / older.geometry.metersPerPixelX;
    const sy = y - (-velocity.northMs * dtSec) / older.geometry.metersPerPixelY;
    const sampled = sampleField(older, sx, sy);
    if (sampled.rainRateMmHr == null) return sampled.echoWeight < 0.05 && sampled.missingWeight < 0.5 ? 0 : null;
    return sampled.rainRateMmHr;
  }
  return null;
}

export type TrajectoryMask = {
  supported: boolean;
  speedMs: number;
  corridor: Uint8Array;
  adjacent: Uint8Array;
};

/** Upstream of the target, along the motion vector, with a cross-track band. */
export function trajectoryMask(field: ObservationField, motion: MotionField, x: number, y: number): TrajectoryMask {
  const { width, height, metersPerPixelX, metersPerPixelY } = field.geometry;
  const corridor = new Uint8Array(width * height);
  const adjacent = new Uint8Array(width * height);
  const velocity = vectorAtPixel(motion, x, y);
  const speed = velocity ? Math.hypot(velocity.eastMs, velocity.northMs) : 0;
  if (!velocity || speed < 1) return { supported: false, speedMs: speed, corridor, adjacent };
  const ux = velocity.eastMs / speed;
  const uy = velocity.northMs / speed;
  const reach = speed * PRECURSOR.horizonMin * 60;
  const half = PRECURSOR.corridorHalfWidthKm * 1000;
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const east = (px - x) * metersPerPixelX;
      const north = -(py - y) * metersPerPixelY;
      const downstream = east * ux + north * uy;
      const along = -downstream;
      const cross = Math.hypot(east - downstream * ux, north - downstream * uy);
      const index = py * width + px;
      if (along >= -metersPerPixelX && along <= reach && cross <= half) corridor[index] = 1;
      else if (along >= -metersPerPixelX && along <= reach && cross <= half * 2) adjacent[index] = 1;
    }
  }
  return { supported: true, speedMs: speed, corridor, adjacent };
}

function circleMask(field: ObservationField, x: number, y: number, radiusKm: number): Uint8Array {
  const { width, height, metersPerPixelX, metersPerPixelY } = field.geometry;
  const mask = new Uint8Array(width * height);
  const limit = radiusKm * 1000;
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const east = (px - x) * metersPerPixelX;
      const north = -(py - y) * metersPerPixelY;
      if (Math.hypot(east, north) <= limit) mask[py * width + px] = 1;
    }
  }
  return mask;
}

type Cover = { valid: number; trace: number; light: number; moderate: number; heavy: number };

function coverage(field: ObservationField, mask: Uint8Array): Cover {
  const out = { valid: 0, trace: 0, light: 0, moderate: 0, heavy: 0 };
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    const y = Math.floor(i / field.geometry.width);
    const x = i - y * field.geometry.width;
    const rate = rateAt(field, x, y);
    if (rate == null) continue;
    out.valid += 1;
    if (rate > RAIN_THRESHOLD_MM_HR) out.trace += 1;
    if (rate >= PRECURSOR.lightMmHr) out.light += 1;
    if (rate >= PRECURSOR.moderateMmHr) out.moderate += 1;
    if (rate >= PRECURSOR.heavyMmHr) out.heavy += 1;
  }
  return out;
}

function fraction(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

type PairMasks = { initiation: Uint8Array; growth: Uint8Array; residual: Float32Array };

function pairSignals(older: ObservationField, newer: ObservationField, motion: MotionField): PairMasks | null {
  const dtSec = (Date.parse(newer.validAt) - Date.parse(older.validAt)) / 1000;
  if (!Number.isFinite(dtSec) || dtSec < MOTION.minPairSec || dtSec > MOTION.maxPairSec) return null;
  const n = newer.geometry.width * newer.geometry.height;
  const initiation = new Uint8Array(n);
  const growth = new Uint8Array(n);
  const residual = new Float32Array(n);
  residual.fill(Number.NaN);
  for (let y = 0; y < newer.geometry.height; y += 1) {
    for (let x = 0; x < newer.geometry.width; x += 1) {
      const observed = rateAt(newer, x, y);
      const advected = advectedRate(older, motion, x, y, dtSec);
      if (observed == null || advected == null) continue;
      const index = y * newer.geometry.width + x;
      residual[index] = observed - advected;
      const obsWet = observed > RAIN_THRESHOLD_MM_HR;
      const advWet = advected > RAIN_THRESHOLD_MM_HR;
      if (obsWet && !advWet) initiation[index] = 1;
      else if (obsWet && advWet && observed > advected) growth[index] = 1;
    }
  }
  return { initiation, growth, residual };
}

function components(mask: Uint8Array, width: number, minCells: number): Array<{ cells: number; cx: number; cy: number }> {
  const seen = new Uint8Array(mask.length);
  const found: Array<{ cells: number; cx: number; cy: number }> = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    stack.push(start);
    seen[start] = 1;
    let cells = 0;
    let sx = 0;
    let sy = 0;
    while (stack.length) {
      const index = stack.pop() as number;
      const y = Math.floor(index / width);
      const x = index - y * width;
      cells += 1;
      sx += x;
      sy += y;
      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (const next of neighbors) {
        if (next < 0 || next >= mask.length || seen[next] || !mask[next]) continue;
        const ny = Math.floor(next / width);
        const nx = next - ny * width;
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    if (cells >= minCells) found.push({ cells, cx: sx / cells, cy: sy / cells });
  }
  return found;
}

function elongation(field: ObservationField, mask: Uint8Array): boolean | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    const y = Math.floor(i / field.geometry.width);
    const x = i - y * field.geometry.width;
    const rate = rateAt(field, x, y);
    if (rate == null || !(rate > RAIN_THRESHOLD_MM_HR) || rate >= PRECURSOR.lightMmHr) continue;
    xs.push(x);
    ys.push(y);
  }
  if (xs.length < 8) return null;
  const mx = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const my = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  const trace = xx + yy;
  const det = xx * yy - xy * xy;
  const root = Math.sqrt(Math.max(0, trace * trace / 4 - det));
  const major = trace / 2 + root;
  const minor = Math.max(trace / 2 - root, 1e-6);
  return major / minor >= 4;
}

function motionConvergence(field: ObservationField, motion: MotionField, x: number, y: number): number | null {
  const step = 4;
  const right = vectorAtPixel(motion, x + step, y);
  const left = vectorAtPixel(motion, x - step, y);
  const north = vectorAtPixel(motion, x, y - step);
  const south = vectorAtPixel(motion, x, y + step);
  const usable = [right, left, north, south].every((vector) => vector && vector.source === 'solved' && Number.isFinite(vector.eastMs));
  if (!usable || !right || !left || !north || !south) return null;
  const dx = 2 * step * field.geometry.metersPerPixelX;
  const dy = 2 * step * field.geometry.metersPerPixelY;
  const divergence = (right.eastMs - left.eastMs) / dx + (north.northMs - south.northMs) / dy;
  return -divergence;
}

export type PrecursorFeatures = {
  ms: number;
  trajectorySupported: boolean;
  speedMs: number;
  analysisRateMmHr: number | null;
  pointResidualMmHrPerMin: number | null;
  traceCoverage20: number | null;
  traceCoverageTendencyPerMin: number | null;
  lightCoverage20: number | null;
  moderateCoverage20: number | null;
  traceCoverage10: number | null;
  corridorTraceCoverage: number | null;
  corridorInitiationFraction: number | null;
  adjacentInitiationFraction: number | null;
  circleInitiationFraction: number | null;
  latestNewCells20: number;
  persistentInitiationFraction: number | null;
  persistentComponents: number;
  nearestPersistentKm: number | null;
  existingGrowthFraction: number | null;
  meanGrowthResidualMmHr: number | null;
  weakEchoPersistence: number | null;
  elongatedWeakEcho: boolean | null;
  motionConvergencePerSec: number | null;
  /** Solved vectors inside 20 km. Separate from the single vector at the target. */
  nearbySolvedFraction: number | null;
  nearbyMedianSpeedMs: number | null;
};

function countMask(mask: Uint8Array, gate: Uint8Array): { hit: number; valid: number } {
  let hit = 0;
  let valid = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    valid += 1;
    if (gate[i]) hit += 1;
  }
  return { hit, valid };
}

export function precursorFeatures(
  frames: readonly ObservationField[],
  motion: MotionField,
  latitude: number,
  longitude: number,
): PrecursorFeatures {
  const started = Date.now();
  const latest = frames[frames.length - 1];
  const oldest = frames[0];
  const blank: PrecursorFeatures = {
    ms: 0,
    trajectorySupported: false,
    speedMs: 0,
    analysisRateMmHr: null,
    pointResidualMmHrPerMin: null,
    traceCoverage20: null,
    traceCoverageTendencyPerMin: null,
    lightCoverage20: null,
    moderateCoverage20: null,
    traceCoverage10: null,
    corridorTraceCoverage: null,
    corridorInitiationFraction: null,
    adjacentInitiationFraction: null,
    circleInitiationFraction: null,
    latestNewCells20: 0,
    persistentInitiationFraction: null,
    persistentComponents: 0,
    nearestPersistentKm: null,
    existingGrowthFraction: null,
    meanGrowthResidualMmHr: null,
    weakEchoPersistence: null,
    elongatedWeakEcho: null,
    motionConvergencePerSec: null,
    nearbySolvedFraction: null,
    nearbyMedianSpeedMs: null,
  };
  if (!latest || !oldest) return { ...blank, ms: Date.now() - started };
  const pixel = pixelOf(latest.geometry, latitude, longitude);
  const x = Math.round(pixel.x);
  const y = Math.round(pixel.y);
  const trajectory = trajectoryMask(latest, motion, x, y);
  const circle20 = circleMask(latest, x, y, 20);
  const circle10 = circleMask(latest, x, y, 10);
  const now20 = coverage(latest, circle20);
  const then20 = coverage(oldest, circle20);
  const now10 = coverage(latest, circle10);
  const corridorCover = coverage(latest, trajectory.corridor);
  const minutes = Math.max(1 / 60, (Date.parse(latest.validAt) - Date.parse(oldest.validAt)) / 60_000);
  const pairs: PairMasks[] = [];
  for (let i = 1; i < frames.length; i += 1) {
    const pair = pairSignals(frames[i - 1], frames[i], motion);
    if (pair) pairs.push(pair);
  }
  const latestPair = pairs[pairs.length - 1];
  const previous = frames.length >= 2 ? frames[frames.length - 2] : null;
  const counts = new Uint8Array(latest.geometry.width * latest.geometry.height);
  for (const pair of pairs) {
    for (let i = 0; i < counts.length; i += 1) if (pair.initiation[i]) counts[i] += 1;
  }
  const persistent = new Uint8Array(counts.length);
  for (let i = 0; i < counts.length; i += 1) if (counts[i] >= PRECURSOR.persistencePairs) persistent[i] = 1;
  const parts = components(persistent, latest.geometry.width, PRECURSOR.minComponentCells);
  let nearest = Infinity;
  for (const part of parts) {
    const east = (part.cx - x) * latest.geometry.metersPerPixelX;
    const north = -(part.cy - y) * latest.geometry.metersPerPixelY;
    nearest = Math.min(nearest, Math.hypot(east, north) / 1000);
  }
  let growthCells = 0;
  let growthResidual = 0;
  let growthN = 0;
  if (latestPair) {
    const gated = countMask(circle20, latestPair.growth);
    growthCells = gated.hit;
    for (let i = 0; i < circle20.length; i += 1) {
      if (!circle20[i] || !latestPair.growth[i] || !Number.isFinite(latestPair.residual[i])) continue;
      growthResidual += latestPair.residual[i];
      growthN += 1;
    }
  }
  let weakNow = 0;
  let weakHeld = 0;
  if (previous) {
    for (let i = 0; i < circle20.length; i += 1) {
      if (!circle20[i]) continue;
      const yy = Math.floor(i / latest.geometry.width);
      const xx = i - yy * latest.geometry.width;
      const rate = rateAt(latest, xx, yy);
      const before = rateAt(previous, xx, yy);
      if (rate == null || !(rate > RAIN_THRESHOLD_MM_HR) || rate >= PRECURSOR.lightMmHr) continue;
      weakNow += 1;
      if (before != null && before > RAIN_THRESHOLD_MM_HR) weakHeld += 1;
    }
  }
  const targetResidual = latestPair ? latestPair.residual[y * latest.geometry.width + x] : Number.NaN;
  const dtMin = frames.length >= 2 ? (Date.parse(latest.validAt) - Date.parse(frames[frames.length - 2].validAt)) / 60_000 : Number.NaN;
  const new20 = latestPair ? countMask(circle20, latestPair.initiation) : { hit: 0, valid: 0 };
  const persist20 = countMask(circle20, persistent);
  const corridorInit = latestPair && trajectory.supported ? countMask(trajectory.corridor, latestPair.initiation) : { hit: 0, valid: 0 };
  const adjacentInit = latestPair && trajectory.supported ? countMask(trajectory.adjacent, latestPair.initiation) : { hit: 0, valid: 0 };
  const around = nearbyMotion(latest, motion, circle20);
  return {
    ms: Date.now() - started,
    trajectorySupported: trajectory.supported,
    speedMs: trajectory.speedMs,
    analysisRateMmHr: rateAt(latest, x, y),
    pointResidualMmHrPerMin: Number.isFinite(targetResidual) && dtMin > 0 ? targetResidual / dtMin : null,
    traceCoverage20: fraction(now20.trace, now20.valid),
    traceCoverageTendencyPerMin:
      then20.valid && now20.valid ? (now20.trace / now20.valid - then20.trace / then20.valid) / minutes : null,
    lightCoverage20: fraction(now20.light, now20.valid),
    moderateCoverage20: fraction(now20.moderate, now20.valid),
    traceCoverage10: fraction(now10.trace, now10.valid),
    corridorTraceCoverage: trajectory.supported ? fraction(corridorCover.trace, corridorCover.valid) : null,
    corridorInitiationFraction: trajectory.supported ? fraction(corridorInit.hit, corridorInit.valid) : null,
    adjacentInitiationFraction: trajectory.supported ? fraction(adjacentInit.hit, adjacentInit.valid) : null,
    circleInitiationFraction: fraction(new20.hit, new20.valid),
    latestNewCells20: new20.hit,
    persistentInitiationFraction: fraction(persist20.hit, persist20.valid),
    persistentComponents: parts.length,
    nearestPersistentKm: Number.isFinite(nearest) ? nearest : null,
    existingGrowthFraction: latestPair ? fraction(growthCells, new20.valid) : null,
    meanGrowthResidualMmHr: growthN ? growthResidual / growthN : null,
    weakEchoPersistence: weakNow ? weakHeld / weakNow : null,
    elongatedWeakEcho: elongation(latest, circle20),
    motionConvergencePerSec: motionConvergence(latest, motion, x, y),
    nearbySolvedFraction: around.fraction,
    nearbyMedianSpeedMs: around.median,
  };
}

function nearbyMotion(field: ObservationField, motion: MotionField, mask: Uint8Array): { fraction: number | null; median: number | null } {
  const speeds: number[] = [];
  let solved = 0;
  let sampled = 0;
  for (let i = 0; i < mask.length; i += 4) {
    if (!mask[i]) continue;
    const y = Math.floor(i / field.geometry.width);
    const x = i - y * field.geometry.width;
    sampled += 1;
    const vector = vectorAtPixel(motion, x, y);
    if (!vector || vector.source !== 'solved' || !Number.isFinite(vector.eastMs)) continue;
    solved += 1;
    speeds.push(Math.hypot(vector.eastMs, vector.northMs));
  }
  speeds.sort((a, b) => a - b);
  return {
    fraction: sampled ? solved / sampled : null,
    median: speeds.length ? speeds[Math.floor(speeds.length / 2)] : null,
  };
}
