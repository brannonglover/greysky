import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import { WeatherIcon } from '@/components/WeatherIcon';
import { colors, fonts, glass, typeStyles, typography } from '@/constants/theme';
import { formatHourCompact } from '@/lib/format';
import { iconForLikelyWeather, isPrecipComing, precipIsLikely, rainStartsInMinutes, rainStopsInMinutes } from '@/lib/nowcast';
import { intensityFromHourlyMm } from '@/lib/precip';
import type { HourPoint, MinutePoint, Units } from '@/lib/types';
import { displayTemp, formatPrecip, hasPrecipAmount } from '@/lib/units';

type Props = {
  hours: HourPoint[];
  units: Units;
  minutes?: MinutePoint[];
};

const COL_W = 72;
const PRECIP_H = 108;
const PRECIP_PAD_TOP = 22;
const PRECIP_PAD_BOTTOM = 12;
const BANDS = [
  { label: 'HEAVY', intensity: 1 },
  { label: 'MED', intensity: 0.5 },
  { label: 'LIGHT', intensity: 0 },
] as const;

function smoothLine(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const cpx = (prev.x + curr.x) / 2;
    d += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
  }
  return d;
}

function xAt(index: number): number {
  return index * COL_W + COL_W / 2;
}

function areaFromLine(line: string, points: { x: number; y: number }[], baseline: number): string {
  if (!line || points.length === 0) return '';
  return `${line} L ${points[points.length - 1].x} ${baseline} L ${points[0].x} ${baseline} Z`;
}

const styles = StyleSheet.create({
  wrap: {
    ...glass.card,
    marginTop: 16,
  },
  label: {
    ...typeStyles.panelLabel,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  rainWindow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.precip,
  },
  rainText: {
    color: colors.precip,
    fontFamily: fonts.monoMedium,
    fontSize: 13,
    letterSpacing: 0.3,
  },
  hours: {
    flexDirection: 'row',
    paddingBottom: 16,
    paddingTop: 4,
  },
  hour: {
    width: COL_W,
    alignItems: 'center',
    gap: 7,
  },
  hourTime: {
    color: 'rgba(255,255,255,0.7)',
    fontFamily: fonts.monoMedium,
    fontSize: 13,
  },
  hourTemp: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 18,
    fontVariant: typography.tabular,
  },
  hourPrecip: {
    color: colors.precip,
    fontFamily: fonts.monoMedium,
    fontSize: 12,
    minHeight: 16,
  },
  bands: {
    position: 'absolute',
    left: 10,
    width: 52,
    justifyContent: 'space-between',
    pointerEvents: 'none',
  },
  bandLabel: {
    color: colors.text,
    fontFamily: fonts.monoMedium,
    fontSize: 11,
    letterSpacing: 0.6,
  },
});

