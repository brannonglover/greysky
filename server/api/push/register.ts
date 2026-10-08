import type { VercelRequest, VercelResponse } from '@vercel/node';

import { storageConfigured, upsertDevice } from '../../lib/push/store';

/**
 * Register or refresh a device's silent-push wake record.
 *
 * No location is accepted. The server is a scheduler: it stores the token and
 * the device's own `nextWakeAfter`, and nothing about the weather.
 */

type Body = {
  installId?: unknown;
  token?: unknown;
  platform?: unknown;
  appVersion?: unknown;
  lastRefreshAt?: unknown;
  nextWakeAfter?: unknown;
};

function asString(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function asEpoch(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!storageConfigured()) {
    return res.status(503).json({ error: 'Push storage is not configured' });
  }

  const body = (req.body ?? {}) as Body;
  const installId = asString(body.installId, 80);
  const token = asString(body.token, 200);
  const platform = asString(body.platform, 40) ?? 'unknown';
  const appVersion = asString(body.appVersion, 40) ?? 'unknown';
  const lastRefreshAt = asEpoch(body.lastRefreshAt);
  const nextWakeAfter = asEpoch(body.nextWakeAfter);

  if (!installId || !token || lastRefreshAt === null || nextWakeAfter === null) {
    return res.status(400).json({
      error: 'installId, token, lastRefreshAt, and nextWakeAfter are required',
    });
  }
  if (!token.startsWith('ExponentPushToken[') && !token.startsWith('ExpoPushToken[')) {
    return res.status(400).json({ error: 'token must be an Expo push token' });
  }

  try {
    const record = await upsertDevice(installId, {
      token,
      platform,
      appVersion,
      lastRefreshAt,
      nextWakeAfter,
    });
    return res.status(200).json({
      ok: true,
      nextWakeAfter: record.nextWakeAfter,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    return res.status(502).json({ error: message });
  }
}
