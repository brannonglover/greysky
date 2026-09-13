import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { DarkSkyRadar } from '@/components/DarkSkyRadar';
import { RadarTimeline } from '@/components/RadarTimeline';
import { colors, fonts, pressed } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { formatRadarTime } from '@/lib/format';
import { useOnAppResume } from '@/lib/useOnAppResume';
import { fetchRadarManifest, radarNowIndex, type RadarFrame, type RadarLegendStop } from '@/lib/weather';

const FALLBACK_LEGEND: RadarLegendStop[] = [
  { dbz: 5, color: '#6c7fac' },
  { dbz: 15, color: '#57bab9' },
  { dbz: 25, color: '#0db213' },
  { dbz: 35, color: '#6d8f05' },
  { dbz: 45, color: '#ff9100' },
  { dbz: 55, color: '#bb1313' },
];

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
  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [window, setWindow] = useState({ pastMin: 60, futureMin: 60 });
  const [legend, setLegend] = useState<RadarLegendStop[]>(FALLBACK_LEGEND);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const framesRef = useRef<RadarFrame[]>([]);
  const indexRef = useRef(0);
  framesRef.current = frames;
  indexRef.current = index;

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(() => {
    fetchRadarManifest()
      .then((manifest) => {
        if (!mounted.current) return;
        // Hold the user's position across refreshes when that frame survives.
        // After a long background it will not, and we snap back to now.
        const previousTime = framesRef.current[indexRef.current]?.time;
        const keep =
          previousTime != null ? manifest.frames.findIndex((frame) => frame.time === previousTime) : -1;
        setFrames(manifest.frames);
        setWindow(manifest.window);
        if (manifest.legend.length) setLegend(manifest.legend);
        setIndex(keep >= 0 ? keep : radarNowIndex(manifest.frames));
        setError(null);
      })
      .catch(() => {
        if (mounted.current && framesRef.current.length === 0) {
          setError('Radar is unavailable right now.');
        }
      });
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 75_000);
    return () => clearInterval(timer);
  }, [load]);

  useOnAppResume(load);

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
              {[...legend].reverse().map((stop) => (
                <View key={stop.dbz} style={[styles.swatch, { backgroundColor: stop.color }]} />
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
          <RadarTimeline frames={frames} index={index} onSeek={seekTo} window={window} />
          <View style={styles.stampWrap}>
            <Text style={styles.stamp}>{stamp?.clock ?? '--:--'}</Text>
            {stamp ? <Text style={styles.stampRelative}>{stamp.relative}</Text> : null}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}
