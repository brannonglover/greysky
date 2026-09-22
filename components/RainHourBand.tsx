import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, rainRamp, typography } from '@/constants/theme';
import { formatHourCompact } from '@/lib/format';
import type { RainBand } from '@/lib/precip';
import type { RainHour } from '@/lib/rainOutlook';

const RAMP: Record<RainBand, string> = {
  none: rainRamp.none,
  drizzle: rainRamp.drizzle,
  light: rainRamp.light,
  moderate: rainRamp.moderate,
  heavy: rainRamp.heavy,
  storm: rainRamp.storm,
};

const CHART_HEIGHT = 110;
/** Guide lines, mm/hr. Only the ones inside the current scale are drawn. */
const GUIDES: { label: string; mmHr: number }[] = [
  { label: 'LIGHT', mmHr: 0.6 },
  { label: 'MODERATE', mmHr: 2.5 },
  { label: 'HEAVY', mmHr: 7.5 },
];

type Props = {
  hours: RainHour[];
  /** Highlights this hour's label. */
  peakTime?: string;
};

export function RainHourBand({ hours, peakTime }: Props) {
  const peakRate = hours.reduce((max, hour) => Math.max(max, hour.mmHr), 0);
  // Adaptive scale: a drizzle day shouldn't be squashed against a heavy-rain axis.
  const scaleMax = Math.max(peakRate * 1.2, 1.2);
  const guides = GUIDES.filter((guide) => guide.mmHr < scaleMax);

  return (
    <View>
      <View style={styles.plot}>
        {guides.map((guide) => (
          <View
            key={guide.label}
            style={[styles.guide, { bottom: (guide.mmHr / scaleMax) * CHART_HEIGHT }]}>
            <View style={styles.guideLine} />
            <Text style={styles.guideLabel}>{guide.label}</Text>
          </View>
        ))}

        <View style={styles.bars}>
          {hours.map((hour) => {
            const height = Math.max(2, Math.round((hour.mmHr / scaleMax) * CHART_HEIGHT));
            return (
              <View key={hour.time} style={styles.barSlot}>
                <View
                  style={[
                    styles.bar,
                    {
                      height,
                      backgroundColor: RAMP[hour.band],
                      borderRadius: height < 10 ? height / 2 : 8,
                    },
                  ]}
                />
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.labels}>
        {hours.map((hour) => (
          <Text
            key={`label-${hour.time}`}
            style={[styles.hour, hour.time === peakTime && styles.hourPeak]}>
            {formatHourCompact(hour.time)}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plot: {
    height: CHART_HEIGHT,
    justifyContent: 'flex-end',
  },
  guide: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  guideLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(238, 242, 248, 0.22)',
  },
  guideLabel: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1.2,
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: CHART_HEIGHT,
  },
  barSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  bar: {
    width: 26,
    borderCurve: 'continuous',
  },
  labels: {
    flexDirection: 'row',
    marginTop: 10,
  },
  hour: {
    flex: 1,
    textAlign: 'center',
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 10,
    fontVariant: typography.tabular,
  },
  hourPeak: {
    color: colors.text,
  },
});
