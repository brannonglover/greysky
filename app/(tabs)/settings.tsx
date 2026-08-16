import * as Haptics from 'expo-haptics';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, hairline, pressed, radii, spacing } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { ensureNotificationSetup } from '@/lib/notifications';
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
    body: 'Official watches and warnings from the National Weather Service.',
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

  async function toggle(key: keyof AlertPrefs, value: boolean) {
    void Haptics.selectionAsync();
    if (value) await ensureNotificationSetup();
    await updateSettings((prev) => ({
      ...prev,
      alerts: { ...prev.alerts, [key]: value },
    }));
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Notifications</Text>
        <Text style={styles.lede}>
          Next-hour rain, severe weather, and morning reminders — scheduled from the hyperlocal forecast.
        </Text>

        <Text style={styles.section}>Notifications</Text>
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
                thumbColor={colors.onAccent}
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
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.md,
    paddingBottom: 48,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '600',
    letterSpacing: -0.7,
  },
  lede: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.15,
    marginTop: 8,
    marginBottom: 12,
  },
  section: {
    color: colors.textTertiary,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
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
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  rowBody: {
    color: colors.textSecondary,
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
    fontWeight: '600',
  },
  segTextActive: {
    color: colors.onAccent,
  },
  hint: {
    color: colors.textTertiary,
    fontSize: 13,
    marginTop: 10,
  },
});
