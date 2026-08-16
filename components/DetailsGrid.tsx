import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/theme';
import { formatClock } from '@/lib/format';
import type { CurrentWeather, DayPoint, Units } from '@/lib/types';
import { cardinalFromDegrees, formatPressure, formatTemp, formatVisibility, formatWind, uvLabel } from '@/lib/units';

type Props = {
  current: CurrentWeather;
  today?: DayPoint;
  dewPoint: number;
  units: Units;
};

const styles = StyleSheet.create({
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    cell: {
      width: '48%',
      flexGrow: 1,
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 14,
      minHeight: 92,
    },
    label: {
      color: colors.textTertiary,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.7,
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    value: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '600',
    },
    detail: {
      color: colors.textSecondary,
      fontSize: 13,
      marginTop: 4,
    },
});

function Cell({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <View style={styles.cell}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  );
}

export function DetailsGrid({ current, today, dewPoint, units }: Props) {
  return (
    <View style={styles.grid}>
      <Cell
        label="Wind"
        value={formatWind(current.windSpeed, units)}
        detail={`${cardinalFromDegrees(current.windDirection)} · Gusts ${formatWind(current.windGusts, units)}`}
      />
      <Cell label="Humidity" value={`${Math.round(current.humidity)}%`} />
      <Cell label="Dew point" value={formatTemp(dewPoint, units)} />
      <Cell label="UV index" value={`${Math.round(today?.uvIndexMax ?? 0)}`} detail={uvLabel(today?.uvIndexMax ?? 0)} />
      <Cell label="Visibility" value={formatVisibility(current.visibility, units)} />
      <Cell label="Pressure" value={formatPressure(current.pressure, units)} />
      <Cell label="Cloud cover" value={`${Math.round(current.cloudCover)}%`} />
      <Cell
        label="Sun"
        value={today ? formatClock(today.sunrise) : '—'}
        detail={today ? `Sunset ${formatClock(today.sunset)}` : undefined}
      />
    </View>
  );
}
