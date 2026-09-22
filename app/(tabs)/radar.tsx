import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { RadarClock } from '@/components/RadarClock';
import { RadarMap } from '@/components/RadarMap';
import { RadarTimeline } from '@/components/RadarTimeline';
import { colors, fonts, pressed } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { NOAA_REFLECTIVITY } from '@/lib/radarPalette';
import { Playhead } from '@/lib/radar/playhead';
import { radarNowIndex } from '@/lib/radar/types';
import { usePlayback, useRadarManifest } from '@/lib/radar/useRadar';

/** Playback speed. Fast enough to read as motion, slow enough to follow. */
const FRAME_MS = 450;

export default function RadarScreen() {
  const { coords, placeName } = useApp();
  const insets = useSafeAreaInsets();
  const { manifest, error } = useRadarManifest();
  const [playing, setPlaying] = useState(false);

  // The playhead is created once and mutated in place. It never lives in state,
  // so animating it does not re-render this screen.
  const playhead = useMemo(() => new Playhead(), []);
  const frames = useMemo(() => manifest?.frames ?? [], [manifest]);
  const legend = manifest?.legend.length ? manifest.legend : NOAA_REFLECTIVITY;

  // Hold the user's position across refreshes when that frame survives; after a
  // long background it will not, and we snap back to now.
  const lastFrameId = useRef<string | null>(null);
  useEffect(() => {
    if (frames.length === 0) return;
    playhead.setCount(frames.length);
    const keep = lastFrameId.current
      ? frames.findIndex((frame) => frame.id === lastFrameId.current)
      : -1;
    playhead.set(keep >= 0 ? keep : radarNowIndex(frames));
    const unsubscribe = playhead.subscribe((index) => {
      lastFrameId.current = frames[index]?.id ?? null;
    });
    return unsubscribe;
  }, [frames, playhead]);

  usePlayback(playhead, playing, FRAME_MS);

  const latitude = coords?.latitude ?? 39.8;
  const longitude = coords?.longitude ?? -98.5;
  const zoom = coords ? 7 : 4;

  return (
    <View style={styles.root}>
      <RadarMap
        latitude={latitude}
        longitude={longitude}
        zoom={zoom}
        frames={frames}
        playhead={playhead}
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
        {frames.length === 0 && !error ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.text} />
          </View>
        ) : null}
        {error && frames.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}
        <View style={[styles.controls, { marginBottom: Math.max(insets.bottom, 8) + 76 }]}>
          <Pressable
            onPress={() => setPlaying((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel={playing ? 'Pause radar' : 'Play radar'}
            style={({ pressed: isPressed }) => [styles.play, isPressed && pressed]}>
            <Ionicons name={playing ? 'pause' : 'play'} size={18} color={colors.text} />
          </Pressable>
          <RadarTimeline
            frames={frames}
            playhead={playhead}
            window={manifest?.window}
            observedThrough={manifest?.observedThrough}
            onScrub={() => setPlaying(false)}
          />
          <RadarClock frames={frames} playhead={playhead} />
        </View>
      </SafeAreaView>
    </View>
  );
}

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
});
