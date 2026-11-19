import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
  CAFE_ADDONS,
  CAFE_ITEMS,
  cafeSlots,
  coffeeCaption,
  defaultHours,
  hoursOk,
  lineTotal,
  nextCafeStatuses,
  orderMoney,
  receiptWhen,
  sizePrice,
  sizesOk,
  slotAllowed,
  todayLabel,
} from '../supabase/functions/store/cafe.ts';

const require = createRequire(import.meta.url);
const L = require('../store-logic.js');

const hours = defaultHours();
const at = (iso) => new Date(iso);

test('drink prices add the size, the add-ons, and the delivery fee from the menu', () => {
  const spanish = CAFE_ITEMS.find((item) => item.name === 'Spanish Latte');
  const oat = CAFE_ADDONS.find((item) => item.name === 'Oatmilk');
  const kiwi = CAFE_ITEMS.find((item) => item.name === 'K. Kiwi Ade');
  assert.equal(sizePrice(spanish.sizes, 'Med'), 12500);
  assert.equal(sizePrice(spanish.sizes, 'Reg'), 11000);
  assert.equal(sizePrice(kiwi.sizes, 'Reg'), null);
  assert.equal(sizePrice(kiwi.sizes, 'Lrg'), 9900);
  assert.equal(lineTotal(12500, [oat.price], 2), 34000);
  assert.equal(lineTotal(12500, [oat.price], 0), null);
  assert.equal(lineTotal(12500, [-1], 1), null);
  const pickup = orderMoney([17000, 9900], 2000, 'pickup');
  const delivery = orderMoney([17000, 9900], 2000, 'delivery');
  assert.deepEqual(pickup, { subtotal: 26900, deliveryFee: 0, total: 26900 });
  assert.deepEqual(delivery, { subtotal: 26900, deliveryFee: 2000, total: 28900 });
  assert.equal(orderMoney([17000], 2000, 'dine-in'), null);
  assert.equal(sizesOk({ Extra: 100 }), false);
  assert.equal(sizesOk({ Med: 9900, Lrg: 12500 }), true);
  assert.equal(L.formatOrderNo('CAF', 1), 'CAF-0001');
});

test('slots stay inside café hours for today and tomorrow in Manila', () => {
  const now = at('2026-11-19T07:03:00.000Z'); // 3:03 PM Thursday
  const slots = cafeSlots({ now, hours, leadMin: 15, slotMin: 15, accepting: true });
  assert.equal(slots[0].at, '2026-11-19T07:30:00.000Z');
  assert.equal(slots[0].day, 'today');
  assert.equal(slots[0].time, '3:30 PM');
  const today = slots.filter((slot) => slot.day === 'today');
  const tomorrow = slots.filter((slot) => slot.day === 'tomorrow');
  assert.equal(today.at(-1).at, '2026-11-19T10:45:00.000Z');
  assert.equal(today.at(-1).time, '6:45 PM');
  assert.equal(tomorrow[0].at, '2026-11-20T00:00:00.000Z');
  assert.equal(tomorrow[0].time, '8:00 AM');
  assert.equal(slots.some((slot) => slot.at.startsWith('2026-11-21')), false);
  assert.equal(slotAllowed(slots[0].at, { now, hours, leadMin: 15, slotMin: 15, accepting: true }), true);
  assert.equal(slotAllowed('2026-11-21T00:00:00.000Z', { now, hours, leadMin: 15, slotMin: 15, accepting: true }), false);
  assert.equal(cafeSlots({ now, hours, leadMin: 15, slotMin: 15, accepting: false }).length, 0);
  assert.equal(todayLabel(now, hours), 'Open today 8:00 AM – 7:00 PM');
});

