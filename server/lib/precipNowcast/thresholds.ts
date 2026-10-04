/**
 * Verification rain/no-rain line. This is DRY_MM_HR in lib/precip.ts:
 * a rate at or below it is a trace, not rain. Do not raise it to improve a score.
 *
 * The chart's 10 dBZ display gate is not used here.
 */
export const RAIN_THRESHOLD_MM_HR = 0.02;

/** Leads the baseline scoreboard always reports, in minutes. */
export const SCORE_LEADS_MIN = [10, 20, 30, 45, 60] as const;

export type ScoreLeadMin = (typeof SCORE_LEADS_MIN)[number];
