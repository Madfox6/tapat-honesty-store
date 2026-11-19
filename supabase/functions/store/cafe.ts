// Pure café rules for Hello Chingu Café. No secrets and no network.
// The edge function and the SQL place_cafe_order function both follow these rules:
// prices come from the menu, slots are today and tomorrow in Asia/Manila,
// aligned to the opening time, at least leadMin ahead, and strictly before close.

import { CAPTION_MAX, escHtml, manilaStamp, peso } from './telegram.ts';

export const CAFE_NAME = 'Hello Chingu Café';
export const CAFE_PLACE = 'Ore 15th Floor';
export const DELIVERY_FEE = 2000;
export const DEFAULT_LEAD = 15;
export const DEFAULT_SLOT = 15;
export const SLOT_CHOICES = [5, 10, 15, 20, 30, 60];
export const SIZES = ['Reg', 'Med', 'Lrg'] as const;
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const AREAS = [
  { id: 'O20', name: 'Ore 20th Floor' },
  { id: 'O15', name: 'Ore 15th Floor' },
  { id: 'NEO', name: '2 Neo' },
];

const MANILA_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DayHours = { open: string; close: string; closed: boolean };
export type SizeName = (typeof SIZES)[number];

export type CafeSeedItem = {
  id: string;
  categoryId: string;
  name: string;
  sizes: Partial<Record<SizeName, number>>;
  starred: boolean;
  mustTry: boolean;
};

export type CafeSeedAddon = { id: string; name: string; price: number };

const drink = (
  id: string,
  categoryId: string,
  name: string,
  prices: number[],
  sizes: SizeName[],
  flags: { starred?: boolean; mustTry?: boolean } = {},
): CafeSeedItem => ({
  id,
  categoryId,
  name,
  sizes: Object.fromEntries(sizes.map((size, i) => [size, prices[i] * 100])) as CafeSeedItem['sizes'],
  starred: !!flags.starred,
  mustTry: !!flags.mustTry,
});

const RML: SizeName[] = ['Reg', 'Med', 'Lrg'];
const ML: SizeName[] = ['Med', 'Lrg'];

export const CAFE_CATEGORIES = [
  { id: 'cat-coffee', name: 'Coffee' },
  { id: 'cat-matcha', name: 'Matcha' },
  { id: 'cat-non', name: 'Non-coffee' },
  { id: 'cat-refresh', name: 'Refreshments' },
  { id: 'cat-tea', name: 'Tea' },
];

