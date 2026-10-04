import type { IntendedRegime } from './records';

/**
 * Fixed replay set. `intendedRegime` is why the point is here. It is not
 * rewritten after a run to match whatever the radar happened to show.
 */
export type BenchmarkCase = {
  id: string;
  latitude: number;
  longitude: number;
  intendedRegime: IntendedRegime;
  note: string;
};

export const BENCHMARK_CASES: readonly BenchmarkCase[] = [
  {
    id: 'phoenix',
    latitude: 33.4484,
    longitude: -112.074,
    intendedRegime: 'dry',
    note: 'Sonoran desert. Usually no echo, so false alarms show up.',
  },
  {
    id: 'seattle',
    latitude: 47.6062,
    longitude: -122.3321,
    intendedRegime: 'widespread',
    note: 'Pacific coast. Often broad stratiform rain when a system is overhead.',
  },
  {
    id: 'atlanta-30345',
    latitude: 33.8513,
    longitude: -84.287,
    intendedRegime: 'convective',
    note: 'North Druid Hills. The 4 Oct 2026 cell that the forecast called dry.',
  },
  {
    id: 'oklahoma-city',
    latitude: 35.4676,
    longitude: -97.5164,
    intendedRegime: 'convective',
    note: 'Southern plains. Convective when a cell is nearby.',
  },
  {
    id: 'des-moines',
    latitude: 41.5868,
    longitude: -93.625,
    intendedRegime: 'isolated',
    note: 'Midwest. Isolated cells rather than a continuous shield.',
  },
  {
    id: 'houston',
    latitude: 29.7604,
    longitude: -95.3698,
    intendedRegime: 'widespread',
    note: 'Upper Texas coast. Broad rain is common in a Gulf fetch.',
  },
];

/**
 * Extra live points for later collection. Not part of the six-case Phase 1
 * table. Labels say why the city was added. They are not changed after a run.
 */
export const EXPANDED_CASES: readonly BenchmarkCase[] = [
  {
    id: 'miami',
    latitude: 25.7617,
    longitude: -80.1918,
    intendedRegime: 'convective',
    note: 'South Florida. Sea-breeze and afternoon cells.',
  },
  {
    id: 'chicago',
    latitude: 41.8781,
    longitude: -87.6298,
    intendedRegime: 'widespread',
    note: 'Southern Lake Michigan. Broad rain or a line moving off the plains.',
  },
  {
    id: 'portland-or',
    latitude: 45.5152,
    longitude: -122.6784,
    intendedRegime: 'widespread',
    note: 'Willamette Valley. Slow stratiform rain is common.',
  },
  {
    id: 'amarillo',
    latitude: 35.222,
    longitude: -101.8313,
    intendedRegime: 'convective',
    note: 'Texas Panhandle. Isolated cells and organized lines both occur.',
  },
  {
    id: 'denver',
    latitude: 39.7392,
    longitude: -104.9903,
    intendedRegime: 'isolated',
    note: 'Front Range. Small cells, often slow or terrain-tied.',
  },
  {
    id: 'minneapolis',
    latitude: 44.9778,
    longitude: -93.265,
    intendedRegime: 'widespread',
    note: 'Upper Midwest. Long-lived shields and decaying areas.',
  },
  {
    id: 'marietta',
    latitude: 33.9526,
    longitude: -84.5499,
    intendedRegime: 'convective',
    note: 'Northwest metro Atlanta. Added to see whether a cell covers more than one point.',
  },
  {
    id: 'atlanta-downtown',
    latitude: 33.749,
    longitude: -84.388,
    intendedRegime: 'convective',
    note: 'Downtown Atlanta. Added to see whether the 30345 cell was local.',
  },
];
