import { StyleSheet, type TextStyle } from 'react-native';

export const fonts = {
  display: 'SpaceGrotesk_600SemiBold',
  displayMedium: 'SpaceGrotesk_500Medium',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
} as const;

export type ThemeColors = {
  bg: string;
  bgElevated: string;
  surface: string;
  surface2: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  precip: string;
  precipMuted: string;
  precipHeavy: string;
  precipFill: string;
  snow: string;
  alert: string;
  alertFill: string;
  alertSevere: string;
  accent: string;
  onAccent: string;
  divider: string;
  tempWarm: string;
  tempCold: string;
  tempPill: string;
  rangePill: string;
  tabInactive: string;
  overlay: string;
  mapPin: string;
  mapBg: string;
  iconMoon: string;
  iconCloud: string;
  iconCloudSoft: string;
  iconFlake: string;
};

export const colors: ThemeColors = {
  bg: '#0B1120',
  bgElevated: 'rgba(6, 9, 17, 0.4)',
  surface: 'rgba(8, 12, 22, 0.28)',
  surface2: 'rgba(255,255,255,0.14)',
  text: '#EEF2F8',
  textSecondary: 'rgba(238, 242, 248, 0.86)',
  textTertiary: 'rgba(147, 163, 190, 0.9)',
  precip: '#4FC3E8',
  precipMuted: 'rgba(79, 195, 232, 0.28)',
  precipHeavy: '#4FC3E8',
  precipFill: 'rgba(79, 195, 232, 0.16)',
  snow: '#EEF2F8',
  alert: '#FFC169',
  alertFill: 'rgba(255, 193, 105, 0.16)',
  alertSevere: '#FF9166',
  accent: '#FF9166',
  onAccent: '#0B1120',
  divider: 'rgba(255,255,255,0.1)',
  tempWarm: '#FF9166',
  tempCold: '#4FC3E8',
  tempPill: 'rgba(255,255,255,0.14)',
  rangePill: 'rgba(238, 242, 248, 0.42)',
  tabInactive: 'rgba(238, 242, 248, 0.6)',
  overlay: 'rgba(6, 9, 17, 0.4)',
  mapPin: '#EEF2F8',
  mapBg: '#141C30',
  iconMoon: '#EEF2F8',
  iconCloud: 'rgba(238, 242, 248, 0.38)',
  iconCloudSoft: 'rgba(238, 242, 248, 0.22)',
  iconFlake: '#EEF2F8',
};

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radii = {
  card: 18,
  control: 14,
  pill: 100,
} as const;

export const typography = {
  tabular: ['tabular-nums'] as TextStyle['fontVariant'],
};

export const typeStyles = {
  panelLabel: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.55)',
  } satisfies TextStyle,
};

export const glass = {
  card: {
    backgroundColor: 'rgba(6, 9, 17, 0.4)',
    borderRadius: radii.card,
    borderCurve: 'continuous' as const,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden' as const,
  },
  pill: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: radii.pill,
  },
};

export const shadows = {
  card: {
    shadowColor: '#041018',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 4,
  },
};

export const pressed = { opacity: 0.38 } as const;

export const hairline = StyleSheet.hairlineWidth;

function hexToRgb(hex: string) {
  const value = parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function lerpHex(from: string, to: string, t: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r},${g},${bl})`;
}

/** Temperature tint on the 7-day range bars. Scale is Fahrenheit. */
export function tempColorFromC(celsius: number): string {
  const f = (celsius * 9) / 5 + 32;
  const pct = (Math.max(45, Math.min(100, f)) - 45) / 55;
  if (pct < 0.5) return lerpHex('#4FC3E8', '#EEF2F8', pct / 0.5);
  return lerpHex('#EEF2F8', '#FF9166', (pct - 0.5) / 0.5);
}
