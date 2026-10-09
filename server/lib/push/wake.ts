/**
 * Drain the due-wake queue and check prior push receipts.
 *
 * Pure of weather: the server only knows which devices asked to be woken.
 * Every judgment about cadence lives on the client in `nextWakeAfter`.
 */

import {
  deleteDevice,
  dueInstallIds,
  dueTickets,
  enqueueTicket,
  getDevice,
  markPushed,
  removeTickets,
  rescheduleDevice,
  type DeviceRecord,
  type PushTicket,
} from './store';
import {
  EXPO_BATCH_SIZE,
  getPushReceipts,
  refreshMessage,
  sendPushMessages,
  type ExpoPushMessage,
} from './expo';

/** Minimum gap between pushes to one device, regardless of what it requested. */
export const SERVER_PUSH_FLOOR_MS = 20 * 60_000;
/** Hard daily cap so a client bug cannot exhaust the app's APNs budget. */
export const SERVER_DAILY_CAP = 24;
/** No heartbeat / refresh in this long → drop the record. */
export const DORMANT_MS = 14 * 24 * 60 * 60_000;
/** If we push and hear nothing, reschedule this far out. */
export const POST_PUSH_BACKOFF_MS = 20 * 60_000;
/** Expo says receipts are ready ~15 minutes after the ticket. */
export const RECEIPT_DELAY_MS = 15 * 60_000;

export type WakeDecision =
  | { action: 'send'; record: DeviceRecord }
  | { action: 'skip'; reason: 'dormant' | 'budget' | 'floor' | 'missing' | 'no-token' };

/**
 * Whether this device should receive a silent wake right now.
 *
 * Separated from I/O so the hygiene rules can be asserted without Redis.
 */
export function decideWake(
  record: DeviceRecord | null,
  now: number,
): WakeDecision {
  if (!record) return { action: 'skip', reason: 'missing' };
  if (!record.token) return { action: 'skip', reason: 'no-token' };

  // Prefer lastRefreshAt; fall back to updatedAt so a brand-new registration
  // that has never refreshed is not immediately culled as dormant.
  const lastSeen = Math.max(record.lastRefreshAt, record.updatedAt);
  if (lastSeen > 0 && now - lastSeen >= DORMANT_MS) {
    return { action: 'skip', reason: 'dormant' };
  }
  if (record.lastPushAt > 0 && now - record.lastPushAt < SERVER_PUSH_FLOOR_MS) {
    return { action: 'skip', reason: 'floor' };
  }
  if (record.pushCount >= SERVER_DAILY_CAP) {
    return { action: 'skip', reason: 'budget' };
  }
  return { action: 'send', record };
}

export type WakeDrainResult = {
  examined: number;
  sent: number;
  skipped: Record<WakeDecision['action'] extends 'skip' ? never : string, number> & {
    dormant: number;
    budget: number;
    floor: number;
    missing: number;
    'no-token': number;
  };
  tickets: number;
  receiptsChecked: number;
  devicesDeleted: number;
};

function emptySkipped(): WakeDrainResult['skipped'] {
  return { dormant: 0, budget: 0, floor: 0, missing: 0, 'no-token': 0 };
}

async function processReceipts(now: number, fetchImpl: typeof fetch): Promise<number> {
  const tickets = await dueTickets(now, EXPO_BATCH_SIZE);
  if (tickets.length === 0) return 0;

  const receipts = await getPushReceipts(
    tickets.map((ticket) => ticket.ticketId),
    fetchImpl,
  );

  let deleted = 0;
  const done: PushTicket[] = [];
  for (const ticket of tickets) {
    const receipt = receipts[ticket.ticketId];
    if (!receipt) {
      // Not ready yet — leave it for a later drain. Cap age so a stuck
      // ticket cannot live forever if Expo dropped it.
      if (ticket.dueAt < now - 24 * 60 * 60_000) done.push(ticket);
      continue;
    }
    done.push(ticket);
    if (
      receipt.status === 'error' &&
      receipt.details?.error === 'DeviceNotRegistered'
    ) {
      await deleteDevice(ticket.installId);
      deleted += 1;
    }
  }
  await removeTickets(done);
  return deleted;
}

/**
 * One cron tick: check receipts, then wake up to 100 due devices.
 */
export async function drainWakeQueue(
  now: number = Date.now(),
  fetchImpl: typeof fetch = fetch,
): Promise<WakeDrainResult> {
  const devicesDeleted = await processReceipts(now, fetchImpl);

  const due = await dueInstallIds(now, EXPO_BATCH_SIZE);
  const result: WakeDrainResult = {
    examined: due.length,
    sent: 0,
    skipped: emptySkipped(),
    tickets: 0,
    receiptsChecked: 0,
    devicesDeleted,
  };

  const batch: { installId: string; message: ExpoPushMessage }[] = [];

  for (const installId of due) {
    const record = await getDevice(installId);
    const decision = decideWake(record, now);
    if (decision.action === 'skip') {
      result.skipped[decision.reason] += 1;
      if (decision.reason === 'dormant' || decision.reason === 'missing') {
        await deleteDevice(installId);
        result.devicesDeleted += 1;
      } else if (decision.reason === 'floor' || decision.reason === 'budget') {
        // Slide them past the floor / an hour out so they stop clogging the
        // head — without counting against the daily push budget.
        const retryAt =
          decision.reason === 'floor'
            ? (record?.lastPushAt ?? now) + SERVER_PUSH_FLOOR_MS
            : now + 60 * 60_000;
        await rescheduleDevice(installId, Math.max(retryAt, now + SERVER_PUSH_FLOOR_MS), now);
      }
      continue;
    }
    batch.push({
      installId,
      message: refreshMessage(decision.record.token, now),
    });
  }

  if (batch.length === 0) return result;

  const tickets = await sendPushMessages(
    batch.map((entry) => entry.message),
    fetchImpl,
  );

  for (let i = 0; i < batch.length; i += 1) {
    const { installId } = batch[i];
    const ticket = tickets[i];
    await markPushed(installId, now + POST_PUSH_BACKOFF_MS, now);
    result.sent += 1;

    if (ticket?.status === 'ok' && ticket.id) {
      await enqueueTicket({
        ticketId: ticket.id,
        installId,
        dueAt: now + RECEIPT_DELAY_MS,
      });
      result.tickets += 1;
    } else if (
      ticket?.status === 'error' &&
      ticket.details?.error === 'DeviceNotRegistered'
    ) {
      await deleteDevice(installId);
      result.devicesDeleted += 1;
    }
  }

  return result;
}
