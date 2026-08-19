/** Map precipitation rate (mm/hr) onto Dark Sky's 0–1 intensity scale. */
export function intensityFromMmHr(mmHr: number): number {
  const rate = Math.max(0, mmHr);
  if (rate <= 0.02) return 0;
  if (rate < 0.4) return (rate / 0.4) * 0.33;
  if (rate < 2.5) return 0.33 + ((rate - 0.4) / 2.1) * 0.33;
  if (rate < 7.6) return 0.66 + ((rate - 2.5) / 5.1) * 0.34;
  return 1;
}

/** 15-minute totals from the nowcast. */
export function intensityFromMm(mm15: number): number {
  return intensityFromMmHr(Math.max(0, mm15) * 4);
}

/** Hourly precipitation is already a mm/hr average for that hour. */
export function intensityFromHourlyMm(mm: number): number {
  return intensityFromMmHr(mm);
}

export function barColorForCode(code: number): string {
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '#C7C7CC';
  if (code >= 95) return '#AF52DE';
  if (code === 65 || code === 82) return '#007AFF';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return '#5AC8FA';
  if (code >= 51 && code <= 57) return '#A5D8FF';
  if (code === 3 || code === 45 || code === 48) return '#8E8E93';
  if (code === 2) return '#AEAEB2';
  if (code === 0 || code === 1) return '#FFD60A';
  return '#C7C7CC';
}
