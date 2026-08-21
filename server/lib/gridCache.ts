import { loadGrid, resolveFrame, type ForecastFrame, type Grid } from './hrrr';

/**
 * Decoding a REFC record costs ~130 ms and ~15 MB. A map view pulls a dozen
 * tiles from one grid and a point query pulls every forecast step, so keeping a
 * few warm per instance avoids most of the work.
 */
const MAX_ENTRIES = 4;
const grids = new Map<string, Promise<Grid>>();

function remember(key: string, load: () => Promise<Grid>): Promise<Grid> {
  const hit = grids.get(key);
  if (hit) return hit;
  const pending = load().catch((error: unknown) => {
    grids.delete(key);
    throw error;
  });
  grids.set(key, pending);
  while (grids.size > MAX_ENTRIES) {
    const oldest = grids.keys().next().value;
    if (oldest === undefined) break;
    grids.delete(oldest);
  }
  return pending;
}

export function gridForFrame(frame: ForecastFrame): Promise<Grid> {
  return remember(`${frame.run}:${frame.forecastMinute}`, () => loadGrid(frame));
}

export function gridForRunMinute(runIso: string, minute: number): Promise<Grid> {
  return remember(`${runIso}:${minute}`, async () => loadGrid(await resolveFrame(runIso, minute)));
}
