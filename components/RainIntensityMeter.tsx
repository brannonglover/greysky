import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, rainRamp } from '@/constants/theme';
import { bandIndex, RAIN_BANDS, type RainBand } from '@/lib/precip';

const RAMP: Record<RainBand, string> = {
  none: rainRamp.none,
  drizzle: rainRamp.drizzle,
  light: rainRamp.light,
  moderate: rainRamp.moderate,
  heavy: rainRamp.heavy,
  storm: rainRamp.storm,
};

type Props = {
  /** The heaviest band reached in the window. 'none' leaves the meter empty. */
  band: RainBand;
};

export function RainIntensityMeter({ band }: Props) {
  const active = band === 'none' ? -1 : bandIndex(band);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Heaviest rain: ${band === 'none' ? 'none' : RAIN_BANDS[active]?.label}`}>
      <View style={styles.row}>
        {RAIN_BANDS.map((entry, index) => (
          <View key={`caret-${entry.band}`} style={styles.cell}>
            {index === active ? <View style={styles.caret} /> : null}
          </View>
        ))}
      </View>

      <View style={[styles.row, styles.barRow]}>
        {RAIN_BANDS.map((entry, index) => (
          <View
            key={`bar-${entry.band}`}
            style={[
              styles.bar,
              { backgroundColor: index <= active ? RAMP[entry.band] : rainRamp.none },
            ]}
          />
        ))}
      </View>

      <View style={[styles.row, styles.labelRow]}>
        {RAIN_BANDS.map((entry, index) => (
          <Text
            key={`label-${entry.band}`}
            style={[styles.label, index === active && styles.labelActive]}
            numberOfLines={1}>
            {entry.label.toUpperCase()}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 4,
  },
  cell: {
    flex: 1,
    height: 8,
    alignItems: 'center',
  },
  caret: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: colors.text,
  },
  barRow: {
    marginTop: 4,
  },
  bar: {
    flex: 1,
    height: 14,
    borderRadius: 4,
    borderCurve: 'continuous',
  },
  labelRow: {
    marginTop: 9,
  },
  label: {
    flex: 1,
    textAlign: 'center',
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 0.4,
  },
  labelActive: {
    color: colors.text,
  },
});
