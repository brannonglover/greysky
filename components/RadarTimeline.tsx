import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import { colors, fonts } from '@/constants/theme';
import type { Playhead } from '@/lib/radar/playhead';
import { isFutureKind, radarWindow, type RadarFrame } from '@/lib/radar/types';
import { usePlayheadIndex } from '@/lib/radar/useRadar';

type Props = {
  frames: RadarFrame[];
  /**
   * The timeline subscribes to the playhead directly instead of taking an
   * index prop, so scrubbing and playback never re-render the screen above it.
   */
  playhead: Playhead;
  window?: { pastMin: number; futureMin: number };
  /** Newest real observation; the observed/future boundary is anchored here. */
  observedThrough?: number | null;
  /**
   * Called when the user grabs the track. Taking hold of the timeline means
   * taking control of it, so the screen stops playback — otherwise the
   * animation timer advances straight past wherever they just seeked.
   */
  onScrub?: () => void;
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
  tickFilled: {
    backgroundColor: colors.precip,
  },
  /** Model output reads lighter than a measurement. */
  tickFuture: {
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  /**
   * The last real observation, which typically trails wall-clock now by a
   * couple of minutes. Drawn separately from the Now line so the gap is
   * visible rather than papered over.
   */
  boundary: {
    position: 'absolute',
    top: 0,
    width: StyleSheet.hairlineWidth,
    height: 12,
    backgroundColor: 'rgba(255,255,255,0.35)',
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

function edgeLabel(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

/**
 * Frames left over from before a long background sit outside the window, and
 * clamping would stack them all on one edge. Drop them until a refresh lands.
 */
function inWindow(time: number, start: number, end: number): boolean {
  return time >= start && time <= end;
}

function pctForTime(time: number, start: number, end: number): number {
  const span = Math.max(1, end - start);
  return Math.max(0, Math.min(100, ((time - start) / span) * 100));
}

function indexFromX(x: number, width: number, frames: RadarFrame[], start: number, end: number): number {
  if (frames.length === 0 || width <= 0) return 0;
  const t = start + Math.max(0, Math.min(1, x / width)) * (end - start);
  return frames.reduce((best, frame, i) => {
    return Math.abs(frame.timestamp - t) < Math.abs(frames[best].timestamp - t) ? i : best;
  }, 0);
}

export function RadarTimeline({
  frames,
  playhead,
  window,
  observedThrough,
  onScrub,
}: Props) {
  const index = usePlayheadIndex(playhead);
  const onSeek = (next: number) => playhead.set(next);
  const widthRef = useRef(1);
  const originX = useRef(0);
  const lastIndex = useRef(index);
  lastIndex.current = index;

  // Re-render on a timer so the Now marker and thumb keep drifting between
  // frame refreshes rather than freezing wherever the last render left them.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 15_000);
    return () => clearInterval(timer);
  }, []);

  const pastMin = window?.pastMin ?? 60;
  const futureMin = window?.futureMin ?? 60;
  const nowSec = Date.now() / 1000;
  const { start, end } = radarWindow(window, nowSec);
  const current = frames[index];
  const boundary = observedThrough ?? nowSec;
  const thumbPct = current ? pctForTime(current.timestamp, start, end) : 0;
  const nowPct = pctForTime(nowSec, start, end);
  const playedPct = current ? pctForTime(current.timestamp, start, end) : 0;

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
          onScrub?.();
          originX.current = event.nativeEvent.pageX - event.nativeEvent.locationX;
          seekToX(event.nativeEvent.locationX, true);
        }}
        onResponderMove={(event) => seekToX(xFromEvent(event))}
        accessibilityRole="adjustable"
        accessibilityLabel={`Radar time, from ${edgeLabel(pastMin)} ago to ${edgeLabel(futureMin)} ahead`}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          onScrub?.();
          if (event.nativeEvent.actionName === 'increment') {
            onSeek(Math.min(frames.length - 1, index + 1));
          } else if (event.nativeEvent.actionName === 'decrement') {
            onSeek(Math.max(0, index - 1));
          }
        }}>
        <View style={styles.axis} pointerEvents="none">
          <View style={styles.rail} />
          <View style={[styles.railPlayed, { width: `${playedPct}%` }]} />
          {frames.map((item, i) =>
            inWindow(item.timestamp, start, end) ? (
              <View
                key={item.id}
                style={[
                  styles.tick,
                  { left: `${pctForTime(item.timestamp, start, end)}%` },
                  isFutureKind(item.kind) && styles.tickFuture,
                  i <= index && styles.tickFilled,
                ]}
              />
            ) : null,
          )}
          <View style={[styles.boundary, { left: `${pctForTime(boundary, start, end)}%` }]} />
          <View style={[styles.nowLine, { left: `${nowPct}%` }]} />
        </View>
        {current && inWindow(current.timestamp, start, end) ? (
          <View pointerEvents="none" style={[styles.thumb, { left: `${thumbPct}%` }]} />
        ) : null}
      </View>
      <View style={styles.labels} pointerEvents="none">
        <Text style={[styles.label, styles.labelStart]}>−{edgeLabel(pastMin)}</Text>
        <Text style={[styles.nowLabel, { left: `${nowPct}%` }]}>Now</Text>
        <Text style={[styles.label, styles.labelEnd]}>+{edgeLabel(futureMin)}</Text>
      </View>
    </View>
  );
}
