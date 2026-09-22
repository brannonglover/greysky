/**
 * Regression test: a partially published HRRR run must not shorten the
 * timeline or delete blended frames.
 *
 * NCEP writes wrfsubh files progressively. wrfsubhf01 covers forecast minutes
 * 15-60, f02 covers 75-120, and so on. A run is normally discovered about 55
 * minutes after its init hour, at which point f01 alone reaches only ~5
 * minutes past now. Selecting a run purely on "f01 exists" therefore opened a
 * several-minute window every hour where the service had a run it could not
 * forecast from: HRRR samples disappeared, every blend fell back to weight 0,
 * and the manifest collapsed to nowcast-only truncated at +45.
 *
 * Observed live before the fix:
 *   15:56  run 15:00Z  files=[1]    -> 1 frame  -> manifest 12 obs + 9 nowcast
 *   15:57  run 15:00Z  files=[1,2]  -> 5 frames -> manifest 12 obs + 6 + 6
 */
import { requiredFileIndex, selectRun, type FileProbe } from '../lib/hrrr';

let failures = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n        ${detail}`);
  if (!ok) failures += 1;
}

const hour = (h: number) => new Date(Date.UTC(2026, 8, 22, h, 0, 0));
const at = (h: number, m: number) => new Date(Date.UTC(2026, 8, 22, h, m, 0));
/** The horizon a 60-minute future window actually asks for. */
const HORIZON = 75;

/** Only these runs have any files; each maps to the highest index published. */
function probeFor(published: Record<string, number>): FileProbe {
  return async (run, fileIndex) => {
    const key = run.toISOString().slice(11, 16);
    return (published[key] ?? 0) >= fileIndex;
  };
}

async function main(): Promise<void> {
  // Discovery time: 15:56 is 56 min after the 15:00Z run, so it is the newest
  // candidate and needs file ceil((56+75)/60) = 3 to cover the horizon.
  const now = at(15, 56);
  check(
    'required file index accounts for run age',
    requiredFileIndex(56, HORIZON) === 3 && requiredFileIndex(116, HORIZON) === 4,
    `56 min old -> f03, 116 min old -> f04 (horizon ${HORIZON} min)`,
  );

  // 1. Newest run fully available.
  let run = await selectRun(now, HORIZON, probeFor({ '15:00': 4, '14:00': 4 }));
  check('newest run fully available', run.getTime() === hour(15).getTime(),
    `chose ${run.toISOString().slice(11, 16)}Z, expected 15:00Z`);

  // 2. Newest run has only wrfsubhf01 — the exact failure observed in production.
  run = await selectRun(now, HORIZON, probeFor({ '15:00': 1, '14:00': 4 }));
  check('newest run has only f01 -> falls back', run.getTime() === hour(14).getTime(),
    `chose ${run.toISOString().slice(11, 16)}Z, expected 14:00Z`);

  // 3. Newest run has f01+f02 but still cannot reach the horizon (needs f03).
  run = await selectRun(now, HORIZON, probeFor({ '15:00': 2, '14:00': 4 }));
  check('newest run has f01+f02 but horizon needs f03', run.getTime() === hour(14).getTime(),
    `chose ${run.toISOString().slice(11, 16)}Z, expected 14:00Z`);

  // 4. wrfsubh only reaches f+240, so a run much older than ~165 minutes
  //    cannot serve a 75-minute horizon at all. When no candidate is both
  //    complete and in range, keep the newest partial run rather than an
  //    older one that could never cover the window.
  check(
    'a run too old cannot cover the horizon regardless of completeness',
    requiredFileIndex(176, HORIZON) > 4,
    `176 min old needs f0${requiredFileIndex(176, HORIZON)}, but only f01-f04 exist`,
  );
  run = await selectRun(now, HORIZON, probeFor({ '15:00': 1, '14:00': 2, '13:00': 4 }));
  check('keeps newest partial when nothing complete is in range', run.getTime() === hour(15).getTime(),
    `chose ${run.toISOString().slice(11, 16)}Z, expected 15:00Z (14:00Z incomplete, 13:00Z out of range)`);

  // 5. Transitions back to the newest run once it is sufficiently complete.
  run = await selectRun(now, HORIZON, probeFor({ '15:00': 3, '14:00': 4 }));
  check('returns to newest run once complete', run.getTime() === hour(15).getTime(),
    `chose ${run.toISOString().slice(11, 16)}Z, expected 15:00Z`);

  // 6. Horizon is retained throughout: whichever run is chosen must cover it.
  for (const [label, published] of [
    ['fully published', { '15:00': 4, '14:00': 4 }],
    ['f01 only', { '15:00': 1, '14:00': 4 }],
    ['f01+f02', { '15:00': 2, '14:00': 4 }],
  ] as const) {
    const chosen = await selectRun(now, HORIZON, probeFor(published));
    const ageMin = (now.getTime() - chosen.getTime()) / 60_000;
    const needed = requiredFileIndex(ageMin, HORIZON);
    const have = (published as Record<string, number>)[chosen.toISOString().slice(11, 16)] ?? 0;
    check(`horizon retained (${label})`, have >= needed,
      `chose ${chosen.toISOString().slice(11, 16)}Z, needs f0${needed}, has f0${have}`);
  }

  // 7. Nothing complete anywhere: still return the partial run rather than throw,
  //    so the timeline degrades instead of vanishing.
  run = await selectRun(now, HORIZON, probeFor({ '15:00': 1 }));
  check('degrades rather than throwing', run.getTime() === hour(15).getTime(),
    `chose ${run.toISOString().slice(11, 16)}Z (partial) instead of failing`);

  console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
