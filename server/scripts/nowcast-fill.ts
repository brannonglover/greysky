/**
 * Fill verifying observations into cases that were archived before those
 * frames existed. Does not recapture the forecast or the motion fields.
 */
import { observedTimes } from '../lib/mrms';
import { fillOpenVerification } from '../lib/precipNowcast/verifyFill';

async function main() {
  const times = await observedTimes();
  const latest = times[times.length - 1];
  const nowMs = latest ? Date.parse(latest) : Date.now();
  const filled = await fillOpenVerification(times, nowMs);
  console.log(`updated ${filled.bundles} case(s), ${filled.leads} lead(s)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
