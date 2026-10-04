/**
 * Version 1 case bundle. One regional MRMS history, many points.
 * Float32 rain rates are stored as written so a later predictor sees the same field.
 * The directory is local (`server/.nowcast-cases`) and is not a production store.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { FieldGeometry, FieldSource, ObservationField } from './field';
import { CELL_MISSING } from './field';
import type { PointNowcast } from './point';
import type { IntendedRegime } from './records';

export const CASE_SCHEMA_VERSION = 1 as const;
const MAGIC = 'NCF1';

export type StoredFrame = {
  validAt: string;
  file: string;
  source: FieldSource;
  geometry: FieldGeometry;
};

export type StoredVerification = {
  source: 'mrms-cref-qcd';
  leads: Array<{ leadMinutes: number; validAt: string | null; rainRateMmHr: number | null; dbz: number | null }>;
};

export type EnvironmentValue = {
  id: string;
  variable: string;
  level: string;
  product: string;
  validAt: string | null;
  units: string;
  point: number | null;
  nearbyMean: number | null;
  nearbyMax: number | null;
  radiusKm: number;
};

export type StoredPoint = {
  id: string;
  latitude: number;
  longitude: number;
  intendedRegime: IntendedRegime | null;
  note: string | null;
  /** Native-step member rates, step then member. Not part of the public API. */
  memberRates: Array<Array<number | null>>;
  forecast: PointNowcast;
  verification: StoredVerification | null;
  environment: EnvironmentValue[] | null;
};

export type CaseBundle = {
  schemaVersion: typeof CASE_SCHEMA_VERSION;
  observationTime: string;
  regionKey: string;
  centerLatitude: number;
  centerLongitude: number;
  predictorVersion: string;
  history: {
    requested: number;
    usable: number;
    failed: number;
    ageSec: number[];
    gapSec: number[];
  };
  frames: StoredFrame[];
  points: StoredPoint[];
  /** Byte sizes from the model index. A field listed here was not necessarily downloaded. */
  environmentInventory: Array<{ id: string; variable: string; level: string; product: string; bytes: number | null; fetched: boolean; rationale: string }> | null;
};

export function casesRoot(): string {
  return process.env.NOWCAST_CASES_DIR ?? path.join(process.cwd(), '.nowcast-cases');
}

export function bundleDir(regionKey: string, observationTime: string): string {
  const slug = `${observationTime.replace(/[:.]/g, '-')}_${regionKey.replace(/[^0-9a-zA-Z.-]+/g, '_')}`;
  return path.join(casesRoot(), slug);
}

export function writeFrame(file: string, field: ObservationField): void {
  const n = field.geometry.width * field.geometry.height;
  const header = Buffer.alloc(8);
  header.write(MAGIC, 0, 'ascii');
  header.writeUInt16LE(field.geometry.width, 4);
  header.writeUInt16LE(field.geometry.height, 6);
  const state = Buffer.from(field.state.buffer, field.state.byteOffset, field.state.byteLength);
  const rates = Buffer.alloc(n * 4);
  const copy = new Float32Array(field.rainRateMmHr);
  Buffer.from(copy.buffer).copy(rates);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([header, state, rates]));
}

export function readFrame(file: string, meta: StoredFrame): ObservationField {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== MAGIC) throw new Error(`Not a nowcast field: ${file}`);
  const width = buf.readUInt16LE(4);
  const height = buf.readUInt16LE(6);
  const n = width * height;
  const state = new Uint8Array(n);
  state.set(buf.subarray(8, 8 + n));
  const rainRateMmHr = new Float32Array(n);
  for (let i = 0; i < n; i += 1) rainRateMmHr[i] = buf.readFloatLE(8 + n + i * 4);
  if (state.length !== n) state.fill(CELL_MISSING);
  return {
    validAt: meta.validAt,
    geometry: meta.geometry,
    rainRateMmHr,
    state,
    source: meta.source,
  };
}

export function writeBundle(dir: string, bundle: CaseBundle, fields: ObservationField[]): void {
  fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
  fields.forEach((field, index) => {
    const name = bundle.frames[index]?.file ?? `frames/${index}.bin`;
    writeFrame(path.join(dir, name), field);
  });
  fs.writeFileSync(path.join(dir, 'case.json'), JSON.stringify(bundle));
}

export function readCase(dir: string): CaseBundle {
  const bundle = JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8')) as CaseBundle;
  if (bundle.schemaVersion !== CASE_SCHEMA_VERSION) throw new Error(`Unsupported case schema ${bundle.schemaVersion}`);
  return bundle;
}

export function readBundle(dir: string): { bundle: CaseBundle; fields: ObservationField[] } {
  const bundle = readCase(dir);
  const fields = bundle.frames.map((frame) => readFrame(path.join(dir, frame.file), frame));
  return { bundle, fields };
}

export function listBundleDirs(root = casesRoot()): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .map((name) => path.join(root, name))
    .filter((dir) => fs.existsSync(path.join(dir, 'case.json')));
}
