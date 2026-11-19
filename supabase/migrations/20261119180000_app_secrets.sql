-- Telegram chat ids. The bot token is an edge function secret, not a row here.
-- Safe to run once. Does not insert or replace any values.
-- service_role only. RLS stays on with no policies, same as the other store tables.

create table if not exists public.app_secrets (
  k text primary key,
  v text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_secrets enable row level security;
revoke all on table public.app_secrets from public, anon, authenticated;
grant select, insert, update, delete on table public.app_secrets to service_role;
