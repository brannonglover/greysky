import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { WeatherIcon } from '@/components/WeatherIcon';
import { colors, typography } from '@/constants/theme';
import type { CurrentWeather, Units } from '@/lib/types';
import { formatTemp } from '@/lib/units';
import { iconForCode, labelForCode } from '@/lib/wmo';

type Props = {
  current: CurrentWeather;
  units: Units;
};

const styles = StyleSheet.create({
    wrap: {
      width: '100%',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingTop: 20,
      paddingBottom: 22,
    },
    temp: {
      color: colors.text,
      fontSize: 86,
      fontWeight: '500',
      letterSpacing: -3.4,
      lineHeight: 90,
      fontVariant: typography.tabular,
    },
    feels: {
      color: colors.textSecondary,
      fontSize: 17,
      fontWeight: '500',
      letterSpacing: -0.2,
      marginTop: 4,
      fontVariant: typography.tabular,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 10,
    },
    condition: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '500',
      letterSpacing: -0.3,
    },
});

export function CurrentHero({ current, units }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.temp}>{formatTemp(current.temperature, units)}</Text>
      <Text style={styles.feels}>Feels {formatTemp(current.apparentTemperature, units)}</Text>
      <View style={styles.row}>
        <WeatherIcon name={iconForCode(current.weatherCode, current.isDay)} size={28} />
        <Text style={styles.condition}>{labelForCode(current.weatherCode)}</Text>
      </View>
    </View>
  );
}
