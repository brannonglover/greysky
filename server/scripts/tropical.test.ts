/**
 * Regression tests for the NHC advisory parser.
 *
 * These run against committed fixtures rather than the live feed on purpose:
 * the storms NHC is tracking change constantly and disappear entirely between
 * seasons, so a live-only test silently exercises nothing in January. The
 * live check lives in tropical-live.ts and is a format check, not a test.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  extractAdvisoryText,
  hasForecastTrack,
  parseAdvisoryNumber,
  parseForecastTrack,
  type TrackPoint,
} from '../lib/tropical';

const FIXTURES = join(__dirname, '..', 'fixtures', 'tropical');

let failures = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

function equal(name: string, actual: unknown, expected: unknown): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, same, same ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function fixture(file: string): string {
  return readFileSync(join(FIXTURES, file), 'utf8');
}

/** Advisories are issued at a fixed UTC time; fixtures are all 23/1500Z. */
const ISSUED = Date.UTC(2026, 8, 23, 15, 0);

// ---------------------------------------------------------------------------

console.log('\nhurricane.txt — Odalys, advisory 14');
{
  const track = parseForecastTrack(fixture('hurricane.txt'), ISSUED);

  equal('point count (1 analysis + 6 forecast + 2 outlook)', track.length, 9);

  equal('analysis flagged only on the first point', track.map((p) => p.analysis), [
    true, false, false, false, false, false, false, false, false,
  ]);
  equal('analysis position', [track[0].latitude, track[0].longitude], [16.0, -127.9]);
  equal('analysis valid time', new Date(track[0].time).toISOString(), '2026-09-23T15:00:00.000Z');
  equal('analysis max wind / gust', [track[0].maxWindKt, track[0].gustKt], [65, 80]);
  equal('analysis 34 kt radii', track[0].radii34, { ne: 90, se: 130, sw: 60, nw: 70 });
  equal('analysis 64 kt radii', track[0].radii64, { ne: 10, se: 10, sw: 0, nw: 0 });
  check('analysis does not pick up the SEAS radii line', track[0].radii50?.ne !== 180);

  equal('first forecast position', [track[1].latitude, track[1].longitude], [16.2, -126.9]);
  equal('first forecast valid time', new Date(track[1].time).toISOString(), '2026-09-24T00:00:00.000Z');
  equal('first forecast max wind / gust', [track[1].maxWindKt, track[1].gustKt], [70, 85]);
  equal('first forecast 34 kt radii', track[1].radii34, { ne: 100, se: 130, sw: 60, nw: 70 });
  equal('first forecast 64 kt radii', track[1].radii64, { ne: 10, se: 10, sw: 0, nw: 10 });

  check('times strictly increase', track.every((p, i) => i === 0 || p.time > track[i - 1].time));
  equal('outlook flags', track.map((p) => p.outlook), [
    false, false, false, false, false, false, false, true, true,
  ]);
  equal('last outlook position', [track[8].latitude, track[8].longitude], [22.7, -121.1]);
  equal('advisory number', parseAdvisoryNumber(fixture('hurricane.txt')), '14');
}

console.log('\nhurricane-major.txt — Polo, category 4');
{
  const track = parseForecastTrack(fixture('hurricane-major.txt'), ISSUED);

  equal('point count', track.length, 9);
  equal('analysis wind', track[0].maxWindKt, 130);
  equal('peak forecast wind', Math.max(...track.map((p) => p.maxWindKt)), 130);
  check('every non-outlook point has 64 kt radii', track.slice(0, 7).every((p) => p.radii64 !== null));
  equal('day-5 outlook drops 64 kt radii', track[8].radii64, null);
  equal('day-5 outlook keeps 50 kt radii', track[8].radii50, { ne: 50, se: 50, sw: 45, nw: 45 });
}

