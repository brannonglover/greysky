/**
 * Regional MRMS history for motion. Frames keep their real timestamps.
 * A failed download is skipped. It is not replaced with a dry field.
 */
import { PNG } from 'pngjs';

import { LAYER, WMS_BASE } from '../mrms';
import { fieldFromPng, regionGeometry, type ObservationField } from './field';

export const REGION = {
  spanDeg: 3,
  width: 160,
  height: 160,
  historyMin: 15,
  maxFrames: 8,
} as const;

export type HistoryStats = {
  requested: number;
  usable: number;
  failed: number;
  /** Age of each usable frame relative to the issue time, oldest first. */
  ageSec: number[];
  /** Seconds between consecutive requested frames, including ones that failed. */
  gapSec: number[];
  downloadBytes: number;
  downloadMs: number;
  buildMs: number;
};

export type RegionalHistory = HistoryStats & {
  frames: ObservationField[];
};

function selectHistory(times: readonly string[], issueMs: number): string[] {
  const cutoff = issueMs - REGION.historyMin * 60_000;
  const picked = times
    .map((iso) => ({ iso, ms: Date.parse(iso) }))
    .filter((entry) => Number.isFinite(entry.ms) && entry.ms <= issueMs && entry.ms >= cutoff)
    .sort((a, b) => a.ms - b.ms);
  return picked.slice(-REGION.maxFrames).map((entry) => entry.iso);
}

async function fetchMap(
  isoTime: string,
  latitude: number,
  longitude: number,
): Promise<{ png: PNG; bytes: number } | null> {
  const west = longitude - REGION.spanDeg / 2;
  const east = longitude + REGION.spanDeg / 2;
  const south = latitude - REGION.spanDeg / 2;
  const north = latitude + REGION.spanDeg / 2;
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: LAYER,
    format: 'image/png',
    transparent: 'true',
    crs: 'EPSG:4326',
    bbox: `${south},${west},${north},${east}`,
    width: String(REGION.width),
    height: String(REGION.height),
    time: isoTime,
  });
  const res = await fetch(`${WMS_BASE}?${params.toString()}`);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  return { png: PNG.sync.read(buf), bytes: buf.length };
}

/**
 * Up to eight styled composite frames from the last 15 minutes, ending at the
 * newest observation at or before `issueMs`.
 */
export async function loadRegionalHistory(
  latitude: number,
  longitude: number,
  issueMs: number,
  times: readonly string[],
): Promise<RegionalHistory> {
  const requested = selectHistory(times, issueMs);
  const gapSec: number[] = [];
  for (let i = 1; i < requested.length; i += 1) {
    gapSec.push((Date.parse(requested[i]) - Date.parse(requested[i - 1])) / 1000);
  }
  const geometry = regionGeometry(latitude, longitude, REGION.spanDeg, REGION.width, REGION.height);
  const source = { id: 'mrms-cref-qcd', product: 'styled-composite-marshall-palmer' };
  const frames: ObservationField[] = [];
  const ageSec: number[] = [];
  let failed = 0;
  let downloadBytes = 0;
  let downloadMs = 0;
  let buildMs = 0;

  const batchStarted = Date.now();
  const results = await Promise.all(
    requested.map(async (iso) => {
      const fetched = await fetchMap(iso, latitude, longitude).catch(() => null);
      return { iso, fetched };
    }),
  );
  downloadMs = Date.now() - batchStarted;
  for (const result of results) {
    if (!result.fetched) {
      failed += 1;
      continue;
    }
    downloadBytes += result.fetched.bytes;
    const built = Date.now();
    const field = fieldFromPng(result.fetched.png, result.iso, geometry, source);
    buildMs += Date.now() - built;
    frames.push(field);
    ageSec.push((issueMs - Date.parse(result.iso)) / 1000);
  }
  frames.sort((a, b) => Date.parse(a.validAt) - Date.parse(b.validAt));
  ageSec.sort((a, b) => b - a);

  return {
    frames,
    requested: requested.length,
    usable: frames.length,
    failed,
    ageSec,
    gapSec,
    downloadBytes,
    downloadMs,
    buildMs,
  };
}
