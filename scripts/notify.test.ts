/**
 * The SPC outlook notification state machine.
 *
 * SPC reissues the day-1 outlook five times daily and a risk period stays in
 * view for three days, so the difference between "notify on change" and
 * "notify on presence" is the difference between a useful alert and fifteen
 * identical ones. The first sighting must still get through.
 *
 * Run with: npx tsx scripts/notify.test.ts
 */

import {
  decideOutlookNotification,
  type CategoryCode,
  type DayOutlook,
  type OutlookNotifyState,
} from '../lib/spc';

const H = 3_600_000;
const NOW = Date.UTC(2026, 3, 14, 18, 0);

let failures = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

/** A risk period identified by when its window closes, as SPC windows are. */
function outlook(code: CategoryCode | null, day: 1 | 2 | 3, validTo: number, hazards = false): DayOutlook {
  return {
    day,
    issued: NOW,
    validFrom: validTo - 24 * H,
    validTo,
    categorical: code ? { code, label: `${code} Risk` } : null,
    tornado: hazards ? { probability: 0.1, significant: false } : null,
    wind: null,
    hail: null,
    anySevere: null,
  };
}

const THURSDAY = Date.UTC(2026, 3, 17, 12, 0);
const FRIDAY = Date.UTC(2026, 3, 18, 12, 0);

function run(days: DayOutlook[], previous: Record<string, OutlookNotifyState> = {}) {
  return decideOutlookNotification(days, previous, NOW);
}

// ---------------------------------------------------------------------------

console.log('\nfirst sighting must notify');
{
  const { announce, next } = run([outlook('ENH', 2, THURSDAY)]);
  check('a brand new Enhanced Risk announces', announce !== null);
  check('and is recorded', (Object.values(next)[0] as OutlookNotifyState | undefined)?.category === 'ENH');
}

console.log('\nunchanged reissue stays silent');
{
  const first = run([outlook('ENH', 2, THURSDAY)]);
  // SPC reissues the identical outlook a few hours later.
  const second = run([outlook('ENH', 2, THURSDAY)], first.next);
  check('the same risk does not announce twice', second.announce === null);

  // And again, and again.
  const third = run([outlook('ENH', 2, THURSDAY)], second.next);
  const fourth = run([outlook('ENH', 1, THURSDAY)], third.next);
  check('nor on the third reissue', third.announce === null);
  check('nor when it slides from day 2 to day 1', fourth.announce === null,
    'the key must not depend on the day number');
}

console.log('\nmaterial upgrade notifies again');
{
  const first = run([outlook('SLGT', 2, THURSDAY)]);
  check('Slight Risk announces first', first.announce !== null);

  const upgraded = run([outlook('ENH', 2, THURSDAY)], first.next);
  check('Slight → Enhanced announces again', upgraded.announce !== null);
  check('and records the new level', (Object.values(upgraded.next)[0] as OutlookNotifyState | undefined)?.category === 'ENH');

  const again = run([outlook('ENH', 2, THURSDAY)], upgraded.next);
  check('then falls silent at the new level', again.announce === null);
}

console.log('\ndowngrade is silent but remembered');
{
  const high = run([outlook('MDT', 2, THURSDAY)]);
  const down = run([outlook('SLGT', 2, THURSDAY)], high.next);
  check('Moderate → Slight does not announce', down.announce === null);
  check('but the lower level is recorded', (Object.values(down.next)[0] as OutlookNotifyState | undefined)?.category === 'SLGT');

  // The risk climbing back up is news again.
  const backUp = run([outlook('ENH', 2, THURSDAY)], down.next);
  check('Slight → Enhanced afterwards announces', backUp.announce !== null,
    'a downgrade must not permanently suppress later upgrades');
}

console.log('\ngeneral thunderstorms are never announced');
{
  const { announce, next } = run([outlook('TSTM', 1, THURSDAY)]);
  check('TSTM alone does not announce', announce === null);
  check('and is not recorded', Object.keys(next).length === 0);

  // But a categorical-free outlook carrying real hazard probabilities is real.
  const hazardOnly = run([outlook(null, 2, THURSDAY, true)]);
  check('hazard probabilities without a category still announce', hazardOnly.announce !== null);
}

console.log('\nseveral risk periods at once');
{
  const { announce } = run([
    outlook('ENH', 3, FRIDAY),
    outlook('SLGT', 2, THURSDAY),
  ]);
  check('the nearest risk period leads', announce?.validTo === THURSDAY,
    `announced ${announce?.validTo === FRIDAY ? 'Friday' : 'something else'}`);

  const both = run([outlook('ENH', 3, FRIDAY), outlook('SLGT', 2, THURSDAY)]);
  check('both are recorded even though only one announced', Object.keys(both.next).length === 2);
}

console.log('\nexpired risk periods are pruned');
{
  const stale: Record<string, OutlookNotifyState> = {
    'spc:1': { category: 'ENH', validTo: NOW - 48 * H, notifiedAt: NOW - 72 * H },
    'spc:2': { category: 'SLGT', validTo: NOW + 48 * H, notifiedAt: NOW - H },
  };
  const { next } = run([], stale);
  check('past risk periods drop out', next['spc:1'] === undefined);
  check('future ones are kept', next['spc:2'] !== undefined);
}

console.log('\nan empty outlook list changes nothing');
{
  const seeded = run([outlook('ENH', 2, THURSDAY)]);
  const quiet = run([], seeded.next);
  check('nothing announces', quiet.announce === null);
  check('and the record survives for the still-future period', Object.keys(quiet.next).length === 1);
}

// ---------------------------------------------------------------------------

if (failures > 0) {
  console.error(`\n${failures} check(s) failed\n`);
  process.exit(1);
}
console.log('\nall outlook notification transitions hold\n');
