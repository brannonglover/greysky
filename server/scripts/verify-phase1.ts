/** Phase 1 verification: builds both manifests in-process against live NOAA. */
import { createRadarService } from '../lib/radar/registry';

const ORIGIN = 'https://grey-sky-radar.vercel.app';

function downgrade(m: Awaited<ReturnType<ReturnType<typeof createRadarService>['getManifest']>>) {
  return {
    generated: m.generated,
    window: m.window,
    legend: m.legend,
    frames: m.frames.map((f) => {
      const base = { time: f.timestamp, kind: f.kind === 'observed' ? 'observed' : 'forecast' };
      return f.source.kind === 'wms'
        ? { ...base, wms: { url: f.source.url, params: f.source.params } }
        : { ...base, urlTemplate: f.source.urlTemplate };
    }),
  };
}

(async () => {
  const now = Math.round(Date.now() / 1000);
  const t0 = Date.now();
  const m = await createRadarService('default').getManifest({
    now, origin: ORIGIN, pastMin: 60, futureMin: 60,
    observedCadenceSec: 300, futureCadenceSec: 300,
  });
  console.log(`built in ${Date.now() - t0}ms`);

  const kinds: Record<string, number> = {};
  const providers: Record<string, number> = {};
  for (const f of m.frames) {
    kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
    providers[f.providerId] = (providers[f.providerId] ?? 0) + 1;
  }
  const hhmm = (t: number) => new Date(t * 1000).toISOString().slice(11, 16);

  console.log('\n--- v2 manifest ---');
  console.log('version        ', m.version);
  console.log('frames         ', m.frames.length, kinds);
  console.log('providers      ', providers);
  console.log('range          ', hhmm(m.frames[0].timestamp), '->', hhmm(m.frames.at(-1)!.timestamp));
  console.log('observedThrough', m.observedThrough ? hhmm(m.observedThrough) : null,
    m.observedThrough ? `(${((now - m.observedThrough) / 60).toFixed(1)} min behind now)` : '');
  console.log('attribution    ', m.attribution);
  console.log('legend stops   ', m.legend.length);

  const sourceKinds = new Set(m.frames.map((f) => f.source.kind));
  console.log('transports     ', [...sourceKinds]);

  // Ordering + uniqueness invariants the timeline relies on.
  const times = m.frames.map((f) => f.timestamp);
  console.log('sorted         ', times.every((t, i) => i === 0 || t >= times[i - 1]));
  console.log('unique times   ', new Set(times).size === times.length);
  console.log('unique ids     ', new Set(m.frames.map((f) => f.id)).size === m.frames.length);
  console.log('within window  ', times.every((t) => t >= now - 3600 - 300 && t <= now + 3600));

  console.log('\n--- v1 downgrade vs live deployed v1 ---');
  const v1 = downgrade(m);
  const live = (await fetch(`${ORIGIN}/api/radar/frames`).then((r) => r.json())) as any;
  const keysOf = (o: object) => Object.keys(o).sort().join(',');
  console.log('top-level keys  new:', keysOf(v1), '| live:', keysOf(live));
  const nObs = v1.frames.find((f) => f.kind === 'observed')!;
  const lObs = live.frames.find((f: any) => f.kind === 'observed');
  const nFc = v1.frames.find((f) => f.kind === 'forecast')!;
  const lFc = live.frames.find((f: any) => f.kind === 'forecast');
  console.log('observed keys   new:', keysOf(nObs), '| live:', keysOf(lObs));
  console.log('  wms params    new:', keysOf((nObs as any).wms.params), '| live:', keysOf(lObs.wms.params));
  console.log('forecast keys   new:', keysOf(nFc), '| live:', keysOf(lFc));
  const strip = (u: string) => u.replace(/([?&])(t|minute|from|to|run|time|obs|u|v|lead)=[^&]*/g, '$1$2=');
  console.log('  url shape     new:', strip((nFc as any).urlTemplate));
  console.log('  url shape    live:', strip(lFc.urlTemplate));
  console.log('  SHAPE MATCH   ', strip((nFc as any).urlTemplate) === strip(lFc.urlTemplate));
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
