/**
 * Neighborhood comparison on the Phase 3 wet points.
 * A missing frame is reported. It is not filled in.
 */
import { observedTimes } from '../lib/mrms';
import { ensembleFromHistory } from '../lib/precipNowcast/ensemble';
import { loadRegionalHistory } from '../lib/precipNowcast/history';
import { nearestIso, sampleMrmsPoint } from '../lib/precipNowcast/mrmsPoint';
import { rateMeets } from '../lib/precipNowcast/point';
import {
  POINT,
  POINT_THRESHOLDS,
  assemblePoint,
  clearRegionCache,
  eventDistributions,
  getRegion,
  regionCacheBytes,
  sampleMembers,
  scorePointMinutes,
  type MemberSeries,
  type PointNowcast,
} from '../lib/precipNowcast/point';
import { SCORE_LEADS_MIN } from '../lib/precipNowcast/thresholds';

const RADII = [0, 2, 3, 5];
const CASES = [
  { id: 'atlanta-30345', latitude: 33.8513, longitude: -84.287, issue: '2026-10-04T12:12:41.000Z' },
  { id: 'atlanta-30345', latitude: 33.8513, longitude: -84.287, issue: '2026-10-04T12:46:40.000Z' },
  { id: 'marietta', latitude: 33.9526, longitude: -84.5499, issue: '2026-10-04T12:46:40.000Z' },
  { id: 'atlanta-downtown', latitude: 33.749, longitude: -84.388, issue: '2026-10-04T12:46:40.000Z' },
];

