import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors } from '@/constants/theme';
import type { IconName } from '@/lib/wmo';

type Props = {
  name: IconName;
  size?: number;
};

export function WeatherIcon({ name, size = 72 }: Props) {
  const stroke = colors.text;
  const line = {
    stroke,
    strokeWidth: 2.3,
    fill: 'none' as const,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  if (name === 'clear-day') {
    return (
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Circle cx="32" cy="32" r="11" fill={colors.tempWarm} />
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i * Math.PI) / 4 - Math.PI / 2;
          return (
            <Path
              key={i}
              d={`M${32 + Math.cos(a) * 16.5} ${32 + Math.sin(a) * 16.5} L${32 + Math.cos(a) * 24} ${32 + Math.sin(a) * 24}`}
              stroke={colors.tempWarm}
              strokeWidth={3}
              strokeLinecap="round"
            />
          );
        })}
      </Svg>
    );
  }

  if (name === 'clear-night') {
    return (
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Path d="M40 16a18 18 0 1 0 6 30 22 22 0 1 1-6-30z" fill={colors.iconMoon} stroke={stroke} strokeWidth={2} />
      </Svg>
    );
  }

  if (name === 'partly-cloudy-day' || name === 'partly-cloudy-night') {
    const sun = name === 'partly-cloudy-day';
    return (
      <Svg width={size} height={size} viewBox="0 0 64 64">
        {sun ? <Circle cx="42" cy="22" r="9" fill={colors.tempWarm} /> : (
          <Path d="M48 14a10 10 0 1 0 3 18 12 12 0 1 1-3-18z" fill={colors.iconMoon} stroke={stroke} strokeWidth={1.8} />
        )}
        <Path
          d="M18 46h26a10 10 0 0 0 1.2-19.9 13 13 0 0 0-24.6 3.6A8.5 8.5 0 0 0 18 46z"
          fill={colors.iconCloud}
          stroke={stroke}
          strokeWidth={2}
        />
      </Svg>
    );
  }

  if (name === 'cloudy' || name === 'fog') {
    return (
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Path
          d="M16 44h30a11 11 0 0 0 1.4-21.9 14 14 0 0 0-26.6 4.2A9 9 0 0 0 16 44z"
          fill={colors.iconCloud}
          stroke={stroke}
          strokeWidth={2}
        />
        {name === 'fog' ? (
          <>
            <Path d="M18 50h28" {...line} />
            <Path d="M22 56h20" {...line} />
          </>
        ) : null}
      </Svg>
    );
  }

  if (name === 'drizzle' || name === 'rain' || name === 'sleet' || name === 'thunderstorm') {
    return (
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Path
          d="M12 30c0-11 9-20 20-20s20 9 20 20H12z"
          fill={colors.iconCloudSoft}
          stroke={stroke}
          strokeWidth={2.4}
        />
        <Path d="M32 30v18" stroke={stroke} strokeWidth={2.4} strokeLinecap="round" />
        <Path d="M32 48c-6 0-8 4-4 6" stroke={stroke} strokeWidth={2.4} fill="none" strokeLinecap="round" />
        <Path d="M20 38c0 3.2 4.5 5.5 4.5 9" stroke={colors.precipHeavy} strokeWidth={2.6} fill="none" strokeLinecap="round" />
        <Path d="M44 36c0 3.2 4.5 5.5 4.5 9" stroke={colors.precipHeavy} strokeWidth={2.6} fill="none" strokeLinecap="round" />
        {name === 'thunderstorm' ? (
          <Path d="M36 34l-7 10h6l-3 10 11-14h-7l5-6z" fill={colors.tempWarm} />
        ) : null}
        {name === 'sleet' ? <Circle cx="28" cy="54" r="2.2" fill={colors.snow} /> : null}
      </Svg>
    );
  }

  if (name === 'snow') {
    return (
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Path
          d="M16 34h30a10 10 0 0 0 1.2-19.9 13 13 0 0 0-24.6 3.6A8.5 8.5 0 0 0 16 34z"
          fill={colors.iconCloudSoft}
          stroke={stroke}
          strokeWidth={2}
        />
        <Circle cx="22" cy="44" r="2.3" fill={colors.iconFlake} />
        <Circle cx="32" cy="50" r="2.3" fill={colors.iconFlake} />
        <Circle cx="42" cy="44" r="2.3" fill={colors.iconFlake} />
        <Circle cx="28" cy="56" r="2.3" fill={colors.iconFlake} />
      </Svg>
    );
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Path d="M14 40h36" {...line} />
      <Path d="M18 32h28" {...line} />
      <Path d="M22 24h20" {...line} />
    </Svg>
  );
}
