/**
 * Correctness invariants for the cached alert set.
 *
 * A cached alert set is evidence that those alerts existed when it was
 * confirmed. It is never evidence that they are still in effect, because a
 * cancellation is invisible from the cached copy — a canceled warning keeps
 * whatever future end time it was issued with. These assertions pin down the
 * rules that follow from that — including the four distinct states the UI can
 * report — and guard against the two failure modes that matter:
 *
 *   false negative — a live warning disappearing because a request failed
 *   false positive — a withdrawn warning still presented as currently confirmed
 *
 * Run with: npx tsx scripts/alerts.test.ts
 */

import {
  ALERT_CONFIRMED_MS,
  alertConfidence,
  nextAlertSnapshot,
  type AlertSnapshot,
} from '../lib/weather';
import type { WeatherAlert } from '../lib/types';

/** Confidence for a set confirmed at `verifiedAt`, after an attempt finished. */
function confidence(verifiedAt: number, attempted = true, at = Date.now()) {
  return alertConfidence({ verifiedAt, attempted }, at);
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const now = Date.now();

let failures = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

function alert(id: string, endsInMs: number | null): WeatherAlert {
  return {
    id,
    event: 'Tornado Warning',
    headline: 'Tornado Warning issued',
    description: '',
    severity: 'Extreme',
    ends: endsInMs === null ? undefined : new Date(now + endsInMs).toISOString(),
  };
}

function ok<T>(value: T): PromiseSettledResult<T> {
  return { status: 'fulfilled', value };
}

function failed(): PromiseSettledResult<WeatherAlert[]> {
  return { status: 'rejected', reason: new Error('NWS unavailable') };
}

// --- a failed fetch must never read as "no alerts" -------------------------

console.log('\na failed fetch preserves the last confirmed set');
{
  const previous: AlertSnapshot = { alerts: [alert('tor-1', 30 * MIN)], verifiedAt: now - 5 * MIN };
  const next = nextAlertSnapshot(previous, failed(), now);

  check('the live warning survives the failure', next.alerts.length === 1);
  check('and keeps its identity', next.alerts[0]?.id === 'tor-1');
  check(
    'verifiedAt is NOT advanced by a failure',
    next.verifiedAt === previous.verifiedAt,
    `got ${next.verifiedAt}, expected ${previous.verifiedAt}`,
  );
}

console.log('\na failure with nothing cached yet claims nothing');
{
  const next = nextAlertSnapshot(null, failed(), now);
  check('no alerts are invented', next.alerts.length === 0);
  check('and the set is marked never-confirmed', next.verifiedAt === 0);
  check('which reads as unavailable once attempted', confidence(0, true, now) === 'unavailable');
}

// --- only a successful fetch may remove an alert ---------------------------

console.log('\nonly a successful fetch may remove an alert');
{
  const previous: AlertSnapshot = { alerts: [alert('tor-1', 30 * MIN)], verifiedAt: now - 5 * MIN };

  // NWS canceling the warning is reported as a successful fetch returning
  // nothing. That, and only that, clears it.
  const cleared = nextAlertSnapshot(previous, ok([]), now);
  check('a confirmed empty response clears the warning', cleared.alerts.length === 0);
  check('and stamps a fresh confirmation', cleared.verifiedAt === now);
  check('so the UI treats it as current', confidence(cleared.verifiedAt, true, now) === 'confirmed');
}

console.log('\na canceled warning is not inferable from the cached copy');
{
  // The defining case: NWS canceled this warning, but the cached copy still
  // carries a future end time. Nothing local can tell. The only safe response
  // is to keep showing it while marking how old the confirmation is — never to
  // invent a shorter local expiry, which would hide live warnings instead.
  const stillFutureEnd = alert('tor-1', 45 * MIN);
  const previous: AlertSnapshot = { alerts: [stillFutureEnd], verifiedAt: now - 40 * MIN };
  const next = nextAlertSnapshot(previous, failed(), now);

  check('it is still shown rather than silently dropped', next.alerts.length === 1);
  check(
    'but it is no longer presented as confirmed',
    confidence(next.verifiedAt, true, now) === 'stale',
  );
}

// --- the confirmation window ----------------------------------------------

console.log('\nconfirmation decays with age, not with the alert');
{
  check('a just-fetched set is confirmed', confidence(now, true, now) === 'confirmed');
  check(
    'still confirmed at the edge of the window',
    confidence(now - ALERT_CONFIRMED_MS, true, now) === 'confirmed',
  );
  check(
    'stale one minute past it',
    confidence(now - ALERT_CONFIRMED_MS - MIN, true, now) === 'stale',
  );
}

console.log('\nthe window clears the foreground refresh cadence');
{
  // The ten-minute auto-refresh ticks once a minute, so a window of exactly
  // ten minutes guaranteed a stale flicker before every renewal. Anything
  // inside the cadence plus a tick must still read as confirmed.
  check('fifteen minutes, not ten', ALERT_CONFIRMED_MS === 15 * 60_000);
  check(
    'a set renewed on the normal cadence never flickers',
    confidence(now - 11 * MIN, true, now) === 'confirmed',
    'eleven minutes is one refresh cadence plus a timer tick',
  );
}

// --- the four states are genuinely distinct ------------------------------

console.log('\na cold start is not an outage');
{
  check(
    'nothing confirmed and no attempt finished reads as checking',
    confidence(0, false, now) === 'checking',
  );
  check(
    'the same state after a failed attempt reads as unavailable',
    confidence(0, true, now) === 'unavailable',
  );
  check(
    'and those are different claims',
    confidence(0, false, now) !== confidence(0, true, now),
    'a first load must not be reported as the alert feed being down',
  );
}

console.log('\nthe full lifecycle walks all four states');
{
  // checking → confirmed → stale → confirmed, which is what a device does
  // across a cold start, a good fetch, a quiet hour, and a recovery.
  check('1. cold start', confidence(0, false, now) === 'checking');
  check('2. first success', confidence(now, true, now) === 'confirmed');
  check('3. ages out', confidence(now - 20 * MIN, true, now) === 'stale');
  check('4. recovery re-confirms', confidence(now, true, now) === 'confirmed');

  // And the branch that never reaches a confirmation.
  check('cold start whose attempt failed', confidence(0, true, now) === 'unavailable');
}

console.log('\nattempted is only consulted when nothing was ever confirmed');
{
  // Once something has been confirmed, whether the latest attempt finished is
  // irrelevant — age alone decides.
  check(
    'a confirmed set ignores the attempt flag',
    confidence(now, false, now) === confidence(now, true, now),
  );
  check(
    'a stale set ignores it too',
    confidence(now - HOUR, false, now) === confidence(now - HOUR, true, now),
  );
}

console.log('\nswitching places never inherits the previous place’s alerts');
{
  // Guarded in AppContext by keying the snapshot to selectedId; this pins the
  // contract the helper relies on — a null `previous` yields an empty set
  // rather than whatever was last seen somewhere else.
  const next = nextAlertSnapshot(null, failed(), now);
  check('an unkeyed failure yields no alerts', next.alerts.length === 0);
}

console.log(
  failures === 0
    ? '\nall alert cache invariants hold\n'
    : `\n${failures} alert cache invariant(s) broken\n`,
);
process.exit(failures === 0 ? 0 : 1);
