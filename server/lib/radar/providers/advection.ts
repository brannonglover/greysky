import { nowcastFrames } from '../../nowcast';
import type {
  FutureRadarProvider,
  FutureSample,
  RadarFrame,
  RadarFrameRequest,
} from '../types';

/**
 * Advection nowcast: continues the newest MRMS image along the motion measured
 * over the last ~20 minutes.
 *
 * This is the short-lead anchor for the whole future timeline. It starts from
 * the actual observed field, so the step from the last observation into the
 * first future frame is continuous by construction — which is the entire point
 * of running it ahead of HRRR rather than cutting straight to the model.
 *
 * It cannot grow or decay echoes, only move them, so its skill falls away with
 * lead. That is what the transition window is for.
 */
export class AdvectionNowcastProvider implements FutureRadarProvider {
  readonly id = 'mrms-advection';
  readonly kind = 'nowcast' as const;
  readonly attribution = 'Nowcast: NOAA MRMS advection';
  /** Covers the pure-nowcast stretch plus the whole blend window. */
  readonly leadRange = { fromMin: 0, toMin: 45 };

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async samples(
    req: RadarFrameRequest & { observed: RadarFrame[] },
  ): Promise<FutureSample[]> {
    // nowcastFrames works from MRMS ISO timestamps, which ride along in the
    // observed frames' WMS params.
    const source = req.observed
      .filter((frame) => frame.source.kind === 'wms')
      .map((frame) => ({
        time: frame.timestamp,
        isoTime: frame.source.kind === 'wms' ? (frame.source.params.time ?? '') : '',
      }))
      .filter((entry) => entry.isoTime.length > 0);

    if (source.length === 0) return [];

    // Ask for the full blend window, not just the pure-nowcast stretch.
    const horizon = Math.min(req.windowMinutes, this.leadRange.toMin);
    const frames = await nowcastFrames(source, horizon, req.now * 1000);

    return frames.map((frame) => ({
      validTime: frame.time,
      leadMinutes: Math.round((frame.time - req.now) / 60),
      query: {
        // `lead` is minutes past the anchoring observation, which is not the
        // same as leadMinutes (minutes past now) — the newest observation is
        // typically a few minutes old.
        obs: frame.isoTime,
        u: String(frame.u),
        v: String(frame.v),
        lead: String(frame.leadMin),
      },
    }));
  }
}
