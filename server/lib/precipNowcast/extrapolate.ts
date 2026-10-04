/**
 * Semi-Lagrangian backward trace on rain rate.
 * Velocity is re-read along the path every `chunkSec`. The original field is
 * sampled once, at the end. No growth or decay is applied.
 */
import { pixelOf, sampleField, type ObservationField } from './field';
import { vectorAtPixel, type MotionField } from './motion';

export type Trace = {
  rainRateMmHr: number | null;
  echoWeight: number;
  emptyWeight: number;
  missingWeight: number;
};

/**
 * No velocity at an empty pixel is still empty: every displacement of an empty
 * sample is empty, so this does not invent a zero wind. Echo with no velocity
 * stays missing. That is not stored as dry.
 */
function withoutVelocity(field: ObservationField, x: number, y: number): Trace | null {
  const here = sampleField(field, x, y);
  if (here.missingWeight >= 0.5 || here.echoWeight >= 0.05) return null;
  return here;
}

function walk(
  field: ObservationField,
  motion: MotionField,
  x: number,
  y: number,
  leadSec: number,
  chunkSec: number,
): Trace {
  let px = x;
  let py = y;
  let left = leadSec;
  const step = Math.max(1, chunkSec);
  while (left > 1e-6) {
    const h = Math.min(step, left);
    const velocity = vectorAtPixel(motion, px, py);
    if (!velocity) {
      return withoutVelocity(field, px, py) ?? { rainRateMmHr: null, echoWeight: 0, emptyWeight: 0, missingWeight: 1 };
    }
    px -= (velocity.eastMs * h) / field.geometry.metersPerPixelX;
    py -= (-velocity.northMs * h) / field.geometry.metersPerPixelY;
    left -= h;
  }
  return sampleField(field, px, py);
}

export function tracePoint(
  field: ObservationField,
  motion: MotionField,
  latitude: number,
  longitude: number,
  leadSec: number,
  chunkSec: number,
): Trace {
  const start = pixelOf(field.geometry, latitude, longitude);
  return walk(field, motion, start.x, start.y, leadSec, chunkSec);
}

export function tracePixel(
  field: ObservationField,
  motion: MotionField,
  x: number,
  y: number,
  leadSec: number,
  chunkSec: number,
): Trace {
  return walk(field, motion, x, y, leadSec, chunkSec);
}
