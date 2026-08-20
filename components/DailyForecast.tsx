import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DayDetailSheet } from '@/components/DayDetailSheet';
import { WeatherIcon } from '@/components/WeatherIcon';
import { colors, fonts, glass, hairline, pressed, tempColorFromC, typeStyles, typography } from '@/constants/theme';
import { formatWeekdayShort } from '@/lib/format';
import type { DayPoint, HourPoint, Units } from '@/lib/types';
import { formatTemp } from '@/lib/units';
import { iconForCode } from '@/lib/wmo';

type Props = {
  days: DayPoint[];
  hours: HourPoint[];
  units: Units;
};

const styles = StyleSheet.create({
  wrap: {
    ...glass.card,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 6,
  },
  label: {
    ...typeStyles.panelLabel,
    paddingTop: 10,
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: hairline,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  day: {
    width: 60,
    color: colors.text,
    fontFamily: fonts.bodyMedium,
    fontSize: 16.5,
  },
  track: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.14)',
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    height: 9,
    borderRadius: 5,
    top: -3,
  },
  temps: {
    width: 96,
    color: colors.textSecondary,
    fontFamily: fonts.mono,
    fontSize: 15.5,
    textAlign: 'right',
    fontVariant: typography.tabular,
  },
  lo: {
    color: 'rgba(255,255,255,0.5)',
  },
  precip: {
    width: 40,
    color: colors.precip,
    fontFamily: fonts.mono,
    fontSize: 13,
    textAlign: 'right',
    fontVariant: typography.tabular,
  },
});

export function DailyForecast({ days, hours, units }: Props) {
  const week = days.slice(0, 7);
  const min = Math.min(...week.map((day) => day.temperatureMin));
  const max = Math.max(...week.map((day) => day.temperatureMax));
  const span = Math.max(1, max - min);
  const [selected, setSelected] = useState<{ day: DayPoint; index: number } | null>(null);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>7-Day</Text>
      {week.map((day, index) => {
        const leftPct = ((day.temperatureMin - min) / span) * 100;
        const widthPct = Math.max(4, ((day.temperatureMax - day.temperatureMin) / span) * 100);
        const name = formatWeekdayShort(day.date, index);
        return (
          <Pressable
            key={day.date}
            onPress={() => {
              void Haptics.selectionAsync();
              setSelected({ day, index });
            }}
            accessibilityRole="button"
            accessibilityLabel={`${name} forecast`}
            accessibilityHint="Shows detailed weather for this day"
            style={({ pressed: isPressed }) => [
              styles.row,
              index === week.length - 1 && styles.rowLast,
              isPressed && pressed,
            ]}>
            <Text style={styles.day}>{name}</Text>
            <WeatherIcon name={iconForCode(day.weatherCode, true)} size={26} />
            <View style={styles.track}>
              <LinearGradient
                colors={[tempColorFromC(day.temperatureMin), tempColorFromC(day.temperatureMax)]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.fill, { left: `${leftPct}%`, width: `${widthPct}%` }]}
              />
            </View>
            <Text style={styles.temps}>
              {formatTemp(day.temperatureMax, units)} <Text style={styles.lo}>{formatTemp(day.temperatureMin, units)}</Text>
            </Text>
            <Text style={styles.precip}>
              {day.precipitationProbabilityMax > 0 ? `${Math.round(day.precipitationProbabilityMax)}%` : ''}
            </Text>
          </Pressable>
        );
      })}
      <DayDetailSheet
        day={selected?.day ?? null}
        dayIndex={selected?.index ?? 0}
        hours={hours}
        units={units}
        onClose={() => setSelected(null)}
      />
    </View>
  );
}
