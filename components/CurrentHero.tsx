import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TemperatureDial } from '@/components/TemperatureDial';
import { WeatherIcon } from '@/components/WeatherIcon';
import { colors, fonts, glass, pressed, typography } from '@/constants/theme';
import type { CurrentWeather, Units } from '@/lib/types';
import { formatTemp } from '@/lib/units';
import { iconForCode, labelForCode } from '@/lib/wmo';

type Props = {
  current: CurrentWeather;
  units: Units;
  high?: number;
  low?: number;
  /** Chance of precipitation today, 0–100. Drives the dial's inner ring. */
  precipProbability?: number;
  /** One plain-language line, e.g. "Staying dry — under 15% all evening." */
  verdict?: string;
};

export function CurrentHero({ current, units, high, low, precipProbability, verdict }: Props) {
  const router = useRouter();
  const icon = iconForCode(current.weatherCode, current.isDay);
  const hasRange = high != null && low != null;
  const hasRain = precipProbability != null && Number.isFinite(precipProbability);

  return (
    <View style={styles.wrap}>
      <TemperatureDial
        tempC={current.temperature}
        lowC={low ?? current.temperature}
        highC={high ?? current.temperature}
        feelsC={current.apparentTemperature}
        precipProbability={precipProbability}
        units={units}>
        <Text style={styles.eyebrow}>RIGHT NOW</Text>
        <Text style={styles.temp} numberOfLines={1} adjustsFontSizeToFit>
          {formatTemp(current.temperature, units)}
        </Text>
        <View style={styles.condition}>
          <WeatherIcon name={icon} size={15} />
          <Text style={styles.conditionText} numberOfLines={1}>
            {labelForCode(current.weatherCode)}
          </Text>
        </View>
      </TemperatureDial>

      <View style={styles.pills}>
        {hasRange ? (
          <View style={styles.pill}>
            <View style={[styles.dot, { backgroundColor: colors.tempWarm }]} />
            <Text style={styles.pillText}>
              {formatTemp(low, units)} → {formatTemp(high, units)}
            </Text>
          </View>
        ) : null}
        {hasRain ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Rain ${Math.round(precipProbability)} percent today. Open rain detail.`}
            onPress={() => router.push('/rain')}
            style={({ pressed: isPressed }) => [styles.pill, isPressed && pressed]}>
            <View style={[styles.dot, { backgroundColor: colors.precip }]} />
            <Text style={styles.pillText}>Rain {Math.round(precipProbability)}%</Text>
            <Ionicons name="chevron-forward" size={13} color={colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>

      {verdict ? (
        <View style={styles.verdict}>
          <Ionicons name="water-outline" size={15} color={colors.precip} />
          <Text style={styles.verdictText}>{verdict}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  eyebrow: {
    color: colors.precip,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2.6,
  },
  temp: {
    color: colors.text,
    fontFamily: fonts.monoMedium,
    fontSize: 72,
    letterSpacing: -2,
    lineHeight: 82,
    fontVariant: typography.tabular,
  },
  condition: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  conditionText: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  pill: {
    ...glass.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 9,
    minHeight: 44,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pillText: {
    color: colors.text,
    fontFamily: fonts.bodyMedium,
    fontSize: 13.5,
    fontVariant: typography.tabular,
  },
  verdict: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 12,
  },
  verdictText: {
    color: colors.text,
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    letterSpacing: -0.2,
    flexShrink: 1,
  },
});
