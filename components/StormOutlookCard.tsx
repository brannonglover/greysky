import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, glass, hairline, spacing } from '@/constants/theme';
import { approximateWhen, signalDetail, type StormSignal } from '@/lib/stormOutlook';
import type { Units } from '@/lib/types';

/**
 * Grey Sky's own read of the hourly forecast.
 *
 * This card is styled deliberately *unlike* AlertDetailCard: no alert colour,
 * a plain informational icon, and an explicit disclaimer strip. Someone
 * glancing at the Storms tab must be able to tell at a distance which cards
 * carry the National Weather Service's authority and which carry ours.
 */

type Props = {
  signal: StormSignal;
  units: Units;
};

const ICONS: Record<StormSignal['kind'], keyof typeof Ionicons.glyphMap> = {
  thunderstorm: 'thunderstorm-outline',
  wind: 'flag-outline',
  rain: 'rainy-outline',
};

export function StormOutlookCard({ signal, units }: Props) {
  const detail = signalDetail(signal, units);
  const when = approximateWhen(signal.startsAt, signal.startsAtIso);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name={ICONS[signal.kind]} size={18} color={colors.precip} />
        <View style={styles.headings}>
          <Text style={styles.headline}>{signal.headline}</Text>
          <Text style={styles.when}>{when}</Text>
        </View>
      </View>

      {detail ? <Text style={styles.detail}>{detail}</Text> : null}

      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>
          Forecast signal · not an official warning
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...glass.card,
    padding: spacing.md,
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  headings: {
    flex: 1,
  },
  headline: {
    color: colors.text,
    fontFamily: fonts.bodySemi,
    fontSize: 16,
    letterSpacing: -0.2,
  },
  when: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 13.5,
    marginTop: 3,
  },
  detail: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  disclaimer: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: hairline,
    borderTopColor: colors.divider,
  },
  disclaimerText: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});
