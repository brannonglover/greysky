/**
 * Device wake queue on Supabase Postgres.
 *
 * Two tables, nothing weather-shaped:
 *   push_devices  — token + bookkeeping, ordered by next_wake_after
 *   push_tickets  — Expo receipt checks due later
 *
 * Uses the service-role key (server-only). Without SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY the register endpoints refuse rather than invent
 * a store — a half-working queue that forgets devices on every cold start is
 * worse than no queue.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

type DeviceRow = {
  install_id: string;
  token: string;
  platform: string;
  app_version: string;
  last_refresh_at: number;
  next_wake_after: number;
  last_push_at: number;
  push_count: number;
  push_day: string;
  updated_at: number;
};

type TicketRow = {
  ticket_id: string;
  install_id: string;
  due_at: number;
};

export function utcDay(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

let client: SupabaseClient | null | undefined;

/** Lazy singleton. null means "configured off"; undefined means "not checked". */
export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    client = null;
    return client;
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/** Test seam — reset between suites. */
export function resetSupabaseForTests(): void {
  client = undefined;
}

export function storageConfigured(): boolean {
  return getSupabase() !== null;
}

function rowToRecord(row: DeviceRow): DeviceRecord {
  return {
    token: row.token,
    platform: row.platform || 'unknown',
    appVersion: row.app_version || 'unknown',
    lastRefreshAt: Number(row.last_refresh_at) || 0,
    nextWakeAfter: Number(row.next_wake_after) || 0,
    lastPushAt: Number(row.last_push_at) || 0,
    pushCount: Number(row.push_count) || 0,
    pushDay: row.push_day || '',
    updatedAt: Number(row.updated_at) || 0,
  };
}

function recordToRow(installId: string, record: DeviceRecord): DeviceRow {
  return {
    install_id: installId,
    token: record.token,
    platform: record.platform,
    app_version: record.appVersion,
    last_refresh_at: record.lastRefreshAt,
    next_wake_after: record.nextWakeAfter,
    last_push_at: record.lastPushAt,
    push_count: record.pushCount,
    push_day: record.pushDay,
    updated_at: record.updatedAt,
  };
}

export async function getDevice(installId: string): Promise<DeviceRecord | null> {
  const db = getSupabase();
  if (!db) return null;
  const { data, error } = await db
    .from('push_devices')
    .select('*')
    .eq('install_id', installId)
    .maybeSingle();
  if (error) throw new Error(`getDevice: ${error.message}`);
  if (!data?.token) return null;
  return rowToRecord(data as DeviceRow);
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
  const db = getSupabase();
  if (!db) throw new Error('Push storage is not configured');

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

  const { error } = await db.from('push_devices').upsert(recordToRow(installId, record));
  if (error) throw new Error(`upsertDevice: ${error.message}`);
  return record;
}

export async function deleteDevice(installId: string): Promise<void> {
  const db = getSupabase();
  if (!db) throw new Error('Push storage is not configured');
  // Tickets cascade via FK; delete them explicitly too in case the FK is absent.
  const tickets = await db.from('push_tickets').delete().eq('install_id', installId);
  if (tickets.error) throw new Error(`deleteDevice tickets: ${tickets.error.message}`);
  const devices = await db.from('push_devices').delete().eq('install_id', installId);
  if (devices.error) throw new Error(`deleteDevice: ${devices.error.message}`);
}

/** Devices whose requested wake time is at or before `now`, oldest first. */
export async function dueInstallIds(now: number, limit: number): Promise<string[]> {
  const db = getSupabase();
  if (!db) return [];
  const { data, error } = await db
    .from('push_devices')
    .select('install_id')
    .lte('next_wake_after', now)
    .order('next_wake_after', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`dueInstallIds: ${error.message}`);
  return (data ?? []).map((row) => String((row as { install_id: string }).install_id));
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
  const existing = await getDevice(installId);
  if (!existing) return null;
  const record: DeviceRecord = {
    ...existing,
    nextWakeAfter,
    updatedAt: now,
  };
  const db = getSupabase();
  if (!db) return null;
  const { error } = await db.from('push_devices').upsert(recordToRow(installId, record));
  if (error) throw new Error(`rescheduleDevice: ${error.message}`);
  return record;
}

export async function markPushed(
  installId: string,
  nextWakeAfter: number,
  now: number = Date.now(),
): Promise<DeviceRecord | null> {
  const existing = await getDevice(installId);
  if (!existing) return null;

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
  const db = getSupabase();
  if (!db) return null;
  const { error } = await db.from('push_devices').upsert(recordToRow(installId, record));
  if (error) throw new Error(`markPushed: ${error.message}`);
  return record;
}

export async function enqueueTicket(ticket: PushTicket): Promise<void> {
  const db = getSupabase();
  if (!db) return;
  const row: TicketRow = {
    ticket_id: ticket.ticketId,
    install_id: ticket.installId,
    due_at: ticket.dueAt,
  };
  const { error } = await db.from('push_tickets').upsert(row);
  if (error) throw new Error(`enqueueTicket: ${error.message}`);
}

export async function dueTickets(now: number, limit: number): Promise<PushTicket[]> {
  const db = getSupabase();
  if (!db) return [];
  const { data, error } = await db
    .from('push_tickets')
    .select('ticket_id, install_id, due_at')
    .lte('due_at', now)
    .order('due_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`dueTickets: ${error.message}`);
  return (data ?? []).map((row) => {
    const r = row as TicketRow;
    return { ticketId: r.ticket_id, installId: r.install_id, dueAt: Number(r.due_at) || 0 };
  });
}

export async function removeTickets(tickets: PushTicket[]): Promise<void> {
  const db = getSupabase();
  if (!db || tickets.length === 0) return;
  const ids = tickets.map((ticket) => ticket.ticketId);
  const { error } = await db.from('push_tickets').delete().in('ticket_id', ids);
  if (error) throw new Error(`removeTickets: ${error.message}`);
}
