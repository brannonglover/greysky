import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { DarkSkyRadar, type RadarViewFrame } from '@/components/DarkSkyRadar';
import { colors, glass, pressed } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { fetchRadarFrames, radarTileUrl } from '@/lib/weather';

export function ForecastMap() {
  const router = useRouter();
  const { coords } = useApp();
  const [frames, setFrames] = useState<RadarViewFrame[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchRadarFrames()
      .then((next) => {
        if (cancelled) return;
        const mapped = next.map((frame) => ({ time: frame.time, urlTemplate: radarTileUrl(frame) }));
        const nowSec = Date.now() / 1000;
        const current =
          [...mapped].reverse().find((frame) => frame.time <= nowSec + 90) ?? mapped.at(-1);
        setFrames(current ? [current] : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
