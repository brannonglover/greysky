import { seriesEvents, type RateLead } from './events';
import {
  SCHEMA_VERSION,
  type LeadScore,
  type ObservationRecord,
  type PredictionRecord,
  type Scorecard,
  type TimingScore,
} from './records';
import { RAIN_THRESHOLD_MM_HR, SCORE_LEADS_MIN, type ScoreLeadMin } from './thresholds';

function emptyLead(leadMinutes: ScoreLeadMin): LeadScore {
  return {
    leadMinutes,
    sampleCount: 0,
    scoredCount: 0,
    hits: 0,
    falseAlarms: 0,
    misses: 0,
    correctRejections: 0,
    brierScore: null,
    brierCount: 0,
    rainRateMae: null,
    rainRateCount: 0,
  };
}

function emptyTiming(): TimingScore {
  return { matched: 0, maeMinutes: null, unmatchedObserved: 0, unmatchedPredicted: 0 };
}

function obsKey(caseId: string, issuedAt: string, leadMinutes: number): string {
  return `${caseId}|${issuedAt}|${leadMinutes}`;
}

function isRain(rateMmHr: number, thresholdMmHr: number): boolean {
  return rateMmHr > thresholdMmHr;
}

function addTiming(score: TimingScore, predictedMinutes: number | null, observedMinutes: number | null): void {
  if (predictedMinutes == null && observedMinutes == null) return;
  if (predictedMinutes == null) {
    score.unmatchedObserved += 1;
    return;
  }
  if (observedMinutes == null) {
    score.unmatchedPredicted += 1;
    return;
  }
  score.matched += 1;
  const error = Math.abs(predictedMinutes - observedMinutes);
  score.maeMinutes = score.maeMinutes == null ? error : score.maeMinutes + error;
}

function finishTiming(score: TimingScore): void {
  if (score.matched > 0 && score.maeMinutes != null) {
    score.maeMinutes = score.maeMinutes / score.matched;
  }
}

/**
 * Score predictions against MRMS observations from the same issue time.
 * A null rate is skipped. It is not counted as dry.
 * Onset and ending are recomputed from stored rates so a later reader can
 * replay the rows without trusting a duplicated event field.
 */
