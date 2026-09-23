/**
 * Ranking invariants for the Storms system.
 *
 * The impact scores in lib/stormImpact.ts are tuning constants with no
 * meteorological meaning, so the orderings that genuinely matter must not be
 * left to emerge from them. These assertions pin those orderings down, and are
 * deliberately written so that changing a constant cannot quietly break one.
 *
 * Run with: npx tsx scripts/ranking.test.ts
 */

import { rankStormItems, type StormItem } from '../lib/stormImpact';
import type { StormSignal } from '../lib/stormOutlook';
import type { DayOutlook } from '../lib/spc';
import type { TropicalReport } from '../lib/tropical';
import type { WeatherAlert } from '../lib/types';

const H = 3_600_000;
const now = Date.now();

let failures = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

function order(items: StormItem[]): string[] {
  return items.map((i) => i.key);
}

function indexOfSource(items: StormItem[], source: string): number {
  return items.findIndex((i) => i.source === source);
}

// --- builders --------------------------------------------------------------

function alert(event: string, severity: WeatherAlert['severity'], offsetH = -1): WeatherAlert {
  return {
    id: `${event}-${offsetH}`,
    event,
    headline: `${event} issued for your area`,
    description: '',
    severity,
    onset: new Date(now + offsetH * H).toISOString(),
  };
}

function outlook(day: 1 | 2 | 3, code: DayOutlook['categorical'], significant = false): DayOutlook {
  return {
    day,
    issued: now,
    validFrom: now + day * 24 * H,
    validTo: now + (day + 1) * 24 * H,
    categorical: code,
    tornado: significant ? { probability: 0.3, significant: true } : null,
    wind: null,
    hail: null,
    anySevere: null,
  };
}

function signal(severity: StormSignal['severity'], startOffsetH: number): StormSignal {
  return {
    kind: 'thunderstorm',
    severity,
    startsAt: now + startOffsetH * H,
    startsAtIso: new Date(now + startOffsetH * H).toISOString(),
    endsAt: now + (startOffsetH + 2) * H,
    hours: 2,
    headline: severity === 'severe' ? 'Strong storms possible' : 'Storms possible',
    peakGustKmh: 70,
    peakRainMm: 5,
  };
}

function tropical(
  id: string,
  strength: 'ts' | 'strong-ts' | 'hurricane' | null,
  startOffsetH: number,
  maxWindKt = 90,
): TropicalReport {
  return {
    storm: {
      id, name: id, classification: 'HU', latitude: 25, longitude: -80,
      maxWindKt, pressureMb: 950, movementDir: 315, movementSpeedKt: 12,
      lastUpdate: now, advisoryNumber: '1', advisoryUrl: null,
      trackAvailable: true, track: [],
    },
    threat: {
      distanceKm: 500,
      bearing: 180,
      exposure: strength
        ? { startsAt: now + startOffsetH * H, endsAt: now + (startOffsetH + 12) * H,
            strength, peakWindKt: maxWindKt, fromOutlook: false }
        : null,
      closest: { distanceKm: 200, time: now + startOffsetH * H, maxWindKt },
    },
  };
}

const EMPTY = { alerts: [], signals: [], tropical: [] };

// --- invariant 1 -----------------------------------------------------------

console.log('\ninvariant: an active official warning outranks all outlook and forecast information');
{
  // The adversarial case. SPC High Risk scores 88, an NWS warning scores 80,
  // so on score alone the outlook would win. Tier precedence must prevent it.
  const items = rankStormItems({
    ...EMPTY,
    alerts: [alert('Tornado Warning', 'Severe', -1)],
    outlooks: [outlook(1, { code: 'HIGH', label: 'High Risk' }, true)],
  });

  check('warning sorts first despite the outlook scoring higher', items[0]?.source === 'nws',
    `got ${order(items).join(' > ')}`);
  check('the outlook really does outscore the warning (so this is a real test)',
    (items.find((i) => i.source === 'spc')?.impact ?? 0) > (items.find((i) => i.source === 'nws')?.impact ?? 0));
  check('warning is in the active tier', items[0]?.tier === 'active');
  check('outlook is in the incoming tier', items.find((i) => i.source === 'spc')?.tier === 'incoming');
}

{
  // Same check against every other stage, so no source can sneak above it.
  const items = rankStormItems({
    alerts: [alert('Tornado Warning', 'Severe', -1)],
    outlooks: [outlook(1, { code: 'HIGH', label: 'High Risk' }, true)],
    signals: [signal('severe', 2)],
    tropical: [tropical('Imelda', 'hurricane', 6, 115)],
    regional: [{ alert: alert('Tornado Warning', 'Extreme', -2), state: 'AL', distanceKm: 300 }],
  });
  check('warning still first with every source present', items[0]?.source === 'nws',
    `got ${order(items).join(' > ')}`);
  check('and an Extreme regional alert cannot displace it', items[0]?.source !== 'regional');
}

// --- invariant 2 -----------------------------------------------------------

