import { AdvectionNowcastProvider } from './providers/advection';
import { HrrrForecastProvider } from './providers/hrrr';
import { MrmsObservedProvider } from './providers/mrms';
import {
  TomorrowForecastProvider,
  TomorrowObservedProvider,
} from './providers/tomorrow';
import { RadarFrameService } from './service';

export type RadarSourceName = 'default' | 'tomorrow';

/**
 * The one place providers are chosen. Everything downstream — the endpoints,
 * the manifest, the app — is provider-agnostic, so this function is the whole
 * surface area of a provider swap.
 */
export function createRadarService(source: RadarSourceName = 'default'): RadarFrameService {
  if (source === 'tomorrow') {
    return new RadarFrameService(new TomorrowObservedProvider(), [
      new TomorrowForecastProvider(),
    ]);
  }

  // HRRR first: a real model beats advection whenever a run has published.
  // Advection is the fallback for the gap right after a run boundary.
  return new RadarFrameService(new MrmsObservedProvider(), [
    new HrrrForecastProvider(),
    new AdvectionNowcastProvider(),
  ]);
}
