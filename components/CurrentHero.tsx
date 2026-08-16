import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { WeatherIcon } from '@/components/WeatherIcon';
import { colors, typography } from '@/constants/theme';
import type { CurrentWeather, Units } from '@/lib/types';
import { formatTemp } from '@/lib/units';
import { iconForCode } from '@/lib/wmo';

type Props = {
  current: CurrentWeather;
  units: Units;
};

const styles = StyleSheet.create({
    wrap: {
      width: '100%',
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 16,
      paddingHorizontal: 8,
      paddingTop: 12,
      paddingBottom: 16,
    },
    temp: {
      color: colors.text,
      fontSize: 64,
      fontWeight: '600',
      letterSpacing: -2.6,
      lineHeight: 68,
      fontVariant: typography.tabular,
    },
    feels: {
      color: colors.textSecondary,
      fontSize: 16,
      fontWeight: '500',
      letterSpacing: -0.2,
      marginTop: 2,
      fontVariant: typography.tabular,
    },
});

export function CurrentHero({ current, units }: Props) {

  return (
    <View style={styles.wrap}>
      <WeatherIcon name={iconForCode(current.weatherCode, current.isDay)} size={86} />
      <View>
        <Text style={styles.temp}>{formatTemp(current.temperature, units)}</Text>
        <Text style={styles.feels}>Feels {formatTemp(current.apparentTemperature, units)}</Text>
      </View>
    </View>
  );
}
