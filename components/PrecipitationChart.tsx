import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';

import { colors } from '@/constants/theme';
import { intensityFromMm } from '@/lib/precip';
import type { MinutePoint } from '@/lib/types';

type Props = {
  minutes: MinutePoint[];
  summary: string;
};

const PAD_LEFT = 52;
const PAD_RIGHT = 8;
const PAD_TOP = 28;
const PAD_AXIS = 34;
const PLOT_HEIGHT = 92;
const HEIGHT = PAD_TOP + PLOT_HEIGHT + PAD_AXIS;
const LABEL_LINE_GAP = 10;
const HOUR_MINUTES = 60;
const TICKS = [10, 20, 30, 40, 50] as const;
const BANDS = [
  { label: 'HEAVY', intensity: 1 },
  { label: 'MED', intensity: 0.5 },
  { label: 'LIGHT', intensity: 0 },
] as const;

function smoothPath(points: { x: number; y: number }[], bottom: number): { line: string; area: string } {
  if (points.length === 0) return { line: '', area: '' };
  let line = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const cpx = (prev.x + curr.x) / 2;
    line += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
  }
  const area = `${line} L ${points[points.length - 1].x} ${bottom} L ${points[0].x} ${bottom} Z`;
  return { line, area };
}

const styles = StyleSheet.create({
    wrap: {
      marginTop: 8,
      marginBottom: 0,
    },
    summary: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '500',
      letterSpacing: -0.25,
      lineHeight: 23,
      marginTop: 4,
      paddingHorizontal: 8,
      textAlign: 'center',
    },
    rule: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
      marginTop: 18,
    },
});

export function PrecipitationChart({ minutes, summary }: Props) {
  const [width, setWidth] = useState(0);
  const caption = summary.trim() || 'Clear for the hour.';
  const hasPrecip = minutes.some((p) => intensityFromMm(p.precipitationMm) > 0.04);
  const baselineY = PAD_TOP + PLOT_HEIGHT;
  const innerW = Math.max(1, width - PAD_LEFT - PAD_RIGHT);
  const span = Math.max(1, minutes[minutes.length - 1]?.minute ?? HOUR_MINUTES - 1);
  const xAt = (minute: number) => PAD_LEFT + (minute / span) * innerW;

  const paths = useMemo(() => {
    const pts = minutes.map((point) => {
      const intensity = intensityFromMm(point.precipitationMm);
      return {
        x: PAD_LEFT + (point.minute / span) * innerW,
        y: PAD_TOP + PLOT_HEIGHT * (1 - intensity),
      };
    });
    return smoothPath(pts, baselineY);
  }, [baselineY, innerW, minutes, span]);

  return (
    <View style={styles.wrap} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Svg width={width} height={HEIGHT}>
          {hasPrecip && paths.area ? (
            <>
              <Path d={paths.area} fill={colors.precipFill} opacity={0.82} />
              <Path d={paths.line} stroke={colors.precipHeavy} strokeWidth={1.5} fill="none" />
            </>
          ) : null}
          {BANDS.map((band) => {
            const y = PAD_TOP + PLOT_HEIGHT * (1 - band.intensity);
            return (
              <React.Fragment key={band.label}>
                {band.label !== 'LIGHT' ? (
                  <Line
                    x1={2}
                    x2={width}
                    y1={y}
                    y2={y}
                    stroke={colors.textTertiary}
                    strokeDasharray="5 4"
                    strokeWidth={1}
                  />
                ) : null}
                <SvgText
                  x={4}
                  y={y - LABEL_LINE_GAP}
                  fill={colors.text}
                  fontSize={12}
                  fontWeight="600"
                  alignmentBaseline="baseline">
                  {band.label}
                </SvgText>
              </React.Fragment>
            );
          })}
          <Line
            x1={2}
            x2={width}
            y1={baselineY}
            y2={baselineY}
            stroke={colors.text}
            strokeWidth={1.75}
          />
          {TICKS.map((minute) => {
            const x = xAt(minute);
            return (
              <React.Fragment key={minute}>
                <Line
                  x1={x}
                  x2={x}
                  y1={baselineY}
                  y2={baselineY + 4}
                  stroke={colors.text}
                  strokeWidth={1.25}
                />
                <SvgText
                  x={x}
                  y={baselineY + 17}
                  fill={colors.text}
                  fontSize={11}
                  textAnchor="middle">
                  {`${minute} min`}
                </SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
      ) : (
        <View style={{ height: HEIGHT }} />
      )}
      <Text style={styles.summary}>{caption}</Text>
      <View style={styles.rule} />
    </View>
  );
}
