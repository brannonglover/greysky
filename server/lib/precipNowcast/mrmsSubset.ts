/**
 * Clip one native MRMS GRIB message to a regional window and drop the full grid.
 * Research only. The nowcast still reads the styled composite.
 *
 * gribberish materialises the whole CONUS grid as a JavaScript array. This
 * module copies the window into a Float32Array and does not retain the message.
 */
import { gunzipSync } from 'node:zlib';

import { parseMessagesFromBuffer } from '@mattnucc/gribberish';

export type NativeWindow = {
  validAt: string;
  product: string;
  units: string;
  /** Longitude of the western column, cell centre. */
  west: number;
  /** Latitude of the northern row, cell centre. */
  north: number;
  dLon: number;
  dLat: number;
  width: number;
  height: number;
  /** NaN where the GRIB value was missing. Row 0 is north. */
  values: Float32Array;
};

export type DecodeCost = {
  compressedBytes: number;
  inflatedBytes: number;
  downloadMs: number;
  decodeMs: number;
  peakHeapBytes: number;
  peakRssBytes: number;
  fullRows: number;
  fullCols: number;
  clippedCells: number;
  axis: '1d' | '2d';
};

export type LatLonBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

const MISSING_LOW = -100;
const MISSING_HIGH = 1e6;

export function clipFromRegular(args: {
  values: ArrayLike<number | null | undefined>;
  rows: number;
  cols: number;
  lat0: number;
  lon0: number;
  dLat: number;
  dLon: number;
  bounds: LatLonBounds;
  missingBelow?: number;
  validAt: string;
  product: string;
  units: string;
}): NativeWindow {
  const includedRows: number[] = [];
  const includedCols: number[] = [];
  for (let row = 0; row < args.rows; row += 1) {
    const lat = args.lat0 + row * args.dLat;
    if (lat <= args.bounds.north + 1e-6 && lat >= args.bounds.south - 1e-6) includedRows.push(row);
  }
  for (let col = 0; col < args.cols; col += 1) {
    let lon = args.lon0 + col * args.dLon;
    if (lon > 180) lon -= 360;
    if (lon >= args.bounds.west - 1e-6 && lon <= args.bounds.east + 1e-6) includedCols.push(col);
  }
  const orderedRows = args.dLat > 0 ? [...includedRows].reverse() : includedRows;
  const width = includedCols.length;
  const height = orderedRows.length;
  const values = new Float32Array(width * height);
  values.fill(Number.NaN);
  if (width && height) {
    for (let y = 0; y < height; y += 1) {
      const row = orderedRows[y];
      for (let x = 0; x < width; x += 1) {
        const raw = args.values[row * args.cols + includedCols[x]];
        if (raw == null || typeof raw !== 'number' || !Number.isFinite(raw)) continue;
        if (raw < (args.missingBelow ?? MISSING_LOW) || raw > MISSING_HIGH) continue;
        values[y * width + x] = raw;
      }
    }
  }
  const north = height ? args.lat0 + orderedRows[0] * args.dLat : args.bounds.north;
  let west = width ? args.lon0 + includedCols[0] * args.dLon : args.bounds.west;
  if (west > 180) west -= 360;
  return {
    validAt: args.validAt,
    product: args.product,
    units: args.units,
    west,
    north,
    dLon: Math.abs(args.dLon),
    dLat: Math.abs(args.dLat),
    width,
    height,
    values,
  };
}

/** Nearest cell. Coordinates are cell centres, so no half-pixel shift. */
export function sampleWindow(grid: NativeWindow, latitude: number, longitude: number): number | null {
  if (!grid.width || !grid.height || grid.dLon === 0 || grid.dLat === 0) return null;
  const x = Math.round((longitude - grid.west) / grid.dLon);
  const y = Math.round((grid.north - latitude) / grid.dLat);
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return null;
  const value = grid.values[y * grid.width + x];
  return Number.isFinite(value) ? value : null;
}

type Axis = { origin: number; step: number; kind: '1d' | '2d' };

function readAxes(rows: number, cols: number, latitude: number[], longitude: number[]): { lat: Axis; lon: Axis } {
  if (latitude.length === rows && longitude.length === cols) {
    return {
      lat: { origin: latitude[0], step: rows > 1 ? latitude[1] - latitude[0] : -0.01, kind: '1d' },
      lon: { origin: longitude[0], step: cols > 1 ? longitude[1] - longitude[0] : 0.01, kind: '1d' },
    };
  }
  if (latitude.length === rows * cols && longitude.length === rows * cols) {
    return {
      lat: { origin: latitude[0], step: rows > 1 ? latitude[cols] - latitude[0] : -0.01, kind: '2d' },
      lon: { origin: longitude[0], step: cols > 1 ? longitude[1] - longitude[0] : 0.01, kind: '2d' },
    };
  }
  throw new Error(`Unexpected MRMS axis length ${latitude.length} for ${rows}×${cols}`);
}

