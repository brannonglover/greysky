import type { VercelRequest, VercelResponse } from '@vercel/node';

import { storageConfigured } from '../../lib/push/store';
import { drainWakeQueue } from '../../lib/push/wake';

/**
 * Drain devices that asked to be woken.
 *
 * Authenticated with CRON_SECRET (Bearer), matching Vercel's cron pattern.
 * On Hobby plans the Vercel cron minimum is once a day — pair this with an
 * external scheduler (GitHub Actions) hitting the same path every ~15 minutes.
 */

function authorized(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.authorization;
  if (header === `Bearer ${secret}`) return true;
  // Vercel Cron can also pass the secret as a query param on older setups.
  const query = req.query.secret;
  const fromQuery = Array.isArray(query) ? query[0] : query;
  return fromQuery === secret;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }
  if (!authorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!storageConfigured()) {
    return res.status(503).json({ error: 'Push storage is not configured' });
  }

  try {
    const result = await drainWakeQueue();
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Wake drain failed';
    return res.status(502).json({ error: message });
  }
}
