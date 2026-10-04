import type { TimedEvent } from './records';

export type RateLead = {
  leadMinutes: number;
  rateMmHr: number | null;
};

/**
 * Onset is the first lead above the rain line, and only if every earlier lead
 * is present and dry. Ending is the first lead that is dry and stays dry
 * through the last lead. A missing rate is not dry, and one dry lead followed
 * by rain is not an ending.
 */
export function seriesEvents(
  analysisRateMmHr: number | null,
  leads: readonly RateLead[],
  thresholdMmHr: number,
): { onset: TimedEvent; ending: TimedEvent } {
  const ordered = [...leads].sort((a, b) => a.leadMinutes - b.leadMinutes);
  if (analysisRateMmHr == null) {
    return {
      onset: { applicable: false, minutes: null },
      ending: { applicable: false, minutes: null },
    };
  }

  const wet = analysisRateMmHr > thresholdMmHr;
  return {
    onset: wet ? { applicable: false, minutes: null } : onsetFromDry(ordered, thresholdMmHr),
    ending: wet ? endingFromWet(ordered, thresholdMmHr) : { applicable: false, minutes: null },
  };
}

function onsetFromDry(leads: readonly RateLead[], thresholdMmHr: number): TimedEvent {
  for (const lead of leads) {
    if (lead.rateMmHr == null) return { applicable: false, minutes: null };
    if (lead.rateMmHr > thresholdMmHr) return { applicable: true, minutes: lead.leadMinutes };
  }
  return { applicable: true, minutes: null };
}

function endingFromWet(leads: readonly RateLead[], thresholdMmHr: number): TimedEvent {
  if (leads.some((lead) => lead.rateMmHr == null)) return { applicable: false, minutes: null };
  for (let i = 0; i < leads.length; i += 1) {
    const rest = leads.slice(i);
    if (rest.every((lead) => (lead.rateMmHr as number) <= thresholdMmHr)) {
      return { applicable: true, minutes: leads[i].leadMinutes };
    }
  }
  return { applicable: true, minutes: null };
}
