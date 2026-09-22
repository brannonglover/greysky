import type {
  FutureRadarProvider,
  FutureSample,
  ObservedRadarProvider,
  RadarFrame,
  RadarFrameRequest,
} from '../types';

/**
 * Tomorrow.io precipitation intensity tiles.
 *
 * An alternate commercial source kept behind the provider interface so it can
 * be compared against MRMS/HRRR, or dropped, without touching the service, the
 * map or the timeline. Tiles are proxied through /api/radar/tile so the API key
 * stays server-side.
 *
 * Tomorrow serves one continuous series spanning past and future, so it is
 * expressed as two providers over a shared frame builder — one claiming the
 * observed half, one the forecast half.
 */

const ATTRIBUTION = 'Radar: Tomorrow.io';

function configured(): boolean {
  return Boolean(process.env.TOMORROW_API_KEY);
}

function buildFrames(
  req: RadarFrameRequest,
  providerId: string,
  kind: 'observed' | 'forecast',
  fromOffsetSec: number,
  toOffsetSec: number,
): RadarFrame[] {
  const step = Math.max(60, req.cadenceSeconds);
  const frames: RadarFrame[] = [];
  const seen = new Set<number>();

  for (let offset = fromOffsetSec; offset <= toOffsetSec; offset += step) {
    const snapped = Math.round((req.now + offset) / step) * step;
    if (seen.has(snapped)) continue;
    seen.add(snapped);

    const iso = new Date(snapped * 1000).toISOString();
    frames.push({
      id: `${providerId}:${iso}`,
      timestamp: snapped,
      kind,
      providerId,
      leadMinutes: kind === 'forecast' ? Math.round((snapped - req.now) / 60) : undefined,
      source: {
        kind: 'xyz',
        urlTemplate:
          `${req.origin}/api/radar/tile?source=tomorrow` +
          `&time=${encodeURIComponent(iso)}&z={z}&x={x}&y={y}`,
      },
    });
  }
  return frames;
}

export class TomorrowObservedProvider implements ObservedRadarProvider {
  readonly id = 'tomorrow-observed';
  readonly kind = 'observed' as const;
  readonly attribution = ATTRIBUTION;

  async isAvailable(): Promise<boolean> {
    return configured();
  }

  async availableTimes(req: RadarFrameRequest): Promise<number[]> {
    return this.getFrames(req).then((frames) => frames.map((frame) => frame.timestamp));
  }

  async getFrames(req: RadarFrameRequest): Promise<RadarFrame[]> {
    if (!configured()) return [];
    return buildFrames(req, this.id, 'observed', -req.windowMinutes * 60, 0);
  }
}

export class TomorrowForecastProvider implements FutureRadarProvider {
  readonly id = 'tomorrow-forecast';
  readonly kind = 'forecast' as const;
  readonly attribution = ATTRIBUTION;
  /**
   * Tomorrow serves one continuous series, so it covers the whole future on
   * its own and never participates in a nowcast/HRRR blend.
   */
  readonly leadRange = { fromMin: 0, toMin: Number.POSITIVE_INFINITY };

  async isAvailable(): Promise<boolean> {
    return configured();
  }

  async samples(req: RadarFrameRequest): Promise<FutureSample[]> {
    if (!configured()) return [];
    const step = Math.max(60, req.cadenceSeconds);
    const out: FutureSample[] = [];
    const seen = new Set<number>();

    for (let offset = step; offset <= req.windowMinutes * 60; offset += step) {
      const snapped = Math.round((req.now + offset) / step) * step;
      if (seen.has(snapped)) continue;
      seen.add(snapped);
      out.push({
        validTime: snapped,
        leadMinutes: Math.round((snapped - req.now) / 60),
        query: { source: 'tomorrow', time: new Date(snapped * 1000).toISOString() },
      });
    }
    return out;
  }
}
