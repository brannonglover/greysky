import { legendStops } from '../palette';
import {
  DEFAULT_TRANSITION,
  forecastWeight,
  quantizeWeight,
  type TransitionConfig,
} from './transition';
import type {
  FutureRadarProvider,
  FutureSample,
  ObservedRadarProvider,
  RadarFrame,
  RadarFrameKind,
  RadarManifest,
  TileQuery,
} from './types';

export type ManifestRequest = {
  now: number;
  origin: string;
  pastMin: number;
  futureMin: number;
  observedCadenceSec: number;
  futureCadenceSec: number;
  transition?: TransitionConfig;
};

/**
 * Composes one observed provider with future providers into a single
 * normalized, chronological manifest.
 *
 * Future providers are no longer "first one that returns frames wins". They
 * declare lead ranges and overlap on purpose, and this service decides per
 * frame how much each contributes — so the timeline moves from observation to
 * nowcast to model without a hard seam at any point. The client still receives
 * one flat RadarFrame array and never learns how any frame was produced.
 */
export class RadarFrameService {
  constructor(
    private readonly observed: ObservedRadarProvider,
    private readonly future: FutureRadarProvider[],
  ) {}

  async getManifest(req: ManifestRequest): Promise<RadarManifest> {
    const transition = req.transition ?? DEFAULT_TRANSITION;
    const attribution: string[] = [this.observed.attribution];

    const observed = await this.observed
      .getFrames({
        now: req.now,
        origin: req.origin,
        windowMinutes: req.pastMin,
        cadenceSeconds: req.observedCadenceSec,
      })
      .catch((): RadarFrame[] => []);

    const futureReq = {
      now: req.now,
      origin: req.origin,
      windowMinutes: req.futureMin,
      cadenceSeconds: req.futureCadenceSec,
      observed,
    };

    const nowcaster = this.future.find((p) => p.kind === 'nowcast');
    const forecaster = this.future.find((p) => p.kind === 'forecast');

    const [nowcastSamples, forecastSamples] = await Promise.all([
      nowcaster?.samples(futureReq).catch((): FutureSample[] => []) ?? [],
      forecaster?.samples(futureReq).catch((): FutureSample[] => []) ?? [],
    ]);

    const future = this.composeFuture({
      req,
      transition,
      observed,
      nowcaster,
      forecaster,
      nowcastSamples,
      forecastSamples,
    });

    if (nowcaster && future.some((f) => f.blend || f.providerId === nowcaster.id)) {
      attribution.push(nowcaster.attribution);
    }
    if (forecaster && future.some((f) => f.blend || f.providerId === forecaster.id)) {
      attribution.push(forecaster.attribution);
    }

    return {
      version: 2,
      generated: req.now,
      window: { pastMin: req.pastMin, futureMin: req.futureMin },
      observedThrough: observed.at(-1)?.timestamp ?? null,
      legend: legendStops(),
      frames: dedupe([...observed, ...future]),
      attribution: [...new Set(attribution)],
    };
  }

  private composeFuture(args: {
    req: ManifestRequest;
    transition: TransitionConfig;
    observed: RadarFrame[];
    nowcaster?: FutureRadarProvider;
    forecaster?: FutureRadarProvider;
    nowcastSamples: FutureSample[];
    forecastSamples: FutureSample[];
  }): RadarFrame[] {
    const { req, transition, observed, nowcaster, forecaster } = args;
    const step = req.futureCadenceSec;
    const cutoff = req.now + req.futureMin * 60;

    // Anchor the future grid on the newest observation so the spacing across
    // the observed/future boundary stays uniform.
    const anchor = observed.at(-1)?.timestamp ?? req.now;
    const tolerance = step / 2;
    const frames: RadarFrame[] = [];

    for (let t = anchor + step; t <= cutoff; t += step) {
      if (t <= req.now) continue;
      const leadMinutes = Math.round((t - req.now) / 60);
      const nSample = nearest(args.nowcastSamples, t, tolerance);
      const fSample = nearest(args.forecastSamples, t, tolerance);

      let weight = quantizeWeight(forecastWeight(leadMinutes, transition));
      // Fall back rather than dropping a frame when one side cannot cover it.
      if (!fSample) weight = 0;
      if (!nSample) weight = 1;

      if (weight <= 0 && nSample && nowcaster) {
        frames.push({
          id: `${nowcaster.id}:${t}`,
          timestamp: t,
          kind: 'nowcast',
          providerId: nowcaster.id,
          leadMinutes,
          expiresAt: t + 5 * 60,
          source: { kind: 'xyz', urlTemplate: tileUrl(req.origin, nSample.query) },
        });
        continue;
      }

      if (weight >= 1 && fSample && forecaster) {
        frames.push({
          id: `${forecaster.id}:${t}`,
          timestamp: t,
          kind: 'forecast',
          providerId: forecaster.id,
          leadMinutes,
          source: { kind: 'xyz', urlTemplate: tileUrl(req.origin, fSample.query) },
        });
        continue;
      }

      if (!nSample || !fSample || !nowcaster || !forecaster) continue;

      // Dominant source drives `kind` so the timeline has something to style;
      // the real mix is preserved in `blend`.
      const kind: RadarFrameKind = weight < 0.5 ? 'nowcast' : 'forecast';
      frames.push({
        id: `blend:${t}:${weight}`,
        timestamp: t,
        kind,
        providerId: weight < 0.5 ? nowcaster.id : forecaster.id,
        leadMinutes,
        expiresAt: t + 5 * 60,
        blend: {
          mode: transition.blendMode,
          nowcastWeight: quantizeWeight(1 - weight),
          forecastWeight: weight,
          nowcastProvider: nowcaster.id,
          forecastProvider: forecaster.id,
        },
        source: {
          kind: 'xyz',
          urlTemplate: tileUrl(req.origin, {
            blend: '1',
            // Explicit, not implied. These tiles are cached immutable, so the
            // URL has to fully determine the bytes — a default resolved
            // server-side would make an old cache entry mean something new.
            mode: transition.blendMode,
            w: String(weight),
            ...prefix('n_', nSample.query),
            ...prefix('f_', fSample.query),
          }),
        },
      });
    }

    return frames;
  }
}

function nearest(samples: FutureSample[], time: number, tolerance: number): FutureSample | null {
  let best: FutureSample | null = null;
  let bestDist = Infinity;
  for (const sample of samples) {
    const dist = Math.abs(sample.validTime - time);
    if (dist <= tolerance && dist < bestDist) {
      best = sample;
      bestDist = dist;
    }
  }
  return best;
}

function prefix(tag: string, query: TileQuery): TileQuery {
  return Object.fromEntries(Object.entries(query).map(([k, v]) => [`${tag}${k}`, v]));
}

function tileUrl(origin: string, query: TileQuery): string {
  const qs = Object.entries(query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${origin}/api/radar/tile?${qs}&z={z}&x={x}&y={y}`;
}

/**
 * One frame per timestamp, sorted. An observation always beats model output
 * for the same instant — at the boundary the real measurement is the truth.
 */
function dedupe(frames: RadarFrame[]): RadarFrame[] {
  const byTime = new Map<number, RadarFrame>();
  for (const frame of frames) {
    const existing = byTime.get(frame.timestamp);
    if (!existing || (existing.kind !== 'observed' && frame.kind === 'observed')) {
      byTime.set(frame.timestamp, frame);
    }
  }
  return [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp);
}