test('lead time, closing, and a closed weekday remove slots', () => {
  const late = cafeSlots({
    now: at('2026-11-19T10:50:00.000Z'), // 6:50 PM
    hours, leadMin: 15, slotMin: 15, accepting: true,
  });
  assert.equal(late.some((slot) => slot.day === 'today'), false);
  assert.equal(late[0].time, '8:00 AM');
  assert.equal(late[0].day, 'tomorrow');

  const open = cafeSlots({
    now: at('2026-11-19T00:00:00.000Z'), // 8:00 AM exactly
    hours, leadMin: 15, slotMin: 15, accepting: true,
  });
  assert.equal(open[0].at, '2026-11-19T00:15:00.000Z');
  assert.equal(open.some((slot) => slot.time === '8:00 AM' && slot.day === 'today'), false);

  const fridayOff = defaultHours();
  fridayOff[4] = { open: '08:00', close: '19:00', closed: true };
  const friday = cafeSlots({
    now: at('2026-11-19T07:03:00.000Z'),
    hours: fridayOff, leadMin: 15, slotMin: 15, accepting: true,
  });
  assert.equal(friday.some((slot) => slot.day === 'tomorrow'), false);
  assert.equal(friday.at(-1).day, 'today');

  const sundayOff = defaultHours();
  sundayOff[6] = { open: '08:00', close: '19:00', closed: true };
  const saturdayNight = cafeSlots({
    now: at('2026-11-21T10:00:00.000Z'), // 6:00 PM Saturday
    hours: sundayOff, leadMin: 15, slotMin: 15, accepting: true,
  });
  assert.deepEqual(saturdayNight.map((slot) => slot.time), ['6:15 PM', '6:30 PM', '6:45 PM']);
  assert.equal(saturdayNight.every((slot) => slot.day === 'today'), true);

  const midnight = cafeSlots({
    now: at('2026-11-19T15:50:00.000Z'), // 11:50 PM Thursday
    hours, leadMin: 15, slotMin: 15, accepting: true,
  });
  assert.equal(midnight[0].at, '2026-11-20T00:00:00.000Z');
  assert.equal(midnight[0].day, 'tomorrow');
  assert.equal(midnight.some((slot) => slot.at === '2026-11-21T00:00:00.000Z'), false);
  assert.equal(hoursOk([{ open: '19:00', close: '08:00', closed: false }]), false);
  assert.equal(hoursOk(hours), true);
});

test('coffee caption lists the slot, the drinks, and escapes HTML', () => {
  const slot = at('2026-11-20T00:15:00.000Z');
  const text = coffeeCaption({
    num: 'CAF-0001',
    fulfilment: 'delivery',
    area: 'Ore 20th Floor',
    spot: 'Desk 4B',
    slot,
    items: [
      { name: 'Spanish Latte', size: 'Med', qty: 1, addons: ['Oatmilk'], note: 'less sweet' },
      { name: 'K. Kiwi Ade', size: 'Lrg', qty: 1, addons: [], note: '' },
    ],
    deliveryFee: 2000,
    total: 28900,
    customer: 'Ana Cruz',
    note: 'Call when you arrive',
  });
  assert.equal(text, [
    '<b>CAF-0001</b>',
    'Delivery · Ore 20th Floor · Desk 4B',
    'Nov 20, 2026 · 8:15 AM',
    '',
    '1 × Spanish Latte (Med) + Oatmilk',
    '  less sweet',
    '1 × K. Kiwi Ade (Lrg)',
    '',
    'Delivery fee PHP 20',
    '<b>Total PHP 289</b>',
    '',
    'Ana Cruz',
    'Call when you arrive',
  ].join('\n'));
  assert.equal(receiptWhen('delivery', slot, 'Ore 20th Floor', 'Desk 4B'), 'Delivery · Ore 20th Floor, Desk 4B · Nov 20, 2026 · 8:15 AM');
  assert.equal(receiptWhen('pickup', slot), 'Pickup · Nov 20, 2026 · 8:15 AM');

  const escaped = coffeeCaption({
    num: 'CAF-0002',
    fulfilment: 'pickup',
    slot,
    items: [{ name: 'A & B <latte>', size: 'Reg', qty: 2, addons: ['Syrup / Sauce'], note: 'no <ice>' }],
    deliveryFee: 0,
    total: 19000,
    customer: 'Ana & Bo',
    note: '',
  });
  assert.match(escaped, /Pickup · Hello Chingu Café, Ore 15th Floor/);
  assert.match(escaped, /2 × A &amp; B &lt;latte&gt; \(Reg\) \+ Syrup \/ Sauce/);
  assert.match(escaped, /no &lt;ice&gt;/);
  assert.match(escaped, /Ana &amp; Bo/);
  assert.match(escaped, /Delivery fee PHP 0/);
  assert.equal(escaped.includes('Call when'), false);

  const many = Array.from({ length: 30 }, (_, i) => ({
    name: 'X'.repeat(70) + i,
    size: 'Lrg',
    qty: 1,
    addons: ['Oatmilk', 'Cold Foam'],
    note: 'Y'.repeat(70),
  }));
  const long = coffeeCaption({
    num: 'CAF-0099', fulfilment: 'delivery', area: 'Lobby', spot: 'Guard', slot,
    items: many, deliveryFee: 2000, total: 4000, customer: 'Ana Cruz', note: 'leave it',
  });
  assert.ok(long.length <= 1024);
  assert.equal(long.includes('Ana Cruz'), false);
  assert.equal(long.includes('leave it'), false);
  assert.match(long, /…/);
});

