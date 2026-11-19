-- Hello Chingu Café pre-orders. Safe to run once.
-- Apply this BEFORE deploying the updated edge function.
-- Re-running does not replace menu rows, hours, or the CAF- order counter.
-- Prices are centavos. Delivery in the building is ₱20 (2000).
-- Order numbers are CAF-0001 and up, separate from the shelf sequences.
-- Telegram uses app_secrets key telegram_coffee_chat_id when the owner adds it.
-- This file does not insert that chat id. If the key is missing, orders still complete.
-- Slot rules match supabase/functions/store/cafe.ts: Asia/Manila, today and tomorrow
-- only, aligned to the opening time, at least lead_min ahead, and strictly before close.

create table if not exists public.cafe_settings (
  id text primary key check (id = 'main'),
  accepting integer not null default 1 check (accepting in (0, 1)),
  lead_min integer not null default 15 check (lead_min >= 0 and lead_min <= 180),
  slot_min integer not null default 15 check (slot_min in (5, 10, 15, 20, 30, 60)),
  delivery_fee integer not null default 2000 check (delivery_fee >= 0 and delivery_fee <= 100000000),
  hours jsonb not null,
  order_seq integer not null default 0 check (order_seq >= 0)
);

create table if not exists public.cafe_categories (
  id text primary key check (id ~ '^[a-z0-9-]{1,48}$'),
  name text not null check (char_length(name) between 1 and 40),
  seq integer not null,
  active integer not null default 1 check (active in (0, 1))
);

create table if not exists public.cafe_items (
  id text primary key check (id ~ '^[a-z0-9-]{1,48}$'),
  category_id text not null references public.cafe_categories (id),
  name text not null check (char_length(name) between 1 and 80),
  sizes jsonb not null,
  available integer not null default 1 check (available in (0, 1)),
  starred integer not null default 0 check (starred in (0, 1)),
  must_try integer not null default 0 check (must_try in (0, 1)),
  seq integer not null,
  active integer not null default 1 check (active in (0, 1))
);

create table if not exists public.cafe_addons (
  id text primary key check (id ~ '^[a-z0-9-]{1,48}$'),
  name text not null check (char_length(name) between 1 and 40),
  price integer not null check (price >= 0 and price <= 100000000),
  seq integer not null,
  active integer not null default 1 check (active in (0, 1))
);

create table if not exists public.cafe_orders (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  num text not null unique check (num ~ '^CAF-[0-9]{4,}$'),
  ts timestamptz not null default now(),
  items jsonb not null,
  subtotal integer not null check (subtotal >= 0 and subtotal <= 1000000000),
  delivery_fee integer not null check (delivery_fee >= 0 and delivery_fee <= 100000000),
  total integer not null check (total >= 0 and total <= 1000000000),
  fulfilment text not null check (fulfilment in ('pickup', 'delivery')),
  area text not null default '' check (char_length(area) <= 80),
  spot text not null default '' check (char_length(spot) <= 80),
  slot_at timestamptz not null,
  customer text not null check (char_length(customer) between 1 and 80),
  note text not null default '' check (char_length(note) <= 200),
  bank text not null default '' check (char_length(bank) <= 40),
  proof text not null default '' check (char_length(proof) <= 80),
  status text not null default 'New' check (status in ('New', 'Preparing', 'Ready', 'Out for delivery', 'Completed', 'Cancelled'))
);

create index if not exists cafe_items_category_idx on public.cafe_items (category_id, seq);
create index if not exists cafe_orders_ts_idx on public.cafe_orders (ts desc);
create index if not exists cafe_orders_slot_idx on public.cafe_orders (slot_at);
create index if not exists cafe_orders_customer_ts_idx on public.cafe_orders (lower(customer), ts desc);

create or replace function public.cafe_settings_check()
returns trigger
language plpgsql
set search_path to ''
as $fn$
declare
  i integer;
  row jsonb;
  open_txt text;
  close_txt text;
  closed integer;
  open_min integer;
  close_min integer;
