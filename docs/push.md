# Server-driven refresh architecture

**Status: proposed. Nothing in this document is implemented.**

```
Silent push            →  expo-background-task     →  Foreground refresh
server says "you're      OS granted us time          user opened the app
 due for a refresh"      opportunistic, 15-min floor  guaranteed, on open
     best effort                best effort              the real guarantee
```

Three tiers, each a fallback for the one before it. Only the last is guaranteed,
and it already works — this design is about making the first two land often
enough that the third rarely has anything left to do.

## The governing principle

**The server knows when a device's cache is old. It does not know, or need to
know, anything about the weather.**

An earlier draft of this document proposed a server that fetched NWS, SPC and
NHC products, computed a per-cell "situation fingerprint", and pushed only when
a `warrantsWake()` predicate judged the change material. That design is recorded
in [Appendix: the event-aware alternative](#appendix-the-event-aware-alternative)
and is **not** recommended. Two problems killed it, and both are worth stating
up front because they shaped everything below.

**It solved the wrong problem.** A cache goes stale as a function of *time*, not
as a function of whether the world changed. A six-hour-old cache with an
unchanged forecast is still stale: the minute-by-minute nowcast is worthless, and
`lastUpdated` says so on screen. Weather-state awareness answers "did something
happen?", which is a notification question. Cache warming asks "is this device's
data old?", which the device itself already knows.

**It made removals invisible.** Gating refresh on escalation meant a canceled
tornado warning never triggered a wake, so the Storms tab would keep displaying
it until the user opened the app. That converts a benign "told you late"
tradeoff into a false-positive severe-weather display. Refresh is a correctness
mechanism; **removals matter as much as additions**, and a design where the
question can be asked at all is a design where it can be answered wrongly.

The architecture below makes that class of bug unrepresentable: there is no
wake-worthiness predicate, and every wake performs a full refresh that replaces
the whole cache, cancellations included.

## Components

| Piece | Location |
|---|---|
| Shared refresh (extracted first) | `lib/refreshWeatherCaches.ts` |
| Background-task wake | `lib/backgroundWeather.ts` (existing, becomes a thin caller) |
| Push wake | `lib/pushRefresh.ts` (new) |
| Token registration + heartbeat | `lib/pushRegistration.ts` (new) |
| Registration endpoints | `server/api/push/register.ts`, `unregister.ts` (new) |
| Due-queue sender | `server/api/cron/wake.ts` (new) |

No new server-side weather code. `server/lib/` is untouched.

---

## 1. The shared refresh function

This is the first commit, before any push code exists, and it is the one piece
both designs agreed on.

Today the entire refresh body is inline inside `TaskManager.defineTask` in
`lib/backgroundWeather.ts`. It moves to `lib/refreshWeatherCaches.ts`:

```ts
export type RefreshTrigger = 'background-task' | 'push' | 'manual';
export async function runWeatherRefresh(trigger: RefreshTrigger): Promise<RefreshOutcome>;
```

Every wake path becomes a three-line caller. Beyond avoiding a second
implementation, this is the only sane home for three things the push tier makes
necessary:

- **Coalescing.** A push and a background task can fire seconds apart. If a
  refresh completed within ~90 seconds, return early; the second wake costs
  nothing.
- **An in-flight lock.** Two overlapping wakes must not both write the caches.
  One promise, shared.
- **`lastRefreshAt` in one place**, which the heartbeat reports back so the
  server can skip a device that is already fresh.

Cache divergence is the bug class we just fixed — the old background task wrote
`selectedId: 'current'` unconditionally while the foreground wrote the real id,
so launches threw the cache away. A hand-written second refresh path is an
invitation to reintroduce exactly that.

Only `TaskManager.defineTask` registrations are constrained to module scope. The
shared function is an ordinary import.

## 2. Registration and the heartbeat

The app has never had a push token — today it only schedules *local*
notifications. This is all new.

After notification setup succeeds, `lib/pushRegistration.ts` calls
`Notifications.getExpoPushTokenAsync({ projectId })`, taking `projectId` from
`Constants.expoConfig.extra.eas.projectId` (already set). The docs are explicit
that this call hits Expo's servers and fails offline, so it is wrapped in
try/catch and retried on the next launch rather than blocking anything.

```
POST /api/push/register
{
  installId,       // client-generated uuid, persisted in AsyncStorage
  token,           // ExponentPushToken[...]
  platform, appVersion,
  lastRefreshAt,   // when this device last completed a refresh
  nextWakeAfter    // when the device would like to be woken — see below
}
```

**No location is sent.** The server never learns where the device is, at any
precision. This falls out of the principle: a scheduler doesn't need geography.

**`installId`, not the token, is the primary key.** Expo tokens rotate; keying on
`installId` means a rotated token replaces the value on an existing record
instead of orphaning it and leaving a dead token in the queue forever.

**The heartbeat is not per-launch.** The client re-posts only when
`nextWakeAfter` moves materially, the token changes, or the record is a week
old. A user who opens the app six times in an evening makes one call.

`POST /api/push/unregister` deletes the record when the user opts out — a fast
path, rather than waiting on a `DeviceNotRegistered` receipt to learn something
the user told us directly.

## 3. The device decides when it wants waking

This is what keeps the server dumb. On each heartbeat the device computes its
own `nextWakeAfter` from its own freshness policy — it is the only party that
knows what is in its cache and how long each part stays useful:

| Source | Wake cadence | Note |
|---|---|---|
| Forecast, alerts | 2 h | The binding pair |
| Regional sweep | 3 h | |
| SPC outlook, tropical | 6 h | Published on slow cycles |
| *Retry floor* | 20 min | Only binds after a failure |

These are **wake cadences, not freshness ideals**. The UI would prefer the
minute nowcast under half an hour old, but waking on that would mean roughly
seventy wakes a day against Apple's two-or-three-an-hour guidance. The gap is
covered by the other two tiers. `lib/wakeSchedule.ts` carries the reasoning and
`scripts/wake.test.ts` pins the property that matters: a healthy device waits
the full cadence, while a failed source pulls the next wake in to the retry
floor.

The server stores that timestamp and honors it. All freshness *policy* lives in
the client, next to the cache semantics it describes; the server holds only
scheduling *mechanism*. Changing how aggressively the app warms itself becomes a
client change, shippable over the air, with no server deploy.

Storage is two keys:

```
device:<installId>   hash   token, lastRefreshAt, lastPushAt, budget, appVersion
wake:due             zset   installIds, scored by nextWakeAfter
```

## 4. The cron, which is a queue drain

`/api/cron/wake`, bearer-authenticated with `CRON_SECRET`:

```
ZRANGEBYSCORE wake:due 0 <now> LIMIT 0 100
  → drop dormant (no refresh in 14 days) and budget-exhausted devices
  → send one batch of ≤100 silent pushes
  → reschedule each device at now + backoff
  → record tickets for receipt checking
```

That is the entire server-side logic. It is O(log n) on the sorted set, makes
**zero** upstream weather requests, and has no weather code to get wrong.

Devices that are already fresh — because the user has been in the app — are not
in the due window and are never touched. Dormant installs cost nothing. This is
demand-driven by real per-device staleness, not a broadcast on a fixed timer.

The one piece of judgment the server keeps is **APNs hygiene, not weather**: a
minimum floor between pushes to a device (~20 min) and a daily cap, enforced
regardless of what `nextWakeAfter` requests, so a client bug cannot spend the
app's entire push budget.

## 5. The push itself

Sent through the Expo Push API, batched at **≤100 messages per request** (the
documented cap; over it returns `PUSH_TOO_MANY_NOTIFICATIONS`).

```json
{
  "to": "ExponentPushToken[...]",
  "data": { "kind": "refresh", "at": 1758700000000 },
  "contentAvailable": true,
  "priority": "normal",
  "ttl": 900
}
```

- **No `title` or `body`** — a data-only message is what makes it silent.
- **`contentAvailable: true`** is the current field name; `_contentAvailable` is
  deprecated but still accepted, and `contentAvailable` wins if both are sent.
- **`priority: "normal"`** maps to APNs priority 5, which is what Apple
  *requires* for background updates. `high` (APNs 10) is for user-visible
  alerts; sending a background push at 10 is how apps get throttled.
- **`ttl: 900`** — a wake-up arriving twenty minutes late is worthless, and
  dropping it beats spending a battery wake on stale intent.

**Receipts.** Tickets go into a due-queue scored fifteen minutes out (the
documented window); the same cron drains anything due via
`/--/api/v2/push/getReceipts` in batches of ≤1000. A `DeviceNotRegistered`
receipt deletes the device record. Receipts clear after 24 hours, so a missed
drain is a lost signal, not a stuck queue.

**Client task**, in `lib/pushRefresh.ts`, at module scope:

```ts
TaskManager.defineTask<Notifications.NotificationTaskPayload>(
  BACKGROUND_NOTIFICATION_TASK,
  async ({ data, error }) => {
    if (error) return;
    if (!isRefreshPayload(data)) return;
    await runWeatherRefresh('push');
  },
);
Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
```

`app/_layout.tsx` imports it for side effects beside the existing
`import '@/lib/backgroundWeather'`. The task **must** be defined at module scope
in a module reached from the root layout: on a headless launch the OS dispatches
to the task before any component renders.

## 6. Fallback tiers

| Tier | Trigger | Guaranteed? | Role |
|---|---|---|---|
| Silent push | Device is due for a refresh | No | Targeted, demand-driven |
| `expo-background-task` | iOS grants time, 15-min floor | No | Catch-up, and full coverage if push fails entirely |
| Foreground | App opened | **Yes** | The freshness guarantee. Never removed. |

All three call `runWeatherRefresh`. The background task keeps its current
unconditional registration and 15-minute floor — it is not downgraded to a
"legacy" path, because it is the only tier that still works if APNs, Expo's push
service, or our own cron is down. The foreground path is untouched.

## 7. What keeps the cost down

| Control | Effect |
|---|---|
| Server makes zero upstream weather requests | No standing API cost at all |
| Only devices past their own due time are woken | Active users generate no pushes |
| Dormant devices (no refresh in 14 days) skipped | Abandoned installs cost nothing |
| Per-device floor (~20 min) and daily cap | Stays inside Apple's guidance |
| `ttl: 900` | No battery spent on a wake whose reason expired |
| Heartbeat only on material change or 7-day expiry | Registration is not per-launch traffic |

## 8. iOS limitations — none of them worked around

| Limitation | Consequence | What we do |
|---|---|---|
| App force-quit by the user | iOS delivers no background push and runs no `BGTask` | Nothing. Foreground refresh covers it. Not defeatable; don't try. |
| Apple's "two or three per hour" guidance | Exceeding it throttles the **app**, not the message | Hard per-device budget in the sender |
| `priority: normal` is APNs 5 | Apple explicitly may delay, coalesce or drop these | Every push is advisory; correctness never depends on one arriving |
| Low Power Mode | Background pushes and background tasks both suspended | Foreground refresh |
| Receipts confirm handoff, not execution | `status: ok` means APNs accepted it, not that our task ran | The device's own `lastRefreshAt` on the next heartbeat is the only trustworthy signal |
| Delivery is not an alert channel | — | See below |

**A silent push must never be the delivery mechanism for a severe-weather
warning.** It is explicitly droppable, throttled, and dead when the app is
force-quit. The existing local-notification path stays exactly as it is. If we
later want warnings to reach users who haven't opened the app, that is a
*visible* push — a different message, a different priority, and a different
design conversation.

## 9. A pre-existing hole this makes more visible

Independent of which architecture ships, and worth fixing first.

`isActiveAlert` in `lib/weather.ts:248` filters expired alerts at **parse** time,
not at render time. Once an alert is in `umbra.weatherCache`, nothing re-checks
it — and `isActiveAlert(undefined)` returns `true`, so an alert with no `ends`
never expires at all. The awareness-cache filter added alongside the background
work (`liveAwareness`) closes part of this for the Storms tab, but only against
`ends`/`validTo` — which catches **expiry** and not **cancellation**, because a
canceled warning can still carry a future end time.

Cache warming makes this more visible rather than causing it: the cold-start path
now adopts the cache and clears `loading` immediately, so a stale alert is on
screen sooner and for longer.

The asymmetry to encode: **a cache proves an alert existed when it was written;
it never proves one still exists.** Positive severe-weather claims should
therefore decay with cache age — beyond ~15–20 minutes, render them as "as of
HH:MM" rather than as a live active warning, until a fetch confirms. Ordinary
forecast data has no such constraint.

## Required configuration

**`app.config.js`** — the plugin entry becomes:

```js
['expo-notifications', { enableBackgroundRemoteNotifications: true }]
```

which adds `remote-notification` to `UIBackgroundModes`. The Info.plist
currently carries `processing` and `fetch`. **This is a native change — it needs
a prebuild and a new build, not an OTA update.**

**EAS credentials** — an APNs push key must exist for the project. The app has
only ever used local notifications, so there is probably no key yet; without one
`getExpoPushTokenAsync` fails and nothing delivers. `eas credentials` handles it.

**Server env** — `CRON_SECRET` (the bearer pattern Vercel documents for cron
handlers), `EXPO_ACCESS_TOKEN` (optional, enables push security), plus storage
credentials.

**`server/vercel.json`** — a `crons` entry for `/api/cron/wake` plus `functions`
limits for the three new endpoints.

**Storage** — nothing is provisioned today. Vercel KV / Upstash Redis fits: one
hash and one sorted set, which Redis expresses directly. (I could not read the
project's environment variables to confirm — the MCP token lacks scope for
`brannonglovers-projects` — so please verify nothing is already attached.)

## Verified against the live project

Checked against `grey-sky-radar` (`prj_eDEpKsLWIKEncCpDMakPfbqaNEOF`) rather
than assumed:

| Finding | Status |
|---|---|
| Production API reachable despite Deployment Protection | **Confirmed** — `/api/spc/outlook` returns 200 on the production `.vercel.app` alias |
| Cron jobs currently configured | **None** |
| Vercel CLI authenticated | Yes, scope `brannonglovers-projects` |
| Plan | **Could not determine** — see below |

`ssoProtection` is enabled at `all_except_custom_domains`. Production is
unaffected, but **preview deployments are protected**, so the registration
endpoints will not be testable from a preview URL without a bypass token.

### The cron cadence constraint

Vercel's documented limits, which decide whether the push tier is viable at all:

| Plan | Minimum interval | Scheduling precision |
|---|---|---|
| Hobby | **Once per day** | Per-hour (±59 min) |
| Pro / Enterprise | Once per minute | Per-minute |

On Hobby a more frequent expression **fails at deploy time**, so this is not a
degradation — it is a hard stop. Devices come due roughly every two hours; a
once-daily drain would wake each device at most once a day with an hour of
jitter, which is barely better than the background task already manages and not
worth the moving parts.

**The project's plan could not be read.** The MCP token returns 403 for
team-scoped reads under `brannonglovers-projects`, no CLI command exposes the
plan, and reading the CLI's stored credential is blocked by policy. This needs
an answer before steps 2-4 proceed.

If the answer is Hobby, the options are to upgrade to Pro, drive
`/api/cron/wake` from an external scheduler (GitHub Actions or similar) with the
`CRON_SECRET` bearer, or drop the push tier and keep the two tiers that already
work.

## Open decisions

1. **Does a push token require notification permission?** Apple allows silent
   pushes without alert authorization, but `expo-notifications` may gate
   `getExpoPushTokenAsync` on granted permissions. If it does, users with alerts
   off get the background-task and foreground tiers only. Worth a spike before
   committing to the registration flow.
3. **Android** — in scope now, or iOS first? The same task fires, but Doze and
   FCM data-message behaviour need their own pass.

---

## Appendix: the event-aware alternative

Recorded because the capability it enables is real, and because the comparison
is the justification for the design above.

That design added: coarse geohash cells per device, an active-cell index,
state-grouped NWS alert fetching, per-cell situation fingerprints combining
alerts/SPC/tropical/nowcast, a `warrantsWake()` escalation predicate, and
separate escalation and keep-warm push budgets.

| | Minimal (recommended) | Event-aware |
|---|---|---|
| **Freshness, quiet weather** | Identical — both fall back to a timer | Identical |
| **Freshness, active weather** | Wake within the device's due window | Wake ~1 cron tick after the change |
| **Cancellation correctness** | Automatic; every wake is a full refresh | Actively broken by the escalation rule |
| **Server upstream cost** | Zero | NWS per state + SPC + NHC, every tick, forever |
| **Push volume** | One per device per due interval | Same, plus event pushes |
| **Reliability** | Fails to "no pushes" → BGTask + foreground | Parser bug yields an empty fingerprint that reads as "quiet" and silently suppresses wakes |
| **Server complexity** | 3 endpoints, 2 keys, no weather code | Above plus two parsing modules, point-in-polygon, fixtures, fingerprint versioning |
| **Ops hazard** | None | Changing the fingerprint shape invalidates every cell at once → mass push storm on deploy |
| **Enables later** | Warm caches | Server-sent *visible* warnings |

Three things decided it:

**The event tier is a superset, not a different path.** Its keep-warm tier *is*
the minimal design. Shipping minimal now and adding event-awareness later is
strictly additive — no rework, no migration.

**Its low latency serves a channel that can't use it.** Event-awareness buys
seconds-to-minutes on material change. For cache warming that is invisible — the
user isn't looking. It would matter for alerting, and silent push must not be the
alerting channel.

**The real payoff belongs to a feature we're not building.** Server-side weather
evaluation is genuinely required for visible server-sent warnings. But that
feature needs things this design doesn't have — per-user dedup of what each
person has already been told, quiet hours, severity thresholds, notification
copy. Building the evaluation now means building it against requirements that
don't exist yet, and probably rebuilding it when they do.

**Correction to the earlier draft.** It claimed server-side evaluation would
*reduce* total upstream requests by collapsing per-device polling. That was
wrong. Devices poll NWS, SPC and NHC on their foreground timers only while the
app is open, and server-side evaluation does not replace that polling — the
app keeps doing it either way. The server's upstream load would have been purely
additive and permanent.
