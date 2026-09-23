import * as Haptics from 'expo-haptics';
import React, { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fonts, hairline, pressed, radii, spacing, typeStyles } from '@/constants/theme';
import { SkyBackdrop } from '@/components/SkyBackdrop';
import { useApp } from '@/context/AppContext';
import { alertsEnabled, ensureNotificationSetup } from '@/lib/notifications';
import type { AlertPrefs } from '@/lib/types';

const ALERTS: { key: keyof AlertPrefs; title: string; body: string }[] = [
  {
    key: 'nextHourPrecip',
    title: 'Next-hour precipitation',
    body: 'Alert when rain or snow is about to start at your location.',
  },
  {
    key: 'severeWeather',
    title: 'Severe weather',
    body: 'Official watches and warnings, issued by the National Weather Service.',
  },
  {
    key: 'severeOutlook',
    title: 'Severe weather outlooks',
    body: "Days ahead, when NOAA's Storm Prediction Center places your area in a severe-weather risk.",
  },
  {
    key: 'strongStorm',
    title: 'Strong storms',
    body: "Grey Sky's own read of the forecast — storms, damaging gusts, or heavy rain, before any official alert exists.",
  },
  {
    key: 'tropical',
    title: 'Tropical systems',
    body: 'When a hurricane or tropical storm is forecast to bring damaging winds to your location.',
  },
  {
    key: 'umbrella',
    title: 'Umbrella reminder',
    body: 'Morning ping if rain is likely later in the day.',
  },
  {
    key: 'sunscreen',
    title: 'Sunscreen reminder',
    body: 'Morning ping when the UV index is high.',
  },
  {
    key: 'dailySummary',
    title: 'Daily summary',
    body: 'A short forecast and high/low around 7:00 AM.',
  },
];

export default function SettingsScreen() {
  const { settings, updateSettings } = useApp();

  useEffect(() => {
    if (alertsEnabled(settings.alerts)) {
      void ensureNotificationSetup();
    }
  }, [settings.alerts]);

  async function toggle(key: keyof AlertPrefs, value: boolean) {
    void Haptics.selectionAsync();
    if (value) await ensureNotificationSetup();
    await updateSettings((prev) => ({
      ...prev,
      alerts: { ...prev.alerts, [key]: value },
    }));
  }

  return (
    <SkyBackdrop>
      <SafeAreaView style={styles.safe} edges={['top']} collapsable={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Notifications</Text>
        <Text style={styles.lede}>
          Next-hour rain, severe weather, and morning reminders — scheduled from the hyperlocal forecast.
        </Text>

        <Text style={styles.section}>Alerts</Text>
        <View style={styles.card}>
          {ALERTS.map((item, index) => (
            <View key={item.key} style={[styles.row, index < ALERTS.length - 1 && styles.border]}>
              <View style={styles.copy}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                <Text style={styles.rowBody}>{item.body}</Text>
              </View>
              <Switch
                value={settings.alerts[item.key]}
                onValueChange={(value) => toggle(item.key, value)}
                trackColor={{ false: colors.surface2, true: colors.precip }}
                thumbColor={colors.text}
              />
            </View>
          ))}
        </View>

        <Text style={styles.section}>Units</Text>
        <View style={styles.segment}>
          <Pressable
            onPress={() => updateSettings({ units: 'us' })}
            style={({ pressed: isPressed }) => [
              styles.segBtn,
              settings.units === 'us' && styles.segActive,
              isPressed && pressed,
            ]}>
            <Text style={[styles.segText, settings.units === 'us' && styles.segTextActive]}>US</Text>
          </Pressable>
          <Pressable
            onPress={() => updateSettings({ units: 'si' })}
            style={({ pressed: isPressed }) => [
              styles.segBtn,
              settings.units === 'si' && styles.segActive,
              isPressed && pressed,
            ]}>
            <Text style={[styles.segText, settings.units === 'si' && styles.segTextActive]}>Metric</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>
          US uses °F, mph, and inches. Metric uses °C, km/h, and millimeters.
        </Text>
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
    marginBottom: 12,
  },
  section: {
    ...typeStyles.panelLabel,
    marginTop: 24,
    marginBottom: 10,
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.card,
    borderCurve: 'continuous',
    borderWidth: hairline,
    borderColor: colors.divider,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: spacing.md,
  },
  border: {
    borderBottomWidth: hairline,
    borderBottomColor: colors.divider,
  },
  copy: {
    flex: 1,
  },
  rowTitle: {
    color: colors.text,
    fontFamily: fonts.bodySemi,
    fontSize: 16,
  },
  rowBody: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.bgElevated,
    borderRadius: radii.control,
    borderCurve: 'continuous',
    borderWidth: hairline,
    borderColor: colors.divider,
    padding: 4,
  },
  segBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
    borderCurve: 'continuous',
  },
  segActive: {
    backgroundColor: colors.accent,
  },
  segText: {
    color: colors.textSecondary,
    fontFamily: fonts.bodySemi,
  },
  segTextActive: {
    color: colors.onAccent,
  },
  hint: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 12,
    marginTop: 10,
  },
});
