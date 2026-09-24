import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, glass, hairline, pressed, radii, spacing, typeStyles } from '@/constants/theme';
import { formatClock } from '@/lib/format';
import type { WeatherAlert } from '@/lib/types';
import type { AlertConfidence } from '@/lib/weather';

/**
 * An official National Weather Service product, shown with the event name
 * exactly as NWS issued it. The alert palette is reserved for this card —
 * forecast-derived cards must never borrow it.
 */

type Props = {
  alert: WeatherAlert;
  /**
   * Whether this alert set has been re-checked against NWS recently. An
   * `unconfirmed` alert is still shown with its real event name and palette —
   * it is a genuine NWS product — but it carries the time it was last
   * confirmed, because a cancellation issued since then is invisible from the
   * cached copy alone.
   */
  confidence?: AlertConfidence;
  /** When the alert set was last confirmed; 0 if it never has been. */
  verifiedAt?: number;
};

function severityTone(severity: WeatherAlert['severity']): string {
  return severity === 'Extreme' || severity === 'Severe' ? colors.alertSevere : colors.alert;
}

function window(alert: WeatherAlert): string | null {
  const ends = alert.ends ? Date.parse(alert.ends) : Number.NaN;
  if (!Number.isFinite(ends)) return null;
  return `Until ${formatClock(new Date(ends).toISOString())}`;
}

export function AlertDetailCard({ alert, confidence = 'confirmed', verifiedAt = 0 }: Props) {
  const [open, setOpen] = useState(false);
  const tone = severityTone(alert.severity);
  const until = window(alert);
  const body = alert.description.trim() || alert.headline;
  const stale = confidence === 'unconfirmed';

  return (
    <View style={[styles.card, { borderColor: tone }]}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityLabel={`${alert.event}. ${open ? 'Collapse' : 'Expand'} details`}
        style={({ pressed: isPressed }) => [styles.header, isPressed && pressed]}>
        <Ionicons name="warning" size={18} color={tone} />
        <View style={styles.headings}>
          <Text style={[styles.event, { color: tone }]}>{alert.event}</Text>
          <Text style={styles.headline} numberOfLines={open ? undefined : 2}>
            {alert.headline}
          </Text>
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.textTertiary}
        />
      </Pressable>

      <View style={styles.meta}>
        <Text style={styles.source}>National Weather Service</Text>
        {until ? <Text style={styles.until}>{until}</Text> : null}
      </View>

      {stale ? (
        <Text style={styles.unverified}>
          {verifiedAt
            ? `Last confirmed ${formatClock(new Date(verifiedAt).toISOString())}. The Weather Service may have updated or canceled it since.`
            : 'Not yet confirmed with the Weather Service.'}
        </Text>
      ) : null}

      {open && body ? <Text style={styles.body}>{body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...glass.card,
    borderWidth: hairline,
    padding: spacing.md,
    marginBottom: 10,
    borderRadius: radii.card,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  headings: {
    flex: 1,
  },
  event: {
    fontFamily: fonts.bodySemi,
    fontSize: 16,
    letterSpacing: -0.2,
  },
  headline: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 13.5,
    lineHeight: 19,
    marginTop: 3,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  source: {
    ...typeStyles.panelLabel,
    fontSize: 10,
  },
  until: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 11,
  },
  unverified: {
    color: colors.textTertiary,
    fontFamily: fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 8,
  },
  body: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 12,
  },
});
