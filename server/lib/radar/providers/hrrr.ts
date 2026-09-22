import { forecastFrames } from '../../hrrr';
import type {
  FutureRadarProvider,
  FutureSample,
  RadarFrame,
  RadarFrameRequest,
} from '../types';

/** HRRR sub-hourly output step, in minutes. */
const HRRR_STEP_MIN = 15;
/** Samples are emitted at this spacing between HRRR keyframes. */
const SAMPLE_CADENCE_SEC = 5 * 60;

/**
 * HRRR forecast composite reflectivity (REFC).
 *
 * A real numerical model, so precipitation forms, intensifies and dissipates
 * rather than merely sliding. The tradeoff is that a run publishes ~50-60
 * minutes after its init hour, so by the time it is the freshest available it
 * has already diverged from observation — measured at IoU 0.41 against MRMS at
 * F+60, versus 0.66 at F+15. That divergence is why it takes over gradually
 * instead of immediately.
 */
export class HrrrForecastProvider implements FutureRadarProvider {
  readonly id = 'hrrr';
  readonly kind = 'forecast' as const;
  readonly attribution = 'Forecast: NOAA HRRR';
  /** Starts contributing inside the blend window and owns the long tail. */
  readonly leadRange = { fromMin: 15, toMin: Number.POSITIVE_INFINITY };

  async isAvailable(now: number): Promise<boolean> {
    try {
      const frames = await forecastFrames(HRRR_STEP_MIN, new Date(now * 1000));
      return frames.length > 0;
    } catch {
      return false;
    }
  }

  async samples(
    req: RadarFrameRequest & { observed: RadarFrame[] },
  ): Promise<FutureSample[]> {
    // One extra step so interpolation reaches the end of the window.
    const keyframes = await forecastFrames(
      req.windowMinutes + HRRR_STEP_MIN,
      new Date(req.now * 1000),
    );
    if (keyframes.length === 0) return [];

    const run = keyframes[0].run;
    const runMs = Date.parse(run);
    const out: FutureSample[] = [];
    const push = (validTime: number, query: Record<string, string>) => {
      out.push({
        validTime,
        leadMinutes: Math.round((validTime - req.now) / 60),
        query: { run, ...query },
      });
    };

    // Extend backwards from the first published step so HRRR has coverage at
    // the start of the blend window, which can sit earlier than that step.
    const first = keyframes[0];
    const anchorMin = first.forecastMinute - HRRR_STEP_MIN;
    if (anchorMin > 0) {
      const anchorTime = Math.round((runMs + anchorMin * 60_000) / 1000);
      const span = first.time - anchorTime;
      for (let dt = SAMPLE_CADENCE_SEC; dt < span; dt += SAMPLE_CADENCE_SEC) {
        push(anchorTime + dt, {
          from: String(anchorMin),
          to: String(first.forecastMinute),
          t: (dt / span).toFixed(2),
        });
      }
    }

    for (let i = 0; i < keyframes.length; i += 1) {
      const frame = keyframes[i];
      push(frame.time, { minute: String(frame.forecastMinute) });

      const next = keyframes[i + 1];
      if (!next) continue;
      const span = next.time - frame.time;
      for (let dt = SAMPLE_CADENCE_SEC; dt < span; dt += SAMPLE_CADENCE_SEC) {
        push(frame.time + dt, {
          from: String(frame.forecastMinute),
          to: String(next.forecastMinute),
          t: (dt / span).toFixed(2),
        });
      }
    }

    return out.sort((a, b) => a.validTime - b.validTime);
  }
}
