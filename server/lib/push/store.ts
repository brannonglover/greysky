/**
 * Device wake queue.
 *
 * Two keys, nothing weather-shaped:
 *   device:<installId>  — hash of token + bookkeeping
 *   wake:due            — sorted set of installIds scored by nextWakeAfter
 *
 * Backed by Upstash Redis when UPSTASH_REDIS_REST_URL / TOKEN are set.
 * Without them the register endpoints refuse rather than invent a store —
 * a half-working queue that forgets devices on every cold start is worse
 * than no queue.
 */

import { Redis } from '@upstash/redis';

export type DeviceRecord = {
  token: string;
  platform: string;
  appVersion: string;
  lastRefreshAt: number;
  nextWakeAfter: number;
  lastPushAt: number;
  /** Pushes sent today (UTC day). Reset when day changes. */
  pushCount: number;
  pushDay: string;
  updatedAt: number;
};

export type PushTicket = {
  ticketId: string;
  installId: string;
  /** When to ask Expo for the receipt. */
  dueAt: number;
};

const DEVICE_PREFIX = 'device:';
const WAKE_DUE_KEY = 'wake:due';
const TICKET_DUE_KEY = 'push:tickets';

export function deviceKey(installId: string): string {
  return `${DEVICE_PREFIX}${installId}`;
}

export function utcDay(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

let redis: Redis | null | undefined;

/** Lazy singleton. null means "configured off"; undefined means "not checked". */
export function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    redis = null;
    return redis;
  }
  redis = new Redis({ url, token });
  return redis;
}

/** Test seam — reset between suites. */
export function resetRedisForTests(): void {
  redis = undefined;
}

export function storageConfigured(): boolean {
  return getRedis() !== null;
}

function asRecord(raw: Record<string, unknown> | null): DeviceRecord | null {
  if (!raw || typeof raw.token !== 'string' || !raw.token) return null;
  return {
    token: raw.token,
    platform: typeof raw.platform === 'string' ? raw.platform : 'unknown',
    appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : 'unknown',
    lastRefreshAt: Number(raw.lastRefreshAt) || 0,
    nextWakeAfter: Number(raw.nextWakeAfter) || 0,
    lastPushAt: Number(raw.lastPushAt) || 0,
    pushCount: Number(raw.pushCount) || 0,
    pushDay: typeof raw.pushDay === 'string' ? raw.pushDay : '',
    updatedAt: Number(raw.updatedAt) || 0,
  };
}

export async function getDevice(installId: string): Promise<DeviceRecord | null> {
  const client = getRedis();
  if (!client) return null;
  const raw = await client.hgetall<Record<string, unknown>>(deviceKey(installId));
  return asRecord(raw);
}

export async function upsertDevice(
  installId: string,
  patch: {
    token: string;
    platform: string;
    appVersion: string;
    lastRefreshAt: number;
    nextWakeAfter: number;
  },
  now: number = Date.now(),
): Promise<DeviceRecord> {
  const client = getRedis();
  if (!client) throw new Error('Push storage is not configured');

  const existing = await getDevice(installId);
  const day = utcDay(now);
  const record: DeviceRecord = {
    token: patch.token,
    platform: patch.platform,
    appVersion: patch.appVersion,
    lastRefreshAt: Math.max(existing?.lastRefreshAt ?? 0, patch.lastRefreshAt),
    nextWakeAfter: patch.nextWakeAfter,
    lastPushAt: existing?.lastPushAt ?? 0,
    pushCount: existing && existing.pushDay === day ? existing.pushCount : 0,
    pushDay: existing && existing.pushDay === day ? existing.pushDay : day,
    updatedAt: now,
  };

  await client.hset(deviceKey(installId), record);
  await client.zadd(WAKE_DUE_KEY, { score: record.nextWakeAfter, member: installId });
  return record;
}

export async function deleteDevice(installId: string): Promise<void> {
  const client = getRedis();
  if (!client) throw new Error('Push storage is not configured');
  await client.del(deviceKey(installId));
  await client.zrem(WAKE_DUE_KEY, installId);
}

/** Devices whose requested wake time is at or before `now`, oldest first. */
export async function dueInstallIds(now: number, limit: number): Promise<string[]> {
  const client = getRedis();
  if (!client) return [];
  // Upstash returns members ascending by score for zrange with score bounds.
  const members = await client.zrange(WAKE_DUE_KEY, 0, now, {
    byScore: true,
    offset: 0,
    count: limit,
  });
  return members.map(String);
}

/**
 * Move a device's due time without counting a push — used when the floor or
 * daily cap blocked a send so the install stops clogging the head of the queue.
 */
export async function rescheduleDevice(
  installId: string,
  nextWakeAfter: number,
  now: number = Date.now(),
): Promise<DeviceRecord | null> {
  const client = getRedis();
  if (!client) return null;
  const existing = await getDevice(installId);
  if (!existing) {
    await client.zrem(WAKE_DUE_KEY, installId);
    return null;
  }
  const record: DeviceRecord = {
    ...existing,
    nextWakeAfter,
    updatedAt: now,
  };
  await client.hset(deviceKey(installId), record);
  await client.zadd(WAKE_DUE_KEY, { score: nextWakeAfter, member: installId });
  return record;
}

export async function markPushed(
  installId: string,
  nextWakeAfter: number,
  now: number = Date.now(),
): Promise<DeviceRecord | null> {
  const client = getRedis();
  if (!client) return null;
  const existing = await getDevice(installId);
  if (!existing) {
    await client.zrem(WAKE_DUE_KEY, installId);
    return null;
  }

  const day = utcDay(now);
  const pushCount = existing.pushDay === day ? existing.pushCount + 1 : 1;
  const record: DeviceRecord = {
    ...existing,
    lastPushAt: now,
    pushCount,
    pushDay: day,
    nextWakeAfter,
    updatedAt: now,
  };
  await client.hset(deviceKey(installId), record);
  await client.zadd(WAKE_DUE_KEY, { score: nextWakeAfter, member: installId });
  return record;
}

export async function enqueueTicket(ticket: PushTicket): Promise<void> {
  const client = getRedis();
  if (!client) return;
  await client.zadd(TICKET_DUE_KEY, {
    score: ticket.dueAt,
    member: JSON.stringify(ticket),
  });
}

export async function dueTickets(now: number, limit: number): Promise<PushTicket[]> {
  const client = getRedis();
  if (!client) return [];
  const members = await client.zrange(TICKET_DUE_KEY, 0, now, {
    byScore: true,
    offset: 0,
    count: limit,
  });
  const tickets: PushTicket[] = [];
  for (const member of members) {
    try {
      const parsed = JSON.parse(String(member)) as PushTicket;
      if (parsed?.ticketId && parsed?.installId) tickets.push(parsed);
    } catch {
      // Drop malformed entries below.
    }
  }
  return tickets;
}

export async function removeTickets(tickets: PushTicket[]): Promise<void> {
  const client = getRedis();
  if (!client || tickets.length === 0) return;
  await client.zrem(TICKET_DUE_KEY, ...tickets.map((ticket) => JSON.stringify(ticket)));
}