begin
  if jsonb_typeof(new.hours) <> 'array' or jsonb_array_length(new.hours) <> 7 then
    raise exception 'BAD_CAFE' using errcode = 'P0001';
  end if;
  for i in 0..6 loop
    row := new.hours -> i;
    if row is null or jsonb_typeof(row) <> 'object' then
      raise exception 'BAD_CAFE' using errcode = 'P0001';
    end if;
    open_txt := row->>'open';
    close_txt := row->>'close';
    if open_txt !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or close_txt !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'BAD_CAFE' using errcode = 'P0001';
    end if;
    begin
      closed := (row->>'closed')::integer;
    exception when others then
      raise exception 'BAD_CAFE' using errcode = 'P0001';
    end;
    if closed is null or closed not in (0, 1) then
      raise exception 'BAD_CAFE' using errcode = 'P0001';
    end if;
    open_min := split_part(open_txt, ':', 1)::integer * 60 + split_part(open_txt, ':', 2)::integer;
    close_min := split_part(close_txt, ':', 1)::integer * 60 + split_part(close_txt, ':', 2)::integer;
    if closed = 0 and close_min <= open_min then
      raise exception 'BAD_CAFE' using errcode = 'P0001';
    end if;
  end loop;
  return new;
end;
$fn$;

create or replace function public.cafe_items_check()
returns trigger
language plpgsql
set search_path to ''
as $fn$
declare
  k text;
  n bigint;
  seen integer := 0;
begin
  if new.sizes is null or jsonb_typeof(new.sizes) <> 'object' then
    raise exception 'BAD_CAFE' using errcode = 'P0001';
  end if;
  for k in select pg_catalog.jsonb_object_keys(new.sizes) loop
    if k not in ('Reg', 'Med', 'Lrg') then
      raise exception 'BAD_CAFE' using errcode = 'P0001';
    end if;
    if pg_catalog.jsonb_typeof(new.sizes -> k) <> 'number' or (new.sizes ->> k) !~ '^[0-9]+$' then
      raise exception 'BAD_CAFE' using errcode = 'P0001';
    end if;
    n := (new.sizes ->> k)::bigint;
    if n < 1 or n > 100000000 then
      raise exception 'BAD_CAFE' using errcode = 'P0001';
    end if;
    seen := seen + 1;
  end loop;
  if seen < 1 then
    raise exception 'BAD_CAFE' using errcode = 'P0001';
  end if;
  return new;
end;
$fn$;

drop trigger if exists cafe_settings_check on public.cafe_settings;
create trigger cafe_settings_check
before insert or update on public.cafe_settings
for each row execute function public.cafe_settings_check();

drop trigger if exists cafe_items_check on public.cafe_items;
create trigger cafe_items_check
before insert or update of sizes on public.cafe_items
for each row execute function public.cafe_items_check();

insert into public.cafe_settings (id, accepting, lead_min, slot_min, delivery_fee, hours)
values (
  'main', 1, 15, 15, 2000,
  '[
    {"open":"08:00","close":"19:00","closed":0},
    {"open":"08:00","close":"19:00","closed":0},
    {"open":"08:00","close":"19:00","closed":0},
    {"open":"08:00","close":"19:00","closed":0},
    {"open":"08:00","close":"19:00","closed":0},
    {"open":"08:00","close":"19:00","closed":0},
    {"open":"08:00","close":"19:00","closed":0}
  ]'::jsonb
)
on conflict (id) do nothing;

insert into public.cafe_categories (id, name, seq, active) values
  ('cat-coffee', 'Coffee', 1, 1),
  ('cat-matcha', 'Matcha', 2, 1),
  ('cat-non', 'Non-coffee', 3, 1),
  ('cat-refresh', 'Refreshments', 4, 1),
  ('cat-tea', 'Tea', 5, 1)
on conflict (id) do nothing;