export function clipMessage(buffer: Uint8Array, bounds: LatLonBounds, missingBelow = MISSING_LOW): { window: NativeWindow; inflatedBytes: number; axis: '1d' | '2d'; fullRows: number; fullCols: number; peakHeapBytes: number; peakRssBytes: number } {
  const message = parseMessagesFromBuffer(buffer)[0];
  if (!message) throw new Error('No GRIB message');
  const data = message.data;
  const { rows, cols } = message.gridShape;
  const axes = readAxes(rows, cols, message.latlng.latitude, message.latlng.longitude);
  const usage = process.memoryUsage();
  const validAt = (message.referenceDate ?? message.forecastDate).toISOString();
  const window = clipFromRegular({
    values: data,
    rows,
    cols,
    lat0: axes.lat.origin,
    lon0: axes.lon.origin > 180 ? axes.lon.origin - 360 : axes.lon.origin,
    dLat: axes.lat.step,
    dLon: axes.lon.step,
    bounds,
    missingBelow,
    validAt,
    product: message.varAbbrev || message.varName,
    units: message.units,
  });
  return {
    window,
    inflatedBytes: buffer.byteLength,
    axis: axes.lat.kind,
    fullRows: rows,
    fullCols: cols,
    peakHeapBytes: usage.heapUsed,
    peakRssBytes: usage.rss,
  };
}

export async function fetchAndClip(url: string, bounds: LatLonBounds, missingBelow = MISSING_LOW): Promise<{ window: NativeWindow; cost: DecodeCost }> {
  const started = Date.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MRMS fetch ${res.status}`);
  const gz = Buffer.from(await res.arrayBuffer());
  const downloadMs = Date.now() - started;
  const raw = gunzipSync(gz);
  const decodeStarted = Date.now();
  const clipped = clipMessage(new Uint8Array(raw), bounds, missingBelow);
  return {
    window: clipped.window,
    cost: {
      compressedBytes: gz.byteLength,
      inflatedBytes: clipped.inflatedBytes,
      downloadMs,
      decodeMs: Date.now() - decodeStarted,
      peakHeapBytes: clipped.peakHeapBytes,
      peakRssBytes: clipped.peakRssBytes,
      fullRows: clipped.fullRows,
      fullCols: clipped.fullCols,
      clippedCells: clipped.window.width * clipped.window.height,
      axis: clipped.axis,
    },
  };
}

const BUCKET = 'https://noaa-mrms-pds.s3.amazonaws.com';

function fileStamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`;
}

function timeFromKey(key: string): string | null {
  const match = /(\d{8})-(\d{6})/.exec(key);
  if (!match) return null;
  const day = match[1];
  const clock = match[2];
  return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${clock.slice(0, 2)}:${clock.slice(2, 4)}:${clock.slice(4, 6)}.000Z`;
}

/** Keys in (start, end], oldest first. One list page is enough for a 20-minute window. */
export async function listMrmsKeys(folder: string, start: Date, end: Date, limit = 10): Promise<Array<{ key: string; validAt: string }>> {
  const day = fileStamp(start).slice(0, 8);
  const product = folder.split('/').pop() ?? folder;
  const prefix = `${folder}/${day}/`;
  const startAfter = `${prefix}MRMS_${product}_${fileStamp(new Date(start.getTime() - 1000))}`;
  const url = `${BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix)}&start-after=${encodeURIComponent(startAfter)}&max-keys=40`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MRMS list ${res.status}`);
  const text = await res.text();
  const found: Array<{ key: string; validAt: string }> = [];
  for (const match of text.matchAll(/<Key>([^<]+)<\/Key>/g)) {
    const key = match[1];
    const validAt = timeFromKey(key);
    if (!validAt) continue;
    const ms = Date.parse(validAt);
    if (ms <= start.getTime() || ms > end.getTime()) continue;
    found.push({ key, validAt });
  }
  found.sort((a, b) => a.validAt.localeCompare(b.validAt));
  return found.slice(-limit);
}

export function productUrl(key: string): string {
  return `${BUCKET}/${key}`;
}
