import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RainHourBand } from '@/components/RainHourBand';
import { RainIntensityMeter } from '@/components/RainIntensityMeter';
import { colors, fonts, glass, hairline, spacing, typography } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { formatHour } from '@/lib/format';
import { bandLabel } from '@/lib/precip';
import {
  formatRate,
  rainOutlook,
  rainVerdict,
  rateUnitLabel,
  splitPrecip,
} from '@/lib/rainOutlook';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export default function RainScreen() {
  const { weather, settings, placeName } = useApp();
  const outlook = useMemo(
    () => (weather ? rainOutlook(weather.hourly, weather.timezone) : null),
    [weather],
  );

  if (!weather || outlook == null || outlook.hours.length === 0) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Rain forecast unavailable.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const total = splitPrecip(outlook.totalMm, settings.units);
  const verdict = rainVerdict(outlook);
  const peakRate = outlook.peak != null ? formatRate(outlook.peak.mmHr, settings.units) : null;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.place}>{placeName}</Text>
        <Text style={styles.verdict}>{verdict}</Text>

        <View style={styles.totalRow}>
          <Text style={styles.totalValue}>{total.value}</Text>
          <Text style={styles.totalUnit}>{total.unit}</Text>
          <Text style={styles.totalCaption}>expected total</Text>
        </View>

        <View style={styles.meterBlock}>
          <View style={styles.blockHead}>
            <Text style={styles.blockLabel}>HOW HEAVY IT GETS</Text>
            {peakRate != null ? <Text style={styles.blockValue}>PEAK {peakRate}</Text> : null}
          </View>
          <View style={styles.meter}>
            <RainIntensityMeter band={outlook.peakBand} />
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.blockHead}>
            <Text style={styles.blockLabel}>{rateUnitLabel(settings.units)}</Text>
            <Text style={styles.blockMuted}>
              NEXT {outlook.hours.length} HOURS
            </Text>
          </View>
          <View style={styles.chart}>
            <RainHourBand hours={outlook.hours} peakTime={outlook.peak?.time} />
          </View>
        </View>

        <View style={styles.rows}>
          <Row
            label="STARTS"
            value={outlook.starts != null ? formatHour(outlook.starts.time) : 'Not expected'}
          />
          <Row
            label="HEAVIEST"
            value={
              outlook.peak != null
                ? `${formatHour(outlook.peak.time)} · ${bandLabel(outlook.peakBand).toLowerCase()}`
                : '—'
            }
          />
          <Row
            label="CLEARS"
            value={
              outlook.clears != null
                ? formatHour(outlook.clears.time)
                : outlook.wet
                  ? 'Still raining'
                  : '—'
            }
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.md,
    paddingBottom: 48,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 16,
  },
  place: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  verdict: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 26,
    lineHeight: 33,
    letterSpacing: -0.5,
    marginTop: 10,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    marginTop: 18,
  },
  totalValue: {
    color: colors.text,
    fontFamily: fonts.monoMedium,
    fontSize: 58,
    letterSpacing: -2,
    lineHeight: 64,
    fontVariant: typography.tabular,
  },
  totalUnit: {
    color: colors.precip,
    fontFamily: fonts.mono,
    fontSize: 15,
    letterSpacing: 1.4,
  },
  totalCaption: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 14,
  },
  meterBlock: {
    marginTop: 26,
  },
  meter: {
    marginTop: 12,
  },
  blockHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  blockLabel: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2,
  },
  blockValue: {
    color: colors.precip,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  blockMuted: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  card: {
    ...glass.card,
    marginTop: 24,
    padding: spacing.md,
  },
  chart: {
    marginTop: 14,
  },
  rows: {
    marginTop: 22,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: hairline,
    borderBottomColor: colors.divider,
  },
  rowLabel: {
    color: colors.textSecondary,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.6,
  },
  rowValue: {
    color: colors.text,
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
  },
});
