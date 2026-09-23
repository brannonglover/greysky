/**
 * Regression tests for the SPC outlook parser, against committed fixtures.
 *
 * Severe weather is seasonal and most days are quiet, so a live-only test
 * would exercise almost nothing for months at a stretch. The fixtures here
 * capture a genuine High Risk day (6 May 2024), a quiet day, and the specific
 * malformed and stale records SPC serves in practice.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  categoricalAt,
  hazardAt,
  isCurrent,
  isSevereCategory,
  outlookAt,
  pointInGeometry,
  type ProductSet,
} from '../lib/spc';

const FIXTURES = join(__dirname, '..', 'fixtures', 'spc');

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

function load(dir: string, file: string) {
  return JSON.parse(readFileSync(join(FIXTURES, dir, `${file}.json`), 'utf8'));
}

/** Inside the 6 May 2024 day-1 validity window (valid 1300Z, expires 07/1200Z). */
const ACTIVE_NOW = Date.UTC(2024, 4, 6, 18, 0);
/** Inside the captured quiet day's window. */
const QUIET_NOW = Date.UTC(2026, 8, 23, 21, 0);

// ---------------------------------------------------------------------------

console.log('\nstale products — the bug this suite exists for');
{
  // SPC serves day2otlk_prob with a 200 even when no such product is current.
  // The captured copy is an outlook from January 2020 carrying entirely
  // plausible 5% and 15% severe polygons.
  const stale = load('quiet', 'day2otlk_prob');
  const props = stale.features[0].properties;

  equal('fixture really is the 2020 artifact', [props.ISSUE, props.EXPIRE], ['202001300632', '202002011200']);
  check('and it does carry risk-shaped polygons', stale.features.some((f: any) => Number(f.properties.DN) > 0));
  check('isCurrent rejects it', !isCurrent(stale, QUIET_NOW));

  // The polygons sit over south Florida. Without the expiry check, someone
  // near Miami would be shown a 15% severe risk six years out of date.
  const inside = hazardAt(stale, -81.0, 26.0);
  check('point-in-polygon alone would have reported a risk', inside !== null);
  equal('and it would have read as a real 15% probability', inside?.probability, 0.15);

  const resolved = outlookAt(2, { prob: stale } as ProductSet, -81.0, 26.0, QUIET_NOW);
  equal('outlookAt discards it entirely', resolved, null);
}

console.log('\nactive day — 6 May 2024, High Risk');
{
  const cat = load('active', 'day1otlk_cat');
  const torn = load('active', 'day1otlk_torn');
  const wind = load('active', 'day1otlk_wind');
  const hail = load('active', 'day1otlk_hail');

  check('products are current at the fixture time', isCurrent(cat, ACTIVE_NOW));
  check('full categorical range present', ['TSTM', 'MRGL', 'SLGT', 'ENH', 'MDT', 'HIGH'].every((l) =>
    cat.features.some((f: any) => f.properties.LABEL === l)));

  // Central Oklahoma sat under the High Risk that day.
  const okc = categoricalAt(cat, -97.5, 35.47);
  equal('Oklahoma City resolves to HIGH', okc?.code, 'HIGH');
  check('carries SPC display text', (okc?.label ?? '').toLowerCase().includes('high'));

  // Overlapping categorical rings mean several polygons cover one point; the
  // most severe must win rather than whichever is encountered first.
  check('most severe category wins where rings overlap', okc?.code === 'HIGH');

  const tor = hazardAt(torn, -97.5, 35.47);
  check('tornado probability resolved', (tor?.probability ?? 0) > 0);
  check('and lands in the hatched significant area', tor?.significant === true);

  check('wind probability resolved', (hazardAt(wind, -97.5, 35.47)?.probability ?? 0) > 0);
  check('hail probability resolved', (hazardAt(hail, -97.5, 35.47)?.probability ?? 0) > 0);

  // Seattle did sit under the general-thunderstorm area that day, which is
  // not severe weather — so the raw lookup finds TSTM but the assembled
  // outlook must not surface anything.
  equal('raw lookup finds only general thunder', categoricalAt(cat, -122.33, 47.61)?.code, 'TSTM');
  check('which is not a severe category', !isSevereCategory('TSTM'));
  equal('Seattle has no tornado risk', hazardAt(torn, -122.33, 47.61), null);
  equal(
    'TSTM-only never becomes a surfaced outlook',
    outlookAt(1, { cat, torn, wind, hail }, -122.33, 47.61, ACTIVE_NOW),
    null,
  );

  const day = outlookAt(1, { cat, torn, wind, hail }, -97.5, 35.47, ACTIVE_NOW);
  equal('assembled outlook is day 1', day?.day, 1);
  equal('assembled categorical', day?.categorical?.code, 'HIGH');
  check('assembled tornado risk is significant', day?.tornado?.significant === true);
  equal('individual hazards suppress the combined fallback', day?.anySevere, null);
}

