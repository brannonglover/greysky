import { wallHour, wallMinute, zonedIsoToMs } from '@/lib/time';

function hour12(hours: number): number {
  const h = hours % 12;
  return h === 0 ? 12 : h;
}

function meridiem(hours: number): 'AM' | 'PM' {
  return hours < 12 ? 'AM' : 'PM';
}

function formatHourNumber(hours: number): string {
  return `${hour12(hours)} ${meridiem(hours)}`;
}

export function formatHour(iso: string): string {
  return formatHourNumber(wallHour(iso));
}

export function formatHourCompact(iso: string): string {
  const hours = wallHour(iso);
  if (!Number.isFinite(hours)) return formatHour(iso);
  return `${hour12(hours)}${hours < 12 ? 'A' : 'P'}`;
}

export function formatWeekday(iso: string, index: number): string {
  if (index === 0) return 'Today';
  const datePart = iso.split('T')[0];
  const [year, month, day] = datePart.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { weekday: 'long' });
}

export function formatWeekdayShort(iso: string, index: number): string {
  if (index === 0) return 'Today';
  const datePart = iso.split('T')[0];
  const [year, month, day] = datePart.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { weekday: 'short' });
}

export function formatSunsetIn(sunsetIso: string, timeZone?: string): string {
  const ms = zonedIsoToMs(sunsetIso, timeZone) - Date.now();
  const clock = formatClock(sunsetIso);
  if (!Number.isFinite(ms) || ms <= 0) return `Sunset ${clock}`;
  const hours = ms / 3_600_000;
  const whole = Math.floor(hours);
  const quarter = Math.round((hours - whole) * 4) / 4;
  const fraction =
    quarter === 0.25 ? '¼' : quarter === 0.5 ? '½' : quarter === 0.75 ? '¾' : '';
  const amount = quarter === 1 ? `${whole + 1}` : `${whole}${fraction}`;
  return `Sunset in ${amount} hours (${clock})`;
}

export function formatClock(iso: string): string {
  const hours = wallHour(iso);
  const minutes = wallMinute(iso);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  return `${formatHourNumber(hours).replace(/ (AM|PM)$/, '')}:${String(minutes).padStart(2, '0')} ${meridiem(hours)}`;
}

export function formatRadarTime(unixSec: number): { clock: string; relative: string } {
  const clock = new Date(unixSec * 1000).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  const deltaMin = Math.round((unixSec * 1000 - Date.now()) / 60_000);
  if (Math.abs(deltaMin) < 5) return { clock, relative: 'Now' };
  if (deltaMin > 0) return { clock, relative: `+${deltaMin} min` };
  return { clock, relative: `−${Math.abs(deltaMin)} min` };
}

export function relativeUpdated(date: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 15) return 'Updated just now';
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  return `Updated ${Math.round(minutes / 60)}h ago`;
}
