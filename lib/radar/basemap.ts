import type { StyleSpecification } from '@maplibre/maplibre-react-native';

/**
 * Grey Sky basemap.
 *
 * A MapLibre style built on OpenFreeMap's OpenMapTiles vector schema (free, no
 * API key, no watermark — the reason CARTO had to go). The same object is
 * handed to MapLibre Native and to MapLibre GL JS, so both platforms render an
 * identical basemap from one definition.
 *
 * Design rule: the basemap is subordinate to radar. Reflectivity owns blue
 * through red, so nothing here is allowed to be saturated — the land, water and
 * roads are all desaturated navy and slate, and greens, yellows and reds are
 * kept off the map entirely so they can only ever mean precipitation.
 */

const TILES = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const SPRITE = 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm';

/** Drawn from constants/theme.ts so the map belongs to the same app. */
const ink = {
  land: '#141C30',
  water: '#0C1426',
  waterLine: '#16203A',
  boundary: 'rgba(147, 163, 190, 0.30)',
  boundaryCountry: 'rgba(174, 189, 213, 0.46)',
  roadMajor: '#26324B',
  roadMinor: '#1D273D',
  label: '#93A3BE',
  labelBright: '#C3CFE2',
  halo: '#0B1120',
};

/**
 * Radar layers are inserted directly beneath this layer, which keeps place
 * names legible on top of heavy reflectivity instead of being buried by it.
 */
export const RADAR_INSERT_BEFORE = 'place-city';

export function greySkyBasemap(): StyleSpecification {
  return {
    version: 8,
    name: 'Grey Sky',
    glyphs: GLYPHS,
    sprite: SPRITE,
    sources: {
      openmaptiles: { type: 'vector', url: TILES },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': ink.land },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': ink.water },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'waterway',
        minzoom: 7,
        paint: {
          'line-color': ink.waterLine,
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.4, 14, 1.6],
        },
      },

      // Roads earn their way in slowly: motorways from z5 for orientation,
      // everything else only once the user is close enough to want streets.
      {
        id: 'road-minor',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 11,
        filter: ['match', ['get', 'class'], ['minor', 'service', 'tertiary'], true, false],
        paint: {
          'line-color': ink.roadMinor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 16, 3],
        },
      },
      {
        id: 'road-secondary',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 9,
        filter: ['match', ['get', 'class'], ['secondary', 'primary'], true, false],
        paint: {
          'line-color': ink.roadMajor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 16, 4],
        },
      },
      {
        id: 'road-major',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 5,
        filter: ['match', ['get', 'class'], ['motorway', 'trunk'], true, false],
        paint: {
          'line-color': ink.roadMajor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 1.6, 16, 5],
        },
      },

      // State lines are the most useful reference at radar zooms, so they read
      // a little stronger than roads do.
      {
        id: 'boundary-state',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'boundary',
        filter: [
          'all',
          ['!=', ['get', 'class'], 'aboriginal_lands'],
          ['==', ['to-number', ['get', 'admin_level'], -1], 4],
          ['!=', ['get', 'maritime'], 1],
        ],
        paint: {
          'line-color': ink.boundary,
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 8, 1, 12, 1.4],
          'line-dasharray': [3, 2],
        },
      },
      {
        id: 'boundary-country',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'boundary',
        /**
         * Matched by equality, not <=. Many features in this layer carry no
         * admin_level at all — reservations come through as
         * class=aboriginal_lands — and `to-number` coerces a missing value to
         * 0, which would satisfy <= 2 and draw every one of them as a national
         * border. Equality excludes that 0, and the class guard keeps
         * reservations out even if they later gain a level.
         */
        filter: [
          'all',
          ['!=', ['get', 'class'], 'aboriginal_lands'],
          ['==', ['to-number', ['get', 'admin_level'], -1], 2],
          ['!=', ['get', 'maritime'], 1],
        ],
        paint: {
          'line-color': ink.boundaryCountry,
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.7, 8, 1.4, 12, 2],
        },
      },

      // Everything below this point sits ABOVE the radar layers.
      {
        id: RADAR_INSERT_BEFORE,
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        minzoom: 3,
        filter: ['match', ['get', 'class'], ['city'], true, false],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 8, 13, 12, 16],
          'text-max-width': 8,
          'text-padding': 4,
        },
        paint: {
          'text-color': ink.labelBright,
          'text-halo-color': ink.halo,
          'text-halo-width': 1.4,
        },
      },
      {
        id: 'place-town',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        minzoom: 8,
        filter: ['match', ['get', 'class'], ['town', 'village', 'suburb'], true, false],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 13],
          'text-max-width': 8,
          'text-padding': 4,
        },
        paint: {
          'text-color': ink.label,
          'text-halo-color': ink.halo,
          'text-halo-width': 1.2,
        },
      },
      {
        id: 'place-state',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        minzoom: 4,
        maxzoom: 8,
        filter: ['match', ['get', 'class'], ['state'], true, false],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 9, 7, 12],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.18,
          'text-max-width': 7,
        },
        paint: {
          'text-color': ink.label,
          'text-opacity': 0.75,
          'text-halo-color': ink.halo,
          'text-halo-width': 1.2,
        },
      },
    ],
  };
}

export const BASEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org/">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
