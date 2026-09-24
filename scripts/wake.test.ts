/**
 * Wake scheduling invariants.
 *
 * `nextWakeAfter` derives entirely from the last *successful* fetch of each
 * source. The property that matters, and the one easiest to regress, is that
 * failure never buys time: a session in which the requests failed must leave
 * the device due no later than it already was.
 *
 * Run with: npx tsx scripts/wake.test.ts
 */

import {
  DUPLICATE_WAKE_MS,
  emptyRefreshState,
  nextWakeAfter,
  shouldAttempt,
  type RefreshState,
} from '../lib/wakeSchedule';

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

function state(patch: Partial<RefreshState>): RefreshState {
  return { ...emptyRefreshState, ...patch };
}

/** Everything confirmed just now. */
function allFresh(at: number): RefreshState {
  return state({
    forecast: at,
    alerts: at,
    tropical: at,
    outlook: at,
    regional: at,
    lastAttemptAt: at,
  });
}

console.log('\nfailure never buys time');
{
  // Same device, two readings. In the second, the app was opened and tried to
  // refresh, but every request failed — so no source timestamp moved.
  const before = allFresh(now - 40 * MIN);
  const afterFailedSession = state({ ...before, lastAttemptAt: now });

  check(
    'a failed session does not postpone the wake',
    nextWakeAfter(afterFailedSession, now) === nextWakeAfter(before, now),
    'lastAttemptAt must not feed into the due time',
  );
}

console.log('\nsuccess does postpone it');
{
  const stale = allFresh(now - 40 * MIN);
  const fresh = allFresh(now);
  check(
    'a successful refresh pushes the wake later',
    nextWakeAfter(fresh, now) > nextWakeAfter(stale, now),
  );
}

console.log('\nthe soonest-stale source drives the schedule');
{
  // Alerts want another look after two hours, tropical after six. A device
  // whose alerts are old is due even though everything else is current.
  const alertsOld = allFresh(now);
  alertsOld.alerts = now - 4 * HOUR;

  check(
    'an old alert fetch pulls the wake in to the retry floor',
    nextWakeAfter(alertsOld, now) === now + 20 * MIN,
    `got ${(nextWakeAfter(alertsOld, now) - now) / MIN} min`,
  );
}

console.log('\npartial failure pulls the wake closer than full success');
{
  const at = now - 10 * MIN;
  const everything = allFresh(at);
  const alertsFailed = allFresh(at);
  alertsFailed.alerts = now - 3 * HOUR; // this run did not refresh them

  check(
    'the run that lost alerts is due sooner',
    nextWakeAfter(alertsFailed, now) < nextWakeAfter(everything, now),
    `failed ${(nextWakeAfter(alertsFailed, now) - now) / MIN} min vs ok ${
      (nextWakeAfter(everything, now) - now) / MIN
    } min`,
  );
  check(
    'and it retries at the floor rather than the normal cadence',
    nextWakeAfter(alertsFailed, now) === now + 20 * MIN,
  );
}

console.log('\na healthy device is never due at the retry floor');
{
  // The floor exists for outages. If a fully successful refresh still came due
  // in twenty minutes, every device would be woken far past Apple's budget.
  const healthy = allFresh(now);
  check(
    'a fully refreshed device waits the real cadence',
    nextWakeAfter(healthy, now) === now + 2 * HOUR,
    `got ${(nextWakeAfter(healthy, now) - now) / MIN} min`,
  );
}

console.log('\nbounds hold');
{
  check(
    'a never-confirmed device still respects the minimum gap',
    nextWakeAfter(emptyRefreshState, now) === now + 20 * MIN,
    'Apple budgets background pushes at a few per hour; due-now must not mean wake-now',
  );

  // Everything confirmed far in the future would otherwise push the wake out
  // indefinitely; a quiet device still has to check in.
  const distant = allFresh(now + 30 * 24 * HOUR);
  check(
    'a very fresh device is still capped at the maximum gap',
    nextWakeAfter(distant, now) === now + 8 * HOUR,
    `got ${(nextWakeAfter(distant, now) - now) / HOUR} h`,
  );
}

// --- duplicate-wake suppression is per source, never per run ---------------

console.log('\na duplicate wake retries what failed and skips what succeeded');
{
  // The scenario that matters: a run 45 seconds ago in which the forecast
  // succeeded and the NWS alert fetch failed. A second legitimate wake arrives.
  // Alerts must be retried; re-fetching the forecast would be waste.
  const justNow = now - 45_000;
  const partial = state({
    forecast: justNow,
    tropical: justNow,
    outlook: justNow,
    regional: justNow,
    alerts: now - 3 * HOUR, // failed, so never advanced
    lastAttemptAt: justNow,
  });

  check('the failed source is retried', shouldAttempt(partial.alerts, now) === true);
  check('the succeeded source is skipped', shouldAttempt(partial.forecast, now) === false);
  check(
    'and the skip is not a blanket one — other fresh sources also skip',
    shouldAttempt(partial.tropical, now) === false &&
      shouldAttempt(partial.regional, now) === false,
  );
}

console.log('\nthe suppression window is a floor on success only');
{
  check('a never-fetched source is always attempted', shouldAttempt(0, now) === true);
  check(
    'a source that succeeded within the window is skipped',
    shouldAttempt(now - (DUPLICATE_WAKE_MS - 1_000), now) === false,
  );
  check(
    'and attempted again once past it',
    shouldAttempt(now - DUPLICATE_WAKE_MS, now) === true,
  );
  check(
    'a normal wake hours later attempts everything',
    shouldAttempt(now - 2 * HOUR, now) === true,
  );
}

console.log(
  failures === 0 ? '\nall wake scheduling invariants hold\n' : `\n${failures} broken\n`,
);
process.exit(failures === 0 ? 0 : 1);