insert into public.cafe_items (id, category_id, name, sizes, available, starred, must_try, seq, active) values
  ('drink-americano', 'cat-coffee', 'Americano / Long Black', '{"Reg":9500,"Med":11000,"Lrg":12500}'::jsonb, 1, 0, 0, 1, 1),
  ('drink-coffee-latte', 'cat-coffee', 'Coffee Latte', '{"Reg":11000,"Med":12500,"Lrg":15000}'::jsonb, 1, 0, 0, 2, 1),
  ('drink-spanish-latte', 'cat-coffee', 'Spanish Latte', '{"Reg":11000,"Med":12500,"Lrg":15000}'::jsonb, 1, 1, 0, 3, 1),
  ('drink-white-mocha', 'cat-coffee', 'White Mocha', '{"Reg":11500,"Med":13500,"Lrg":16000}'::jsonb, 1, 0, 0, 4, 1),
  ('drink-dark-mocha', 'cat-coffee', 'Dark Mocha', '{"Reg":12000,"Med":13500,"Lrg":16000}'::jsonb, 1, 0, 0, 5, 1),
  ('drink-caramel-macchiato', 'cat-coffee', 'Caramel Macchiato', '{"Reg":11500,"Med":13500,"Lrg":16000}'::jsonb, 1, 1, 0, 6, 1),
  ('drink-caramel-latte', 'cat-coffee', 'Caramel Latte', '{"Reg":11000,"Med":12500,"Lrg":15000}'::jsonb, 1, 0, 0, 7, 1),
  ('drink-sea-salt-cheesecake', 'cat-coffee', 'Sea Salt Cheesecake', '{"Reg":12000,"Med":13500,"Lrg":16000}'::jsonb, 1, 1, 0, 8, 1),
  ('drink-cappuccino', 'cat-coffee', 'Cappuccino', '{"Reg":12000,"Med":13500,"Lrg":16000}'::jsonb, 1, 0, 0, 9, 1),
  ('drink-banana-latte-espresso', 'cat-coffee', 'Banana Latte Espresso', '{"Reg":15000,"Med":16500,"Lrg":19500}'::jsonb, 1, 1, 0, 10, 1),
  ('drink-dark-mocha-oreo', 'cat-coffee', 'Dark Mocha Oreo', '{"Reg":15000,"Med":16500,"Lrg":19500}'::jsonb, 1, 1, 0, 11, 1),
  ('drink-banana-split', 'cat-coffee', 'Banana Split Espresso', '{"Reg":17000,"Med":18500,"Lrg":22000}'::jsonb, 1, 0, 1, 12, 1),
  ('drink-matcha-latte', 'cat-matcha', 'Matcha Latte', '{"Reg":13000,"Med":14500,"Lrg":16500}'::jsonb, 1, 0, 0, 13, 1),
  ('drink-dirty-matcha', 'cat-matcha', 'Dirty Matcha Latte', '{"Reg":14000,"Med":15500,"Lrg":17500}'::jsonb, 1, 1, 0, 14, 1),
  ('drink-strawberry-matcha', 'cat-matcha', 'Strawberry Matcha', '{"Reg":15000,"Med":16500,"Lrg":19500}'::jsonb, 1, 1, 0, 15, 1),
  ('drink-spanish-matcha', 'cat-matcha', 'Spanish Matcha', '{"Reg":15000,"Med":16500,"Lrg":19500}'::jsonb, 1, 0, 0, 16, 1),
  ('drink-choco-choco', 'cat-non', 'Choco-Choco', '{"Reg":12000,"Med":13500,"Lrg":16500}'::jsonb, 1, 0, 0, 17, 1),
  ('drink-banana-latte', 'cat-non', 'Banana Latte', '{"Reg":13000,"Med":14500,"Lrg":16500}'::jsonb, 1, 1, 0, 18, 1),
  ('drink-mango-berry', 'cat-non', 'Mango Berry Latte', '{"Reg":15000,"Med":16500,"Lrg":19500}'::jsonb, 1, 1, 0, 19, 1),
  ('drink-exotic-latte', 'cat-non', 'Exotic Latte', '{"Reg":13000,"Med":14500,"Lrg":16500}'::jsonb, 1, 0, 1, 20, 1),
  ('drink-strawberry-soda', 'cat-refresh', 'Strawberry Soda', '{"Med":9900,"Lrg":12500}'::jsonb, 1, 1, 0, 21, 1),
  ('drink-lemon-soda', 'cat-refresh', 'Lemon Soda', '{"Med":9900,"Lrg":12500}'::jsonb, 1, 0, 0, 22, 1),
  ('drink-passion-soda', 'cat-refresh', 'Passion Soda', '{"Med":9900,"Lrg":12500}'::jsonb, 1, 1, 0, 23, 1),
  ('drink-kiwi-ade', 'cat-refresh', 'K. Kiwi Ade', '{"Med":8000,"Lrg":9900}'::jsonb, 1, 0, 1, 24, 1),
  ('drink-green-apple-ade', 'cat-refresh', 'K. Green Apple Ade', '{"Med":8000,"Lrg":9900}'::jsonb, 1, 0, 1, 25, 1),
  ('drink-watermelon-ade', 'cat-refresh', 'K. Watermelon Ade', '{"Med":8000,"Lrg":9900}'::jsonb, 1, 0, 0, 26, 1),
  ('drink-blue-lemonade', 'cat-refresh', 'K. Blue Lemonade', '{"Med":8000,"Lrg":9900}'::jsonb, 1, 1, 0, 27, 1),
  ('drink-passion-mango', 'cat-refresh', 'K. Passion Mango', '{"Med":8000,"Lrg":9900}'::jsonb, 1, 0, 0, 28, 1),
  ('drink-mango-juice', 'cat-refresh', 'Mango Juice', '{"Med":8000,"Lrg":9900}'::jsonb, 1, 0, 0, 29, 1),
  ('drink-english-breakfast', 'cat-tea', 'English Breakfast', '{"Med":12000,"Lrg":16000}'::jsonb, 1, 0, 0, 30, 1),
  ('drink-mint-green', 'cat-tea', 'Mint - Green Tea', '{"Med":12000,"Lrg":16000}'::jsonb, 1, 0, 0, 31, 1),
  ('drink-hibiscus', 'cat-tea', 'Hibiscus', '{"Med":13000,"Lrg":17000}'::jsonb, 1, 0, 0, 32, 1),
  ('drink-chamomile', 'cat-tea', 'Chamomile', '{"Med":13000,"Lrg":17000}'::jsonb, 1, 0, 0, 33, 1)
