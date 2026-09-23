/**
 * Live format check against SPC. Informational, not a test — it confirms the
 * real products still look the way the parser expects, and reports the risk at
 * a spread of probe points.
 *
 * Regression coverage lives in spc.test.ts, against fixtures, so this being
 * quiet out of season costs nothing.
 */

import { loadProducts, outlookAt, type ProductSet } from '../lib/spc';

const PROBES: { name: string; lat: number; lon: number }[] = [
  { name: 'Oklahoma City, OK', lat: 35.47, lon: -97.52 },
  { name: 'Dallas, TX', lat: 32.78, lon: -96.8 },
  { name: 'Kansas City, MO', lat: 39.1, lon: -94.58 },
  { name: 'Atlanta, GA', lat: 33.75, lon: -84.39 },
  { name: 'Birmingham, AL', lat: 33.52, lon: -86.81 },
  { name: 'Chicago, IL', lat: 41.88, lon: -87.63 },
  { name: 'Seattle, WA', lat: 47.61, lon: -122.33 },
];

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

async function main() {
  const now = Date.now();
  const products = await loadProducts(now);

  console.log('\nproduct freshness');
  for (const day of [1, 2, 3] as const) {
    const set: ProductSet = products[day] ?? {};
    const entries = Object.entries(set) as [keyof ProductSet, any][];
    if (entries.length === 0) {
      console.log(`  day ${day}: no products returned`);
      continue;
    }
    const parts = entries.map(([kind, doc]) => {
      const p = doc.features?.[0]?.properties;
      const expire = String(p?.EXPIRE ?? '');
      const stale = expire.length === 12 &&
        Date.UTC(+expire.slice(0, 4), +expire.slice(4, 6) - 1, +expire.slice(6, 8), +expire.slice(8, 10), +expire.slice(10, 12)) < now;
      return `${kind}${stale ? ' (STALE, ignored)' : ''}`;
    });
    console.log(`  day ${day}: ${parts.join(', ')}`);
  }

  console.log('\nrisk at probe points');
  let anyRisk = false;
  for (const probe of PROBES) {
    const lines: string[] = [];
    for (const day of [1, 2, 3] as const) {
      const outlook = outlookAt(day, products[day] ?? {}, probe.lon, probe.lat, now);
      if (!outlook) continue;
      anyRisk = true;
      const bits: string[] = [];
      if (outlook.categorical) bits.push(outlook.categorical.label);
      if (outlook.tornado) bits.push(`tor ${pct(outlook.tornado.probability)}${outlook.tornado.significant ? ' hatched' : ''}`);
      if (outlook.wind) bits.push(`wind ${pct(outlook.wind.probability)}${outlook.wind.significant ? ' hatched' : ''}`);
      if (outlook.hail) bits.push(`hail ${pct(outlook.hail.probability)}${outlook.hail.significant ? ' hatched' : ''}`);
      if (outlook.anySevere) bits.push(`any severe ${pct(outlook.anySevere.probability)}`);
      lines.push(`      day ${day}: ${bits.join(' · ')}`);
    }
    console.log(`  ${probe.name}`);
    console.log(lines.length ? lines.join('\n') : '      no severe risk');
  }

  if (!anyRisk) {
    console.log('\nNo severe risk at any probe point. Normal on a quiet day —');
    console.log('the parser is covered by fixtures, not by this script.\n');
  } else {
    console.log('');
  }
}

main().catch((error) => {
  console.error('\nLive check failed:', error instanceof Error ? error.message : error, '\n');
  process.exit(1);
});
