import React, { useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import type { RainLevel } from '@/lib/sky';

type Props = {
  intensity: RainLevel;
};

type DropConfig = {
  left: number;
  delay: number;
  duration: number;
  length: number;
  drift: number;
  opacity: number;
  width: number;
};

const FIELD_HEIGHT = 248;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dropsFor(intensity: RainLevel, width: number): DropConfig[] {
  if (intensity === 0 || width <= 0) return [];
  const count = intensity === 1 ? 14 : intensity === 2 ? 24 : 34;
  const rand = mulberry32(intensity * 97 + Math.round(width));
  return Array.from({ length: count }, (_, index) => {
    const speed = intensity === 1 ? 1 : intensity === 2 ? 0.72 : 0.5;
    return {
      left: rand() * width,
      delay: rand() * 1800 + index * 18,
      duration: (1400 + rand() * 1400) * speed,
      length: intensity === 1 ? 8 + rand() * 6 : 11 + rand() * 10,
      drift: (rand() - 0.35) * 18,
      opacity: 0.28 + rand() * 0.38,
      width: intensity === 1 ? 1.4 : 1.7,
    };
  });
}

function Drop({ drop }: { drop: DropConfig }) {
  const travel = useSharedValue(-24);

  useEffect(() => {
    travel.value = -24;
    travel.value = withDelay(
      drop.delay,
      withRepeat(
        withTiming(FIELD_HEIGHT + 16, { duration: drop.duration, easing: Easing.linear }),
        -1,
        false,
      ),
    );
  }, [drop.delay, drop.duration, travel]);

  const style = useAnimatedStyle(() => ({
    opacity: drop.opacity * interpolate(travel.value, [-24, 18, FIELD_HEIGHT * 0.72, FIELD_HEIGHT + 16], [0, 1, 0.7, 0]),
    transform: [
      { translateY: travel.value },
      { translateX: (travel.value / FIELD_HEIGHT) * drop.drift },
      { rotate: '14deg' },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.drop,
        {
          left: drop.left,
          width: drop.width,
          height: drop.length,
        },
        style,
      ]}
    />
  );
}

export function RainField({ intensity }: Props) {
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const drops = useMemo(() => dropsFor(intensity, width), [intensity, width]);
  if (intensity === 0 || reduceMotion) return null;

  return (
    <View pointerEvents="none" style={styles.field}>
      {drops.map((drop, index) => (
        <Drop key={`${intensity}-${index}`} drop={drop} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: FIELD_HEIGHT,
    overflow: 'hidden',
  },
  drop: {
    position: 'absolute',
    top: 0,
    borderRadius: 1,
    backgroundColor: 'rgba(236, 246, 255, 0.7)',
  },
});
