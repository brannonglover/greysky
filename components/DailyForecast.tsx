import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useState } from 'react';
import { LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { WeatherIcon } from '@/components/WeatherIcon';
import { colors, pressed, radii, typography } from '@/constants/theme';
import { formatWeekdayShort } from '@/lib/format';
import type { DayPoint, HourlyMetric, Units } from '@/lib/types';
import { formatPrecip, formatTemp } from '@/lib/units';
import { iconForCode } from '@/lib/wmo';

type Props = {
  days: DayPoint[];
  units: Units;
  metric: HourlyMetric;
  onMetricChange: (metric: HourlyMetric) => void;
  rainLabel: string;
  sunsetLabel: string;
};

const METRICS: { id: HourlyMetric; label: (units: Units) => string }[] = [
  { id: 'temp', label: (units) => `TEMP (°${units === 'us' ? 'F' : 'C'})` },
  { id: 'feels', label: (units) => `FEELS-LIKE (°${units === 'us' ? 'F' : 'C'})` },
  { id: 'precip', label: () => 'PRECIP PROB (%)' },
];

const TRACK_HEIGHT = 24;
const PILL_HEIGHT = 10;
const PILL_MIN_WIDTH = 10;
const LABEL_GAP = 4;
const CHAR_WIDTH = 11;

function estimateLabelWidth(label: string): number {
  return Math.max(28, label.length * CHAR_WIDTH);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function layoutTempRange(
  lo: number,
  hi: number,
  weekMin: number,
  weekSpan: number,
  trackWidth: number,
  labelWidth: number,
) {
  const inset = labelWidth + LABEL_GAP;
  const scaleWidth = Math.max(0, trackWidth - inset * 2);
  const loT = clamp((lo - weekMin) / weekSpan, 0, 1);
  const hiT = clamp((hi - weekMin) / weekSpan, 0, 1);

  let pillLeft = inset + loT * scaleWidth;
  let pillWidth = Math.max(PILL_MIN_WIDTH, (hiT - loT) * scaleWidth);

  const minLeft = inset;
  const maxRight = trackWidth - inset;
  if (pillLeft + pillWidth > maxRight) {
    pillLeft = clamp(pillLeft, minLeft, Math.max(minLeft, maxRight - pillWidth));
    pillWidth = Math.min(pillWidth, Math.max(PILL_MIN_WIDTH, maxRight - pillLeft));
  }
  if (pillLeft < minLeft) {
    pillWidth = Math.max(PILL_MIN_WIDTH, pillWidth - (minLeft - pillLeft));
    pillLeft = minLeft;
  }

  return {
    pillLeft,
    pillWidth,
    loLeft: pillLeft - LABEL_GAP - labelWidth,
    hiLeft: pillLeft + pillWidth + LABEL_GAP,
  };
}

const styles = StyleSheet.create({
    pills: {
      gap: 8,
      paddingVertical: 8,
    },
    pill: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: radii.pill,
      borderCurve: 'continuous',
      borderWidth: 1,
      borderColor: 'rgba(244, 240, 230, 0.35)',
    },
    pillActive: {
      backgroundColor: colors.text,
      borderColor: colors.text,
    },
    pillText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.25,
    },
    pillTextActive: {
      color: colors.onAccent,
    },
    meta: {
      color: colors.text,
      fontSize: 15,
      letterSpacing: -0.15,
      marginTop: 2,
    },
    list: {
      marginTop: 16,
      gap: 16,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    dayCol: {
      width: 64,
    },
    day: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
      letterSpacing: -0.2,
    },
    popRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      marginTop: 2,
    },
    pop: {
      color: colors.precipHeavy,
      fontSize: 13,
      fontWeight: '600',
      fontVariant: typography.tabular,
    },
    precipLo: {
      width: 36,
      color: colors.text,
      fontSize: 16,
      textAlign: 'right',
      fontVariant: typography.tabular,
    },
    precipHi: {
      width: 52,
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
      textAlign: 'right',
      fontVariant: typography.tabular,
    },
    track: {
      flex: 1,
      height: TRACK_HEIGHT,
      justifyContent: 'center',
    },
    tempLabel: {
      position: 'absolute',
      top: 0,
      height: TRACK_HEIGHT,
      lineHeight: TRACK_HEIGHT,
      color: colors.text,
      fontSize: 16,
      fontVariant: typography.tabular,
      letterSpacing: -0.2,
    },
    tempLo: {
      textAlign: 'right',
    },
    tempHi: {
      fontWeight: '600',
      textAlign: 'left',
    },
    rangePill: {
      position: 'absolute',
      top: (TRACK_HEIGHT - PILL_HEIGHT) / 2,
      height: PILL_HEIGHT,
      borderRadius: PILL_HEIGHT / 2,
      backgroundColor: colors.rangePill,
    },
    precipBar: {
      height: PILL_HEIGHT,
      borderRadius: PILL_HEIGHT / 2,
      backgroundColor: colors.precip,
    },
});

