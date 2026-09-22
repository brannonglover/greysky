import React, { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { colors, dial, tempColorFromC } from '@/constants/theme';
import type { Units } from '@/lib/types';
import { displayTemp } from '@/lib/units';

const { center, radiusOuter, radiusInner, strokeOuter, strokeInner, startAngle, sweep } = dial;

const TICK_COUNT = 8;
const TICK_OUTER = radiusOuter - strokeOuter / 2 - 6;
const TICK_INNER = TICK_OUTER - 7;

type Props = {
  /** Current temperature, celsius (the app's internal unit). */
  tempC: number;
  lowC: number;
  highC: number;
  /** Apparent temperature, drawn as a hollow ghost marker. */
  feelsC?: number;
  /** Chance of precipitation today, 0–100. Omit to hide the inner ring. */
  precipProbability?: number;
  units: Units;
  size?: number;
  children?: ReactNode;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function polar(value: number, min: number, max: number, radius: number) {
  const span = max - min;
  const t = span === 0 ? 0 : (clamp(value, min, max) - min) / span;
  const radians = ((startAngle + t * sweep) * Math.PI) / 180;
  return { x: center + radius * Math.cos(radians), y: center + radius * Math.sin(radians) };
}

function arc(from: number, to: number, min: number, max: number, radius: number): string {
  const a = polar(from, min, max, radius);
  const b = polar(to, min, max, radius);
  const span = max === min ? 0 : ((clamp(to, min, max) - clamp(from, min, max)) / (max - min)) * sweep;
  const large = span > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${large} 1 ${b.x} ${b.y}`;
}

/**
 * The ring is today's range, not an absolute thermometer: the scale is padded
 * out from the day's low and high so "where am I in today" stays readable
 * whatever the season.
 */
function scaleFor(lowC: number, highC: number, units: Units) {
  const low = displayTemp(lowC, units);
  const high = displayTemp(highC, units);
  const pad = units === 'us' ? 8 : 4;
  const step = units === 'us' ? 5 : 2;
  const min = Math.floor((low - pad) / step) * step;
  const max = Math.ceil((high + pad) / step) * step;
  return { min, max: Math.max(max, min + step * 4) };
}

export function TemperatureDial({
  tempC,
  lowC,
  highC,
  feelsC,
  precipProbability,
  units,
  size = dial.size,
  children,
}: Props) {
  const usable =
    Number.isFinite(tempC) && Number.isFinite(lowC) && Number.isFinite(highC) && highC >= lowC;
  const { min, max } = usable ? scaleFor(lowC, highC, units) : { min: 0, max: 1 };

  const now = usable ? displayTemp(tempC, units) : min;
  const low = usable ? displayTemp(lowC, units) : min;
  const high = usable ? displayTemp(highC, units) : min;
  const feels = feelsC != null && Number.isFinite(feelsC) ? displayTemp(feelsC, units) : null;

  const nowPoint = polar(now, min, max, radiusOuter);
  const lowPoint = polar(low, min, max, radiusOuter);
  const highPoint = polar(high, min, max, radiusOuter);
  const feelsPoint = feels != null ? polar(feels, min, max, radiusOuter) : null;
  const showFeels =
    feelsPoint != null && feels != null && Math.abs(feels - now) >= (units === 'us' ? 2 : 1);

  const showRain = precipProbability != null && Number.isFinite(precipProbability);
  const rainPct = showRain ? clamp(precipProbability, 0, 100) : 0;

  const ticks = Array.from({ length: TICK_COUNT }, (_, i) => {
    const value = min + ((max - min) * i) / (TICK_COUNT - 1);
    const outer = polar(value, min, max, TICK_OUTER);
    const inner = polar(value, min, max, TICK_INNER);
    return { key: i, d: `M ${outer.x} ${outer.y} L ${inner.x} ${inner.y}` };
  });

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${dial.size} ${dial.size}`}>
        <Defs>
          <LinearGradient
            id="dialTempArc"
            x1={lowPoint.x}
            y1={lowPoint.y}
            x2={highPoint.x}
            y2={highPoint.y}
            gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={tempColorFromC(lowC)} />
            <Stop offset="1" stopColor={tempColorFromC(highC)} />
          </LinearGradient>
        </Defs>

        <Path
          d={arc(min, max, min, max, radiusOuter)}
          stroke={dial.track}
          strokeWidth={strokeOuter}
          strokeLinecap="round"
          fill="none"
        />
        {usable ? (
          <Path
            d={arc(low, high, min, max, radiusOuter)}
            stroke="url(#dialTempArc)"
            strokeWidth={strokeOuter}
            strokeLinecap="round"
            fill="none"
          />
        ) : null}

        {ticks.map((tick) => (
          <Path
            key={tick.key}
            d={tick.d}
            stroke={dial.tick}
            strokeWidth={2}
            strokeLinecap="round"
            fill="none"
          />
        ))}

        {showRain ? (
          <>
            <Path
              d={arc(0, 100, 0, 100, radiusInner)}
              stroke={dial.trackInner}
              strokeWidth={strokeInner}
              strokeLinecap="round"
              fill="none"
            />
            {rainPct > 0 ? (
              <Path
                d={arc(0, rainPct, 0, 100, radiusInner)}
                stroke={colors.precip}
                strokeWidth={strokeInner}
                strokeLinecap="round"
                fill="none"
              />
            ) : null}
          </>
        ) : null}

        {showFeels && feelsPoint ? (
          <Circle
            cx={feelsPoint.x}
            cy={feelsPoint.y}
            r={6.5}
            fill={dial.markerCore}
            stroke={dial.ghost}
            strokeWidth={2}
          />
        ) : null}

        {usable ? (
          <>
            <Circle cx={nowPoint.x} cy={nowPoint.y} r={11} fill={dial.marker} />
            <Circle cx={nowPoint.x} cy={nowPoint.y} r={4} fill={dial.markerCore} />
          </>
        ) : null}
      </Svg>

      <View style={styles.center} pointerEvents="box-none">
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 56,
  },
});
