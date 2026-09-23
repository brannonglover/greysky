import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';

import { colors } from '@/constants/theme';
import type { TrackPoint } from '@/lib/tropical';

/**
 * A small diagram of the forecast track and the wind field around it.
 *
 * The centerline is drawn dashed and faint on purpose. NHC's own guidance is
 * that the line is the least useful part of a forecast — the storm's effects
 * are spread across the wind field, and average day-4 track error runs past a
 * hundred nautical miles. So the filled wind envelope carries the emphasis and
 * the line is only there to show the direction of travel.
 */

type Props = {
  track: TrackPoint[];
  latitude: number;
  longitude: number;
  height?: number;
  /**
   * Whether to frame the user's location alongside the track. For a storm on
   * the other side of the continent, including it zooms the diagram out until
   * both are dots in an empty ocean, so distant systems show the track alone.
   */
  showUser?: boolean;
};

const NM_TO_DEG = 1 / 60;

/** Mean of the quadrant radii — the envelope is indicative, not a footprint. */
function meanRadiusDeg(point: TrackPoint): number {
  const radii = point.radii34;
  if (!radii) return 0;
  return ((radii.ne + radii.se + radii.sw + radii.nw) / 4) * NM_TO_DEG;
}

export function StormTrackMap({ track, latitude, longitude, height = 170, showUser = true }: Props) {
  const geometry = useMemo(() => {
    if (track.length === 0) return null;

    const lons = track.map((p) => p.longitude);
    const lats = track.map((p) => p.latitude);
    const pad = Math.max(...track.map(meanRadiusDeg), 2);

    const framed = showUser ? { lat: [latitude], lon: [longitude] } : { lat: [], lon: [] };
    const minLon = Math.min(...lons, ...framed.lon) - pad;
    const maxLon = Math.max(...lons, ...framed.lon) + pad;
    const minLat = Math.min(...lats, ...framed.lat) - pad;
    const maxLat = Math.max(...lats, ...framed.lat) + pad;

    const spanLon = Math.max(maxLon - minLon, 0.5);
    const spanLat = Math.max(maxLat - minLat, 0.5);
    // Equirectangular with a cos(lat) correction, so the shapes stay round.
    const cos = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const width = 100;
    const aspect = spanLat / (spanLon * Math.max(cos, 0.2));
    const viewHeight = Math.max(40, Math.min(160, width * aspect));

    const project = (lat: number, lon: number) => ({
      x: ((lon - minLon) / spanLon) * width,
      y: viewHeight - ((lat - minLat) / spanLat) * viewHeight,
    });

    const scaleX = width / spanLon;
    const scaleY = viewHeight / spanLat;

    return { project, width, viewHeight, scaleX, scaleY };
  }, [track, latitude, longitude, showUser]);

  if (!geometry) return null;

  const { project, width, viewHeight, scaleX, scaleY } = geometry;
  const points = track.map((point) => ({ point, ...project(point.latitude, point.longitude) }));
  const user = project(latitude, longitude);
  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // The envelope is the union of per-point wind-field circles, approximated by
  // drawing them stacked; overlapping alpha reads as one continuous corridor.
  const envelope = points.filter(({ point }) => meanRadiusDeg(point) > 0);

  return (
    <View style={[styles.wrap, { height }]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${width} ${viewHeight}`}>
        {envelope.map(({ point, x, y }, index) => (
          <Circle
            key={`field-${index}`}
            cx={x}
            cy={y}
            r={Math.max(1.5, meanRadiusDeg(point) * ((scaleX + scaleY) / 2))}
            fill={colors.precipFill}
            stroke={colors.precipMuted}
            strokeWidth={0.4}
          />
        ))}

        <Polyline
          points={line}
          fill="none"
          stroke={colors.rangePill}
          strokeWidth={0.8}
          strokeDasharray="2,2"
          strokeLinecap="round"
        />

        {points.map(({ point, x, y }, index) => (
          <Circle
            key={`node-${index}`}
            cx={x}
            cy={y}
            r={point.analysis ? 2.4 : 1.2}
            fill={point.analysis ? colors.alertSevere : colors.rangePill}
          />
        ))}

        {showUser ? (
          <>
            <Line
              x1={user.x - 2.5}
              y1={user.y}
              x2={user.x + 2.5}
              y2={user.y}
              stroke={colors.mapPin}
              strokeWidth={0.9}
            />
            <Line
              x1={user.x}
              y1={user.y - 2.5}
              x2={user.x}
              y2={user.y + 2.5}
              stroke={colors.mapPin}
              strokeWidth={0.9}
            />
            <Circle cx={user.x} cy={user.y} r={1.3} fill={colors.mapPin} />
          </>
        ) : null}

        <SvgText
          x={2}
          y={viewHeight - 2}
          fill={colors.textTertiary}
          fontSize={3.4}
          opacity={0.9}>
          Forecast track · error grows with time
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 12,
    borderRadius: 12,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.mapBg,
  },
});
