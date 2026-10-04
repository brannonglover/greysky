import { SCORE_LEADS_MIN, type ScoreLeadMin } from './thresholds';

export const SCHEMA_VERSION = 1 as const;

export type PredictorId = 'persistence' | 'mrms-advection' | 'hrrr' | 'open-meteo' | 'regional-motion' | 'regional-ensemble';

export type IntendedRegime = 'dry' | 'widespread' | 'isolated' | 'convective';

export type TimedEvent = {
  /** False when the analysis or a gap makes the question unanswerable. */
  applicable: boolean;
  /** Null when the question applies and the event does not occur in the horizon. */
  minutes: number | null;
};

export type PredictionLead = {
  leadMinutes: ScoreLeadMin;
  /** Mathematical valid time, issue plus lead. Not the MRMS frame that verified it. */
  validAt: string;
  /** 0–1. Null when this predictor had no probability. Never invent one at score time. */
  precipProbability: number | null;
  /** Null means the predictor did not produce a rate. It does not mean dry. */
  expectedRainRateMmHr: number | null;
};

export type PredictionRecord = {
  schemaVersion: typeof SCHEMA_VERSION;
  recordType: 'prediction';
  predictorId: PredictorId;
  predictorVersion: string;
  issuedAt: string;
  latitude: number;
  longitude: number;
  caseId: string;
  intendedRegime: IntendedRegime;
  rainThresholdMmHr: number;
  /** Predictor's own rate at issue time. Onset and ending are computed from this plus `leads`. */
  analysis: {
    validAt: string;
    rainRateMmHr: number | null;
  };
  leads: PredictionLead[];
  onset: TimedEvent;
  ending: TimedEvent;
  diagnostics: Record<string, string | number | boolean | null>;
};

export type ObservationRecord = {
  schemaVersion: typeof SCHEMA_VERSION;
  recordType: 'observation';
  source: 'mrms-cref-qcd';
  caseId: string;
  issuedAt: string;
  /** 0 is the analysis. Other values are SCORE_LEADS_MIN. */
  leadMinutes: number;
  /** Actual MRMS frame time used as truth. */
  validAt: string;
  latitude: number;
  longitude: number;
  dbz: number | null;
  /** Null only when the sample failed. A successful empty echo is 0. */
  rainRateMmHr: number | null;
};

export type LeadScore = {
  leadMinutes: ScoreLeadMin;
  sampleCount: number;
  scoredCount: number;
  hits: number;
  falseAlarms: number;
  misses: number;
  correctRejections: number;
  brierScore: number | null;
  brierCount: number;
  rainRateMae: number | null;
  rainRateCount: number;
};

export type TimingScore = {
  matched: number;
  maeMinutes: number | null;
  unmatchedObserved: number;
  unmatchedPredicted: number;
};

export type Scorecard = {
  schemaVersion: typeof SCHEMA_VERSION;
  recordType: 'scorecard';
  predictorId: PredictorId;
  predictorVersion: string;
  rainThresholdMmHr: number;
  leads: LeadScore[];
  onset: TimingScore;
  ending: TimingScore;
};

export function predictionKey(record: Pick<PredictionRecord, 'predictorId' | 'predictorVersion'>): string {
  return `${record.predictorId}@${record.predictorVersion}`;
}

export function serializeRecord(record: PredictionRecord | ObservationRecord | Scorecard): string {
  return JSON.stringify(record);
}

export function parseRecordLine(line: string): PredictionRecord | ObservationRecord | Scorecard {
  const value = JSON.parse(line) as { schemaVersion?: unknown; recordType?: unknown };
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported schemaVersion: ${String(value.schemaVersion)}`);
  }
  if (value.recordType !== 'prediction' && value.recordType !== 'observation' && value.recordType !== 'scorecard') {
    throw new Error(`Unsupported recordType: ${String(value.recordType)}`);
  }
  if (value.recordType === 'prediction') {
    const leads = (value as PredictionRecord).leads;
    if (!Array.isArray(leads) || leads.length !== SCORE_LEADS_MIN.length) {
      throw new Error('Prediction must carry the five score leads');
    }
  }
  return value as PredictionRecord | ObservationRecord | Scorecard;
}