function num(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function observedLabel(obs: { leadMinutes: number; rainRateMmHr: number | null }[], thresholdMmHr: number): string {
  const analysis = obs.find((row) => row.leadMinutes === 0)?.rainRateMmHr;
  if (analysis != null && rateMeets(analysis, thresholdMmHr)) return 'already';
  const later = obs.find((row) => row.leadMinutes > 0 && row.rainRateMmHr != null && rateMeets(row.rainRateMmHr, thresholdMmHr));
  return later ? `by +${later.leadMinutes}` : 'none in horizon';
}

async function observations(issueMs: number, latitude: number, longitude: number, times: readonly string[]) {
  const rows = [];
  for (const leadMinutes of [0, ...SCORE_LEADS_MIN]) {
    const iso = nearestIso(times, issueMs + leadMinutes * 60_000, 4 * 60_000);
    if (!iso) {
      rows.push({ leadMinutes, rainRateMmHr: null });
      continue;
    }
    const sample = await sampleMrmsPoint(iso, latitude, longitude).catch(() => ({ rainRateMmHr: null }));
    rows.push({ leadMinutes, rainRateMmHr: sample.rainRateMmHr });
  }
  return rows;
}

function printProduct(label: string, product: PointNowcast, obs: { leadMinutes: number; rainRateMmHr: number | null }[]) {
  const bytes = Buffer.byteLength(JSON.stringify(product));
  console.log(`\n${label} radius=${product.neighborhood.radiusKm} cache=${product.diagnostics.cache} sampleMs=${product.diagnostics.sampleMs} bytes=${bytes}`);
  console.log(`  confidence=${product.confidence} event=${product.eventThresholdMmHr} onsetP=${num(product.onset.probability)} already=${num(product.onset.alreadyRainingProbability)} onset p10/p50/p90=${num(product.onset.p10Minutes, 0)}/${num(product.onset.p50Minutes, 0)}/${num(product.onset.p90Minutes, 0)}`);
  const moderate = product.thresholds.moderate;
  console.log(`  ending supported=${product.ending.supported} P=${num(product.ending.probability)} p10/p50/p90=${num(product.ending.p10Minutes, 0)}/${num(product.ending.p50Minutes, 0)}/${num(product.ending.p90Minutes, 0)}`);
  console.log(`  moderate onset P=${num(moderate.onset.probability)} already=${num(moderate.onset.alreadyRainingProbability)} p50=${num(moderate.onset.p50Minutes, 0)} ending P=${num(moderate.ending.probability)} p50=${num(moderate.ending.p50Minutes, 0)}`);
  for (const lead of SCORE_LEADS_MIN) {
    const minute = product.minutes.find((row) => row.minute === lead);
    const seen = obs.find((row) => row.leadMinutes === lead)?.rainRateMmHr ?? null;
    if (!minute) continue;
    console.log(
      `  +${lead} obs=${num(seen)} mean=${num(minute.expectedRainRateMmHr)} p10=${num(minute.p10MmHr)} p50=${num(minute.p50MmHr)} p90=${num(minute.p90MmHr)} Ptrace=${num(minute.probability.trace)} Plight=${num(minute.probability.light)} Pmod=${num(minute.probability.moderate)} Pheavy=${num(minute.probability.heavy)}`,
    );
  }
  for (const threshold of POINT_THRESHOLDS) {
    const scored = scorePointMinutes(product.minutes, obs.filter((row) => row.leadMinutes > 0), threshold);
    const brier = scored.leads.map((lead) => (lead.brier == null ? '—' : lead.brier.toFixed(3))).join(' ');
    const hits = scored.leads.reduce((sum, lead) => sum + lead.hit, 0);
    const misses = scored.leads.reduce((sum, lead) => sum + lead.miss, 0);
    const falseAlarms = scored.leads.reduce((sum, lead) => sum + lead.falseAlarm, 0);
    const correct = scored.leads.reduce((sum, lead) => sum + lead.correctRejection, 0);
    const covered = scored.leads.filter((lead) => lead.insideP10P90 === true).length;
    const inner = scored.leads.filter((lead) => lead.insideP25P75 === true).length;
    const comparable = scored.leads.filter((lead) => lead.insideP10P90 != null).length;
    const mae = scored.leads.filter((lead) => lead.absError != null).map((lead) => lead.absError as number);
    const maeMean = mae.length ? mae.reduce((sum, value) => sum + value, 0) / mae.length : null;
    console.log(`  ${threshold.id} hits=${hits} miss=${misses} fa=${falseAlarms} cr=${correct} brier=[${brier}] p10-p90=${covered}/${comparable} p25-p75=${inner}/${comparable} mae=${num(maeMean)}`);
  }
}

function printEnding(series: MemberSeries[], threshold: number) {
  const parts = [6, 8, 10].map((dry) => {
    const events = eventDistributions(series, threshold, dry);
    return `${dry}m P=${num(events.ending.probability)} p50=${num(events.ending.p50Minutes, 0)}`;
  });
  console.log(`  ending dry-persistence @ ${threshold}: ${parts.join(' | ')}`);
}

async function main() {
  const times = await observedTimes();
  const newest = times[times.length - 1];
  const oldest = times[0];
  console.log(`MRMS window ${oldest} .. ${newest} (${times.length} frames)`);
  clearRegionCache();
  let cold = true;
  for (const item of CASES) {
    const issuedAtMs = Date.parse(item.issue);
    const loaded = await getRegion(item.latitude, item.longitude, issuedAtMs, times);
    if (!loaded.region) {
      console.log(`\n${item.id} ${item.issue}: ${loaded.error}`);
      continue;
    }
    const obs = await observations(Date.parse(loaded.region.observationTime), item.latitude, item.longitude, times);
    const lightOnset = observedLabel(obs, 0.6);
    const moderateOnset = observedLabel(obs, 2.5);
    console.log(`\n== ${item.id} issue ${loaded.region.observationTime} obs0=${num(obs[0]?.rainRateMmHr)} region=${loaded.region.key} buildMs=${loaded.region.buildMs} cache=${loaded.cache} ==`);
    console.log(`observed light onset ${lightOnset}; moderate onset ${moderateOnset}`);
    const centered = await loadRegionalHistory(item.latitude, item.longitude, Date.parse(loaded.region.observationTime), times);
    const centeredForecast = ensembleFromHistory(centered, {
      latitude: item.latitude,
      longitude: item.longitude,
      issuedAtMs: Date.parse(loaded.region.observationTime),
    });
    console.log(
      `point-centered ensemble mean ${centeredForecast.leads.map((lead) => num(lead.expectedRainRateMmHr)).join(' ')} p90 ${centeredForecast.leads.map((lead) => num(lead.p90MmHr)).join(' ')}`,
    );
    if (cold) {
      console.log(`cold region build ${loaded.region.buildMs} ms, motion ${loaded.region.motionMs} ms, evolution ${loaded.region.evolutionMs} ms, estimated ${loaded.region.estimatedBytes} bytes`);
      cold = false;
    }
    let shared: MemberSeries[] | null = null;
    for (const radiusKm of RADII) {
      const sampled = sampleMembers(loaded.region, item.latitude, item.longitude, radiusKm);
      if (radiusKm === POINT.defaultRadiusKm) shared = sampled.series;
      const product = assemblePoint({
        region: loaded.region,
        latitude: item.latitude,
        longitude: item.longitude,
        radiusKm,
        eventThresholdMmHr: POINT.eventThresholdMmHr,
        endingDryMin: POINT.endingDryMin,
        series: sampled.series,
        sampleMs: sampled.sampleMs,
        cache: loaded.cache,
      });
      printProduct(`${item.id}`, product, obs);
    }
    if (shared) {
      printEnding(shared, 0.6);
      printEnding(shared, 2.5);
    }
    const warmStarted = Date.now();
    const warm = await getRegion(item.latitude, item.longitude, issuedAtMs, times);
    const warmSample = warm.region ? sampleMembers(warm.region, item.latitude, item.longitude, POINT.defaultRadiusKm) : null;
    console.log(`warm request ${Date.now() - warmStarted} ms cache=${warm.cache} sampleMs=${warmSample?.sampleMs ?? '—'} cacheBytes=${regionCacheBytes()}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
