import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { WeatherIcon } from '@/components/WeatherIcon';
import { colors, fonts, glass, typography } from '@/constants/theme';
import type { CurrentWeather, Units } from '@/lib/types';
import { formatTemp } from '@/lib/units';
import { iconForCode, labelForCode } from '@/lib/wmo';

type Props = {
  current: CurrentWeather;
  units: Units;
  high?: number;
  low?: number;
};

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 4,
    overflow: 'visible',
  },
  temp: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 96,
    letterSpacing: -1.8,
    lineHeight: 110,
    fontVariant: typography.tabular,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  pill: {
    ...glass.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  pillText: {
    color: colors.text,
    fontFamily: fonts.bodyMedium,
    fontSize: 13.5,
  },
  hilo: {
    marginTop: 8,
  },
  hiloText: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 13,
    fontVariant: typography.tabular,
  },
});

export function CurrentHero({ current, units, high, low }: Props) {
  const icon = iconForCode(current.weatherCode, current.isDay);

  return (
    <View style={styles.wrap}>
      <Text style={styles.temp}>{formatTemp(current.temperature, units)}</Text>
      <View style={styles.pills}>
        <View style={styles.pill}>
          <WeatherIcon name={icon} size={15} />
          <Text style={styles.pillText}>{labelForCode(current.weatherCode)}</Text>
        </View>
        <View style={styles.pill}>
          <Text style={styles.pillText}>Feels {formatTemp(current.apparentTemperature, units)}</Text>
        </View>
      </View>
      {high != null && low != null ? (
        <View style={styles.hilo}>
          <View style={styles.pill}>
            <Text style={styles.hiloText}>
              {formatTemp(high, units)} / {formatTemp(low, units)}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
