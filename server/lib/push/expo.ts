/**
 * Thin Expo Push API client.
 *
 * Batches at ≤100 (Expo's documented cap). Silent wakes carry no title/body —
 * only `contentAvailable` — so APNs treats them as background updates.
 */

export type ExpoPushMessage = {
  to: string;
  data: { kind: 'refresh'; at: number };
  contentAvailable: true;
  priority: 'normal';
  ttl: number;
  /** Required on Android for data-only messages to wake the app. */
  _contentAvailable?: true;
};

export type ExpoTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: { error?: string } };

export type ExpoReceipt =
  | { status: 'ok' }
  | { status: 'error'; message: string; details?: { error?: string } };

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

export const EXPO_BATCH_SIZE = 100;
/** A wake arriving this late is worthless; drop rather than spend a battery cycle. */
export const PUSH_TTL_SECONDS = 900;

export function refreshMessage(token: string, at: number): ExpoPushMessage {
  return {
    to: token,
    data: { kind: 'refresh', at },
    contentAvailable: true,
    priority: 'normal',
    ttl: PUSH_TTL_SECONDS,
  };
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  const token = process.env.EXPO_ACCESS_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function sendPushMessages(
  messages: ExpoPushMessage[],
  fetchImpl: typeof fetch = fetch,
): Promise<ExpoTicket[]> {
  if (messages.length === 0) return [];
  if (messages.length > EXPO_BATCH_SIZE) {
    throw new Error(`Expo push batch exceeds ${EXPO_BATCH_SIZE}`);
  }

  const response = await fetchImpl(EXPO_PUSH_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(messages),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Expo push send failed (${response.status}): ${body.slice(0, 200)}`);
  }
  const json = (await response.json()) as { data?: ExpoTicket[] };
  return Array.isArray(json.data) ? json.data : [];
}

export async function getPushReceipts(
  ticketIds: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, ExpoReceipt>> {
  if (ticketIds.length === 0) return {};
  const response = await fetchImpl(EXPO_RECEIPTS_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ ids: ticketIds }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Expo receipts failed (${response.status}): ${body.slice(0, 200)}`);
  }
  const json = (await response.json()) as { data?: Record<string, ExpoReceipt> };
  return json.data ?? {};
}
