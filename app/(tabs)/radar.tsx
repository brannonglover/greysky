import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DarkSkyRadar, type RadarViewFrame } from '@/components/DarkSkyRadar';
import { RadarTimeline } from '@/components/RadarTimeline';
import { colors, pressed } from '@/constants/theme';
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
      fontSize: 28,
      fontWeight: '600',
      letterSpacing: -0.6,
    },
    place: {
      color: colors.textSecondary,
      marginTop: 2,
      fontSize: 16,
      lineHeight: 22,
      letterSpacing: -0.15,
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
      backgroundColor: colors.overlay,
      paddingHorizontal: 8,
      paddingVertical: 12,
      borderRadius: 20,
    },
    legendLabel: {
      color: colors.text,
      fontSize: 11,
      fontWeight: '600',
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
      margin: 16,
      marginBottom: 8,
      backgroundColor: 'rgba(44,44,46,0.92)',
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
      backgroundColor: '#F5F5F7',
      alignItems: 'center',
      justifyContent: 'center',
    },
    stampWrap: {
      minWidth: 72,
      alignItems: 'flex-end',
    },
    stamp: {
      color: '#FFFFFF',
      textAlign: 'right',
      fontWeight: '600',
    },
    stampRelative: {
      color: 'rgba(255,255,255,0.64)',
      fontSize: 11,
      fontWeight: '500',
      marginTop: 1,
      textAlign: 'right',
    },
});

export default function RadarScreen() {
  const { coords, placeName } = useApp();
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
      <SafeAreaView style={styles.overlay}>
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
        <View style={styles.controls}>
          <Pressable
            onPress={() => setPlaying((value) => !value)}
            style={({ pressed: isPressed }) => [styles.play, isPressed && pressed]}>
            <Ionicons name={playing ? 'pause' : 'play'} size={18} color="#1C1C1E" />
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