export const CAFE_ITEMS: CafeSeedItem[] = [
  drink('drink-americano', 'cat-coffee', 'Americano / Long Black', [95, 110, 125], RML),
  drink('drink-coffee-latte', 'cat-coffee', 'Coffee Latte', [110, 125, 150], RML),
  drink('drink-spanish-latte', 'cat-coffee', 'Spanish Latte', [110, 125, 150], RML, { starred: true }),
  drink('drink-white-mocha', 'cat-coffee', 'White Mocha', [115, 135, 160], RML),
  drink('drink-dark-mocha', 'cat-coffee', 'Dark Mocha', [120, 135, 160], RML),
  drink('drink-caramel-macchiato', 'cat-coffee', 'Caramel Macchiato', [115, 135, 160], RML, { starred: true }),
  drink('drink-caramel-latte', 'cat-coffee', 'Caramel Latte', [110, 125, 150], RML),
  drink('drink-sea-salt-cheesecake', 'cat-coffee', 'Sea Salt Cheesecake', [120, 135, 160], RML, { starred: true }),
  drink('drink-cappuccino', 'cat-coffee', 'Cappuccino', [120, 135, 160], RML),
  drink('drink-banana-latte-espresso', 'cat-coffee', 'Banana Latte Espresso', [150, 165, 195], RML, { starred: true }),
  drink('drink-dark-mocha-oreo', 'cat-coffee', 'Dark Mocha Oreo', [150, 165, 195], RML, { starred: true }),
  drink('drink-banana-split', 'cat-coffee', 'Banana Split Espresso', [170, 185, 220], RML, { mustTry: true }),
  drink('drink-matcha-latte', 'cat-matcha', 'Matcha Latte', [130, 145, 165], RML),
  drink('drink-dirty-matcha', 'cat-matcha', 'Dirty Matcha Latte', [140, 155, 175], RML, { starred: true }),
  drink('drink-strawberry-matcha', 'cat-matcha', 'Strawberry Matcha', [150, 165, 195], RML, { starred: true }),
  drink('drink-spanish-matcha', 'cat-matcha', 'Spanish Matcha', [150, 165, 195], RML),
  drink('drink-choco-choco', 'cat-non', 'Choco-Choco', [120, 135, 165], RML),
  drink('drink-banana-latte', 'cat-non', 'Banana Latte', [130, 145, 165], RML, { starred: true }),
  drink('drink-mango-berry', 'cat-non', 'Mango Berry Latte', [150, 165, 195], RML, { starred: true }),
  drink('drink-exotic-latte', 'cat-non', 'Exotic Latte', [130, 145, 165], RML, { mustTry: true }),
  drink('drink-strawberry-soda', 'cat-refresh', 'Strawberry Soda', [99, 125], ML, { starred: true }),
  drink('drink-lemon-soda', 'cat-refresh', 'Lemon Soda', [99, 125], ML),
  drink('drink-passion-soda', 'cat-refresh', 'Passion Soda', [99, 125], ML, { starred: true }),
  drink('drink-kiwi-ade', 'cat-refresh', 'K. Kiwi Ade', [80, 99], ML, { mustTry: true }),
  drink('drink-green-apple-ade', 'cat-refresh', 'K. Green Apple Ade', [80, 99], ML, { mustTry: true }),
  drink('drink-watermelon-ade', 'cat-refresh', 'K. Watermelon Ade', [80, 99], ML),
  drink('drink-blue-lemonade', 'cat-refresh', 'K. Blue Lemonade', [80, 99], ML, { starred: true }),
  drink('drink-passion-mango', 'cat-refresh', 'K. Passion Mango', [80, 99], ML),
  drink('drink-mango-juice', 'cat-refresh', 'Mango Juice', [80, 99], ML),
  drink('drink-english-breakfast', 'cat-tea', 'English Breakfast', [120, 160], ML),
  drink('drink-mint-green', 'cat-tea', 'Mint - Green Tea', [120, 160], ML),
  drink('drink-hibiscus', 'cat-tea', 'Hibiscus', [130, 170], ML),
  drink('drink-chamomile', 'cat-tea', 'Chamomile', [130, 170], ML),
];

export const CAFE_ADDONS: CafeSeedAddon[] = [
  { id: 'addon-shot', name: 'Espresso Shot', price: 3500 },
  { id: 'addon-syrup', name: 'Syrup / Sauce Pump', price: 3000 },
  { id: 'addon-oat', name: 'Oatmilk', price: 4500 },
  { id: 'addon-lowfat', name: 'Low / Non Fat', price: 2000 },
  { id: 'addon-ceremonial', name: 'Ceremonial', price: 3000 },
  { id: 'addon-foam', name: 'Cold Foam', price: 5000 },
  { id: 'addon-nata', name: 'Nata', price: 2500 },
  { id: 'addon-jelly', name: 'Coffee Jelly', price: 3000 },
];

export function defaultHours(): DayHours[] {
  return WEEKDAYS.map(() => ({ open: '08:00', close: '19:00', closed: false }));
}

export function parseHHMM(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function hoursOk(value: unknown): value is DayHours[] {
  if (!Array.isArray(value) || value.length !== 7) return false;
  return value.every((day) => {
    if (!day || typeof day !== 'object') return false;
    const row = day as DayHours;
    const open = parseHHMM(row.open);
    const close = parseHHMM(row.close);
    if (open == null || close == null) return false;
    if (typeof row.closed !== 'boolean') return false;
    if (!row.closed && close <= open) return false;
    return true;
  });
}

export function sizesOk(value: unknown): value is Partial<Record<SizeName, number>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (!keys.length || keys.length > SIZES.length) return false;
  if (keys.some((key) => !SIZES.includes(key as SizeName))) return false;
  return keys.every((key) => {
    const price = (value as Record<string, unknown>)[key];
    return typeof price === 'number' && Number.isSafeInteger(price) && price > 0 && price <= 100000000;
  });
}