console.log('\ndepression.txt — Fifteen-E, strengthening');
{
  const track = parseForecastTrack(fixture('depression.txt'), ISSUED);

  // A 30 kt depression has no wind field at all yet, then grows one as it
  // intensifies. Absent radii must read as null, never as a zero-radius circle.
  equal('analysis point has no radii of any strength', [
    track[0].radii34,
    track[0].radii50,
    track[0].radii64,
  ], [null, null, null]);
  equal('first forecast point has only 34 kt radii', [
    track[1].radii34 !== null,
    track[1].radii50,
    track[1].radii64,
  ], [true, null, null]);
  equal('second forecast point gains 50 kt', track[2].radii50, { ne: 20, se: 0, sw: 0, nw: 0 });
  equal('third forecast point gains 64 kt', track[3].radii64, { ne: 15, se: 0, sw: 0, nw: 0 });
  check('wind increases across the track', track[0].maxWindKt < track[5].maxWindKt);
}

console.log('\nmonth-roll.txt — advisory issued 30 Sep, track runs into October');
{
  const issued = Date.UTC(2026, 8, 30, 15, 0);
  const track = parseForecastTrack(fixture('month-roll.txt'), issued);

  equal('analysis stays in September', new Date(track[0].time).toISOString(), '2026-09-30T15:00:00.000Z');
  equal('first forecast rolls to 1 October', new Date(track[1].time).toISOString(), '2026-10-01T00:00:00.000Z');
  equal('last point', new Date(track[8].time).toISOString(), '2026-10-05T12:00:00.000Z');
  check('times strictly increase across the boundary', track.every((p, i) => i === 0 || p.time > track[i - 1].time));
  check('no point lands before issuance', track.every((p) => p.time >= issued));
}

console.log('\nwrapped.shtml — <pre> extraction and entity decoding');
{
  const raw = fixture('wrapped.shtml');
  const text = extractAdvisoryText(raw);

  check('strips surrounding HTML', !text.includes('<body>') && !text.includes('textproduct'));
  check('decodes entities', !text.includes('&lt;') && !text.includes('&amp;'));

  const wrapped = parseForecastTrack(raw, ISSUED);
  const bare = parseForecastTrack(fixture('hurricane.txt'), ISSUED);
  equal('wrapped and bare advisories parse identically', wrapped, bare);
}

console.log('\nanalysis-only.txt — position intact, forecast section missing');
{
  const track = parseForecastTrack(fixture('analysis-only.txt'), ISSUED);

  // Worth keeping: this still contributes the current wind radii, which is
  // what tells us whether someone is inside the wind field right now.
  equal('keeps the analysis point', track.length, 1);
  equal('analysis radii survive', track[0].radii34, { ne: 90, se: 130, sw: 60, nw: 70 });
  check('but claims no forecast track', !hasForecastTrack(track));
}

console.log('\ngarbled.txt — nothing usable');
{
  const track = parseForecastTrack(fixture('garbled.txt'), ISSUED);

  equal('yields no points at all', track.length, 0);
  check('claims no forecast track', !hasForecastTrack(track));
  check('does not throw on mangled coordinate lines', true);
}

console.log('\nstorm-level degradation');
{
  // Mirrors what the endpoint does across a Promise.allSettled batch: every
  // storm comes back, and a bad advisory costs only that storm its track.
  const cases = [
    { id: 'full', track: parseForecastTrack(fixture('hurricane.txt'), ISSUED) },
    { id: 'analysis-only', track: parseForecastTrack(fixture('analysis-only.txt'), ISSUED) },
    { id: 'garbled', track: parseForecastTrack(fixture('garbled.txt'), ISSUED) },
  ].map((entry) => ({ ...entry, trackAvailable: hasForecastTrack(entry.track) }));

  equal('only the full advisory claims a track', cases.map((c) => c.trackAvailable), [true, false, false]);
  equal('every storm is still returned', cases.length, 3);
  equal('the good storm keeps its full track', cases[0].track.length, 9);
}

// ---------------------------------------------------------------------------

const sanity: TrackPoint[] = parseForecastTrack(fixture('hurricane.txt'), ISSUED);
check('\nall latitudes are plausible', sanity.every((p) => Math.abs(p.latitude) <= 90));
check('all longitudes are plausible', sanity.every((p) => Math.abs(p.longitude) <= 180));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed\n`);
  process.exit(1);
}
console.log('\nall tropical parser checks passed\n');
