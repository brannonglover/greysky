import { observedTimes, selectObserved, wmsConfig, WMS_BASE } from '../../mrms';
import type { ObservedRadarProvider, RadarFrame, RadarFrameRequest } from '../types';

/**
 * NOAA MRMS observed reflectivity, read from the NCEP GeoServer WMS.
 *
 * The layer is the QC'd composite (conus_cref_qcd), which is the rendered form
 * of MergedReflectivityQCComposite — the seamless national mosaic. NOAA keeps a
 * two hour rolling window and publishes roughly every two minutes.
 *
 * Tiles are fetched by the device straight from NOAA, not proxied through this
 * service, which is why frames carry a `wms` source rather than an XYZ
 * template. That saves a function invocation per observed tile.
 */
export class MrmsObservedProvider implements ObservedRadarProvider {
  readonly id = 'mrms';
  readonly kind = 'observed' as const;
  readonly attribution = 'Radar: NOAA MRMS';

  async isAvailable(): Promise<boolean> {
    try {
      const times = await observedTimes();
      return times.length > 0;
    } catch {
      return false;
    }
  }

  async availableTimes(req: RadarFrameRequest): Promise<number[]> {
    const times = await observedTimes();
    const cutoff = req.now * 1000 - req.windowMinutes * 60_000;
    return times
      .map((iso) => Date.parse(iso))
      .filter((ms) => Number.isFinite(ms) && ms >= cutoff && ms <= req.now * 1000)
      .sort((a, b) => a - b)
      .map((ms) => Math.round(ms / 1000));
  }

  async getFrames(req: RadarFrameRequest): Promise<RadarFrame[]> {
    const times = await observedTimes();
    const cadenceMin = Math.max(1, Math.round(req.cadenceSeconds / 60));
    const picked = selectObserved(times, req.windowMinutes, cadenceMin, req.now * 1000);

    return picked.map((frame) => ({
      id: `mrms:${frame.isoTime}`,
      timestamp: frame.time,
      kind: 'observed' as const,
      providerId: this.id,
      source: {
        kind: 'wms' as const,
        url: WMS_BASE,
        params: wmsConfig(frame.isoTime).params,
      },
    }));
  }
}
