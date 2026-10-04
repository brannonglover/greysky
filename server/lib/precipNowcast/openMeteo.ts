const HISTORICAL = 'https://historical-forecast-api.open-meteo.com/v1/forecast';

export type OpenMeteoLead = {
  leadMinutes: number;
  validAt: string;
  rainRateMmHr: number | null;
  precipProbability: number | null;
};

type Hourly = {
  time?: string[];
  precipitation?: Array<number | null>;
  precipitation_probability?: Array<number | null>;
};

/**
 * Hourly precipitation from Open-Meteo's archived forecast for that date.
 * This is not a snapshot of what the app fetched at the issue minute. Every
 * lead that falls in the same clock hour shares that hour's total, read as mm/hr.
 * A failed fetch stays null.
 */
export async function openMeteoLeads(args: {
  latitude: number;
  longitude: number;
  issuedAtMs: number;
  leads: readonly number[];
}): Promise<{ analysisRateMmHr: number | null; leads: OpenMeteoLead[]; diagnostics: Record<string, string | number | boolean | null> }> {
  const diagnostics: Record<string, string | number | boolean | null> = {
    endpoint: 'historical-forecast-api',
    note: 'Hourly archived forecast, not the app response at issue time. Leads in one hour share one value.',
  };
  const start = new Date(args.issuedAtMs).toISOString().slice(0, 10);
  const end = new Date(args.issuedAtMs + 60 * 60_000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    latitude: String(args.latitude),
    longitude: String(args.longitude),
    hourly: 'precipitation,precipitation_probability',
    start_date: start,
    end_date: end,
    timezone: 'UTC',
  });
  let hourly: Hourly | null = null;
  try {
    const res = await fetch(`${HISTORICAL}?${params.toString()}`);
    if (!res.ok) {
      diagnostics.error = `HTTP ${res.status}`;
    } else {
      const json = (await res.json()) as { hourly?: Hourly };
      hourly = json.hourly ?? null;
      if (!hourly?.time?.length) diagnostics.error = 'No hourly rows';
    }
  } catch (error) {
    diagnostics.error = error instanceof Error ? error.message : 'Open-Meteo unavailable';
  }

  const at = (ms: number): { rate: number | null; probability: number | null } => {
    if (!hourly?.time) return { rate: null, probability: null };
    const key = new Date(ms).toISOString().slice(0, 13) + ':00';
    const index = hourly.time.indexOf(key);
    if (index < 0) return { rate: null, probability: null };
    const precip = hourly.precipitation?.[index];
    const probability = hourly.precipitation_probability?.[index];
    return {
      rate: typeof precip === 'number' && Number.isFinite(precip) ? precip : null,
      probability: typeof probability === 'number' && Number.isFinite(probability) ? probability / 100 : null,
    };
  };

  const analysis = at(args.issuedAtMs);
  return {
    analysisRateMmHr: analysis.rate,
    leads: args.leads.map((leadMinutes) => {
      const validMs = args.issuedAtMs + leadMinutes * 60_000;
      const sample = at(validMs);
      return {
        leadMinutes,
        validAt: new Date(validMs).toISOString(),
        rainRateMmHr: sample.rate,
        precipProbability: sample.probability,
      };
    }),
    diagnostics,
  };
}
