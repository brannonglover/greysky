import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, hairline, pressed, radii } from '@/constants/theme';
import { stormItemLabel, type StormItem } from '@/lib/stormImpact';

/**
 * The forecast screen's one-line summary of what is coming, and the way in to
 * the Storms tab.
 *
 * It shows the highest-impact item across all sources, so a hurricane whose
 * wind field is due here outranks a passing thunderstorm regardless of which
 * one came from an official product. Systems in the "tracking" tier — active
 * somewhere, but with no forecast effect here — deliberately never appear;
 * this strip is about the user's own weather.
 *
 * Official alerts keep the alert palette. Anything derived from the forecast
 * gets a plainer treatment and hedged wording, so the pill can never be read
 * as a government warning.
 */

type Props = {
  items: StormItem[];
};

export function AlertBanner({ items }: Props) {
  const router = useRouter();
  const relevant = items.filter((item) => item.tier !== 'tracking');
  if (relevant.length === 0) return null;

  const top = relevant[0];
  const official = top.source === 'nws';
  const extra = relevant.length - 1;
  const label = stormItemLabel(top);
  const tone = official ? colors.alert : colors.textSecondary;

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => router.push('/(tabs)/storms')}
        accessibilityRole="button"
        accessibilityLabel={`${label}${extra > 0 ? `, and ${extra} more` : ''}. Open the Storms tab.`}
        style={({ pressed: isPressed }) => [
          styles.pill,
          official ? styles.pillOfficial : styles.pillDerived,
          isPressed && pressed,
        ]}>
        <Ionicons
          name={official ? 'warning-outline' : 'thunderstorm-outline'}
          size={15}
          color={tone}
        />
        <Text style={[styles.label, { color: tone }]} numberOfLines={1}>
          {label}
          {extra > 0 ? `  |  +${extra}` : ''}
        </Text>
        <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 12,
    marginBottom: 2,
    alignItems: 'center',
  },
  pill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  pillOfficial: {
    backgroundColor: colors.alertFill,
    borderColor: 'rgba(255, 193, 105, 0.6)',
  },
  pillDerived: {
    backgroundColor: colors.surface,
    borderWidth: hairline,
    borderColor: colors.divider,
  },
  label: {
    fontFamily: fonts.bodySemi,
    fontSize: 13.5,
    maxWidth: 250,
  },
});
