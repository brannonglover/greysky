/**
 * Experimental shadow states for the frozen point nowcast.
 * Cutoffs are configurable and were not fitted. They are not production wording.
 * Expected rain rate is not an input.
 */
import type { PointNowcast } from './point';

export const DECISION = {
  ruleVersion: 'shadow-1' as const,
  possibleAt: 0.4,
  likelyAt: 0.7,
  alreadyAt: 0.5,
  endingPossibleAt: 0.4,
  endingLikelyAt: 0.7,
  narrowMinutes: 15,
  broadMinutes: 30,
  imminentP50Max: 20,
  lowConfidence: 0.4,
} as const;

/** Cutoffs the archive can score later. shadow-1 uses two of them. Not a fitted choice. */
export const CANDIDATE_CUTOFFS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8] as const;

export type DecisionState =
  | 'DRY'
  | 'RAIN_POSSIBLE'
  | 'RAIN_LIKELY'
  | 'RAIN_IMMINENT'
  | 'RAINING'
  | 'ENDING_POSSIBLE'
  | 'ENDING_LIKELY'
  | 'TIMING_UNCERTAIN';

export type ShadowDecision = {
  ruleVersion: typeof DECISION.ruleVersion;
  selectedState: DecisionState;
  meaningfulRainProbability: number | null;
  alreadyRainingProbability: number | null;
  onsetWidthMinutes: number | null;
  endingWidthMinutes: number | null;
  onsetP50Minutes: number | null;
  endingP50Minutes: number | null;
  confidence: number | null;
  /** Experimental phrase for review. Not production copy. */
  experimentalPhrase: string;
  rule: string;
};

function width(p10: number | null, p90: number | null): number | null {
  if (p10 == null || p90 == null) return null;
  return p90 - p10;
}

function phrase(state: DecisionState, onsetP50: number | null, endingP50: number | null): string {
  if (state === 'RAIN_IMMINENT' && onsetP50 != null) return `Rain likely in about ${Math.round(onsetP50)} minutes`;
  if (state === 'ENDING_LIKELY' && endingP50 != null) return `Rain should end in about ${Math.round(endingP50)} minutes`;
  if (state === 'RAIN_LIKELY' || state === 'TIMING_UNCERTAIN') return 'Rain likely within the next hour';
  if (state === 'RAIN_POSSIBLE') return 'Rain possible';
  if (state === 'RAINING') return 'Rain continuing for the next hour';
  if (state === 'ENDING_POSSIBLE') return 'Rain may end during the next hour';
  return 'Staying dry for the next hour';
}

export function decide(forecast: PointNowcast): ShadowDecision {
  const meaningful = forecast.onset.withinMinutes['60'];
  const already = forecast.onset.alreadyRainingProbability;
  const onsetWidth = width(forecast.onset.p10Minutes, forecast.onset.p90Minutes);
  const endingWidth = width(forecast.ending.p10Minutes, forecast.ending.p90Minutes);
  const confidence = forecast.confidence;
  const base = {
    ruleVersion: DECISION.ruleVersion,
    meaningfulRainProbability: meaningful,
    alreadyRainingProbability: already,
    onsetWidthMinutes: onsetWidth,
    endingWidthMinutes: endingWidth,
    onsetP50Minutes: forecast.onset.p50Minutes,
    endingP50Minutes: forecast.ending.p50Minutes,
    confidence,
  };
  const finish = (selectedState: DecisionState, rule: string): ShadowDecision => ({
    ...base,
    selectedState,
    experimentalPhrase: phrase(selectedState, forecast.onset.p50Minutes, forecast.ending.p50Minutes),
    rule,
  });

  if (already != null && already >= DECISION.alreadyAt) {
    const endingP = forecast.ending.probability;
    if (
      endingP != null &&
      endingP >= DECISION.endingLikelyAt &&
      endingWidth != null &&
      endingWidth <= DECISION.narrowMinutes &&
      (confidence == null || confidence >= DECISION.lowConfidence)
    ) {
      return finish('ENDING_LIKELY', 'already raining, ending probability high, ending window narrow');
    }
    if (endingP != null && endingP >= DECISION.endingPossibleAt) {
      return finish('ENDING_POSSIBLE', 'already raining, ending probability moderate');
    }
    return finish('RAINING', 'already raining, no supported ending');
  }

  if (meaningful != null && meaningful >= DECISION.likelyAt) {
    const broad = onsetWidth == null || onsetWidth > DECISION.broadMinutes || (confidence != null && confidence < DECISION.lowConfidence);
    if (broad) return finish('TIMING_UNCERTAIN', 'rain likely, timing window broad or confidence low');
    if (
      onsetWidth <= DECISION.narrowMinutes &&
      forecast.onset.p50Minutes != null &&
      forecast.onset.p50Minutes <= DECISION.imminentP50Max
    ) {
      return finish('RAIN_IMMINENT', 'rain likely, onset window narrow and soon');
    }
    return finish('RAIN_LIKELY', 'rain likely, onset window not narrow enough for a minute');
  }
  if (meaningful != null && meaningful >= DECISION.possibleAt) {
    return finish('RAIN_POSSIBLE', 'meaningful-rain probability between possible and likely');
  }
  return finish('DRY', 'meaningful-rain probability below the possible cutoff');
}