export function DailyForecast({ days, units, metric, onMetricChange, rainLabel, sunsetLabel }: Props) {
  const [trackWidth, setTrackWidth] = useState(0);
  const lows = days.map((d) => (metric === 'feels' ? d.apparentMin : d.temperatureMin));
  const highs = days.map((d) => (metric === 'feels' ? d.apparentMax : d.temperatureMax));
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = Math.max(1, max - min);
  const labelWidth = Math.max(
    28,
    ...days.flatMap((day) => {
      const lo = metric === 'feels' ? day.apparentMin : day.temperatureMin;
      const hi = metric === 'feels' ? day.apparentMax : day.temperatureMax;
      return [estimateLabelWidth(formatTemp(lo, units)), estimateLabelWidth(formatTemp(hi, units))];
    }),
  );

  const onTrackLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width);
    setTrackWidth((prev) => (prev === next ? prev : next));
  };

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
        {METRICS.map((item) => {
          const active = item.id === metric;
          return (
            <Pressable
              key={item.id}
              onPress={() => onMetricChange(item.id)}
              style={({ pressed: isPressed }) => [
                styles.pill,
                active && styles.pillActive,
                isPressed && pressed,
              ]}>
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{item.label(units)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={styles.meta}>{rainLabel}</Text>
      <Text style={styles.meta}>{sunsetLabel}</Text>

      <View style={styles.list}>
        {days.map((day, index) => {
          const lo = metric === 'feels' ? day.apparentMin : day.temperatureMin;
          const hi = metric === 'feels' ? day.apparentMax : day.temperatureMax;
          const loLabel = formatTemp(lo, units);
          const hiLabel = formatTemp(hi, units);
          const range = trackWidth > 0 ? layoutTempRange(lo, hi, min, span, trackWidth, labelWidth) : null;
          const precipWidth = Math.max(8, day.precipitationProbabilityMax);

          return (
            <View key={day.date} style={styles.row}>
              <View style={styles.dayCol}>
                <Text style={styles.day}>{formatWeekdayShort(day.date, index)}</Text>
                <View style={styles.popRow}>
                  <Ionicons name="water" size={12} color={colors.precipHeavy} />
                  <Text style={styles.pop}>{Math.round(day.precipitationProbabilityMax)}%</Text>
                </View>
              </View>
              <WeatherIcon name={iconForCode(day.weatherCode, true)} size={36} />
              {metric === 'precip' ? (
                <>
                  <Text style={styles.precipLo}>{Math.round(day.precipitationProbabilityMax)}%</Text>
                  <View style={styles.track}>
                    <View style={[styles.precipBar, { width: `${precipWidth}%` }]} />
                  </View>
                  <Text style={styles.precipHi}>{formatPrecip(day.precipitationSum, units)}</Text>
                </>
              ) : (
                <View style={styles.track} onLayout={onTrackLayout}>
                  {range ? (
                    <>
                      <Text style={[styles.tempLabel, styles.tempLo, { left: range.loLeft, width: labelWidth }]}>
                        {loLabel}
                      </Text>
                      <View
                        style={[
                          styles.rangePill,
                          { left: range.pillLeft, width: range.pillWidth },
                        ]}
                      />
                      <Text style={[styles.tempLabel, styles.tempHi, { left: range.hiLeft, width: labelWidth }]}>
                        {hiLabel}
                      </Text>
                    </>
                  ) : null}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}
