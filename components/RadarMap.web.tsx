import {
  Map as MaplibreMap,
  Marker as MaplibreMarker,
  type StyleSpecification as GlStyleSpecification,
} from 'maplibre-gl';
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/constants/theme';
import { greySkyBasemap, RADAR_INSERT_BEFORE } from '@/lib/radar/basemap';
import { MAP_MAX_ZOOM, resolveTileSource } from '@/lib/radar/tileSource';
import type { RadarFrame } from '@/lib/radar/types';
import type { RadarMapProps } from './RadarMap';

/**
 * Radar map, web.
 *
 * Same basemap definition and same normalized frames as native, but driven
 * imperatively: on the web there is no bridge, so setPaintProperty is the
 * cheapest possible way to change frames and there is nothing to gain from
 * mirroring the native component's declarative structure.
 */

const RING_AHEAD = 2;
const RING_BEHIND = 1;

/** Injected once rather than imported, so no bundler CSS handling is involved. */
const CSS_ID = 'grey-sky-maplibre-css';
const CSS = `
.maplibregl-map{position:relative;width:100%;height:100%;overflow:hidden;}
.maplibregl-canvas-container,.maplibregl-canvas{position:absolute;top:0;left:0;width:100%;height:100%;}
.maplibregl-ctrl-attrib{position:absolute;right:0;bottom:0;margin:0;padding:1px 6px;
  font:11px/1.5 system-ui,sans-serif;background:rgba(11,17,32,.62);color:rgba(238,242,248,.62);}
.maplibregl-ctrl-attrib a{color:rgba(238,242,248,.8);}
.maplibregl-ctrl-attrib-button{display:none;}
`;

function ensureCss(): void {
  if (typeof document === 'undefined' || document.getElementById(CSS_ID)) return;
  const tag = document.createElement('style');
  tag.id = CSS_ID;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

function ringIndices(index: number, count: number): number[] {
  if (count === 0) return [];
  const picked: number[] = [];
  for (let offset = -RING_BEHIND; offset <= RING_AHEAD; offset += 1) {
    const i = ((index + offset) % count + count) % count;
    if (!picked.includes(i)) picked.push(i);
  }
  return picked;
}

const sourceId = (frame: RadarFrame) => `radar-${frame.id}`;
const layerId = (frame: RadarFrame) => `radar-${frame.id}-layer`;

export function RadarMap({
  latitude,
  longitude,
  zoom = 7,
  frames,
  playhead,
  opacity = 0.82,
  interactive = true,
  showPin = true,
  style,
}: RadarMapProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MaplibreMap | null>(null);
  const loaded = useRef(false);
  const framesRef = useRef<RadarFrame[]>(frames);
  framesRef.current = frames;

  // Create the map exactly once. Frames and playhead changes never touch it.
  useEffect(() => {
    ensureCss();
    if (!container.current || map.current) return;

    const instance = new MaplibreMap({
      container: container.current,
      // maplibre-gl and maplibre-react-native pin different builds of the
      // style spec, so the shared style is cast once here rather than being
      // duplicated per platform.
      style: greySkyBasemap() as unknown as GlStyleSpecification,
      center: [longitude, latitude],
      zoom,
      maxZoom: MAP_MAX_ZOOM,
      interactive,
      attributionControl: interactive ? { compact: true } : false,
    });

    map.current = instance;
    instance.on('load', () => {
      loaded.current = true;
    });

    if (showPin) {
      const el = document.createElement('div');
      el.style.cssText =
        'width:20px;height:20px;border-radius:50%;background:rgba(238,242,248,.26);' +
        'border:1px solid rgba(238,242,248,.5);display:flex;align-items:center;justify-content:center;';
      const dot = document.createElement('div');
      dot.style.cssText = `width:9px;height:9px;border-radius:50%;background:${colors.text};`;
      el.appendChild(dot);
      new MaplibreMarker({ element: el }).setLngLat([longitude, latitude]).addTo(instance);
    }

    return () => {
      instance.remove();
      map.current = null;
      loaded.current = false;
    };
    // Recreating the map on a coordinate change would defeat the point; the
    // camera effect below moves it instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move the camera rather than rebuilding when the location changes.
  useEffect(() => {
    map.current?.jumpTo({ center: [longitude, latitude], zoom });
  }, [latitude, longitude, zoom]);

  // Reconcile mounted sources against the ring, then set opacities.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    const apply = (index: number) => {
      const all = framesRef.current;
      if (!instance.isStyleLoaded()) return;
      const wanted = ringIndices(index, all.length);
      const wantedIds = new Set(wanted.map((i) => sourceId(all[i])));

      for (const layer of instance.getStyle().layers ?? []) {
        if (!layer.id.startsWith('radar-') || !layer.id.endsWith('-layer')) continue;
        const id = layer.id.replace(/-layer$/, '');
        if (wantedIds.has(id)) continue;
        if (instance.getLayer(layer.id)) instance.removeLayer(layer.id);
        if (instance.getSource(id)) instance.removeSource(id);
      }

      for (const i of wanted) {
        const frame = all[i];
        if (!frame) continue;
        const id = sourceId(frame);
        if (!instance.getSource(id)) {
          const resolved = resolveTileSource(frame.source);
          instance.addSource(id, {
            type: 'raster',
            tiles: resolved.tiles,
            tileSize: resolved.tileSize,
            minzoom: resolved.minzoom,
            maxzoom: resolved.maxzoom,
          });
          instance.addLayer(
            {
              id: layerId(frame),
              type: 'raster',
              source: id,
              paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 },
            },
            instance.getLayer(RADAR_INSERT_BEFORE) ? RADAR_INSERT_BEFORE : undefined,
          );
        }
        instance.setPaintProperty(
          layerId(frame),
          'raster-opacity',
          i === index ? opacity : 0,
        );
      }
    };

    const run = () => apply(playhead.index);
    if (loaded.current) run();
    else instance.once('load', run);

    return playhead.subscribe(apply);
  }, [frames, opacity, playhead]);

  return (
    <View style={[styles.fill, style]}>
      {React.createElement('div', {
        ref: container,
        style: { width: '100%', height: '100%', backgroundColor: colors.mapBg },
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: colors.mapBg,
  },
});
