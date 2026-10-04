/**
 * Fill verifying MRMS samples into an existing case.
 * A lead whose frame is not available yet, or has rolled off, stays null.
 * Null is not written as 0 mm/hr.
 */
import { listBundleDirs, readCase, writeCase } from './caseFile';
import { nearestIso, sampleMrmsPoint } from './mrmsPoint';
import { SCORE_LEADS_MIN } from './thresholds';
import { verificationState } from './verify';

export async function fillOpenVerification(times: readonly string[], nowMs: number): Promise<{ bundles: number; leads: number }> {
  let bundles = 0;
  let leads = 0;
  for (const dir of listBundleDirs()) {
    const bundle = readCase(dir);
    if (verificationState(bundle) === 'verified') continue;
    let changed = false;
    for (const point of bundle.points) {
      if (!point.verification) continue;
      for (const leadMinutes of [0, ...SCORE_LEADS_MIN]) {
        const row = point.verification.leads.find((lead) => lead.leadMinutes === leadMinutes);
        if (!row || row.rainRateMmHr != null) continue;
        const target = Date.parse(bundle.observationTime) + leadMinutes * 60_000;
        if (!Number.isFinite(target) || target > nowMs) continue;
        const iso = nearestIso(times, target, 4 * 60_000);
        if (!iso) continue;
        const sample = await sampleMrmsPoint(iso, point.latitude, point.longitude).catch(() => ({ rainRateMmHr: null, dbz: null }));
        if (sample.rainRateMmHr == null) continue;
        row.rainRateMmHr = sample.rainRateMmHr;
        row.dbz = sample.dbz;
        row.validAt = iso;
        changed = true;
        leads += 1;
      }
    }
    if (changed) {
      writeCase(dir, bundle);
      bundles += 1;
    }
  }
  return { bundles, leads };
}
