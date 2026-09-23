import Ionicons from '@expo/vector-icons/Ionicons';
import * as WebBrowser from 'expo-web-browser';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { StormTrackMap } from '@/components/StormTrackMap';
import { colors, fonts, glass, hairline, pressed, spacing, typeStyles } from '@/constants/theme';
import { approximateWhen } from '@/lib/stormOutlook';
import {
  exposureLabel,
  saffirSimpson,
  stormKindLabel,
  type TropicalReport,
} from '@/lib/tropical';
import type { Units } from '@/lib/types';
import { cardinalFromDegrees, formatWind, kmhToMph } from '@/lib/units';

/**
 * One tropical cyclone, led by what it means for the user rather than by how
 * impressive the storm is.
 *
 * The headline is the wind-field exposure: whether the forecast brings
 * tropical-storm-force winds over this location, and when. Distance to the
 * centre is shown, but as supporting context — a category 4 whose eye passes
 * 150 miles away can still be the most consequential weather of the year, and
 * a storm that never brings damaging wind here should not read as a threat.
 */

type Props = {
  report: TropicalReport;
  latitude: number;
  longitude: number;
  units: Units;
  /** Demoted styling for systems with no forecast local impact. */
  muted?: boolean;
};

function knotsToKmh(kt: number): number {
  return kt * 1.852;
}

/**
 * Range within which the storm's position relative to the user is worth
 * spelling out. Past this, "passing 2679 mi away" tells nobody anything.
 */
const LOCAL_CONTEXT_KM = 1500;

function distanceLabel(km: number, units: Units): string {
  if (units === 'us') return `${Math.round(km / 1.60934)} mi`;
  return `${Math.round(km)} km`;
}

export function TropicalStormCard({ report, latitude, longitude, units, muted }: Props) {
  const { storm, threat } = report;
  const { exposure, closest } = threat;
  const category = saffirSimpson(storm.maxWindKt);

  const nearby = exposure !== null || (closest?.distanceKm ?? Infinity) < LOCAL_CONTEXT_KM;

  // The closest-approach line only earns its space when it says something the
  // "Now" stat does not: a pass that is near enough to matter, still ahead,
  // and materially closer than the storm already is.
  const showClosest =
    nearby &&
    closest !== null &&
    closest.time > Date.now() + 60 * 60_000 &&
    closest.distanceKm < threat.distanceKm * 0.9;

  // Framing the user alongside a storm on the far side of an ocean zooms the
  // diagram out to two dots in empty water; at that range the track alone is
  // the more useful picture.
  const framesUser = nearby;

  const headline = exposure
    ? `${exposureLabel(exposure.strength)} possible here`
    : 'No local wind impact forecast';

  return (
    <View style={[styles.card, muted && styles.muted]}>
      <View style={styles.header}>
        <Ionicons
          name="sync-circle-outline"
          size={20}
          color={exposure ? colors.alertSevere : colors.textTertiary}
        />
        <View style={styles.headings}>
          <Text style={styles.name}>{storm.name}</Text>
          <Text style={styles.kind}>
            {stormKindLabel(storm)}
            {category !== null ? '' : ` · ${storm.maxWindKt} kt`}
          </Text>
        </View>
        {category !== null ? (
          <View style={styles.categoryChip}>
            <Text style={styles.categoryText}>CAT {category}</Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.exposure, exposure && styles.exposureActive]}>
        <Text style={[styles.exposureHeadline, exposure && styles.exposureHeadlineActive]}>
          {headline}
        </Text>
        {exposure ? (
          <Text style={styles.exposureWhen}>
            Arriving {approximateWhen(exposure.startsAt)}
            {exposure.endsAt > exposure.startsAt
              ? `, easing ${approximateWhen(exposure.endsAt)}`
              : ''}
            .
            {exposure.fromOutlook ? ' Timing still uncertain this far out.' : ''}
          </Text>
        ) : (
          <Text style={styles.exposureWhen}>
            The forecast wind field does not reach your location.
          </Text>
        )}
      </View>

      <View style={styles.stats}>
        <Stat label="Winds" value={formatWind(knotsToKmh(storm.maxWindKt), units)} />
        <Stat label="Pressure" value={storm.pressureMb ? `${storm.pressureMb} mb` : '—'} />
        <Stat
          label="Moving"
          value={
            storm.movementDir !== null && storm.movementSpeedKt !== null
              ? `${cardinalFromDegrees(storm.movementDir)} ${Math.round(
                  units === 'us' ? kmhToMph(knotsToKmh(storm.movementSpeedKt)) : knotsToKmh(storm.movementSpeedKt),
                )} ${units === 'us' ? 'mph' : 'km/h'}`
              : '—'
          }
        />
        <Stat
          label="Now"
          value={`${distanceLabel(threat.distanceKm, units)} ${cardinalFromDegrees(threat.bearing)}`}
        />
      </View>

      {showClosest && closest ? (
        <Text style={styles.closest}>
          Center forecast to pass about {distanceLabel(closest.distanceKm, units)} away{' '}
          {approximateWhen(closest.time)}.
        </Text>
      ) : null}

      {storm.trackAvailable ? (
        <StormTrackMap
          track={storm.track}
          latitude={latitude}
          longitude={longitude}
          showUser={framesUser}
        />
      ) : (
        <Text style={styles.unavailable}>
          Forecast track unavailable — showing the current position and intensity only.
        </Text>
      )}

      <View style={styles.footer}>
        <Text style={styles.source}>
          NHC{storm.advisoryNumber ? ` advisory ${storm.advisoryNumber}` : ''}
          {' · '}
          {new Date(storm.lastUpdate).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
        </Text>
        {storm.advisoryUrl ? (
          <Pressable
            onPress={() => void WebBrowser.openBrowserAsync(storm.advisoryUrl as string)}
            accessibilityRole="link"
            accessibilityLabel={`Read the National Hurricane Center advisory for ${storm.name}`}
            style={({ pressed: isPressed }) => [styles.link, isPressed && pressed]}>
            <Text style={styles.linkText}>Full advisory</Text>
            <Ionicons name="open-outline" size={13} color={colors.accent} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...glass.card,
    padding: spacing.md,
    marginBottom: 10,
  },
  muted: {
    opacity: 0.72,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headings: {
    flex: 1,
  },
  name: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 20,
    letterSpacing: -0.4,
  },
  kind: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 13,
    marginTop: 2,
  },
  categoryChip: {
    backgroundColor: colors.tempPill,
    borderRadius: 8,
    borderCurve: 'continuous',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  categoryText: {
    color: colors.text,
    fontFamily: fonts.monoMedium,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  exposure: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
  },
  exposureActive: {
    backgroundColor: colors.alertFill,
  },
  exposureHeadline: {
    color: colors.textSecondary,
    fontFamily: fonts.bodySemi,
    fontSize: 15,
  },
  exposureHeadlineActive: {
    color: colors.alert,
  },
  exposureWhen: {
    color: colors.textSecondary,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
    gap: 10,
  },
  stat: {
    minWidth: '22%',
    flexGrow: 1,
  },
  statLabel: {
    ...typeStyles.panelLabel,
    fontSize: 10,
  },
  statValue: {
    color: colors.text,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    marginTop: 3,
  },
  closest: {
    color: colors.textTertiary,
    fontFamily: fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 12,
  },
  unavailable: {
    color: colors.textTertiary,
    fontFamily: fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 12,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: hairline,
    borderTopColor: colors.divider,
  },
  source: {
    color: colors.textTertiary,
    fontFamily: fonts.mono,
    fontSize: 10.5,
    flex: 1,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  linkText: {
    color: colors.accent,
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
  },
});
