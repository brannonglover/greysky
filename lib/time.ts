/** Open-Meteo `timezone=auto` timestamps are wall-clock in the location zone, with no offset. */

function hasExplicitOffset(iso: string): boolean {
  return /[zZ]$|[+-]\d{2}:\d{2}$/.test(iso);
}

function padIsoTime(iso: string): string {
  if (/T\d{2}:\d{2}:\d{2}/.test(iso)) return iso;
  if (/T\d{2}:\d{2}$/.test(iso)) return `${iso}:00`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return `${iso}T00:00:00`;
  return iso;
}

export function wallHour(iso: string): number {
  const match = iso.match(/T(\d{1,2})/);
  if (match) return Number(match[1]);
  return new Date(iso).getHours();
}

export function wallMinute(iso: string): number {
  const match = iso.match(/T\d{1,2}:(\d{2})/);
  if (match) return Number(match[1]);
  return new Date(iso).getMinutes();
}

function tzOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(instant));

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour') % 24,
    value('minute'),
    value('second'),
  );
  return asUtc - instant;
}

/** Epoch ms for an Open-Meteo timestamp interpreted in `timeZone`. */
export function zonedIsoToMs(iso: string, timeZone?: string): number {
  if (!iso) return Number.NaN;
  if (!timeZone || hasExplicitOffset(iso)) {
    const parsed = Date.parse(iso);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  const utcGuess = Date.parse(`${padIsoTime(iso)}Z`);
  if (!Number.isFinite(utcGuess)) return Date.parse(iso);

  const first = utcGuess - tzOffsetMs(utcGuess, timeZone);
  return utcGuess - tzOffsetMs(first, timeZone);
}