export function scoreRecords(
  predictions: readonly PredictionRecord[],
  observations: readonly ObservationRecord[],
  thresholdMmHr: number = RAIN_THRESHOLD_MM_HR,
): Scorecard[] {
  const obs = new Map<string, ObservationRecord>();
  for (const row of observations) obs.set(obsKey(row.caseId, row.issuedAt, row.leadMinutes), row);

  const groups = new Map<string, PredictionRecord[]>();
  for (const row of predictions) {
    const key = `${row.predictorId}@${row.predictorVersion}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  return [...groups.values()].map((rows) => scoreGroup(rows, obs, thresholdMmHr));
}

function scoreGroup(
  rows: readonly PredictionRecord[],
  obs: Map<string, ObservationRecord>,
  thresholdMmHr: number,
): Scorecard {
  const first = rows[0];
  const leads = new Map<ScoreLeadMin, LeadScore>(SCORE_LEADS_MIN.map((lead) => [lead, emptyLead(lead)]));
  const brierSum = new Map<ScoreLeadMin, number>(SCORE_LEADS_MIN.map((lead) => [lead, 0]));
  const maeSum = new Map<ScoreLeadMin, number>(SCORE_LEADS_MIN.map((lead) => [lead, 0]));
  const onset = emptyTiming();
  const ending = emptyTiming();

  for (const prediction of rows) {
    const predicted = seriesEvents(
      prediction.analysis.rainRateMmHr,
      prediction.leads.map((lead) => ({ leadMinutes: lead.leadMinutes, rateMmHr: lead.expectedRainRateMmHr })),
      thresholdMmHr,
    );
    const observedLeads: RateLead[] = [];
    const analysis = obs.get(obsKey(prediction.caseId, prediction.issuedAt, 0));
    for (const lead of prediction.leads) {
      const truth = obs.get(obsKey(prediction.caseId, prediction.issuedAt, lead.leadMinutes));
      observedLeads.push({ leadMinutes: lead.leadMinutes, rateMmHr: truth?.rainRateMmHr ?? null });
      const bucket = leads.get(lead.leadMinutes);
      if (!bucket) continue;
      bucket.sampleCount += 1;
      if (lead.expectedRainRateMmHr == null || truth == null || truth.rainRateMmHr == null) continue;
      bucket.scoredCount += 1;
      const predRain = isRain(lead.expectedRainRateMmHr, thresholdMmHr);
      const obsRain = isRain(truth.rainRateMmHr, thresholdMmHr);
      if (predRain && obsRain) bucket.hits += 1;
      else if (predRain && !obsRain) bucket.falseAlarms += 1;
      else if (!predRain && obsRain) bucket.misses += 1;
      else bucket.correctRejections += 1;

      bucket.rainRateCount += 1;
      maeSum.set(lead.leadMinutes, (maeSum.get(lead.leadMinutes) ?? 0) + Math.abs(lead.expectedRainRateMmHr - truth.rainRateMmHr));

      if (lead.precipProbability != null && Number.isFinite(lead.precipProbability)) {
        const outcome = obsRain ? 1 : 0;
        brierSum.set(lead.leadMinutes, (brierSum.get(lead.leadMinutes) ?? 0) + (lead.precipProbability - outcome) ** 2);
        bucket.brierCount += 1;
      }
    }

    const observed = seriesEvents(analysis?.rainRateMmHr ?? null, observedLeads, thresholdMmHr);
    if (predicted.onset.applicable && observed.onset.applicable) {
      addTiming(onset, predicted.onset.minutes, observed.onset.minutes);
    }
    if (predicted.ending.applicable && observed.ending.applicable) {
      addTiming(ending, predicted.ending.minutes, observed.ending.minutes);
    }
  }

  finishTiming(onset);
  finishTiming(ending);

  return {
    schemaVersion: SCHEMA_VERSION,
    recordType: 'scorecard',
    predictorId: first.predictorId,
    predictorVersion: first.predictorVersion,
    rainThresholdMmHr: thresholdMmHr,
    leads: SCORE_LEADS_MIN.map((lead) => {
      const bucket = leads.get(lead) ?? emptyLead(lead);
      const brierCount = bucket.brierCount;
      const rateCount = bucket.rainRateCount;
      return {
        ...bucket,
        brierScore: brierCount > 0 ? (brierSum.get(lead) ?? 0) / brierCount : null,
        rainRateMae: rateCount > 0 ? (maeSum.get(lead) ?? 0) / rateCount : null,
      };
    }),
    onset,
    ending,
  };
}

function num(value: number | null, digits: number): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

/** Plain scoreboard. One block per predictor, metrics split by lead. */
export function formatScorecards(cards: readonly Scorecard[]): string {
  const lines: string[] = [];
  for (const card of cards) {
    lines.push(`${card.predictorId}@${card.predictorVersion}  threshold ${card.rainThresholdMmHr} mm/hr`);
    lines.push('lead  n  scored  hit  FA  miss  CR  Brier  MAE');
    for (const lead of card.leads) {
      lines.push(
        [
          String(lead.leadMinutes).padStart(4),
          String(lead.sampleCount).padStart(2),
          String(lead.scoredCount).padStart(6),
          String(lead.hits).padStart(4),
          String(lead.falseAlarms).padStart(3),
          String(lead.misses).padStart(5),
          String(lead.correctRejections).padStart(3),
          num(lead.brierScore, 3).padStart(6),
          num(lead.rainRateMae, 2).padStart(6),
        ].join(' '),
      );
    }
    lines.push(
      `onset   matched ${card.onset.matched}  mae ${num(card.onset.maeMinutes, 1)} min  unmatchedObs ${card.onset.unmatchedObserved}  unmatchedPred ${card.onset.unmatchedPredicted}`,
    );
    lines.push(
      `ending  matched ${card.ending.matched}  mae ${num(card.ending.maeMinutes, 1)} min  unmatchedObs ${card.ending.unmatchedObserved}  unmatchedPred ${card.ending.unmatchedPredicted}`,
    );
    lines.push('');
  }
  return lines.join('\n');
}
