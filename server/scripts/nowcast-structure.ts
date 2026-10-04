/**
 * Phase 5C diagnostic. Downloads native MRMS products, clips each one to the
 * case window, and drops the full grid. No weights. No ensemble change.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { listBundleDirs, readBundle } from '../lib/precipNowcast/caseFile';
import { metersPerDegreeLon, pixelOf, type ObservationField } from '../lib/precipNowcast/field';
import { estimateMotion, vectorAtPixel } from '../lib/precipNowcast/motion';
import { fetchAndClip, listMrmsKeys, productUrl, sampleWindow, type DecodeCost, type NativeWindow } from '../lib/precipNowcast/mrmsSubset';
import { trajectoryMask } from '../lib/precipNowcast/precursor';
import { RAIN_THRESHOLD_MM_HR } from '../lib/precipNowcast/thresholds';

const HISTORY_MIN = 20;
const MAX_FRAMES = 8;
const PRODUCTS = [
  // EchoTop_18 is a height in kilometres. The decoded unit string is empty.
  { id: 'EchoTop', folder: 'CONUS/EchoTop_18_00.50', levels: [1, 3, 6, 9], floor: 0, missingBelow: 0 },
  { id: 'VIL', folder: 'CONUS/VIL_00.50', levels: [1, 5, 10, 20], floor: 0, missingBelow: 0 },
  { id: 'LowestAltitude', folder: 'CONUS/MergedReflectivityAtLowestAltitude_00.50', levels: [0, 5, 20, 40], floor: 5, missingBelow: -30 },
  { id: 'RQI', folder: 'CONUS/RadarQualityIndex_00.00', levels: [0.2, 0.5, 0.8], floor: 0, missingBelow: 0 },
  { id: 'PrecipRate', folder: 'CONUS/PrecipRate_00.00', levels: [0.02, 0.6, 2.5, 7.5], floor: RAIN_THRESHOLD_MM_HR, missingBelow: 0 },
] as const;

type Disk = {
  point: number | null;
  max10: number | null;
  max20: number | null;
  mean20: number | null;
  meanAboveFloor20: number | null;
  frac20: Array<number | null>;
  poorFraction20: number | null;
  belowPalette20: number | null;
  corridorMax: number | null;
  corridorMean: number | null;
  weakLine: boolean | null;
};

function levelsFor(id: string, units: string, fallback: readonly number[]): readonly number[] {
  if (id === 'EchoTop' && /km/i.test(units)) return [1, 3, 6, 9];
  return fallback;
}

function num(value: number | null | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function wanted(regionKey: string, observationTime: string): boolean {
  if (regionKey.startsWith('34.00,-84.50') || regionKey.startsWith('26.00,-80.00')) return true;
  if (regionKey.startsWith('30.00,-95.50') && observationTime.startsWith('2026-10-04T14')) return true;
  if (regionKey.startsWith('33.00,-112.00') && observationTime.startsWith('2026-10-04T12')) return true;
  return false;
}

function cellLatLon(grid: NativeWindow, x: number, y: number): { latitude: number; longitude: number } {
  return {
    latitude: grid.north - y * grid.dLat,
    longitude: grid.west + x * grid.dLon,
  };
}

function disk(grid: NativeWindow, latitude: number, longitude: number, radiusKm: number, levels: readonly number[], floor: number): {
  max: number | null;
  mean: number | null;
  meanAbove: number | null;
  frac: Array<number | null>;
  poor: number | null;
  belowPalette: number | null;
  weakLine: boolean | null;
} {
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  let aboveSum = 0;
  let aboveN = 0;
  let poor = 0;
  let belowPalette = 0;
  const hits = levels.map(() => 0);
  const xs: number[] = [];
  const ys: number[] = [];
  const limit = radiusKm * 1000;
  const metresLon = metersPerDegreeLon(latitude);
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const cell = cellLatLon(grid, x, y);
      const east = (cell.longitude - longitude) * metresLon;
      const north = (cell.latitude - latitude) * 110_540;
      if (Math.hypot(east, north) > limit) continue;
      const value = grid.values[y * grid.width + x];
      if (!Number.isFinite(value)) continue;
      n += 1;
      sum += value;
      if (value > max) max = value;
      if (value > floor) {
        aboveSum += value;
        aboveN += 1;
      }
      if (value < 0.5) poor += 1;
      if (value >= 0 && value < 5) belowPalette += 1;
      for (let i = 0; i < levels.length; i += 1) if (value >= levels[i]) hits[i] += 1;
      if (value >= 0 && value < 20) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  return {
    max: n ? max : null,
    mean: n ? sum / n : null,
    meanAbove: aboveN ? aboveSum / aboveN : null,
    frac: hits.map((hit) => (n ? hit / n : null)),
    poor: n ? poor / n : null,
    belowPalette: n ? belowPalette / n : null,
    weakLine: elongate(xs, ys),
  };
}

function elongate(xs: number[], ys: number[]): boolean | null {
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
  const root = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  const major = trace / 2 + root;
  const minor = Math.max(trace / 2 - root, 1e-6);
  return major / minor >= 4;
}

function corridorStats(grid: NativeWindow, field: ObservationField, mask: Uint8Array): { max: number | null; mean: number | null } {
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    const y = Math.floor(i / field.geometry.width);
    const x = i - y * field.geometry.width;
    const latitude = field.geometry.north - (y + 0.5) * field.geometry.dLat;
    const longitude = field.geometry.west + (x + 0.5) * field.geometry.dLon;
    const value = sampleWindow(grid, latitude, longitude);
    if (value == null) continue;
    n += 1;
    sum += value;
    if (value > max) max = value;
  }
  return { max: n ? max : null, mean: n ? sum / n : null };
}

function pointStats(grid: NativeWindow, latitude: number, longitude: number, levels: readonly number[], floor: number, field: ObservationField, mask: Uint8Array): Disk {
  const near = disk(grid, latitude, longitude, 10, levels, floor);
  const wide = disk(grid, latitude, longitude, 20, levels, floor);
  const corridor = corridorStats(grid, field, mask);
  return {
    point: sampleWindow(grid, latitude, longitude),
    max10: near.max,
    max20: wide.max,
    mean20: wide.mean,
    meanAboveFloor20: wide.meanAbove,
    frac20: wide.frac,
    poorFraction20: wide.poor,
    belowPalette20: wide.belowPalette,
    corridorMax: corridor.max,
    corridorMean: corridor.mean,
    weakLine: wide.weakLine,
  };
}

function readWindow(file: string, validAt: string, product: string, units: string): NativeWindow {
  const buf = fs.readFileSync(file);
  const width = buf.readUInt16LE(4);
  const height = buf.readUInt16LE(6);
  const values = new Float32Array(width * height);
  values.set(new Float32Array(buf.buffer, buf.byteOffset + 40, width * height));
  return {
    validAt,
    product,
    units,
    west: buf.readDoubleLE(8),
    north: buf.readDoubleLE(16),
    dLon: buf.readDoubleLE(24),
    dLat: buf.readDoubleLE(32),
    width,
    height,
    values,
  };
}

function clipChild(url: string, bounds: { west: number; south: number; east: number; north: number }, missingBelow: number, outFile: string): (DecodeCost & { validAt: string; units: string; width: number; height: number }) | null {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', __filename, '--clip', url, String(bounds.west), String(bounds.south), String(bounds.east), String(bounds.north), String(missingBelow), outFile],
    { encoding: 'utf8', maxBuffer: 2_000_000 },
  );
  if (result.status !== 0) {
    console.log(`  clip failed ${result.stderr?.trim().split('\n').slice(-2).join(' ')}`);
    return null;
  }
  const line = result.stdout.trim().split('\n').filter(Boolean).pop();
  if (!line) return null;
  return JSON.parse(line) as DecodeCost & { validAt: string; units: string; width: number; height: number };
}

function writeWindow(file: string, grid: NativeWindow) {
  const header = Buffer.alloc(40);
  header.write('MRG1', 0);
  header.writeUInt16LE(grid.width, 4);
  header.writeUInt16LE(grid.height, 6);
  header.writeDoubleLE(grid.west, 8);
  header.writeDoubleLE(grid.north, 16);
  header.writeDoubleLE(grid.dLon, 24);
  header.writeDoubleLE(grid.dLat, 32);
  const body = Buffer.from(grid.values.buffer, grid.values.byteOffset, grid.values.byteLength);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([header, body]));
}

function styledAt(field: ObservationField, latitude: number, longitude: number): number | null {
  const pixel = pixelOf(field.geometry, latitude, longitude);
  const x = Math.round(pixel.x);
  const y = Math.round(pixel.y);
  if (x < 0 || y < 0 || x >= field.geometry.width || y >= field.geometry.height) return null;
  const index = y * field.geometry.width + x;
  if (field.state[index] === 0) return null;
  if (field.state[index] !== 2) return 0;
  const rate = field.rainRateMmHr[index];
  return Number.isFinite(rate) ? rate : null;
}

function closestField(fields: ObservationField[], validAt: string): ObservationField | null {
  const target = Date.parse(validAt);
  let best: ObservationField | null = null;
  let bestDt = Infinity;
  for (const field of fields) {
    const dt = Math.abs(Date.parse(field.validAt) - target);
    if (dt < bestDt) {
      best = field;
      bestDt = dt;
    }
  }
  return best && bestDt <= 120_000 ? best : null;
}

function nativeResidual(older: NativeWindow, newer: NativeWindow, field: ObservationField, motion: ReturnType<typeof estimateMotion>, x: number, y: number, latitude: number, longitude: number): number | null {
  const dt = (Date.parse(newer.validAt) - Date.parse(older.validAt)) / 1000;
  if (!(dt >= 30) || dt > 300) return null;
  const observed = sampleWindow(newer, latitude, longitude);
  const velocity = vectorAtPixel(motion, x, y);
  if (observed == null || !velocity || !Number.isFinite(velocity.eastMs)) return null;
  const sx = x - (velocity.eastMs * dt) / field.geometry.metersPerPixelX;
  const sy = y + (velocity.northMs * dt) / field.geometry.metersPerPixelY;
  const lon = field.geometry.west + (sx + 0.5) * field.geometry.dLon;
  const lat = field.geometry.north - (sy + 0.5) * field.geometry.dLat;
  const advected = sampleWindow(older, lat, lon);
  if (advected == null) return null;
  return (observed - advected) / (dt / 60);
}

function release() {
  const gc = (global as { gc?: () => void }).gc;
  if (gc) gc();
}

async function main() {
  const selected = listBundleDirs().filter((dir) => {
    const { bundle } = readBundle(dir);
    return wanted(bundle.regionKey, bundle.observationTime);
  });
  console.log(`structure bundles ${selected.length}`);
  for (const dir of selected) {
    const { bundle, fields } = readBundle(dir);
    const latest = fields[fields.length - 1];
    if (!latest) continue;
    const motion = estimateMotion(fields);
    const bounds = {
      west: bundle.centerLongitude - 1.5,
      east: bundle.centerLongitude + 1.5,
      south: bundle.centerLatitude - 1.5,
      north: bundle.centerLatitude + 1.5,
    };
    const end = new Date(bundle.observationTime);
    const start = new Date(end.getTime() - HISTORY_MIN * 60_000);
    const pointMasks = bundle.points.map((point) => {
      const pixel = pixelOf(latest.geometry, point.latitude, point.longitude);
      const x = Math.round(pixel.x);
      const y = Math.round(pixel.y);
      return { point, x, y, mask: trajectoryMask(latest, motion, x, y) };
    });
    const products = [];
    for (const product of PRODUCTS) {
      if (product.id === 'VIL' || product.id === 'RQI') {
        console.log(`  ${product.id} skipped: current GRIB library cannot decode it`);
        continue;
      }
      const keys = await listMrmsKeys(product.folder, start, end, MAX_FRAMES).catch((error: unknown) => {
        console.log(`  list failed ${product.id} ${error instanceof Error ? error.message : error}`);
        return [];
      });
      console.log(`${bundle.regionKey.split('|')[0]} @ ${bundle.observationTime.slice(11, 16)} ${product.id} frames=${keys.length}`);
      const costs: DecodeCost[] = [];
      let units: string | null = null;
      const series = pointMasks.map(() => [] as Array<Disk & { validAt: string; styledPoint: number | null }>);
      const kept: NativeWindow[] = [];
      for (const item of keys) {
        const outFile = path.join(dir, 'native', product.id, `${item.validAt.replace(/[:.]/g, '-')}.bin`);
        const clipped = clipChild(productUrl(item.key), bounds, product.missingBelow, outFile);
        if (!clipped) continue;
        costs.push(clipped);
        units = clipped.units || units;
        const grid = readWindow(outFile, clipped.validAt, product.id, units ?? '');
        const levels = levelsFor(product.id, units ?? '', product.levels);
        pointMasks.forEach((entry, index) => {
          const styled = closestField(fields, grid.validAt);
          series[index].push({
            validAt: grid.validAt,
            styledPoint: styled ? styledAt(styled, entry.point.latitude, entry.point.longitude) : null,
            ...pointStats(grid, entry.point.latitude, entry.point.longitude, levels, product.floor, latest, entry.mask.corridor),
          });
        });
        if (product.id === 'PrecipRate' || product.id === 'LowestAltitude') kept.push(grid);
        console.log(
          `  ${product.id} ${grid.validAt.slice(11, 19)} ${grid.width}x${grid.height} ${units} heap ${Math.round(clipped.peakHeapBytes / 1_048_576)} MB rss ${Math.round(clipped.peakRssBytes / 1_048_576)} MB decode ${clipped.decodeMs} ms dl ${clipped.downloadMs} ms gz ${clipped.compressedBytes}`,
        );
      }
      const points = pointMasks.map((entry, index) => {
        const frames = series[index];
        let maxRise: number | null = null;
        let risingPairs = 0;
        let pairs = 0;
        for (let i = 1; i < frames.length; i += 1) {
          const before = frames[i - 1].max20;
          const after = frames[i].max20;
          if (before == null || after == null) continue;
          pairs += 1;
          const delta = after - before;
          if (delta > 0) risingPairs += 1;
          if (maxRise == null || delta > maxRise) maxRise = delta;
        }
        const older = kept[kept.length - 2];
        const newer = kept[kept.length - 1];
        const nativePerMin = older && newer ? nativeResidual(older, newer, latest, motion, entry.x, entry.y, entry.point.latitude, entry.point.longitude) : null;
        const first = frames[0];
        const last = frames[frames.length - 1];
        console.log(
          `  ${entry.point.id} ${product.id} pt ${num(first?.point)}→${num(last?.point)} max20 ${num(first?.max20)}→${num(last?.max20)} rise ${num(maxRise)} up ${risingPairs}/${pairs} corr ${num(last?.corridorMax)} line ${last?.weakLine ?? '—'}`,
        );
        return {
          id: entry.point.id,
          trajectorySource: entry.mask.source,
          frames,
          maxRise,
          risingPairs,
          pairs,
          nativeResidualPerMin: nativePerMin,
        };
      });
      kept.length = 0;
      const peakHeap = costs.reduce((max, cost) => Math.max(max, cost.peakHeapBytes), 0);
      const peakRss = costs.reduce((max, cost) => Math.max(max, cost.peakRssBytes), 0);
      products.push({
        id: product.id,
        folder: product.folder,
        levels: product.levels,
        units,
        frameCount: keys.length,
        costs: {
          frames: costs.length,
          compressedBytes: costs[0]?.compressedBytes ?? null,
          inflatedBytes: costs[0]?.inflatedBytes ?? null,
          fullRows: costs[0]?.fullRows ?? null,
          fullCols: costs[0]?.fullCols ?? null,
          clippedCells: costs[0]?.clippedCells ?? null,
          axis: costs[0]?.axis ?? null,
          meanDownloadMs: costs.length ? costs.reduce((sum, cost) => sum + cost.downloadMs, 0) / costs.length : null,
          meanDecodeMs: costs.length ? costs.reduce((sum, cost) => sum + cost.decodeMs, 0) / costs.length : null,
          peakHeapBytes: peakHeap,
          peakRssBytes: peakRss,
        },
        points,
      });
      release();
    }
    fs.writeFileSync(
      path.join(dir, 'structure.json'),
      JSON.stringify({
        observationTime: bundle.observationTime,
        regionKey: bundle.regionKey,
        blocked: [
          {
            id: 'VIL',
            reason: 'gribberish aborts the process while reading the grid: range end index 24500001 out of range for slice of length 24500000. The error is not catchable.',
          },
          {
            id: 'RQI',
            reason: 'gribberish does not support GRIB parameter (8, 0). The file is valid GRIB2 and no values are returned.',
          },
        ],
        products,
      }),
    );
  }
}

if (process.argv[2] === '--clip') {
  const url = process.argv[3];
  const bounds = {
    west: Number(process.argv[4]),
    south: Number(process.argv[5]),
    east: Number(process.argv[6]),
    north: Number(process.argv[7]),
  };
  const missingBelow = Number(process.argv[8]);
  const outFile = process.argv[9];
  fetchAndClip(url, bounds, missingBelow)
    .then(({ window: grid, cost }) => {
      writeWindow(outFile, grid);
      console.log(JSON.stringify({ ...cost, validAt: grid.validAt, units: grid.units, width: grid.width, height: grid.height }));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
} else {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
