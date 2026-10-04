/**
 * Evidence required before this nowcast can replace production wording.
 * The numbers were written down before this phase scored the archive.
 * Do not edit them so the current sample passes.
 */
export const PRODUCTION_GATES = {
  /** Region-hours with at least one observed light-or-heavier lead. */
  independentWetEvents: 30,
  independentOnsetEvents: 20,
  independentEndingEvents: 20,
  /** A reliability bin is readable only with both of these. */
  reliabilityPointLeads: 8,
  reliabilityEvents: 5,
  /** Light-threshold bins that are readable, not counting a lone dry bin. */
  readableLightBins: 3,
  /** An 80% interval that covers less than this of wet outcomes is too narrow. */
  wetP10P90Coverage: 0.7,
  /** Experimental "likely" statements (P at or above the decision likely cutoff). */
  likelyFalseAlarmRate: 0.35,
  likelyForecasts: 20,
  likelyEvents: 10,
  /** Matched onset p50 against the first verifying lead at or above 0.6 mm/hr. */
  onsetTimingMaeMin: 15,
  onsetTimingEvents: 20,
} as const;

export type GateInput = {
  wetEvents: number;
  onsetEvents: number;
  endingEvents: number;
  readableLightBins: number;
  wetCoverage: number | null;
  likelyFalseAlarmRate: number | null;
  likelyForecasts: number;
  likelyEvents: number;
  onsetMaeMin: number | null;
  onsetTimedEvents: number;
};

export type GateResult = {
  id: string;
  pass: boolean;
  need: string;
  have: string;
};

export function gradeProduction(input: GateInput): GateResult[] {
  const gates = PRODUCTION_GATES;
  return [
    {
      id: 'wet-events',
      pass: input.wetEvents >= gates.independentWetEvents,
      need: `${gates.independentWetEvents} region-hours with light rain or more`,
      have: String(input.wetEvents),
    },
    {
      id: 'onset-events',
      pass: input.onsetEvents >= gates.independentOnsetEvents,
      need: `${gates.independentOnsetEvents} onsets`,
      have: String(input.onsetEvents),
    },
    {
      id: 'ending-events',
      pass: input.endingEvents >= gates.independentEndingEvents,
      need: `${gates.independentEndingEvents} endings`,
      have: String(input.endingEvents),
    },
    {
      id: 'reliability-bins',
      pass: input.readableLightBins >= gates.readableLightBins,
      need: `${gates.readableLightBins} readable light-rain bins besides an all-dry bin`,
      have: String(input.readableLightBins),
    },
    {
      id: 'wet-coverage',
      pass: input.wetCoverage != null && input.wetCoverage >= gates.wetP10P90Coverage,
      need: `p10–p90 covers at least ${gates.wetP10P90Coverage} of wet leads`,
      have: input.wetCoverage == null ? 'none' : input.wetCoverage.toFixed(2),
    },
    {
      id: 'likely-false-alarms',
      pass:
        input.likelyFalseAlarmRate != null &&
        input.likelyForecasts >= gates.likelyForecasts &&
        input.likelyEvents >= gates.likelyEvents &&
        input.likelyFalseAlarmRate <= gates.likelyFalseAlarmRate,
      need: `false-alarm rate ≤ ${gates.likelyFalseAlarmRate} on ≥ ${gates.likelyForecasts} likely forecasts from ≥ ${gates.likelyEvents} events`,
      have:
        input.likelyFalseAlarmRate == null
          ? `forecasts ${input.likelyForecasts}, events ${input.likelyEvents}`
          : `rate ${input.likelyFalseAlarmRate.toFixed(2)}, forecasts ${input.likelyForecasts}, events ${input.likelyEvents}`,
    },
    {
      id: 'onset-timing',
      pass:
        input.onsetMaeMin != null &&
        input.onsetTimedEvents >= gates.onsetTimingEvents &&
        input.onsetMaeMin <= gates.onsetTimingMaeMin,
      need: `onset timing MAE ≤ ${gates.onsetTimingMaeMin} min on ≥ ${gates.onsetTimingEvents} events`,
      have: input.onsetMaeMin == null ? `events ${input.onsetTimedEvents}` : `MAE ${input.onsetMaeMin.toFixed(1)} min, events ${input.onsetTimedEvents}`,
    },
  ];
}
