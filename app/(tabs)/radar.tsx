import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { DarkSkyRadar, type RadarViewFrame } from '@/components/DarkSkyRadar';
import { RadarTimeline } from '@/components/RadarTimeline';
import { colors, fonts, pressed } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { formatRadarTime } from '@/lib/format';
import { fetchRadarFrames, radarTileUrl } from '@/lib/weather';

const LEGEND = ['#5CE1FF', '#2F80ED', '#F5D76E', '#FF7EB6', '#E040FB'] as const;

const styles = StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    overlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'space-between',
      pointerEvents: 'box-none',
    },
    top: {
      paddingHorizontal: 20,
      paddingTop: 8,
    },
    title: {
      color: colors.text,
      fontFamily: fonts.display,
      fontSize: 22,
    },
    place: {
      color: colors.textSecondary,
      fontFamily: fonts.body,
      marginTop: 2,
      fontSize: 15,
      lineHeight: 20,
    },
    center: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    error: {
      color: colors.text,
      backgroundColor: colors.overlay,
      padding: 12,
      borderRadius: 10,
    },
    legend: {
      alignSelf: 'flex-start',
      alignItems: 'center',
      gap: 6,
      marginTop: 14,
      backgroundColor: 'rgba(10, 14, 24, 0.6)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.12)',
      paddingHorizontal: 10,
      paddingVertical: 12,
      borderRadius: 16,
    },
    legendLabel: {
      color: colors.textSecondary,
      fontFamily: fonts.mono,
      fontSize: 10,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    swatches: {
      alignItems: 'center',
      gap: 2,
    },
    swatch: {
      width: 10,
      height: 18,
      borderRadius: 2,
    },
    controls: {
      marginHorizontal: 16,
      backgroundColor: 'rgba(10, 14, 24, 0.72)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,255,255,0.12)',
      borderRadius: 18,
      padding: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    play: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.16)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    stampWrap: {
      minWidth: 72,
      alignItems: 'flex-end',
    },
    stamp: {
      color: colors.text,
      fontFamily: fonts.monoMedium,
      textAlign: 'right',
    },
    stampRelative: {
      color: colors.textTertiary,
      fontFamily: fonts.mono,
      fontSize: 11,
      marginTop: 1,
      textAlign: 'right',
    },
});

export default function RadarScreen() {
  const { coords, placeName } = useApp();
  const insets = useSafeAreaInsets();
  const [frames, setFrames] = useState<RadarViewFrame[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRadarFrames()
      .then((next) => {
        if (cancelled) return;
        setFrames(next.map((frame) => ({ time: frame.time, urlTemplate: radarTileUrl(frame) })));
        setIndex(Math.max(0, next.length - 3));
      })
      .catch(() => {
        if (!cancelled) setError('Radar is unavailable right now.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const frame = frames[index];
  const stamp = frame ? formatRadarTime(frame.time) : null;
  const latitude = coords?.latitude ?? 39.8;
  const longitude = coords?.longitude ?? -98.5;
  const zoom = coords ? 7 : 4;

  const seekTo = (next: number) => {
    setPlaying(false);
    setIndex(next);
  };

  return (
    <View style={styles.root}>
      <DarkSkyRadar
        latitude={latitude}
        longitude={longitude}
        zoom={zoom}
        frames={frames}
        playing={playing}
        index={index}
        onIndexChange={setIndex}
        scrollEnabled
        intervalMs={450}
      />
      <SafeAreaView style={styles.overlay} edges={['top']}>
        <View style={styles.top}>
          <Text style={styles.title}>Radar</Text>
          <Text style={styles.place}>{placeName}</Text>
          <View style={styles.legend} pointerEvents="none">
            <Text style={styles.legendLabel}>Heavy</Text>
            <View style={styles.swatches}>
              {[...LEGEND].reverse().map((color) => (
                <View key={color} style={[styles.swatch, { backgroundColor: color }]} />
              ))}
            </View>
            <Text style={styles.legendLabel}>Light</Text>
          </View>
        </View>
        {!frame && !error ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.text} />
          </View>
        ) : null}
        {error ? (
          <View style={styles.center}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}
        <View style={[styles.controls, { marginBottom: Math.max(insets.bottom, 8) + 76 }]}>
          <Pressable
            onPress={() => setPlaying((value) => !value)}
            style={({ pressed: isPressed }) => [styles.play, isPressed && pressed]}>
            <Ionicons name={playing ? 'pause' : 'play'} size={18} color={colors.text} />
          </Pressable>
          <RadarTimeline frames={frames} index={index} onSeek={seekTo} />
          <View style={styles.stampWrap}>
            <Text style={styles.stamp}>{stamp?.clock ?? '--:--'}</Text>
            {stamp ? <Text style={styles.stampRelative}>{stamp.relative}</Text> : null}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}