on conflict (id) do nothing;

insert into public.cafe_addons (id, name, price, active, seq) values
  ('addon-shot', 'Espresso Shot', 3500, 1, 1),
  ('addon-syrup', 'Syrup / Sauce Pump', 3000, 1, 2),
  ('addon-oat', 'Oatmilk', 4500, 1, 3),
  ('addon-lowfat', 'Low / Non Fat', 2000, 1, 4),
  ('addon-ceremonial', 'Ceremonial', 3000, 1, 5),
  ('addon-foam', 'Cold Foam', 5000, 1, 6),
  ('addon-nata', 'Nata', 2500, 1, 7),
  ('addon-jelly', 'Coffee Jelly', 3000, 1, 8)
on conflict (id) do nothing;

-- Prices are read from cafe_items and cafe_addons inside the lock.
-- The client total is ignored. Eight orders per customer name per hour,
-- the same cap the shelf uses for item requests.
create or replace function public.place_cafe_order(
  p_id text,
  p_items jsonb,
  p_fulfilment text,
  p_area text,
  p_spot text,
  p_slot timestamptz,
  p_customer text,
  p_note text,
  p_bank text,
  p_proof text
) returns jsonb
language plpgsql
set search_path to ''
as $fn$
declare
  cfg public.cafe_settings%rowtype;
  it jsonb;
  ad jsonb;
  item public.cafe_items%rowtype;
  addon public.cafe_addons%rowtype;
  v_qty integer;
  v_unit integer;
  v_add bigint;
  v_line bigint;
  v_sub bigint := 0;
  v_fee integer;
  v_total bigint;
  v_lines jsonb := '[]'::jsonb;
  v_addons jsonb;
  v_seq integer;
  v_num text;
  v_note text;
  v_customer text;
  v_order_note text;
  v_area text := '';
  v_spot text := '';
  v_seen text[];
  v_day date;
  v_today date;
  v_dow integer;
  v_hours jsonb;
  v_open text;
  v_close text;
  v_closed integer;
  v_open_min integer;
  v_close_min integer;
  v_slot_min integer;
  v_manila_slot timestamp;
  v_manila_now timestamp;
