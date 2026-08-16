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

/** Light Dark Sky look — warmer off-white page. */
export const colors: ThemeColors = {
  bg: '#F6F6F4',
  bgElevated: '#FFFFFF',
  surface: '#EFEFF2',
  surface2: '#E2E2E6',
  text: '#1C1C1E',
  textSecondary: '#6C6C70',
  textTertiary: '#8A8A8E',
  precip: '#4EB8F0',
  precipMuted: '#D4ECFA',
  precipHeavy: '#007AFF',
  precipFill: '#6BB8D4',
  snow: '#D1D1D6',
  alert: '#FF9500',
  alertFill: '#FFF6E8',
  alertSevere: '#FF3B30',
  accent: '#007AFF',
  onAccent: '#FFFFFF',
  divider: '#D8D8DC',
  tempWarm: '#FFD60A',
  tempCold: '#64D2FF',
  tempPill: '#E8E8ED',
  rangePill: '#C7C7CC',
  tabInactive: '#8A8A8E',
  overlay: 'rgba(0,0,0,0.08)',
  mapPin: '#1C1C1E',
  mapBg: '#e8eef2',
  iconMoon: '#F2F2F7',
  iconCloud: '#C7C7CC',
  iconCloudSoft: '#F7F7F8',
  iconFlake: '#D1D1D6',
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
    shadowColor: '#1C1C1E',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
};

export const pressed = { opacity: 0.38 } as const;

export const hairline = StyleSheet.hairlineWidth;