console.log('\ninvariant: active > incoming > tracking, unconditionally');
{
  const items = rankStormItems({
    alerts: [alert('Flood Advisory', 'Minor', -1)],
    outlooks: [outlook(1, { code: 'HIGH', label: 'High Risk' }, true)],
    signals: [signal('severe', 3)],
    tropical: [tropical('Distant', null, 0, 125)],
    regional: [{ alert: alert('Tornado Warning', 'Extreme', -2), state: 'AL', distanceKm: 100 }],
  });

  const tiers = items.map((i) => i.tier);
  const rank = { active: 0, incoming: 1, tracking: 2 } as const;
  check('tiers are non-decreasing through the list',
    tiers.every((t, i) => i === 0 || rank[tiers[i - 1]] <= rank[t]), tiers.join(' > '));

  // A Minor advisory in effect scores 40, far below the High Risk at 88+.
  check('a low-impact active item still precedes a high-impact incoming one',
    items[0]?.tier === 'active' && items[0]?.impact < (items.find((i) => i.source === 'spc')?.impact ?? 0));
}

// --- invariant 3 -----------------------------------------------------------

console.log('\ninvariant: a regional alert never leaves the tracking tier');
{
  for (const severity of ['Extreme', 'Severe', 'Moderate', 'Minor'] as const) {
    const items = rankStormItems({
      ...EMPTY,
      regional: [{ alert: alert('Tornado Warning', severity, -3), state: 'AL', distanceKm: 50 }],
    });
    check(`${severity} regional alert stays in tracking`, items[0]?.tier === 'tracking');
  }

  const mixed = rankStormItems({
    ...EMPTY,
    signals: [signal('strong', 20)],
    regional: [{ alert: alert('Tornado Warning', 'Extreme', -3), state: 'AL', distanceKm: 50 }],
  });
  check('a mild local forecast signal still outranks an extreme regional alert',
    indexOfSource(mixed, 'forecast') < indexOfSource(mixed, 'regional'));
}

// --- invariant 4 -----------------------------------------------------------

console.log('\nordering within the incoming tier is by impact, then onset');
{
  const items = rankStormItems({
    ...EMPTY,
    outlooks: [outlook(1, { code: 'HIGH', label: 'High Risk' })],
    signals: [signal('strong', 4)],
  });
  check('SPC High Risk outranks a derived "storms possible"',
    indexOfSource(items, 'spc') < indexOfSource(items, 'forecast'));
}

{
  const items = rankStormItems({
    ...EMPTY,
    outlooks: [outlook(3, { code: 'MRGL', label: 'Marginal Risk' })],
    signals: [signal('severe', 4)],
  });
  check('a derived severe signal outranks a distant Marginal outlook',
    indexOfSource(items, 'forecast') < indexOfSource(items, 'spc'));
}

{
  const items = rankStormItems({
    ...EMPTY,
    outlooks: [
      outlook(3, { code: 'ENH', label: 'Enhanced Risk' }),
      outlook(1, { code: 'ENH', label: 'Enhanced Risk' }),
    ],
  });
  check('the nearer day sorts first at equal category',
    (items[0] as Extract<StormItem, { source: 'spc' }>).outlook.day === 1);
}

{
  // Phase-one regression: impact beats source, and beats onset.
  const items = rankStormItems({
    ...EMPTY,
    signals: [signal('strong', 14)],
    tropical: [tropical('Imelda', 'hurricane', 6, 115), tropical('Polo', null, 0, 125)],
  });
  check('hurricane exposure in 6h outranks a moderate derived signal at 14h',
    indexOfSource(items, 'tropical') < indexOfSource(items, 'forecast'));
  check('the no-exposure hurricane drops to tracking',
    items.find((i) => i.key === 'tropical:Polo')?.tier === 'tracking');
  check('and therefore sorts below the local derived signal',
    items.findIndex((i) => i.key === 'tropical:Polo') > indexOfSource(items, 'forecast'));
}

// --- invariant 5 -----------------------------------------------------------

console.log('\nstages are assigned correctly');
{
  const items = rankStormItems({
    alerts: [alert('Tornado Warning', 'Severe', -1), alert('Tornado Watch', 'Severe', -2)],
    outlooks: [outlook(2, { code: 'ENH', label: 'Enhanced Risk' })],
    signals: [signal('severe', 5)],
    tropical: [],
  });
  const stageOf = (event: string) =>
    items.find((i) => (i.source === 'nws' ? i.alert.event === event : false))?.stage;

  check('warning stage', stageOf('Tornado Warning') === 'warning');
  check('watch stage', stageOf('Tornado Watch') === 'watch');
  check('outlook stage', items.find((i) => i.source === 'spc')?.stage === 'outlook');
  check('forecast stage', items.find((i) => i.source === 'forecast')?.stage === 'forecast');
  check('the full progression is present', new Set(items.map((i) => i.stage)).size === 4);
}

{
  // A watch that has not begun is something coming, not something happening.
  const future = rankStormItems({ ...EMPTY, alerts: [alert('Tornado Watch', 'Severe', +3)] });
  check('a not-yet-started watch is incoming, not active', future[0]?.tier === 'incoming');

  const current = rankStormItems({ ...EMPTY, alerts: [alert('Tornado Watch', 'Severe', -1)] });
  check('a watch already in effect is active', current[0]?.tier === 'active');
}

// ---------------------------------------------------------------------------

if (failures > 0) {
  console.error(`\n${failures} invariant check(s) failed\n`);
  process.exit(1);
}
console.log('\nall ranking invariants hold\n');
