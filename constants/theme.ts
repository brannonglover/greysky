import { StyleSheet, type TextStyle } from 'react-native';

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

/** Ink used over atmospheric skies. Live gradients come from `skyFromWeather`. */
export const colors: ThemeColors = {
  bg: '#2A3A48',
  bgElevated: 'rgba(16, 22, 30, 0.48)',
  surface: 'rgba(16, 22, 30, 0.32)',
  surface2: 'rgba(255,255,255,0.16)',
  text: '#F4F0E6',
  textSecondary: 'rgba(244, 240, 230, 0.86)',
  textTertiary: 'rgba(244, 240, 230, 0.7)',
  precip: '#8EC5E0',
  precipMuted: 'rgba(142, 197, 224, 0.28)',
  precipHeavy: '#D2EAF6',
  precipFill: 'rgba(142, 197, 224, 0.42)',
  snow: '#E4EEF4',
  alert: '#FFB020',
  alertFill: 'rgba(255, 176, 32, 0.16)',
  alertSevere: '#FF6B5A',
  accent: '#E8C9A0',
  onAccent: '#1C1915',
  divider: 'rgba(255,255,255,0.18)',
  tempWarm: '#F2C14E',
  tempCold: '#8EC5E0',
  tempPill: 'rgba(255,255,255,0.16)',
  rangePill: 'rgba(244, 240, 230, 0.42)',
  tabInactive: 'rgba(244, 240, 230, 0.7)',
  overlay: 'rgba(12, 16, 24, 0.28)',
  mapPin: '#F4F0E6',
  mapBg: '#1E2A34',
  iconMoon: '#F4F0E6',
  iconCloud: 'rgba(244, 240, 230, 0.38)',
  iconCloudSoft: 'rgba(244, 240, 230, 0.22)',
  iconFlake: '#E4EEF4',
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
  pill: 20,
} as const;

export const typography = {
  tabular: ['tabular-nums'] as TextStyle['fontVariant'],
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
