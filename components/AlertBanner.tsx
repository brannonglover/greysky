import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, pressed, radii } from '@/constants/theme';
import type { WeatherAlert } from '@/lib/types';

type Props = {
  alerts: WeatherAlert[];
};

const styles = StyleSheet.create({
  wrap: {
    marginTop: 12,
    marginBottom: 2,
    alignItems: 'center',
  },
  pill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.alertFill,
    borderWidth: 1,
    borderColor: 'rgba(255, 193, 105, 0.6)',
    borderRadius: radii.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  label: {
    color: colors.alert,
    fontFamily: fonts.bodySemi,
    fontSize: 13.5,
    maxWidth: 280,
  },
  body: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
    paddingHorizontal: 4,
    textAlign: 'center',
  },
});

export function AlertBanner({ alerts }: Props) {
  const [open, setOpen] = useState(false);
  if (!alerts.length) return null;
  const extra = alerts.length - 1;
  const label = extra > 0 ? `${alerts[0].event}  |  +${extra}` : alerts[0].event;

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        style={({ pressed: isPressed }) => [styles.pill, isPressed && pressed]}>
        <Ionicons name="warning-outline" size={15} color={colors.alert} />
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
      {open ? (
        <Text style={styles.body}>
          {alerts
            .map((alert) => alert.headline)
            .join('\n\n')}
        </Text>
      ) : null}
    </View>
  );
}
