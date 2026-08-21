import * as Haptics from 'expo-haptics';
import React, { useRef } from 'react';
import { StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import { colors, fonts } from '@/constants/theme';
import { radarHourWindow, radarNowIndex } from '@/lib/weather';

type Frame = {
  time: number;
};

type Props = {
  frames: Frame[];
  index: number;
  onSeek: (index: number) => void;
};

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  track: {
    height: 36,
    justifyContent: 'center',
  },
  axis: {
    height: 12,
    justifyContent: 'center',
  },
  rail: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  railPlayed: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.precip,
  },
  nowLine: {
    position: 'absolute',
    top: -4,
    width: 2,
    height: 20,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: '#FFFFFF',
  },
  tick: {
    position: 'absolute',
    top: 1,
    width: 6,
    height: 10,
    marginLeft: -3,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  tickFuture: {
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  tickFilled: {
    backgroundColor: colors.precip,
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
  labels: {
    height: 14,
    marginTop: 2,
  },
  label: {
    position: 'absolute',
    top: 0,
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.3,
  },
  labelStart: {
    left: 0,
  },
  labelEnd: {
    right: 0,
  },
  nowLabel: {
    position: 'absolute',
    top: 0,
    width: 28,
    marginLeft: -14,
    textAlign: 'center',
    color: colors.text,
    fontFamily: fonts.monoMedium,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});

function pctForTime(time: number, start: number, end: number): number {
  const span = Math.max(1, end - start);
  return Math.max(0, Math.min(100, ((time - start) / span) * 100));
}

function indexFromX(x: number, width: number, frames: Frame[], start: number, end: number): number {
  if (frames.length === 0 || width <= 0) return 0;
  const t = start + Math.max(0, Math.min(1, x / width)) * (end - start);
  return frames.reduce((best, frame, i) => {
    return Math.abs(frame.time - t) < Math.abs(frames[best].time - t) ? i : best;
  }, 0);
}

export function RadarTimeline({ frames, index, onSeek }: Props) {
  const widthRef = useRef(1);
  const originX = useRef(0);
  const lastIndex = useRef(index);
  lastIndex.current = index;

  const nowSec = Date.now() / 1000;
  const { start, end } = radarHourWindow(nowSec);
  const nowIndex = radarNowIndex(frames, nowSec);
  const current = frames[index];
  const thumbPct = current ? pctForTime(current.time, start, end) : 0;
  const nowPct = pctForTime(nowSec, start, end);
  const playedPct = current ? pctForTime(current.time, start, end) : 0;

  const seekToX = (x: number, always = false) => {
    const next = indexFromX(x, widthRef.current, frames, start, end);
    const changed = next !== lastIndex.current;
    if (!changed && !always) return;
    lastIndex.current = next;
    if (changed) void Haptics.selectionAsync();
    onSeek(next);
  };

  const xFromEvent = (event: GestureResponderEvent) => event.nativeEvent.pageX - originX.current;

  return (
    <View style={styles.wrap}>
      <View
        style={styles.track}
        onLayout={(event) => {
          widthRef.current = Math.max(1, event.nativeEvent.layout.width);
        }}
        onStartShouldSetResponder={() => frames.length > 1}
        onMoveShouldSetResponder={() => frames.length > 1}
        onResponderGrant={(event) => {
          originX.current = event.nativeEvent.pageX - event.nativeEvent.locationX;
          seekToX(event.nativeEvent.locationX, true);
        }}
        onResponderMove={(event) => seekToX(xFromEvent(event))}
        accessibilityRole="adjustable"
        accessibilityLabel="Radar time, one hour from 30 minutes ago to 30 minutes ahead"
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'increment') {
            onSeek(Math.min(frames.length - 1, index + 1));
          } else if (event.nativeEvent.actionName === 'decrement') {
            onSeek(Math.max(0, index - 1));
          }
        }}>
        <View style={styles.axis} pointerEvents="none">
          <View style={styles.rail} />
          <View style={[styles.railPlayed, { width: `${playedPct}%` }]} />
          {frames.map((item, i) => (
            <View
              key={item.time}
              style={[
                styles.tick,
                { left: `${pctForTime(item.time, start, end)}%` },
                item.time > nowSec + 60 && styles.tickFuture,
                i <= index && styles.tickFilled,
                i === nowIndex && { backgroundColor: '#FFFFFF', height: 12, top: 0 },
              ]}
            />
          ))}
          <View style={[styles.nowLine, { left: `${nowPct}%` }]} />
        </View>
        {current ? <View pointerEvents="none" style={[styles.thumb, { left: `${thumbPct}%` }]} /> : null}
      </View>
      <View style={styles.labels} pointerEvents="none">
        <Text style={[styles.label, styles.labelStart]}>−30m</Text>
        <Text style={[styles.nowLabel, { left: `${nowPct}%` }]}>Now</Text>
        <Text style={[styles.label, styles.labelEnd]}>+30m</Text>
      </View>
    </View>
  );
}
