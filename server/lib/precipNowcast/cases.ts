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
