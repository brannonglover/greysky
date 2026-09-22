import type { RadarTileSource } from './types';

/**
 * Translates a normalized RadarTileSource into the tile URL templates MapLibre
 * wants. This is the ONLY place transport is interpreted — the timeline, the
 * playback loop and the screens never see it.
 *
 * Shared by the native and web map adapters so both platforms resolve a frame
 * to exactly the same request.
 */

/** Radar rasters are 256px; the vector basemap is free to use its own size. */
export const RADAR_TILE_SIZE = 256;

/**
 * MRMS is a 0.01 degree mosaic, so native resolution runs out around z9.
 * Tiles stop being generated past this and MapLibre magnifies what it has,
 * which lets the user keep zooming to street level on the basemap.
 */
export const RADAR_MAX_NATIVE_ZOOM = 9;

/** How far the user may zoom the map itself, well past the radar's detail. */
export const MAP_MAX_ZOOM = 16;

/**
 * Build a WMS GetMap template. The `{bbox-epsg-3857}` token is substituted by
 * MapLibre per tile — by `getTileBBox()` in MapLibre Native and by the raster
 * source in GL JS — so the braces must survive verbatim. URLSearchParams
 * percent-encodes them, which silently breaks the substitution, so the query
 * is assembled by hand.
 */
function wmsTemplate(
  url: string,
  params: Record<string, string>,
  tileSize: number,
): string {
  const merged: Record<string, string> = {
    service: 'WMS',
    request: 'GetMap',
    version: '1.3.0',
    transparent: 'true',
    format: 'image/png',
    ...params,
    // EPSG:3857 is x/y ordered, so bbox stays minx,miny,maxx,maxy.
    crs: 'EPSG:3857',
    width: String(tileSize),
    height: String(tileSize),
  };

  const query = Object.entries(merged)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${query}&bbox={bbox-epsg-3857}`;
}

export type ResolvedTileSource = {
  tiles: string[];
  tileSize: number;
  minzoom: number;
  maxzoom: number;
};

export function resolveTileSource(source: RadarTileSource): ResolvedTileSource {
  const tileSize = source.tileSize ?? RADAR_TILE_SIZE;
  const minzoom = source.minzoom ?? 0;
  const maxzoom = source.maxzoom ?? RADAR_MAX_NATIVE_ZOOM;

  if (source.kind === 'wms') {
    return {
      tiles: [wmsTemplate(source.url, source.params, tileSize)],
      tileSize,
      minzoom,
      maxzoom,
    };
  }

  return { tiles: [source.urlTemplate], tileSize, minzoom, maxzoom };
}
