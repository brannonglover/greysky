import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/constants/theme';
import { formatRadarTime } from '@/lib/format';
import type { Playhead } from '@/lib/radar/playhead';
import type { RadarFrame } from '@/lib/radar/types';
import { usePlayheadIndex } from '@/lib/radar/useRadar';

/**
 * The timestamp readout.
 *
 * Its own component purely so that subscribing to the playhead re-renders two
 * Text nodes instead of the whole radar screen.
 */
export function RadarClock({
  frames,
  playhead,
}: {
  frames: RadarFrame[];
  playhead: Playhead;
}) {
  const index = usePlayheadIndex(playhead);
  const frame = frames[index];
  const stamp = frame ? formatRadarTime(frame.timestamp) : null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.clock}>{stamp?.clock ?? '--:--'}</Text>
      {stamp ? <Text style={styles.relative}>{stamp.relative}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minWidth: 72,
    alignItems: 'flex-end',
  },
  clock: {
    color: colors.text,
    fontFamily: fonts.monoMedium,
    textAlign: 'right',
  },
  relative: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 11,
    marginTop: 1,
    textAlign: 'right',
  },
});
