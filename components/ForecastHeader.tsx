import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { colors, pressed, spacing } from '@/constants/theme';
import { useApp } from '@/context/AppContext';

type Props = {
  shareMessage: string;
};

function formatPlace(name: string, subtitle?: string): string {
  if (!subtitle) return name;
  const extra = subtitle
    .split(',')
    .map((part) => part.trim())
    .find((part) => part && part !== name && part.length <= 16);
  return extra ? `${name}, ${extra}` : name;
}

const styles = StyleSheet.create({
    wrap: {
      paddingHorizontal: spacing.md,
      paddingTop: 8,
      paddingBottom: 4,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    location: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    title: {
      flex: 1,
      color: colors.text,
      fontSize: 20,
      fontWeight: '500',
      letterSpacing: -0.4,
    },
    iconBtn: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dots: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
      marginTop: 8,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.textTertiary,
    },
    dotActive: {
      backgroundColor: colors.text,
    },
});

export function ForecastHeader({ shareMessage }: Props) {
  const router = useRouter();
  const { placeName, placeSubtitle, savedLocations, selectedId } = useApp();
  const title = formatPlace(placeName, placeSubtitle);
  const dots = ['current', ...savedLocations.map((item) => item.id)];

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Pressable
          style={({ pressed: isPressed }) => [styles.location, isPressed && pressed]}
          onPress={() => router.push('/locations')}>
          <Ionicons name="search" size={18} color={colors.text} />
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            void Share.share({ message: shareMessage });
          }}
          hitSlop={8}
          style={({ pressed: isPressed }) => [styles.iconBtn, isPressed && pressed]}>
          <Ionicons name="share-outline" size={22} color={colors.text} />
        </Pressable>
        <Pressable
          onPress={() => router.push('/(tabs)/settings')}
          hitSlop={8}
          style={({ pressed: isPressed }) => [styles.iconBtn, isPressed && pressed]}>
          <Ionicons name="settings-outline" size={22} color={colors.text} />
        </Pressable>
      </View>
      {dots.length > 1 ? (
        <View style={styles.dots}>
          {dots.map((id) => (
            <View key={id} style={[styles.dot, id === selectedId && styles.dotActive]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