export function HourlyTimeline({ hours, units, minutes }: Props) {
  const model = useMemo(
    () =>
      hours.slice(0, 12).map((hour, index) => ({
        time: hour.time,
        label: index === 0 ? 'Now' : formatHourCompact(hour.time),
        temp: displayTemp(hour.temperature, units),
        chance: hour.precipitationProbability,
        amountMm: hour.precipitation,
        intensity: intensityFromHourlyMm(hour.precipitation),
        raining: precipIsLikely(hour.precipitationProbability, hour.precipitation),
        icon: iconForLikelyWeather(
          hour.weatherCode,
          hour.isDay,
          hour.precipitationProbability,
          hour.precipitation,
          hour.cloudCover,
        ),
      })),
    [hours, units],
  );

  const showPrecip = isPrecipComing(minutes, hours);
  const chartW = Math.max(COL_W, model.length * COL_W);

  const rainSpan = useMemo(() => {
    if (!showPrecip) return null;
    let startIdx = -1;
    let endIdx = -1;
    model.slice(0, 2).forEach((hour, i) => {
      if (hour.raining) {
        if (startIdx === -1) startIdx = i;
        endIdx = i;
      }
    });
    if (startIdx === -1) return null;
    return {
      startIdx,
      endIdx,
      startX: xAt(startIdx),
      endX: xAt(endIdx),
    };
  }, [model, showPrecip]);

  const precipPlot = useMemo(() => {
    if (model.length < 2) return null;
    const plotH = PRECIP_H - PRECIP_PAD_TOP - PRECIP_PAD_BOTTOM;
    const baseline = PRECIP_H - PRECIP_PAD_BOTTOM;
    const pts = model.map((hour, i) => ({
      x: xAt(i),
      y: PRECIP_PAD_TOP + (1 - hour.intensity) * plotH,
    }));
    const line = smoothLine(pts);
    return { line, area: areaFromLine(line, pts, baseline), baseline, plotH };
  }, [model]);

  const rainLabel = useMemo(() => {
    if (!showPrecip) return null;
    const near = model.slice(0, 2);
    const totalMm = near.reduce((sum, hour) => sum + hour.amountMm, 0);
    const amount = hasPrecipAmount(totalMm) ? formatPrecip(totalMm, units) : null;
    const starts = minutes ? rainStartsInMinutes(minutes) : null;
    const stops = minutes ? rainStopsInMinutes(minutes) : null;
    let headline = 'RAIN THIS HOUR';
    if (starts != null) headline = `RAIN IN ${starts} MIN`;
    else if (stops != null && stops < 55) headline = `RAIN ${stops} MIN LEFT`;
    return amount ? `${headline} · ${amount}` : headline;
  }, [minutes, model, showPrecip, units]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Next 12 Hours</Text>
      {rainLabel ? (
        <View style={styles.rainWindow}>
          <View style={styles.dot} />
          <Text style={styles.rainText}>{rainLabel}</Text>
        </View>
      ) : null}
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ width: chartW }}>
            {showPrecip && precipPlot ? (
              <Svg width={chartW} height={PRECIP_H}>
                {BANDS.map((band) => {
                  const y =
                    band.intensity === 0
                      ? precipPlot.baseline
                      : PRECIP_PAD_TOP + (1 - band.intensity) * precipPlot.plotH;
                  return (
                    <Line
                      key={band.label}
                      x1={0}
                      x2={chartW}
                      y1={y}
                      y2={y}
                      stroke={band.intensity === 0 ? colors.text : colors.textTertiary}
                      strokeWidth={band.intensity === 0 ? 1.5 : 1}
                      strokeDasharray={band.intensity === 0 ? undefined : '5 4'}
                      opacity={band.intensity === 0 ? 0.85 : 0.45}
                    />
                  );
                })}
                {rainSpan ? (
                  <>
                    <Line
                      x1={rainSpan.startX}
                      y1={8}
                      x2={rainSpan.startX}
                      y2={precipPlot.baseline}
                      stroke={colors.precip}
                      strokeWidth={1}
                      strokeDasharray="2 4"
                      opacity={0.55}
                    />
                    <Line
                      x1={rainSpan.endX}
                      y1={8}
                      x2={rainSpan.endX}
                      y2={precipPlot.baseline}
                      stroke={colors.precip}
                      strokeWidth={1}
                      strokeDasharray="2 4"
                      opacity={0.55}
                    />
                  </>
                ) : null}
                <Path d={precipPlot.area} fill={colors.precip} opacity={0.22} />
                <Path
                  d={precipPlot.line}
                  fill="none"
                  stroke={colors.precipHeavy}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </Svg>
            ) : null}
            <View style={styles.hours}>
              {model.map((hour) => (
                <View key={hour.time} style={styles.hour}>
                  <Text style={styles.hourTime}>{hour.label}</Text>
                  <WeatherIcon name={hour.icon} size={32} />
                  <Text style={styles.hourTemp}>{Math.round(hour.temp)}°</Text>
                  <Text style={styles.hourPrecip}>{hour.chance > 0 ? `${Math.round(hour.chance)}%` : ''}</Text>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
        {showPrecip ? (
          <View
            style={[
              styles.bands,
              { top: PRECIP_PAD_TOP - 10, height: PRECIP_H - PRECIP_PAD_TOP - PRECIP_PAD_BOTTOM + 12 },
            ]}>
            {BANDS.map((band) => (
              <Text key={band.label} style={styles.bandLabel}>
                {band.label}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}
