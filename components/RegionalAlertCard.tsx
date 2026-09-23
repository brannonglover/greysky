import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, glass, spacing } from '@/constants/theme';
import type { RegionalAlert } from '@/lib/regional';
import type { Units } from '@/lib/types';

/**
 * An official NWS alert somewhere in the user's region but not over them.
 *
 * Awareness, deliberately not alarm. It keeps the exact event name — it is a
 * real official product — but is stripped of the alert palette and urgency the
 * local cards carry, and says plainly that it does not affect this location.
 * Being in the same state as a tornado warning is not a threat, and the card
 * must never read as though it were.
 */

type Props = {
  entry: RegionalAlert;
  units: Units;
};

function distanceLabel(km: number, units: Units): string {
  if (units === 'us') return `${Math.round(km / 1.60934)} mi away`;
  return `${Math.round(km)} km away`;
}

export function RegionalAlertCard({ entry, units }: Props) {
  const { alert, state, distanceKm } = entry;

  return (
    <View style={styles.card}>
      <Ionicons name="ellipse-outline" size={13} color={colors.textTertiary} style={styles.dot} />
      <View style={styles.body}>
        <Text style={styles.event}>{alert.event}</Text>
        <Text style={styles.meta}>
          {state}
          {distanceKm !== null ? ` · ${distanceLabel(distanceKm, units)}` : ''}
          {' · Not affecting your location'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...glass.card,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: spacing.sm + 2,
    marginBottom: 8,
    opacity: 0.78,
  },
  dot: {
    marginTop: 2,
  },
  body: {
    flex: 1,
  },
  event: {
    color: colors.textSecondary,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
  },
  meta: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 10.5,
    lineHeight: 16,
    marginTop: 3,
  },
});