export function sizePrice(sizes: Partial<Record<string, number>> | null | undefined, size: string): number | null {
  if (!SIZES.includes(size as SizeName) || !sizes) return null;
  const price = sizes[size];
  if (typeof price !== 'number' || !Number.isSafeInteger(price) || price <= 0) return null;
  return price;
}

export function lineTotal(unit: number, addonPrices: number[], qty: number): number | null {
  if (!Number.isSafeInteger(unit) || unit <= 0) return null;
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > 20) return null;
  let addons = 0;
  for (const price of addonPrices) {
    if (!Number.isSafeInteger(price) || price < 0 || price > 100000000) return null;
    addons += price;
  }
  const total = (unit + addons) * qty;
  if (!Number.isSafeInteger(total) || total <= 0 || total > 100000000) return null;
  return total;
}

export function orderMoney(lines: number[], deliveryFee: number, fulfilment: string): { subtotal: number; deliveryFee: number; total: number } | null {
  if (fulfilment !== 'pickup' && fulfilment !== 'delivery') return null;
  if (!Number.isSafeInteger(deliveryFee) || deliveryFee < 0 || deliveryFee > 100000000) return null;
  if (!lines.length || lines.length > 30) return null;
  let subtotal = 0;
  for (const line of lines) {
    if (!Number.isSafeInteger(line) || line <= 0) return null;
    subtotal += line;
  }
  const fee = fulfilment === 'delivery' ? deliveryFee : 0;
  const total = subtotal + fee;
  if (total > 1000000000) return null;
  return { subtotal, deliveryFee: fee, total };
}

function manilaParts(date: Date) {
  const wall = new Date(date.getTime() + MANILA_MS);
  return {
    y: wall.getUTCFullYear(),
    m: wall.getUTCMonth(),
    d: wall.getUTCDate(),
    dow: wall.getUTCDay(),
  };
}

export function manilaWeekIndex(date: Date) {
  const dow = manilaParts(date).dow;
  return dow === 0 ? 6 : dow - 1;
}

export function startOfManilaDay(date: Date) {
  const parts = manilaParts(date);
  return new Date(Date.UTC(parts.y, parts.m, parts.d) - MANILA_MS);
}

