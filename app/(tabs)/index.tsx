import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { PermissionStatus } from 'expo-location';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AlertBanner } from '@/components/AlertBanner';
import { CurrentHero } from '@/components/CurrentHero';
import { DailyForecast } from '@/components/DailyForecast';
import { ForecastHeader } from '@/components/ForecastHeader';
import { ForecastMap } from '@/components/ForecastMap';
import { HourlyTimeline } from '@/components/HourlyTimeline';
import { PrecipitationChart } from '@/components/PrecipitationChart';
import { RainField } from '@/components/RainField';
import { SkyBackdrop } from '@/components/SkyBackdrop';
import { colors, pressed, radii, spacing } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { formatSunsetIn } from '@/lib/format';
import type { HourlyMetric } from '@/lib/types';
import { formatPrecip, formatTemp } from '@/lib/units';

const styles = StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    screen: {
      flex: 1,
    },
    content: {
      paddingBottom: 108,
    },
    padded: {
      paddingHorizontal: spacing.md,
    },
    dailyBlock: {
      marginTop: 28,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
      padding: spacing.xl,
    },
    muted: {
      color: colors.textSecondary,
      letterSpacing: -0.15,
    },
    permission: {
      flex: 1,
      justifyContent: 'center',
      padding: spacing.xl,
      gap: 12,
    },
    permissionTitle: {
      color: colors.text,
      fontSize: 28,
      fontWeight: '600',
      letterSpacing: -0.6,
    },
    permissionBody: {
      color: colors.textSecondary,
      fontSize: 16,
      lineHeight: 22,
      letterSpacing: -0.15,
      marginBottom: 8,
    },
    primary: {
      backgroundColor: colors.accent,
      borderRadius: radii.control,
      borderCurve: 'continuous',
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 8,
    },
    primaryText: {
      color: colors.onAccent,
      fontSize: 16,
      fontWeight: '600',
    },
    link: {
      color: colors.accent,
      fontSize: 16,
      textAlign: 'center',
      marginTop: 16,
    },
});

export default function ForecastScreen() {
  const router = useRouter();
  const {
    weather,
    placeName,
    selectedId,
    loading,
    refreshing,
    error,
    permission,
    settings,
    sky,
    refresh,
    requestPermission,
  } = useApp();
  const [metric, setMetric] = useState<HourlyMetric>('temp');

  const onRefresh = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void refresh(true);
  }, [refresh]);

  if (permission !== PermissionStatus.GRANTED && selectedId === 'current' && !weather) {
    return (
      <SkyBackdrop>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.permission}>
            <Ionicons name="location-outline" size={42} color={colors.accent} />
            <Text style={styles.permissionTitle}>Hyperlocal weather needs your location</Text>
            <Text style={styles.permissionBody}>
              Grey Sky uses GPS and radar nowcast — the same kind of hyperlocal data Dark Sky was built on.
            </Text>
            <Pressable
              style={({ pressed: isPressed }) => [styles.primary, isPressed && pressed]}
              onPress={requestPermission}>
              <Text style={styles.primaryText}>Enable location</Text>
            </Pressable>
            <Pressable
              style={({ pressed: isPressed }) => isPressed && pressed}
              onPress={() => router.push('/locations')}>
              <Text style={styles.link}>Search for a city instead</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </SkyBackdrop>
    );
  }

  if (loading && !weather) {
    return (
      <SkyBackdrop>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.centered}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.muted}>Reading the sky…</Text>
          </View>
        </SafeAreaView>
      </SkyBackdrop>
    );
  }

  if (!weather) {
    return (
      <SkyBackdrop>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.permission}>
            <Text style={styles.permissionTitle}>{error ?? 'Weather unavailable'}</Text>
            <Text style={styles.permissionBody}>
              You can retry GPS, or search for a city to load a hyperlocal forecast.
            </Text>
            <Pressable
              style={({ pressed: isPressed }) => [styles.primary, isPressed && pressed]}
              onPress={() => refresh(true)}>
              <Text style={styles.primaryText}>Try again</Text>
            </Pressable>
            <Pressable
              style={({ pressed: isPressed }) => isPressed && pressed}
              onPress={() => router.push('/locations')}>
              <Text style={styles.link}>Search for a city</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </SkyBackdrop>
    );
  }

  const today = weather.daily[0];
  const shareMessage = `${placeName}: ${formatTemp(weather.current.temperature, settings.units)} · ${weather.nowcastSummary}`;

  return (
    <SkyBackdrop>
      <View style={styles.screen} collapsable={false}>
        <RainField intensity={sky.rain} />
        <SafeAreaView style={styles.safe} edges={['top']} collapsable={false}>
          <ForecastHeader shareMessage={shareMessage} />
          <ScrollView
            contentContainerStyle={styles.content}
            refreshControl={
              <RefreshControl tintColor={colors.text} refreshing={refreshing} onRefresh={onRefresh} />
            }>
            <View style={styles.padded}>
              <CurrentHero current={weather.current} units={settings.units} />
              <AlertBanner alerts={weather.alerts} />
            </View>
            <ForecastMap />
            <View style={styles.padded}>
              <PrecipitationChart minutes={weather.minutely} summary={weather.nowcastSummary} />
              <HourlyTimeline hours={weather.hourly} units={settings.units} />
              <View style={styles.dailyBlock}>
                <DailyForecast
                  days={weather.daily}
                  units={settings.units}
                  metric={metric}
                  onMetricChange={setMetric}
                  rainLabel={`Rain: ${formatPrecip(today?.precipitationSum ?? 0, settings.units)}`}
                  sunsetLabel={today ? formatSunsetIn(today.sunset, weather.timezone) : ''}
                />
              </View>
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </SkyBackdrop>
  );
}
