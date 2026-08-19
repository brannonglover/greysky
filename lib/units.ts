import type { Units } from './types';

export function cToF(c: number): number {
  return (c * 9) / 5 + 32;
}

export function mmToIn(mm: number): number {
  return mm / 25.4;
}

export function kmhToMph(kmh: number): number {
  return kmh / 1.60934;
}

export function metersToMiles(m: number): number {
  return m / 1609.34;
}

export function displayTemp(celsius: number, units: Units): number {
  return units === 'us' ? cToF(celsius) : celsius;
}

export function tempSymbol(units: Units): string {
  return units === 'us' ? '°' : '°';
}

export function formatTemp(celsius: number, units: Units, withUnit = false): string {
  const value = Math.round(displayTemp(celsius, units));
  return withUnit ? `${value}${units === 'us' ? '°F' : '°C'}` : `${value}°`;
}

export function formatWind(kmh: number, units: Units): string {
  if (units === 'us') return `${Math.round(kmhToMph(kmh))} mph`;
  return `${Math.round(kmh)} km/h`;
}

export function formatPrecip(mm: number, units: Units): string {
  if (units === 'us') {
    const inches = mmToIn(mm);
    if (inches < 0.005) return '0 in';
    return `${inches < 0.1 ? inches.toFixed(2) : inches.toFixed(1)} in`;
  }
  if (mm < 0.05) return '0 mm';
  return `${mm < 10 ? mm.toFixed(1) : Math.round(mm)} mm`;
}

export function hasPrecipAmount(mm: number): boolean {
  return mm >= 0.2;
}

export function formatVisibility(meters: number, units: Units): string {
  if (!Number.isFinite(meters)) return '—';
  if (units === 'us') {
    const miles = metersToMiles(meters);
    return miles >= 10 ? '10 mi' : `${miles.toFixed(1)} mi`;
  }
  const km = meters / 1000;
  return km >= 10 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
}

export function formatPressure(hPa: number, units: Units): string {
  if (units === 'us') {
    return `${(hPa * 0.02953).toFixed(2)} inHg`;
  }
  return `${Math.round(hPa)} hPa`;
}

export function cardinalFromDegrees(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

export function uvLabel(uv: number): string {
  if (uv < 3) return 'Low';
  if (uv < 6) return 'Moderate';
  if (uv < 8) return 'High';
  if (uv < 11) return 'Very high';
  return 'Extreme';
}
