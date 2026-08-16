import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { DarkSkyRadar, type RadarViewFrame } from '@/components/DarkSkyRadar';
import { colors, hairline, radii, shadows } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { fetchRadarFrames, radarTileUrl } from '@/lib/weather';

export function ForecastMap() {
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
    <View style={[styles.shadow, shadows.card]}>
      <View style={styles.card}>
        <DarkSkyRadar
          latitude={coords.latitude}
          longitude={coords.longitude}
          zoom={6}
          frames={frames}
          playing={false}
          scrollEnabled={false}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    marginBottom: 18,
    borderRadius: radii.card,
    borderCurve: 'continuous',
    backgroundColor: colors.bgElevated,
    borderWidth: hairline,
    borderColor: colors.divider,
  },
  card: {
    height: 228,
    borderRadius: radii.card,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
});
