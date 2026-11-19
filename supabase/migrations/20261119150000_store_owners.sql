-- Multiple store owners. Safe to run once.
-- Apply this BEFORE deploying the updated edge function.
-- public.config k='owner' stays. It is the fallback while this table is empty,
-- and the edge function repoints it when that person is removed from the team.
-- The original owner is copied in here so the current sign-in keeps working.

create table if not exists public.store_owners (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now(),
  constraint store_owners_email_ok check (
    email = lower(email)
    and char_length(email) between 3 and 200
    and position('@' in email) > 1
    and email !~ '[[:space:][:cntrl:]]'
  ),
  constraint store_owners_email_unique unique (email)
);

insert into public.store_owners (user_id, email, added_by, added_at)
select u.id, lower(btrim(u.email)), null, coalesce(u.created_at, now())
from public.config c
join auth.users u on u.id::text = lower(btrim(c.v))
where c.k = 'owner'
  and u.email is not null
  and char_length(lower(btrim(u.email))) between 3 and 200
  and position('@' in lower(btrim(u.email))) > 1
  and lower(btrim(u.email)) !~ '[[:space:][:cntrl:]]'
on conflict (user_id) do nothing;

create index if not exists store_owners_added_by_idx on public.store_owners (added_by);

-- Block deleting the final owner, including two deletes that race.
create or replace function public.store_owners_keep_one()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if (select count(*) from public.store_owners) <= 1 then
    raise exception 'LAST_OWNER' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists store_owners_keep_one on public.store_owners;
create trigger store_owners_keep_one
before delete on public.store_owners
for each row execute function public.store_owners_keep_one();

revoke all on function public.store_owners_keep_one() from public, anon, authenticated;
grant execute on function public.store_owners_keep_one() to service_role;

alter table public.store_owners enable row level security;
revoke all on table public.store_owners from public, anon, authenticated;
grant select, insert, update, delete on table public.store_owners to service_role;