begin
  if exists (select 1 from public.cafe_orders where id = p_id) then
    return (
      select pg_catalog.jsonb_build_object(
        'id', o.id, 'num', o.num, 'total', o.total, 'subtotal', o.subtotal, 'existing', true,
        'items', o.items, 'slot', o.slot_at, 'fulfilment', o.fulfilment,
        'deliveryFee', o.delivery_fee, 'area', o.area, 'spot', o.spot,
        'customer', o.customer, 'note', o.note
      )
      from public.cafe_orders o where o.id = p_id
    );
  end if;

  if p_id is null or p_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;

  select * into cfg from public.cafe_settings where id = 'main' for update;
  if not found or cfg.accepting <> 1 then
    raise exception 'NOT_ACCEPTING' using errcode = 'P0001';
  end if;

  if p_fulfilment not in ('pickup', 'delivery') then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;
  if p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array' or pg_catalog.jsonb_array_length(p_items) < 1 or pg_catalog.jsonb_array_length(p_items) > 30 then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;
  v_customer := btrim(coalesce(p_customer, ''));
  v_order_note := btrim(coalesce(p_note, ''));
  if char_length(v_customer) < 1 or char_length(v_customer) > 80 or v_customer ~ '[[:cntrl:]]' then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;
  if char_length(v_order_note) > 200 or v_order_note ~ '[[:cntrl:]]' then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;
  if p_slot is null or p_slot <> date_trunc('minute', p_slot) then
    raise exception 'BAD_SLOT' using errcode = 'P0001';
  end if;
  if coalesce(p_bank, '') not in ('GCash', 'Maya (PayMaya)', 'BPI', 'MariBank')
     or coalesce(p_proof, '') !~* '^/file/proof-[0-9a-f-]{36}$' then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;

  v_manila_now := pg_catalog.timezone('Asia/Manila', pg_catalog.now());
  v_manila_slot := pg_catalog.timezone('Asia/Manila', p_slot);
  v_today := v_manila_now::date;
  v_day := v_manila_slot::date;
  if v_day <> v_today and v_day <> (v_today + 1) then
    raise exception 'BAD_SLOT' using errcode = 'P0001';
  end if;
  if p_slot < pg_catalog.now() + make_interval(mins => cfg.lead_min) then
    raise exception 'BAD_SLOT' using errcode = 'P0001';
  end if;
  v_dow := extract(isodow from v_day)::integer;
  v_hours := cfg.hours -> (v_dow - 1);
  if v_hours is null then
    raise exception 'BAD_SLOT' using errcode = 'P0001';
  end if;
  begin
    v_closed := coalesce((v_hours->>'closed')::integer, 1);
  exception when others then
    raise exception 'BAD_SLOT' using errcode = 'P0001';
  end;
  v_open := v_hours->>'open';
  v_close := v_hours->>'close';
  if v_closed = 1 or v_open is null or v_close is null
     or v_open !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or v_close !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'BAD_SLOT' using errcode = 'P0001';
  end if;
  v_open_min := split_part(v_open, ':', 1)::integer * 60 + split_part(v_open, ':', 2)::integer;
  v_close_min := split_part(v_close, ':', 1)::integer * 60 + split_part(v_close, ':', 2)::integer;
  v_slot_min := extract(hour from v_manila_slot)::integer * 60 + extract(minute from v_manila_slot)::integer;
  if v_close_min <= v_open_min or v_slot_min < v_open_min or v_slot_min >= v_close_min
     or ((v_slot_min - v_open_min) % cfg.slot_min) <> 0 then
    raise exception 'BAD_SLOT' using errcode = 'P0001';
  end if;

  if p_fulfilment = 'delivery' then
    v_area := btrim(coalesce(p_area, ''));
    v_spot := btrim(coalesce(p_spot, ''));
    if char_length(v_area) < 1 or char_length(v_area) > 80 or v_area ~ '[[:cntrl:]]'
       or char_length(v_spot) < 1 or char_length(v_spot) > 80 or v_spot ~ '[[:cntrl:]]' then
      raise exception 'BAD_ITEM' using errcode = 'P0001';
    end if;
    v_fee := cfg.delivery_fee;
  else
    v_fee := 0;
  end if;

  if (
    select count(*) from public.cafe_orders
    where ts >= pg_catalog.now() - interval '1 hour'
      and lower(customer) = lower(v_customer)
  ) >= 8 then
    raise exception 'RATE' using errcode = 'P0001';
  end if;

  for it in select value from pg_catalog.jsonb_array_elements(p_items) loop
    select * into item from public.cafe_items where id = it->>'id' for update;
    if not found or item.active <> 1 or item.available <> 1 then
      raise exception 'BAD_ITEM' using errcode = 'P0001';
    end if;
    if coalesce(it->>'size', '') not in ('Reg', 'Med', 'Lrg') or not pg_catalog.jsonb_exists(item.sizes, it->>'size') then
      raise exception 'BAD_ITEM' using errcode = 'P0001';
    end if;
    begin
      v_qty := (it->>'qty')::integer;
      v_unit := (item.sizes ->> (it->>'size'))::integer;
    exception when others then
      raise exception 'BAD_ITEM' using errcode = 'P0001';
    end;
    if v_qty is null or v_qty < 1 or v_qty > 20 or v_unit is null or v_unit <= 0 then
      raise exception 'BAD_ITEM' using errcode = 'P0001';
    end if;
    v_note := btrim(coalesce(it->>'note', ''));
    if char_length(v_note) > 80 or v_note ~ '[[:cntrl:]]' then
      raise exception 'BAD_ITEM' using errcode = 'P0001';
    end if;
    if it->'addons' is null or pg_catalog.jsonb_typeof(it->'addons') <> 'array' or pg_catalog.jsonb_array_length(it->'addons') > 8 then
      raise exception 'BAD_ITEM' using errcode = 'P0001';
    end if;
    v_add := 0;
    v_addons := '[]'::jsonb;
    v_seen := '{}';
    for ad in select value from pg_catalog.jsonb_array_elements(it->'addons') loop
      if pg_catalog.jsonb_typeof(ad) <> 'string' then
        raise exception 'BAD_ITEM' using errcode = 'P0001';
      end if;
      if (ad #>> '{}') = any (v_seen) then
        raise exception 'BAD_ITEM' using errcode = 'P0001';
      end if;
      v_seen := v_seen || (ad #>> '{}');
      select * into addon from public.cafe_addons where id = ad #>> '{}' and active = 1;
      if not found then
        raise exception 'BAD_ITEM' using errcode = 'P0001';
      end if;
      v_add := v_add + addon.price;
      v_addons := v_addons || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', addon.id, 'name', addon.name, 'price', addon.price));
    end loop;
    v_line := (v_unit::bigint + v_add) * v_qty::bigint;
    if v_line < 1 or v_line > 100000000 then
      raise exception 'BAD_ITEM' using errcode = 'P0001';
    end if;
    v_sub := v_sub + v_line;
    v_lines := v_lines || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id', item.id,
      'name', item.name,
      'size', it->>'size',
      'qty', v_qty,
      'unit', v_unit,
      'addons', v_addons,
      'note', v_note,
      'line', v_line
    ));
  end loop;

  v_total := v_sub + v_fee;
  if v_sub > 1000000000 or v_total > 1000000000 then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;

  update public.cafe_settings set order_seq = order_seq + 1 where id = 'main' returning order_seq into v_seq;
  v_num := 'CAF-' || lpad(v_seq::text, 4, '0');

  insert into public.cafe_orders (
    id, num, items, subtotal, delivery_fee, total, fulfilment, area, spot, slot_at, customer, note, bank, proof, status
  ) values (
    p_id, v_num, v_lines, v_sub::integer, v_fee, v_total::integer, p_fulfilment,
    v_area, v_spot, p_slot, v_customer, v_order_note, p_bank, p_proof, 'New'
  );

  return pg_catalog.jsonb_build_object(
    'id', p_id, 'num', v_num, 'total', v_total, 'subtotal', v_sub, 'deliveryFee', v_fee,
    'items', v_lines, 'slot', p_slot, 'fulfilment', p_fulfilment,
    'area', v_area, 'spot', v_spot, 'customer', v_customer, 'note', v_order_note
  );