console.log('\nnon-probability labels inside probability products');
{
  // day1otlk_hail mixes CIG1 ("Conditional Intensity Group") with real
  // probabilities; the active day mixes in SIGN for the hatched area.
  const quietHail = load('quiet', 'day1otlk_hail');
  const labels = quietHail.features.map((f: any) => f.properties.LABEL);
  check('quiet hail fixture really contains CIG1', labels.includes('CIG1'));

  const risk = hazardAt(quietHail, -100, 40);
  check('CIG1 never becomes a probability', risk === null || risk.probability !== 1);
  check('no NaN leaks into the probability', risk === null || Number.isFinite(risk.probability));

  const activeTorn = load('active', 'day1otlk_torn');
  check('active tornado fixture contains SIGN', activeTorn.features.some((f: any) => f.properties.LABEL === 'SIGN'));
  const sign = hazardAt(activeTorn, -97.5, 35.47);
  check('SIGN sets significance, not probability', sign?.significant === true && sign.probability < 1);
}

console.log('\nDN:0 no-risk placeholders');
{
  const torn = load('quiet', 'day1otlk_torn');
  equal('fixture is the placeholder form', torn.features[0].properties.LABEL, 'Less Than 2% All Areas');
  equal('placeholder DN is zero', torn.features[0].properties.DN, 0);
  equal('never reported as a hazard', hazardAt(torn, -97.5, 35.47), null);

  const cat = load('quiet', 'day1otlk_cat');
  // The quiet day is TSTM/MRGL only — nothing severe enough to surface.
  const atlanta = categoricalAt(cat, -84.388, 33.749);
  check('quiet day resolves to nothing or a low category',
    atlanta === null || ['TSTM', 'MRGL'].includes(atlanta.code));
}

console.log('\ngeometry — holes and multipolygons');
{
  const doc = load('geometry', 'multipolygon-with-hole');
  const feature = doc.features[0];

  check('point inside the outer ring is inside', pointInGeometry(feature.geometry, -99, 31));
  check('point inside the hole is OUTSIDE', !pointInGeometry(feature.geometry, -95, 35));
  check('point in the second polygon is inside', pointInGeometry(feature.geometry, -77.5, 32.5));
  check('point beyond everything is outside', !pointInGeometry(feature.geometry, -60, 20));

  equal('categoricalAt honours the hole', categoricalAt(doc, -95, 35), null);
  equal('categoricalAt finds the outer ring', categoricalAt(doc, -99, 31)?.code, 'ENH');

  equal('empty GeometryCollection is never inside', pointInGeometry(doc.features[1].geometry, -99, 31), false);
}

console.log('\nquiet day end to end');
{
  const products: ProductSet = {
    cat: load('quiet', 'day1otlk_cat'),
    torn: load('quiet', 'day1otlk_torn'),
    wind: load('quiet', 'day1otlk_wind'),
    hail: load('quiet', 'day1otlk_hail'),
  };
  const day = outlookAt(1, products, -122.33, 47.61, QUIET_NOW);
  equal('no risk anywhere near Seattle on the quiet day', day, null);
}

// ---------------------------------------------------------------------------

if (failures > 0) {
  console.error(`\n${failures} check(s) failed\n`);
  process.exit(1);
}
console.log('\nall SPC outlook checks passed\n');
