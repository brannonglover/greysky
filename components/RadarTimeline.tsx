import * as Haptics from 'expo-haptics';
import React, { useRef } from 'react';
import { StyleSheet, View, type DimensionValue, type GestureResponderEvent } from 'react-native';

import { colors } from '@/constants/theme';

type Frame = {
  time: number;
};

type Props = {
  frames: Frame[];
  index: number;
  onSeek: (index: number) => void;
};

const styles = StyleSheet.create({
    track: {
      flex: 1,
      height: 36,
      justifyContent: 'center',
    },
    ticks: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      height: 6,
    },
    tick: {
      flex: 1,
      height: 6,
      borderRadius: 3,
      backgroundColor: 'rgba(255,255,255,0.22)',
    },
    tickFuture: {
      backgroundColor: 'rgba(255,255,255,0.12)',
    },
    tickFilled: {
      backgroundColor: colors.precip,
    },
    tickNow: {
      height: 10,
    },
    thumb: {
      position: 'absolute',
      top: '50%',
      width: 16,
      height: 16,
      marginTop: -8,
      marginLeft: -8,
      borderRadius: 8,
      backgroundColor: '#FFFFFF',
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.35,
      shadowRadius: 2,
      elevation: 2,
    },
});

function indexFromX(x: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0;
  return Math.round(Math.max(0, Math.min(1, x / width)) * (count - 1));
}

export function RadarTimeline({ frames, index, onSeek }: Props) {
  const widthRef = useRef(1);
  const originX = useRef(0);
  const lastIndex = useRef(index);
  lastIndex.current = index;

  const count = frames.length;
  const nowSec = Date.now() / 1000;
  const nowIndex = frames.reduce((best, frame, i) => {
    if (!frames[best]) return i;
    return Math.abs(frame.time - nowSec) < Math.abs(frames[best].time - nowSec) ? i : best;
  }, 0);
  const thumbLeft: DimensionValue = count <= 1 ? '0%' : `${(index / Math.max(1, count - 1)) * 100}%`;

  const seekToX = (x: number, always = false) => {
    const next = indexFromX(x, widthRef.current, count);
    const changed = next !== lastIndex.current;
    if (!changed && !always) return;
    lastIndex.current = next;
    if (changed) void Haptics.selectionAsync();
    onSeek(next);
  };

  const xFromEvent = (event: GestureResponderEvent) => event.nativeEvent.pageX - originX.current;

  return (
    <View
      style={styles.track}
      onLayout={(event) => {
        widthRef.current = Math.max(1, event.nativeEvent.layout.width);
      }}
      onStartShouldSetResponder={() => count > 1}
      onMoveShouldSetResponder={() => count > 1}
      onResponderGrant={(event) => {
        originX.current = event.nativeEvent.pageX - event.nativeEvent.locationX;
        seekToX(event.nativeEvent.locationX, true);
      }}
      onResponderMove={(event) => seekToX(xFromEvent(event))}
      accessibilityRole="adjustable"
      accessibilityLabel="Radar time"
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') {
          onSeek(Math.min(count - 1, index + 1));
        } else if (event.nativeEvent.actionName === 'decrement') {
          onSeek(Math.max(0, index - 1));
        }
      }}>
      <View style={styles.ticks} pointerEvents="none">
        {frames.map((item, i) => {
          const future = item.time > nowSec + 60;
          return (
            <View
              key={item.time}
              style={[
                styles.tick,
                future && styles.tickFuture,
                i <= index && styles.tickFilled,
                i === nowIndex && styles.tickNow,
              ]}
            />
          );
        })}
      </View>
      {count > 0 ? <View pointerEvents="none" style={[styles.thumb, { left: thumbLeft }]} /> : null}
    </View>
  );
}
