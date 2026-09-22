/**
 * Transition instrumentation.
 *
 * Measures what the caching decision needs: how many distinct blended tile
 * URLs a manifest produces, what they cost cold, what they cost warm, and how
 * that compares with the pure nowcast and pure HRRR tiles either side of them.
 */
import { gridForRunMinute } from '../lib/gridCache';
import { createRadarService } from '../lib/radar/registry';
import { renderTile } from '../lib/render';
import { renderTransitionTile, type HrrrSide } from '../lib/transitionTile';

const ORIGIN = process.env.RADAR_API ?? 'https://grey-sky-radar.vercel.app';
/** Atlanta at z7, plus its z6 parent, so both zooms are represented. */
const TILES: Array<[number, number, number]> = [
  [7, 33, 51],
  [6, 16, 25],
];

function hhmm(t: number): string {
  return new Date(t * 1000).toISOString().slice(11, 16);
}

async function timeFetch(url: string): Promise<{ ms: number; bytes: number; status: number; timing?: string }> {
  const started = Date.now();
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return {
    ms: Date.now() - started,
    bytes: buf.byteLength,
    status: res.status,
    timing: res.headers.get('server-timing') ?? undefined,
  };
}

(async () => {
  const now = Math.round(Date.now() / 1000);
  const t0 = Date.now();
  const manifest = await createRadarService('default').getManifest({
    now,
    origin: ORIGIN,
    pastMin: 60,
    futureMin: 60,
    observedCadenceSec: 300,
    futureCadenceSec: 300,
  });
  console.log(`manifest built in ${Date.now() - t0}ms\n`);

  const counts: Record<string, number> = {};
  for (const f of manifest.frames) {
    const key = f.blend ? 'blend' : f.kind;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  console.log('frame composition:', counts);
  console.log('observedThrough  :', manifest.observedThrough ? hhmm(manifest.observedThrough) : null);
  console.log('attribution      :', manifest.attribution.join(' | '));
  console.log();

  const pad = (v: string | number, n: number) => String(v).padStart(n);

  console.log('future timeline:');
  console.log(`${pad('valid', 7)} ${pad('lead', 6)} ${pad('kind', 9)} ${pad('nowcast', 8)} ${pad('hrrr', 6)}  provider`);
  for (const f of manifest.frames.filter((x) => x.kind !== 'observed')) {
    const b = f.blend;
    const nw = b ? b.nowcastWeight.toFixed(2) : f.kind === 'nowcast' ? '1.00' : '0.00';
    const fw = b ? b.forecastWeight.toFixed(2) : f.kind === 'forecast' ? '1.00' : '0.00';
    console.log(
      `${pad(hhmm(f.timestamp), 7)} ${pad(`${f.leadMinutes ?? ''}m`, 6)} ${pad(f.kind, 9)}` +
        ` ${pad(nw, 8)} ${pad(fw, 6)}  ${f.providerId}`,
    );
  }

  const blends = manifest.frames.filter((f) => f.blend);
  const pureNow = manifest.frames.filter((f) => !f.blend && f.kind === 'nowcast');
  const pureFc = manifest.frames.filter((f) => !f.blend && f.kind === 'forecast');

  const urlsFor = (frames: typeof manifest.frames) =>
    frames.flatMap((f) =>
      f.source.kind === 'xyz'
        ? TILES.map(([z, x, y]) =>
            f.source.kind === 'xyz'
              ? f.source.urlTemplate.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
              : '',
          )
        : [],
    );

  const blendUrls = urlsFor(blends);
  console.log(`\nunique blended tile URLs for ${TILES.length} tiles: ${new Set(blendUrls).size}`);
  console.log(`  => per additional tile on screen: ${blends.length} more URLs`);
  console.log(`  a z7 viewport pulls ~12-20 tiles, so ~${blends.length * 16} blended URLs per viewport-loop\n`);

  const sample = async (label: string, frames: typeof manifest.frames) => {
    const urls = urlsFor(frames).slice(0, 2);
    if (urls.length === 0) return console.log(`${label}: none`);
    for (const url of urls) {
      const cold = await timeFetch(url);
      const warm = await timeFetch(url);
      console.log(
        `${String(label).padStart(14)}  cold ${String(`${cold.ms}ms`).padStart(8)}` +
          `  warm ${String(`${warm.ms}ms`).padStart(7)}  ${cold.bytes}B  http=${cold.status}` +
          (cold.timing ? `  [${cold.timing}]` : ''),
      );
    }
  };

  // ---- in-process compute, isolated from network/CDN ----
  console.log('in-process render cost (z7 over Atlanta):');
  const [Z, X, Y] = TILES[0];
  const blendFrame = blends[Math.floor(blends.length / 2)];
  if (blendFrame && blendFrame.source.kind === 'xyz') {
    const q = new URL(blendFrame.source.urlTemplate).searchParams;
    const run = q.get('f_run')!;
    const side: HrrrSide = q.get('f_minute')
      ? { grid: await gridForRunMinute(run, Number(q.get('f_minute'))) }
      : {
          from: await gridForRunMinute(run, Number(q.get('f_from'))),
          to: await gridForRunMinute(run, Number(q.get('f_to'))),
          t: Number(q.get('f_t')),
        };

    // Warm the cached CONUS nowcast image and HRRR grids first, so the numbers
    // below measure rendering rather than one-off source fetches.
    const warmStart = Date.now();
    await renderTransitionTile(
      { isoTime: q.get('n_obs')!, u: Number(q.get('n_u')), v: Number(q.get('n_v')), leadMin: Number(q.get('n_lead')) },
      side, Number(q.get('w')), Z, X, Y,
    );
    console.log(`  blended  first (sources cold): ${Date.now() - warmStart}ms`);

    const t1 = Date.now();
    for (let i = 0; i < 5; i += 1) {
      await renderTransitionTile(
        { isoTime: q.get('n_obs')!, u: Number(q.get('n_u')), v: Number(q.get('n_v')), leadMin: Number(q.get('n_lead')) },
        side, Number(q.get('w')), Z, X, Y,
      );
    }
    console.log(`  blended  per tile (sources warm): ${((Date.now() - t1) / 5).toFixed(0)}ms`);

    const grid = 'grid' in side ? side.grid : side.from;
    const t2 = Date.now();
    for (let i = 0; i < 5; i += 1) renderTile(grid, Z, X, Y);
    console.log(`  pure HRRR per tile (grid warm): ${((Date.now() - t2) / 5).toFixed(0)}ms`);
  }

  console.log('\nnetwork timings (cold = first request, warm = repeat / CDN):');
  await sample('pure nowcast', pureNow);
  await sample('blended', blends);
  await sample('pure HRRR', pureFc);
})().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
