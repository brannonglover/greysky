import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useMemo, useRef } from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WeatherIcon } from '@/components/WeatherIcon';
import { colors, fonts, glass, pressed, radii, typeStyles, typography } from '@/constants/theme';
import { formatClock, formatDayHeading, formatHourCompact } from '@/lib/format';
import { daySummary, hoursOnDate, iconForLikelyWeather, labelForLikelyWeather } from '@/lib/nowcast';
import type { DayPoint, HourPoint, Units } from '@/lib/types';
import {
  cardinalFromDegrees,
  displayTemp,
  formatPrecip,
  formatPressure,
  formatTemp,
  formatVisibility,
  formatWind,
  hasPrecipAmount,
  uvLabel,
} from '@/lib/units';

type Props = {
  day: DayPoint | null;
  dayIndex: number;
  hours: HourPoint[];
  units: Units;
  onClose: () => void;
};

const HOUR_W = 58;
const SPRING = { damping: 24, stiffness: 240, mass: 0.86 };

function mean(values: number[]): number | undefined {
  if (!values.length) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      {detail ? <Text style={styles.statDetail}>{detail}</Text> : null}
    </View>
  );
}

export function DayDetailSheet({ day, dayIndex, hours, units, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const sheetH = Math.min(height * 0.88, 760);
  const visible = day != null;
  const translateY = useSharedValue(sheetH);
  const dim = useSharedValue(0);
  const closing = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const finishHide = () => {
    closing.current = false;
    onCloseRef.current();
  };

  const dismiss = () => {
    if (!visible || closing.current) return;
    closing.current = true;
    dim.value = withTiming(0, { duration: 180 });
    translateY.value = withTiming(sheetH, { duration: 240 }, (finished) => {
      if (finished) runOnJS(finishHide)();
    });
  };

  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  useEffect(() => {
    closing.current = false;
    if (!visible) {
      translateY.value = sheetH;
      dim.value = 0;
      return;
    }
    translateY.value = sheetH;
    translateY.value = withSpring(0, SPRING);
    dim.value = withTiming(1, { duration: 220 });
  }, [visible, sheetH, translateY, dim]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy > 0) translateY.value = gesture.dy;
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 110 || gesture.vy > 1.15) {
          dismissRef.current();
          return;
        }
        translateY.value = withSpring(0, SPRING);
      },
    }),
  ).current;

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: dim.value,
  }));

  const dayHours = useMemo(() => (day ? hoursOnDate(hours, day.date) : []), [day, hours]);
  const heading = day ? formatDayHeading(day.date, dayIndex) : { title: '', subtitle: '' };
  const summary = day ? daySummary(dayHours, day) : '';
  const humidity = mean(dayHours.map((hour) => hour.humidity));
  const dewPoint = mean(dayHours.map((hour) => hour.dewPoint));
  const pressure = mean(dayHours.map((hour) => hour.pressure));
  const clouds = mean(dayHours.map((hour) => hour.cloudCover));
  const visibility = dayHours.length ? Math.min(...dayHours.map((hour) => hour.visibility)) : undefined;

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={dismiss}>
      <View style={styles.root} pointerEvents={visible ? 'auto' : 'none'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss}>
          <Animated.View style={[styles.backdrop, backdropStyle]} />
        </Pressable>
        <Animated.View style={[styles.sheet, { height: sheetH, paddingBottom: Math.max(insets.bottom, 16) }, sheetStyle]}>
          <View {...pan.panHandlers} style={styles.grab}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View style={styles.heading}>
                <Text style={styles.title}>{heading.title}</Text>
                <Text style={styles.subtitle}>{heading.subtitle}</Text>
              </View>
              <Pressable
                onPress={dismiss}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close day forecast"
                style={({ pressed: isPressed }) => [styles.close, isPressed && pressed]}>
                <Ionicons name="close" size={18} color={colors.text} />
              </Pressable>
            </View>
          </View>
          {day ? (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
              bounces>
              <View style={styles.hero}>
                <WeatherIcon
                  name={iconForLikelyWeather(day.weatherCode, true, day.precipitationProbabilityMax, day.precipitationSum)}
                  size={42}
                />
                <View style={styles.heroCopy}>
                  <Text style={styles.condition}>
                    {labelForLikelyWeather(day.weatherCode, day.precipitationProbabilityMax, day.precipitationSum)}
                  </Text>
                  <Text style={styles.hilo}>
                    {formatTemp(day.temperatureMax, units)} / {formatTemp(day.temperatureMin, units)}
                  </Text>
                  <Text style={styles.feels}>
                    Feels {formatTemp(day.apparentMax, units)} / {formatTemp(day.apparentMin, units)}
                  </Text>
                </View>
              </View>
              <Text style={styles.summary}>{summary}</Text>
              {dayHours.length > 0 ? (
                <View style={styles.hoursCard}>
                  <Text style={styles.sectionLabel}>{dayIndex === 0 ? 'Rest of day' : 'Hourly'}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.hours}>
                      {dayHours.map((hour, index) => (
                        <View key={hour.time} style={styles.hour}>
                          <Text style={styles.hourTime}>
                            {dayIndex === 0 && index === 0 ? 'Now' : formatHourCompact(hour.time)}
                          </Text>
                          <WeatherIcon
                            name={iconForLikelyWeather(
                              hour.weatherCode,
                              hour.isDay,
                              hour.precipitationProbability,
                              hour.precipitation,
                              hour.cloudCover,
                            )}
                            size={26}
                          />
                          <Text style={styles.hourTemp}>{Math.round(displayTemp(hour.temperature, units))}°</Text>
                          <Text style={styles.hourPrecip}>
                            {hour.precipitationProbability > 0 ? `${Math.round(hour.precipitationProbability)}%` : ''}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              ) : null}
              <View style={styles.grid}>
                <Stat
                  label="Precipitation"
                  value={formatPrecip(day.precipitationSum, units)}
                  detail={
                    day.precipitationProbabilityMax > 0
                      ? `${Math.round(day.precipitationProbabilityMax)}% chance${
                          day.precipitationHours > 0 ? ` · ${Math.round(day.precipitationHours)} hrs` : ''
                        }`
                      : hasPrecipAmount(day.precipitationSum)
                        ? `${Math.round(day.precipitationHours)} hrs`
                        : 'None expected'
                  }
                />
                <Stat
                  label="Wind"
                  value={formatWind(day.windSpeedMax, units)}
                  detail={`${cardinalFromDegrees(day.windDirection)} · Gusts ${formatWind(day.windGustsMax, units)}`}
                />
                <Stat label="UV index" value={`${Math.round(day.uvIndexMax)}`} detail={uvLabel(day.uvIndexMax)} />
                <Stat
                  label="Sun"
                  value={day.sunrise ? formatClock(day.sunrise) : '—'}
                  detail={day.sunset ? `Sunset ${formatClock(day.sunset)}` : undefined}
                />
                {humidity != null ? <Stat label="Humidity" value={`${Math.round(humidity)}%`} /> : null}
                {dewPoint != null ? <Stat label="Dew point" value={formatTemp(dewPoint, units)} /> : null}
                {clouds != null ? <Stat label="Cloud cover" value={`${Math.round(clouds)}%`} /> : null}
                {visibility != null ? (
                  <Stat label="Visibility" value={formatVisibility(visibility, units)} />
                ) : null}
                {pressure != null ? <Stat label="Pressure" value={formatPressure(pressure, units)} /> : null}
                {day.snowfallSum > 0.2 ? (
                  <Stat label="Snow" value={formatPrecip(day.snowfallSum, units)} />
                ) : null}
              </View>
            </ScrollView>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: '#10182A',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  grab: {
    paddingTop: 10,
    paddingHorizontal: 18,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingBottom: 8,
  },
  heading: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 28,
    letterSpacing: -0.6,
  },
  subtitle: {
    color: colors.textTertiary,
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    marginTop: 2,
  },
  close: {
    ...glass.pill,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 18,
    paddingBottom: 12,
    gap: 16,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  heroCopy: {
    flex: 1,
    gap: 2,
  },
  condition: {
    color: colors.text,
    fontFamily: fonts.bodySemi,
    fontSize: 18,
  },
  hilo: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 22,
    fontVariant: typography.tabular,
  },
  feels: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 14,
  },
  summary: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 22,
  },
  hoursCard: {
    ...glass.card,
    paddingTop: 12,
    paddingBottom: 8,
  },
  sectionLabel: {
    ...typeStyles.panelLabel,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  hours: {
    flexDirection: 'row',
    paddingHorizontal: 6,
  },
  hour: {
    width: HOUR_W,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  hourTime: {
    color: 'rgba(255,255,255,0.7)',
    fontFamily: fonts.monoMedium,
    fontSize: 12,
  },
  hourTemp: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 16,
    fontVariant: typography.tabular,
  },
  hourPrecip: {
    color: colors.precip,
    fontFamily: fonts.monoMedium,
    fontSize: 11,
    minHeight: 14,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  stat: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: radii.control,
    borderCurve: 'continuous',
    padding: 14,
    minHeight: 88,
  },
  statLabel: {
    ...typeStyles.panelLabel,
    marginBottom: 8,
  },
  statValue: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 22,
    letterSpacing: -0.3,
  },
  statDetail: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 13,
    marginTop: 4,
  },
});
