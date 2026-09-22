import {
  Camera,
  Layer,
  Map,
  Marker,
  RasterSource,
  type MapRef,
} from '@maplibre/maplibre-react-native';
import React, { memo, useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/constants/theme';
import { greySkyBasemap, RADAR_INSERT_BEFORE } from '@/lib/radar/basemap';
import type { Playhead } from '@/lib/radar/playhead';
import { MAP_MAX_ZOOM, resolveTileSource } from '@/lib/radar/tileSource';
import type { RadarFrame } from '@/lib/radar/types';
import { usePlayheadIndex } from '@/lib/radar/useRadar';

/**
 * Radar map, native.
 *
 * Renders MapLibre once and never rebuilds it when the timestamp changes — the
 * playhead only flips raster-opacity between already-mounted sources.
 *
 * The component subscribes to the playhead itself rather than receiving the
 * index as a prop, so an animating timeline re-renders this subtree alone. The
 * screen above it does not re-render at all.
 */

export type RadarMapProps = {
  latitude: number;
  longitude: number;
  zoom?: number;
  frames: RadarFrame[];
  playhead: Playhead;
  /** 0-1. Radar sits over a deliberately quiet basemap, so it can run high. */
  opacity?: number;
  interactive?: boolean;
  showPin?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * How many frames to keep mounted around the playhead.
 *
 * Mounted-but-transparent sources are how a frame is preloaded: its tiles are
 * already fetched when its turn comes, so advancing does not flash. Biased
 * forward because playback runs forward.
 *
 * The previous Leaflet implementation mounted every frame at once — 24 tile
 * pyramids fetching concurrently on a phone. A bounded ring is the fix. Phase 3
 * widens it and adds ordered fetch and cancellation.
 */
const RING_AHEAD = 2;
const RING_BEHIND = 1;

function ringIndices(index: number, count: number): number[] {
  if (count === 0) return [];
  const picked: number[] = [];
  for (let offset = -RING_BEHIND; offset <= RING_AHEAD; offset += 1) {
    const i = ((index + offset) % count + count) % count;
    if (!picked.includes(i)) picked.push(i);
  }
  return picked;
}

function RadarMapInner({
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
  const index = usePlayheadIndex(playhead);
  const mapStyle = useMemo(() => greySkyBasemap(), []);
  const mounted = useMemo(() => ringIndices(index, frames.length), [index, frames.length]);
  /**
   * The camera is driven declaratively: Camera forwards its remaining props to
   * native as a camera "stop", and is memo'd, so the stop is only re-applied
   * when this array's identity changes. Memoizing on the coordinates keeps the
   * user's own pan and zoom intact across the re-render every playhead tick
   * causes, while still following a location change.
   *
   * This replaced an imperative CameraRef.flyTo in an effect. That was wrong in
   * a way optional chaining hid: setStop throws outright when the *native* ref
   * is not attached yet ("NativeCameraComponent ref is null"), which is exactly
   * the state during the first coords update, so the camera never moved.
   */
  const center = useMemo<[number, number]>(() => [longitude, latitude], [longitude, latitude]);

  return (
    <View style={[styles.fill, style]}>
      <Map
        style={styles.fill}
        mapStyle={mapStyle}
        dragPan={interactive}
        touchZoom={interactive}
        doubleTapZoom={interactive}
        touchRotate={false}
        touchPitch={false}
        compass={false}
        logo={false}
        attribution={interactive}>
        <Camera center={center} zoom={zoom} maxZoom={MAP_MAX_ZOOM} />

        {mounted.map((i) => {
          const frame = frames[i];
          if (!frame) return null;
          const resolved = resolveTileSource(frame.source);
          const sourceId = `radar-${frame.id}`;
          return (
            <RasterSource
              key={frame.id}
              id={sourceId}
              tiles={resolved.tiles}
              tileSize={resolved.tileSize}
              minzoom={resolved.minzoom}
              maxzoom={resolved.maxzoom}>
              <Layer
                id={`${sourceId}-layer`}
                type="raster"
                source={sourceId}
                beforeId={RADAR_INSERT_BEFORE}
                paint={{
                  // Neighbours stay mounted at zero so their tiles are already
                  // in memory when the playhead reaches them.
                  'raster-opacity': i === index ? opacity : 0,
                  'raster-fade-duration': 0,
                }}
              />
            </RasterSource>
          );
        })}

        {showPin ? (
          <Marker lngLat={[longitude, latitude]}>
            <View style={styles.pin}>
              <View style={styles.pinDot} />
            </View>
          </Marker>
        ) : null}
      </Map>
    </View>
  );
}

export const RadarMap = memo(RadarMapInner);

export type { MapRef as RadarMapRef };

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: colors.mapBg,
  },
  pin: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(238, 242, 248, 0.26)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(238, 242, 248, 0.5)',
  },
  pinDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: colors.text,
  },
});
