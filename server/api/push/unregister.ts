import type { VercelRequest, VercelResponse } from '@vercel/node';

import { deleteDevice, storageConfigured } from '../../lib/push/store';

/**
 * Drop a device from the wake queue when the user opts out.
 *
 * Faster than waiting on a DeviceNotRegistered receipt for something the
 * user already told us.
 */

type Body = {
  installId?: unknown;
};

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
  const installId =
    typeof body.installId === 'string' && body.installId.trim() ? body.installId.trim() : null;
  if (!installId || installId.length > 80) {
    return res.status(400).json({ error: 'installId is required' });
  }

  try {
    await deleteDevice(installId);
    return res.status(200).json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unregister failed';
    return res.status(502).json({ error: message });
  }
}
