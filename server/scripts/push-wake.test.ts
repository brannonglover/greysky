/**
 * Hygiene rules for the silent-push wake drain.
 *
 * The server must never invent weather judgments. What it *does* own is APNs
 * budget: a floor between pushes and a daily cap. Those rules are easy to
 * regress into "wake every device every tick", so they are pinned here.
 *
 * Run with: npx tsx scripts/push-wake.test.ts
 */

import {
  decideWake,
  DORMANT_MS,
  SERVER_DAILY_CAP,
  SERVER_PUSH_FLOOR_MS,
} from '../lib/push/wake';
import type { DeviceRecord } from '../lib/push/store';

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

function device(patch: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    token: 'ExponentPushToken[test]',
    platform: 'ios',
    appVersion: '3.2.0',
    lastRefreshAt: now - 60_000,
    nextWakeAfter: now - 1,
    lastPushAt: 0,
    pushCount: 0,
    pushDay: '',
    updatedAt: now - 60_000,
    ...patch,
  };
}

console.log('\nhealthy due device is sent');
{
  const decision = decideWake(device(), now);
  check('send', decision.action === 'send');
}

console.log('\nmissing / empty records are skipped');
{
  check('null → missing', decideWake(null, now).action === 'skip');
  check(
    'empty token → no-token',
    decideWake(device({ token: '' }), now).action === 'skip' &&
      (decideWake(device({ token: '' }), now) as { reason: string }).reason === 'no-token',
  );
}

console.log('\ndormant installs are culled');
{
  const decision = decideWake(
    device({
      lastRefreshAt: now - DORMANT_MS - 1,
      updatedAt: now - DORMANT_MS - 1,
    }),
    now,
  );
  check(
    'no activity in 14 days → dormant',
    decision.action === 'skip' && decision.reason === 'dormant',
  );
}

console.log('\nper-device floor');
{
  const decision = decideWake(
    device({ lastPushAt: now - SERVER_PUSH_FLOOR_MS + 5_000 }),
    now,
  );
  check(
    'pushed 15 min ago → floor',
    decision.action === 'skip' && decision.reason === 'floor',
  );
  check(
    'pushed 20 min ago → send',
    decideWake(device({ lastPushAt: now - SERVER_PUSH_FLOOR_MS }), now).action === 'send',
  );
}

console.log('\ndaily cap');
{
  const decision = decideWake(device({ pushCount: SERVER_DAILY_CAP }), now);
  check(
    'at the cap → budget',
    decision.action === 'skip' && decision.reason === 'budget',
  );
  check(
    'under the cap → send',
    decideWake(device({ pushCount: SERVER_DAILY_CAP - 1 }), now).action === 'send',
  );
}

console.log(
  failures === 0 ? '\nall push wake hygiene rules hold\n' : `\n${failures} broken\n`,
);
process.exit(failures === 0 ? 0 : 1);