test('status moves one step, with ready or out for delivery based on the trip', () => {
  assert.deepEqual(nextCafeStatuses('pickup', 'New'), ['Preparing', 'Cancelled']);
  assert.deepEqual(nextCafeStatuses('pickup', 'Preparing'), ['Ready', 'Cancelled']);
  assert.deepEqual(nextCafeStatuses('delivery', 'Preparing'), ['Out for delivery', 'Cancelled']);
  assert.deepEqual(nextCafeStatuses('pickup', 'Ready'), ['Completed', 'Cancelled']);
  assert.deepEqual(nextCafeStatuses('delivery', 'Out for delivery'), ['Completed', 'Cancelled']);
  assert.deepEqual(nextCafeStatuses('pickup', 'Completed'), []);
  assert.deepEqual(nextCafeStatuses('delivery', 'Cancelled'), []);
});

test('the migration seeds the menu, locks the tables, and does not invent a chat id', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261119220000_cafe.sql', import.meta.url), 'utf8');
  CAFE_ITEMS.forEach((item, index) => {
    const tuple = `('${item.id}', '${item.categoryId}', '${item.name}', '${JSON.stringify(item.sizes)}'::jsonb, 1, ${item.starred ? 1 : 0}, ${item.mustTry ? 1 : 0}, ${index + 1}, 1)`;
    assert.ok(sql.includes(tuple), item.name);
  });
  CAFE_ADDONS.forEach((addon, index) => {
    assert.ok(sql.includes(`('${addon.id}', '${addon.name}', ${addon.price}, 1, ${index + 1})`), addon.name);
  });
  assert.equal(sql.includes('Hibiscuss'), false);
  assert.ok(sql.includes('Hibiscus'));
  assert.ok(sql.includes('Chamomile'));
  assert.match(sql, /array\['cafe_settings', 'cafe_categories', 'cafe_items', 'cafe_addons', 'cafe_orders'\]/);
  assert.match(sql, /enable row level security/);
  assert.equal((sql.match(/create policy/gi) || []).length, 0);
  assert.match(sql, /revoke all on table public\.%I from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update, delete on table public\.%I to service_role/);
  assert.match(sql, /grant execute on function public\.place_cafe_order/);
  assert.match(sql, /telegram_coffee_chat_id/);
  assert.equal(/insert into public\.app_secrets/i.test(sql), false);
  assert.match(sql, /lead_min integer not null default 15/);
  assert.match(sql, /slot_min integer not null default 15/);
  assert.match(sql, /delivery_fee integer not null default 2000/);
  assert.match(sql, /'CAF-' \|\| lpad/);
  const sales = L.cafeSales([
    { ts: '2026-11-19T02:00:00Z', total: 28900, status: 'New' },
    { ts: '2026-11-19T03:00:00Z', total: 9900, status: 'Cancelled' },
    { ts: '2026-11-18T03:00:00Z', total: 5000, status: 'Completed' },
  ], at('2026-11-18T16:00:00.000Z'), at('2026-11-19T07:03:00.000Z'));
  assert.deepEqual(sales, { total: 28900, orders: 1 });
  assert.equal(L.formatManila(at('2026-11-19T06:15:00.000Z')), 'Nov 19, 2026 · 2:15 PM');
});