export function manilaClock(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`;
}

export function todayLabel(now: Date, hours: DayHours[]) {
  if (!hoursOk(hours)) return '';
  const dayStart = startOfManilaDay(now);
  const spec = hours[manilaWeekIndex(dayStart)];
  if (!spec || spec.closed) return 'Closed today';
  const open = parseHHMM(spec.open);
  const close = parseHHMM(spec.close);
  if (open == null || close == null) return '';
  const from = manilaClock(new Date(dayStart.getTime() + open * 60000));
  const to = manilaClock(new Date(dayStart.getTime() + close * 60000));
  return `Open today ${from} – ${to}`;
}

export type CafeSlot = { at: string; day: 'today' | 'tomorrow'; time: string };

export function cafeSlots(opts: {
  now: Date;
  hours: DayHours[];
  leadMin: number;
  slotMin: number;
  accepting: boolean;
}): CafeSlot[] {
  if (!opts.accepting) return [];
  if (!Number.isInteger(opts.leadMin) || opts.leadMin < 0 || opts.leadMin > 180) return [];
  if (!SLOT_CHOICES.includes(opts.slotMin)) return [];
  if (!hoursOk(opts.hours)) return [];
  const earliest = opts.now.getTime() + opts.leadMin * 60 * 1000;
  const todayStart = startOfManilaDay(opts.now);
  const slots: CafeSlot[] = [];
  for (let offset = 0; offset < 2; offset++) {
    const dayStart = new Date(todayStart.getTime() + offset * DAY_MS);
    const spec = opts.hours[manilaWeekIndex(dayStart)];
    if (!spec || spec.closed) continue;
    const open = parseHHMM(spec.open);
    const close = parseHHMM(spec.close);
    if (open == null || close == null || close <= open) continue;
    for (let mins = open; mins < close; mins += opts.slotMin) {
      const at = dayStart.getTime() + mins * 60 * 1000;
      if (at < earliest) continue;
      const when = new Date(at);
      slots.push({
        at: when.toISOString(),
        day: offset === 0 ? 'today' : 'tomorrow',
        time: manilaClock(when),
      });
    }
  }
  return slots;
}

export function slotAllowed(slot: unknown, opts: Parameters<typeof cafeSlots>[0]): boolean {
  if (typeof slot !== 'string' || Number.isNaN(Date.parse(slot))) return false;
  const want = new Date(slot).getTime();
  return cafeSlots(opts).some((row) => new Date(row.at).getTime() === want);
}

export function areaLabel(areaId: string, areaText: string) {
  const known = AREAS.find((area) => area.id === areaId);
  if (known) return known.name;
  return areaText.trim();
}

export function fulfilmentLine(fulfilment: 'pickup' | 'delivery', area = '', spot = '') {
  if (fulfilment === 'pickup') return `Pickup · ${CAFE_NAME}, ${CAFE_PLACE}`;
  return `Delivery · ${area.trim()} · ${spot.trim()}`;
}

export function receiptWhen(fulfilment: 'pickup' | 'delivery', slot: Date, area = '', spot = '') {
  const when = manilaStamp(slot);
  if (fulfilment === 'pickup') return `Pickup · ${when}`;
  const place = [area.trim(), spot.trim()].filter(Boolean).join(', ');
  return place ? `Delivery · ${place} · ${when}` : `Delivery · ${when}`;
}

export type CoffeeLine = { name: string; size: string; qty: number; addons: string[]; note: string };

function drinkLine(item: CoffeeLine) {
  const addons = item.addons.length ? ' + ' + item.addons.map((name) => escHtml(name)).join(', ') : '';
  return `${item.qty | 0} × ${escHtml(item.name)} (${escHtml(item.size)})${addons}`;
}

export function coffeeCaption(order: {
  num: string;
  fulfilment: 'pickup' | 'delivery';
  area?: string;
  spot?: string;
  slot: Date;
  items: CoffeeLine[];
  deliveryFee: number;
  total: number;
  customer?: string;
  note?: string;
}) {
  const where = escHtml(fulfilmentLine(order.fulfilment, order.area || '', order.spot || ''));
  const when = escHtml(manilaStamp(order.slot));
  const head = [`<b>${escHtml(order.num)}</b>`, where, when];
  const blocks = (order.items || []).map((item) => {
    const lines = [drinkLine(item)];
    const note = (item.note || '').trim();
    if (note) lines.push('  ' + escHtml(note));
    return lines;
  });
  const fee = `Delivery fee ${escHtml(peso(order.deliveryFee | 0))}`;
  const total = `<b>Total ${escHtml(peso(order.total | 0))}</b>`;
  const customer = (order.customer || '').trim();
  const note = (order.note || '').trim();
  const build = (rows: string[][], withNotes: boolean, extra: string[]) => {
    const body = rows.flatMap((row) => (withNotes ? row : row.slice(0, 1)));
    return [...head, '', ...body, '', fee, total, ...(extra.length ? ['', ...extra] : [])].join('\n');
  };
  const extras = [customer, note].filter(Boolean).map((line) => escHtml(line));
  let text = build(blocks, true, extras);
  if (text.length <= CAPTION_MAX) return text;
  text = build(blocks, true, []);
  if (text.length <= CAPTION_MAX) return text;
  text = build(blocks, false, []);
  if (text.length <= CAPTION_MAX) return text;
  const kept: string[][] = [];
  for (const block of blocks) {
    const next = build([...kept, block, [['…']]], false, []);
    if (kept.length && next.length > CAPTION_MAX) break;
    kept.push(block);
  }
  const shown = kept.length < blocks.length ? [...kept, [['…']]] : kept;
  return build(shown, false, []).slice(0, CAPTION_MAX);
}

export function nextCafeStatuses(fulfilment: string, status: string) {
  const ready = fulfilment === 'delivery' ? 'Out for delivery' : 'Ready';
  if (status === 'New') return ['Preparing', 'Cancelled'];
  if (status === 'Preparing') return [ready, 'Cancelled'];
  if (status === 'Ready' || status === 'Out for delivery') return ['Completed', 'Cancelled'];
  return [];
}
