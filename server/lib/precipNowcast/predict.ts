import { seriesEvents } from './events';
import { SCHEMA_VERSION, type IntendedRegime, type PredictionLead, type PredictionRecord, type PredictorId } from './records';
import { RAIN_THRESHOLD_MM_HR, SCORE_LEADS_MIN, type ScoreLeadMin } from './thresholds';

export const PREDICTOR_VERSION: Record<PredictorId, string> = {
  persistence: 'persistence-1',
  'mrms-advection': 'mrms-advection-1',
  hrrr: 'hrrr-1',
  'open-meteo': 'open-meteo-1',
  'regional-motion': 'regional-motion-1',
  'regional-ensemble': 'regional-ensemble-1',
};

export type LeadInput = {
  leadMinutes: ScoreLeadMin;
  validAt: string;
  rateMmHr: number | null;
  /** Omit to store a deterministic 0/1 from the rate. Pass null to store no probability. */
  precipProbability?: number | null;
};

function deterministicProbability(rateMmHr: number | null): number | null {
  if (rateMmHr == null) return null;
  return rateMmHr > RAIN_THRESHOLD_MM_HR ? 1 : 0;
}

/**
 * Build a schema-1 prediction. Onset and ending come only from this
 * predictor's own rates, including its analysis, not from MRMS truth.
 */
export function predictionFromRates(args: {
  predictorId: PredictorId;
  issuedAt: string;
  latitude: number;
  longitude: number;
  caseId: string;
  intendedRegime: IntendedRegime;
  analysisValidAt: string;
  analysisRateMmHr: number | null;
  leads: readonly LeadInput[];
  diagnostics: Record<string, string | number | boolean | null>;
}): PredictionRecord {
  const byLead = new Map(args.leads.map((lead) => [lead.leadMinutes, lead]));
  const leads: PredictionLead[] = SCORE_LEADS_MIN.map((leadMinutes) => {
    const lead = byLead.get(leadMinutes);
    const rate = lead?.rateMmHr ?? null;
    const probability =
      lead && 'precipProbability' in lead && lead.precipProbability !== undefined
        ? lead.precipProbability
        : deterministicProbability(rate);
    return {
      leadMinutes,
      validAt: lead?.validAt ?? '',
      precipProbability: probability,
      expectedRainRateMmHr: rate,
    };
  });
  const events = seriesEvents(
    args.analysisRateMmHr,
    leads.map((lead) => ({ leadMinutes: lead.leadMinutes, rateMmHr: lead.expectedRainRateMmHr })),
    RAIN_THRESHOLD_MM_HR,
  );
  return {
    schemaVersion: SCHEMA_VERSION,
    recordType: 'prediction',
    predictorId: args.predictorId,
    predictorVersion: PREDICTOR_VERSION[args.predictorId],
    issuedAt: args.issuedAt,
    latitude: args.latitude,
    longitude: args.longitude,
    caseId: args.caseId,
    intendedRegime: args.intendedRegime,
    rainThresholdMmHr: RAIN_THRESHOLD_MM_HR,
    analysis: { validAt: args.analysisValidAt, rainRateMmHr: args.analysisRateMmHr },
    leads,
    onset: events.onset,
    ending: events.ending,
    diagnostics: args.diagnostics,
  };
}
