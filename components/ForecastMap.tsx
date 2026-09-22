import { useRouter } from 'expo-router';
import React, { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { RadarMap } from '@/components/RadarMap';
import { colors, glass, pressed } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { Playhead } from '@/lib/radar/playhead';
import { useRadarManifest } from '@/lib/radar/useRadar';

export function ForecastMap() {
  const router = useRouter();
  const { coords } = useApp();
  const { manifest } = useRadarManifest();

  // A still, not an animation: show the newest real observation. The playhead
  // exists only to satisfy the map's contract and never moves.
  const playhead = useMemo(() => new Playhead(), []);
  const frames = useMemo(() => {
    const latest =
      manifest?.frames.findLast((frame) => frame.kind === 'observed') ??
      manifest?.frames.at(-1);
    return latest ? [latest] : [];
  }, [manifest]);

  useEffect(() => {
    playhead.setCount(frames.length);
  }, [frames.length, playhead]);

  if (!coords) return null;

  return (
    <Pressable
      onPress={() => router.push('/(tabs)/radar')}
      accessibilityRole="button"
      accessibilityLabel="Open radar"
      style={({ pressed: isPressed }) => [styles.card, isPressed && pressed]}>
      <View style={styles.map} pointerEvents="none">
        <RadarMap
          latitude={coords.latitude}
          longitude={coords.longitude}
          zoom={7}
          frames={frames}
          playhead={playhead}
          interactive={false}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    ...glass.card,
    marginTop: 12,
  },
  map: {
    height: 108,
    overflow: 'hidden',
    backgroundColor: colors.mapBg,
  },
});