exception
  when unique_violation then
    return (
      select pg_catalog.jsonb_build_object(
        'id', o.id, 'num', o.num, 'total', o.total, 'subtotal', o.subtotal, 'existing', true,
        'items', o.items, 'slot', o.slot_at, 'fulfilment', o.fulfilment,
        'deliveryFee', o.delivery_fee, 'area', o.area, 'spot', o.spot,
        'customer', o.customer, 'note', o.note
      )
      from public.cafe_orders o where o.id = p_id
    );
end;
$fn$;

create or replace function public.cafe_orders_status()
returns trigger
language plpgsql
set search_path to ''
as $fn$
declare
  ready text;
begin
  if new.id is distinct from old.id
     or new.num is distinct from old.num
     or new.items is distinct from old.items
     or new.subtotal is distinct from old.subtotal
     or new.delivery_fee is distinct from old.delivery_fee
     or new.total is distinct from old.total
     or new.fulfilment is distinct from old.fulfilment
     or new.area is distinct from old.area
     or new.spot is distinct from old.spot
     or new.slot_at is distinct from old.slot_at
     or new.customer is distinct from old.customer
     or new.note is distinct from old.note
     or new.bank is distinct from old.bank
     or new.proof is distinct from old.proof
     or new.ts is distinct from old.ts then
    raise exception 'BAD_STATUS' using errcode = 'P0001';
  end if;
  if new.status = old.status then
    return new;
  end if;
  ready := case when old.fulfilment = 'delivery' then 'Out for delivery' else 'Ready' end;
  if old.status = 'New' and new.status in ('Preparing', 'Cancelled') then
    return new;
  end if;
  if old.status = 'Preparing' and new.status in (ready, 'Cancelled') then
    return new;
  end if;
  if old.status in ('Ready', 'Out for delivery') and new.status in ('Completed', 'Cancelled') then
    return new;
  end if;
  raise exception 'BAD_STATUS' using errcode = 'P0001';
end;
$fn$;

drop trigger if exists cafe_orders_status on public.cafe_orders;
create trigger cafe_orders_status
before update on public.cafe_orders
for each row execute function public.cafe_orders_status();

revoke all on function public.cafe_settings_check() from public, anon, authenticated;
grant execute on function public.cafe_settings_check() to service_role;
revoke all on function public.cafe_items_check() from public, anon, authenticated;
grant execute on function public.cafe_items_check() to service_role;
revoke all on function public.place_cafe_order(text, jsonb, text, text, text, timestamptz, text, text, text, text) from public, anon, authenticated;
grant execute on function public.place_cafe_order(text, jsonb, text, text, text, timestamptz, text, text, text, text) to service_role;
revoke all on function public.cafe_orders_status() from public, anon, authenticated;
grant execute on function public.cafe_orders_status() to service_role;

do $$
declare t text;
begin
  foreach t in array array['cafe_settings', 'cafe_categories', 'cafe_items', 'cafe_addons', 'cafe_orders']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;
