import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, hairline, typography } from '@/constants/theme';
import { formatHour } from '@/lib/format';
import { barColorForCode } from '@/lib/precip';
import type { HourPoint, Units } from '@/lib/types';
import { displayTemp } from '@/lib/units';
import { labelForCode } from '@/lib/wmo';

type Props = {
  hours: HourPoint[];
  units: Units;
};

const styles = StyleSheet.create({
    wrap: {
      marginTop: 20,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'stretch',
      minHeight: 46,
      gap: 10,
    },
    bar: {
      width: 10,
      marginVertical: 0,
      borderRadius: 0,
    },
    barFirst: {
      borderTopLeftRadius: 5,
      borderTopRightRadius: 5,
    },
    barLast: {
      borderBottomLeftRadius: 5,
      borderBottomRightRadius: 5,
    },
    copy: {
      width: 128,
      justifyContent: 'center',
    },
    time: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
      letterSpacing: 0.15,
    },
    condition: {
      color: colors.textSecondary,
      fontSize: 14,
      letterSpacing: -0.15,
      marginTop: 1,
    },
    track: {
      flex: 1,
      height: 28,
      justifyContent: 'center',
      alignSelf: 'center',
    },
    line: {
      height: hairline,
      backgroundColor: colors.divider,
    },
    pill: {
      position: 'absolute',
      backgroundColor: colors.tempPill,
      borderRadius: 16,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    pillText: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
      fontVariant: typography.tabular,
      letterSpacing: -0.2,
    },
});

export function HourlyTimeline({ hours, units }: Props) {
  const slice = hours.slice(0, 18);
  const temps = slice.map((hour) => displayTemp(hour.temperature, units));
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const span = Math.max(1, max - min);

  return (
    <View style={styles.wrap}>
      {slice.map((hour, index) => {
        const temp = displayTemp(hour.temperature, units);
        const pct = (temp - min) / span;
        return (
          <View key={hour.time} style={styles.row}>
            <View
              style={[
                styles.bar,
                { backgroundColor: barColorForCode(hour.weatherCode) },
                index === 0 && styles.barFirst,
                index === slice.length - 1 && styles.barLast,
              ]}
            />
            <View style={styles.copy}>
              <Text style={styles.time}>{index === 0 ? 'NOW' : formatHour(hour.time)}</Text>
              <Text style={styles.condition} numberOfLines={1}>
                {labelForCode(hour.weatherCode)}
              </Text>
            </View>
            <View style={styles.track}>
              <View style={styles.line} />
              <View style={[styles.pill, { left: `${Math.min(86, Math.max(0, pct * 86))}%` }]}>
                <Text style={styles.pillText}>{Math.round(temp)}°</Text>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}
