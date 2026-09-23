import Ionicons from '@expo/vector-icons/Ionicons';
import * as WebBrowser from 'expo-web-browser';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, glass, hairline, pressed, spacing } from '@/constants/theme';
import {
  CATEGORY_COLORS,
  categoryName,
  formatProbability,
  hazardSentence,
  outlookHeadline,
  riskSentence,
  type DayOutlook,
  type HazardRisk,
} from '@/lib/spc';

/**
 * A Storm Prediction Center severe-weather outlook — the earliest stage of the
 * progression, one to three days ahead of any watch or warning.
 *
 * Visually this is a third thing, distinct from both neighbours it will sit
 * among. It does not borrow the alert palette, because it is not an official
 * warning for this location; and it does not use the muted forecast-signal
 * treatment, because it is not Grey Sky's own inference either. Instead it
 * leads with SPC's own categorical colour, which anyone who has seen an SPC
 * map will recognise instantly, and names its source outright.
 */

type Props = {
  outlook: DayOutlook;
};

const SPC_PRODUCT_URL = 'https://www.spc.noaa.gov/products/outlook/';

function Hazard({ label, risk }: { label: string; risk: HazardRisk }) {
  return (
    <View style={styles.hazard}>
      <Text style={styles.hazardLabel}>{label}</Text>
      <View style={styles.hazardValueRow}>
        <Text style={styles.hazardValue}>{formatProbability(risk)}</Text>
        {risk.significant ? (
          <View style={styles.sigChip}>
            <Text style={styles.sigText}>SIG</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function SpcOutlookCard({ outlook }: Props) {
  const code = outlook.categorical?.code;
  const accent = code ? CATEGORY_COLORS[code] : colors.textTertiary;
  const hazards = [
    outlook.tornado ? { label: 'Tornado', risk: outlook.tornado } : null,
    outlook.wind ? { label: 'Wind', risk: outlook.wind } : null,
    outlook.hail ? { label: 'Hail', risk: outlook.hail } : null,
    outlook.anySevere ? { label: 'Any severe', risk: outlook.anySevere } : null,
  ].filter((entry): entry is { label: string; risk: HazardRisk } => entry !== null);

  return (
    <View style={styles.card}>
      <View style={[styles.accent, { backgroundColor: accent }]} />

      <View style={styles.body}>
        <View style={styles.header}>
          <View style={styles.headings}>
            <Text style={styles.headline}>{outlookHeadline(outlook)}</Text>
            <Text style={styles.risk}>{riskSentence(outlook)}</Text>
          </View>
          {code ? (
            <View style={[styles.categoryChip, { backgroundColor: accent }]}>
              <Text style={styles.categoryText}>{categoryName(code).toUpperCase()}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.hazardSentence}>{hazardSentence(outlook)}</Text>

        {hazards.length > 0 ? (
          <View style={styles.hazards}>
            {hazards.map((entry) => (
              <Hazard key={entry.label} label={entry.label} risk={entry.risk} />
            ))}
          </View>
        ) : null}

        {hazards.some((entry) => entry.risk.significant) ? (
          <Text style={styles.sigNote}>
            SIG marks SPC's hatched area, where significant severe weather is possible.
          </Text>
        ) : null}

        <View style={styles.footer}>
          <Text style={styles.source}>SPC CONVECTIVE OUTLOOK · DAY {outlook.day}</Text>
          <Pressable
            onPress={() => void WebBrowser.openBrowserAsync(SPC_PRODUCT_URL)}
            accessibilityRole="link"
            accessibilityLabel="Open the Storm Prediction Center outlook"
            style={({ pressed: isPressed }) => [styles.link, isPressed && pressed]}>
            <Text style={styles.linkText}>SPC outlook</Text>
            <Ionicons name="open-outline" size={13} color={colors.accent} />
          </Pressable>
        </View>

        <Text style={styles.disclaimer}>
          A risk assessment for your area over a multi-hour window — not a warning, and not a
          forecast that severe weather will occur at your exact location.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...glass.card,
    flexDirection: 'row',
    marginBottom: 10,
  },
  accent: {
    width: 4,
  },
  body: {
    flex: 1,
    padding: spacing.md,
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
  risk: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 13.5,
    lineHeight: 19,
    marginTop: 3,
  },
  categoryChip: {
    borderRadius: 8,
    borderCurve: 'continuous',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  categoryText: {
    // SPC's categorical fills are light, so dark text is what stays legible.
    color: '#141414',
    fontFamily: fonts.monoMedium,
    fontSize: 10.5,
    letterSpacing: 0.6,
  },
  hazardSentence: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 13.5,
    lineHeight: 19,
    marginTop: 10,
  },
  hazards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginTop: 12,
  },
  hazard: {
    minWidth: 68,
  },
  hazardLabel: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  hazardValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  hazardValue: {
    color: colors.text,
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
  },
  sigChip: {
    backgroundColor: colors.alertFill,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  sigText: {
    color: colors.alert,
    fontFamily: fonts.monoMedium,
    fontSize: 9,
    letterSpacing: 0.5,
  },
  sigNote: {
    color: colors.textTertiary,
    fontFamily: fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    marginTop: 10,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: hairline,
    borderTopColor: colors.divider,
  },
  source: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.8,
    flex: 1,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  linkText: {
    color: colors.accent,
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
  },
  disclaimer: {
    color: colors.textTertiary,
    fontFamily: fonts.body,
    fontSize: 11.5,
    lineHeight: 17,
    marginTop: 10,
  },
});
