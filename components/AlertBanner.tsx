import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, hairline, pressed, radii } from '@/constants/theme';
import { formatClock } from '@/lib/format';
import { stormItemLabel, type StormItem } from '@/lib/stormImpact';
import type { AlertConfidence } from '@/lib/weather';

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
  /** Whether the NWS alert set behind these items was recently re-checked. */
  confidence?: AlertConfidence;
  /** When it was last confirmed; 0 if it never has been. */
  verifiedAt?: number;
};

export function AlertBanner({ items, confidence = 'confirmed', verifiedAt = 0 }: Props) {
  const router = useRouter();
  const relevant = items.filter((item) => item.tier !== 'tracking');
  if (relevant.length === 0) return null;

  const top = relevant[0];
  const official = top.source === 'nws';
  const extra = relevant.length - 1;
  const label = stormItemLabel(top);
  const tone = official ? colors.alert : colors.textSecondary;
  // Only official products carry a confirmation time — derived signals are
  // computed from the forecast the app already holds, so there is nothing to
  // re-check them against.
  const asOf =
    official && confidence === 'unconfirmed' && verifiedAt
      ? `as of ${formatClock(new Date(verifiedAt).toISOString())}`
      : null;

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => router.push('/(tabs)/storms')}
        accessibilityRole="button"
        accessibilityLabel={`${label}${extra > 0 ? `, and ${extra} more` : ''}${
          asOf ? `, ${asOf}` : ''
        }. Open the Storms tab.`}
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
        {asOf ? <Text style={styles.asOf}>{asOf}</Text> : null}
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
  asOf: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 10.5,
  },
});
