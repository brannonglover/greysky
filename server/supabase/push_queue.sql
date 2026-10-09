-- Wake-queue tables for silent-push refresh.
-- Run once in the Supabase SQL editor (or via migration).
--
-- No location, no weather — only Expo tokens and due times.
-- The API uses the service-role key, so RLS is enabled and left with
-- no anon/authenticated policies (service role bypasses RLS).

create table if not exists public.push_devices (
  install_id text primary key,
  token text not null,
  platform text not null default 'unknown',
  app_version text not null default 'unknown',
  last_refresh_at bigint not null default 0,
  next_wake_after bigint not null default 0,
  last_push_at bigint not null default 0,
  push_count integer not null default 0,
  push_day text not null default '',
  updated_at bigint not null default 0
);

create index if not exists push_devices_due_idx
  on public.push_devices (next_wake_after);

create table if not exists public.push_tickets (
  ticket_id text primary key,
  install_id text not null references public.push_devices (install_id) on delete cascade,
  due_at bigint not null
);

create index if not exists push_tickets_due_idx
  on public.push_tickets (due_at);

alter table public.push_devices enable row level security;
alter table public.push_tickets enable row level security;
