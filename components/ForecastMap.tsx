import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { DarkSkyRadar } from '@/components/DarkSkyRadar';
import { colors, glass, pressed } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { useOnAppResume } from '@/lib/useOnAppResume';
import { fetchRadarManifest, type RadarFrame } from '@/lib/weather';

export function ForecastMap() {
  const router = useRouter();
  const { coords } = useApp();
  const [frames, setFrames] = useState<RadarFrame[]>([]);

  const load = useCallback(() => {
    fetchRadarManifest()
      .then((manifest) => {
        // The preview is a still, so show the most recent actual observation.
        const current =
          [...manifest.frames].reverse().find((frame) => frame.kind === 'observed') ??
          manifest.frames.at(-1);
        setFrames(current ? [current] : []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    // Slower than the radar tab; this is a thumbnail, not an animation.
    const timer = setInterval(load, 5 * 60_000);
    return () => clearInterval(timer);
  }, [load]);

  useOnAppResume(load);

  if (!coords) return null;

  return (
    <Pressable
      onPress={() => router.push('/(tabs)/radar')}
      style={({ pressed: isPressed }) => [styles.card, isPressed && pressed]}>
      <View style={styles.map} pointerEvents="none">
        <DarkSkyRadar
          latitude={coords.latitude}
          longitude={coords.longitude}
          zoom={7}
          frames={frames}
          playing={false}
          scrollEnabled={false}
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
