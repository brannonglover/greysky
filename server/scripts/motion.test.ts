/**
 * Regression test: the nowcast must actually advect.
 *
 * Background. Motion is recovered by searching for the INTEGER pixel shift
 * that best aligns two echo masks over CONUS. That only works if a realistic
 * storm moves more than one pixel over the lookback window.
 *
 * The original grid was 320x160 across roughly 6,570 km of CONUS, i.e. about
 * 20.5 km per pixel. A 40 km/h storm covers ~27 km in the 40-minute lookback —
 * barely one pixel — so the search returned dx=0, dy=0 and the "nowcast"
 * silently degraded into a frozen copy of the last observation. It produced
 * plausible-looking frames, so nothing failed loudly; the first 15 minutes of
 * the timeline simply stopped forecasting.
 *
 * At 640x320 (~10.3 km/px) the same motion spans 2-3 px and is recoverable.
 *
 * This test drives the pure search with synthetic storms so a future
 * downsampling or "optimisation" cannot quietly reintroduce u=0, v=0.
 */
import {
  estimateShift,
  motionPixelSize,
  shiftToMotion,
  MOTION_GRID,
  MOTION_MAX_SHIFT,
} from '../lib/nowcast';

/** Slowest storm we insist on resolving, and the lookback we estimate over. */
const SLOW_STORM_KMH = 40;
const LOOKBACK_MIN = 40;

let failures = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n        ${detail}`);
  if (!ok) failures += 1;
}

/** A few blobs, so the search has structure to lock onto rather than one disc. */
function stormField(width: number, height: number, shiftX: number, shiftY: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  const blobs = [
    { cx: 0.30, cy: 0.45, r: 0.055 },
    { cx: 0.46, cy: 0.38, r: 0.035 },
    { cx: 0.62, cy: 0.55, r: 0.045 },
    { cx: 0.72, cy: 0.35, r: 0.025 },
  ];
  for (const b of blobs) {
    const cx = b.cx * width + shiftX;
    const cy = b.cy * height + shiftY;
    const r = b.r * width;
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(height, Math.ceil(cy + r)); y += 1) {
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(width, Math.ceil(cx + r)); x += 1) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}

const { width, height } = MOTION_GRID;
const px = motionPixelSize(width, height);
const kmPerPx = px.x / 1000;
const travelKm = (SLOW_STORM_KMH * LOOKBACK_MIN) / 60;
const expectedPx = travelKm / kmPerPx;

console.log(`motion grid ${width}x${height} -> ${kmPerPx.toFixed(1)} km/px`);
console.log(`${SLOW_STORM_KMH} km/h over ${LOOKBACK_MIN} min = ${travelKm.toFixed(0)} km = ${expectedPx.toFixed(1)} px\n`);

// 1. The grid must be able to resolve a slow storm at all.
check(
  'grid resolves a slow storm',
  expectedPx >= 2,
  `${expectedPx.toFixed(1)} px of travel; needs >= 2 px for an integer search to find it`,
);

// 2. A known displacement must come back non-zero and roughly correct.
const dxTrue = Math.round(expectedPx);
const dyTrue = -1;
const before = stormField(width, height, 0, 0);
const after = stormField(width, height, dxTrue, dyTrue);
const found = estimateShift(before, after, width, height);

check(
  'recovers a non-zero shift',
  found.dx !== 0 || found.dy !== 0,
  `expected ~(${dxTrue}, ${dyTrue}), found (${found.dx}, ${found.dy}), IoU ${found.score.toFixed(3)}`,
);
check(
  'recovered shift is accurate',
  Math.abs(found.dx - dxTrue) <= 1 && Math.abs(found.dy - dyTrue) <= 1,
  `within 1 px of truth on both axes`,
);

// 3. The velocity handed to the renderer must be non-zero and sane.
const motion = shiftToMotion(found.dx, found.dy, width, height, LOOKBACK_MIN);
const kmh = (Math.hypot(motion.u, motion.v) * 60) / 1000;
check(
  'velocity is non-zero and plausible',
  kmh > 5 && kmh < 200,
  `u=${motion.u.toFixed(0)} v=${motion.v.toFixed(0)} m/min => ${kmh.toFixed(0)} km/h`,
);

// 4. Sign convention: eastward motion must give positive u.
check(
  'eastward displacement yields positive u',
  motion.u > 0,
  `u=${motion.u.toFixed(0)} m/min for a displacement of +${dxTrue} px east`,
);

// 5. The search window must still cover the displacement.
check(
  'search window covers the displacement',
  MOTION_MAX_SHIFT >= expectedPx,
  `max shift ${MOTION_MAX_SHIFT} px vs ${expectedPx.toFixed(1)} px of travel`,
);

// 6. Documents the original defect.
//
// Note what this does and does not claim. On a CLEAN synthetic field a 1 px
// shift is findable, so this is not asserting the old search always returned
// zero. The defect is that ~1 px of travel sits at the noise floor: real echo
// also grows, decays and is sampled coarsely, and a single global vector for
// all of CONUS is dominated by whatever is largest. Measured against live
// MRMS, 320x160 returned exactly dx=0, dy=0 while 640x320 recovered 22 km/h
// and 1280x640 agreed at 17 km/h in the same direction.
//
// The durable invariant is therefore the resolution requirement, not the
// search result: a realistic storm must move enough pixels to be separable
// from no motion at all.
const OLD_W = 320;
const OLD_H = 160;
const oldPx = motionPixelSize(OLD_W, OLD_H).x / 1000;
const oldTravel = travelKm / oldPx;
check(
  'documents why 320x160 was insufficient',
  oldTravel < 2 && expectedPx >= 2,
  `at ${oldPx.toFixed(1)} km/px a ${SLOW_STORM_KMH} km/h storm moves only ${oldTravel.toFixed(2)} px ` +
    `(noise floor); at ${kmPerPx.toFixed(1)} km/px it moves ${expectedPx.toFixed(1)} px`,
);

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
