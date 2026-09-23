import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useMemo } from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlertDetailCard } from '@/components/AlertDetailCard';
import { RegionalAlertCard } from '@/components/RegionalAlertCard';
import { SkyBackdrop } from '@/components/SkyBackdrop';
import { SpcOutlookCard } from '@/components/SpcOutlookCard';
import { StormOutlookCard } from '@/components/StormOutlookCard';
import { TropicalStormCard } from '@/components/TropicalStormCard';
import { colors, fonts, glass, spacing, typeStyles } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { rankStormItems, type StormItem } from '@/lib/stormImpact';
import { forecastStormSignals } from '@/lib/stormOutlook';

/**
 * "What weather could affect me, and when?"
 *
 * Ordering is by expected local impact rather than by data source — see
 * lib/stormImpact.ts. The three tiers are active official alerts, incoming
 * threats, and systems being tracked with no forecast local effect.
 */

export default function StormsScreen() {
  const {
    weather,
    placeName,
    settings,
    coords,
    tropical,
    tropicalLoading,
    outlooks,
    regional,
    refreshing,
    refresh,
    refreshTropical,
    refreshAwareness,
  } = useApp();

  const onRefresh = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void refresh(true);
    void refreshTropical();
    void refreshAwareness();
  }, [refresh, refreshTropical, refreshAwareness]);

  const items = useMemo(() => {
    if (!weather) return [];
    return rankStormItems({
      alerts: weather.alerts,
      signals: forecastStormSignals(weather),
      tropical,
      outlooks,
      regional,
    });
  }, [weather, tropical, outlooks, regional]);

  const active = items.filter((item) => item.tier === 'active');
  const incoming = items.filter((item) => item.tier === 'incoming');
  const tracking = items.filter((item) => item.tier === 'tracking' && item.source !== 'regional');
  const regionalItems = items.filter((item) => item.source === 'regional');
  // Regional alerts are explicitly not about this location, so they must not
  // suppress the all-clear — "nothing here, but note what is happening nearby"
  // is the honest reading.
  const quiet = active.length === 0 && incoming.length === 0 && tracking.length === 0;

  const render = (item: StormItem, muted = false) => {
    switch (item.source) {
      case 'nws':
        return <AlertDetailCard key={item.key} alert={item.alert} />;
      case 'regional':
        return <RegionalAlertCard key={item.key} entry={{
          alert: item.alert,
          state: item.state,
          distanceKm: item.distanceKm,
        }} units={settings.units} />;
      case 'spc':
        return <SpcOutlookCard key={item.key} outlook={item.outlook} />;
      case 'forecast':
        return <StormOutlookCard key={item.key} signal={item.signal} units={settings.units} />;
      case 'tropical':
        return (
          <TropicalStormCard
            key={item.key}
            report={item.report}
            latitude={coords?.latitude ?? item.report.storm.latitude}
            longitude={coords?.longitude ?? item.report.storm.longitude}
            units={settings.units}
            muted={muted}
          />
        );
    }
  };

  return (
    <SkyBackdrop>
      <SafeAreaView style={styles.safe} edges={['top']} collapsable={false}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl tintColor={colors.text} refreshing={refreshing} onRefresh={onRefresh} />
          }>
          <Text style={styles.title}>Storms</Text>
          <Text style={styles.lede}>
            What could affect {placeName}, most urgent first.
          </Text>

          {quiet ? (
            <View style={styles.empty}>
              <Ionicons name="checkmark-circle-outline" size={34} color={colors.precip} />
              <Text style={styles.emptyTitle}>Nothing active for {placeName}</Text>
              <Text style={styles.emptyBody}>
                No official alerts, no severe-weather outlook, no strong storms in the forecast,
                and no tropical system expected to reach you.
              </Text>
            </View>
          ) : null}

          {active.length > 0 ? (
            <>
              <Text style={styles.section}>Active alerts</Text>
              {active.map((item) => render(item))}
            </>
          ) : null}

          {incoming.length > 0 ? (
            <>
              <Text style={styles.section}>Coming your way</Text>
              {incoming.map((item) => render(item))}
            </>
          ) : null}

          {tracking.length > 0 ? (
            <>
              <Text style={styles.section}>Tracking elsewhere</Text>
              <Text style={styles.sectionNote}>
                Active systems with no forecast impact at your location.
              </Text>
              {tracking.map((item) => render(item, true))}
            </>
          ) : null}

          {regionalItems.length > 0 ? (
            <>
              <Text style={styles.section}>Regional awareness</Text>
              <Text style={styles.sectionNote}>
                Official alerts elsewhere in the region. None of these affect your location.
              </Text>
              {regionalItems.map((item) => render(item))}
            </>
          ) : null}

          {Platform.OS === 'web' && tropical.length === 0 && !tropicalLoading ? (
            <Text style={styles.note}>Tropical data is unavailable in this browser session.</Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </SkyBackdrop>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: spacing.md,
    paddingBottom: 108,
  },
  title: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 32,
    letterSpacing: -0.7,
  },
  lede: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 22,
    marginTop: 8,
    marginBottom: 4,
  },
  section: {
    ...typeStyles.panelLabel,
    marginTop: 24,
    marginBottom: 10,
  },
  sectionNote: {
    color: colors.textTertiary,
    fontFamily: fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: -4,
    marginBottom: 10,
  },
  empty: {
    ...glass.card,
    alignItems: 'center',
    gap: 10,
    padding: spacing.lg,
    marginTop: 20,
  },
  emptyTitle: {
    color: colors.text,
    fontFamily: fonts.bodySemi,
    fontSize: 17,
    textAlign: 'center',
  },
  emptyBody: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: 'center',
  },
  note: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 11,
    marginTop: 20,
  },
});
