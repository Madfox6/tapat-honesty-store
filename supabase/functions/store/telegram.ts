// Pure Telegram copy for the store function. No secrets, no network.
// RESTOCK_AT matches store-logic.js LOW_STOCK, which is the dashboard restock alert.

export const RESTOCK_AT = 5;
export const CAPTION_MAX = 1024;

export function escHtml(s: string) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

export function plainNote(value: unknown, max: number) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || text.length > max || /[\u0000-\u001f]/.test(text)) return '';
  return text;
}

export function peso(cents: number) {
  const abs = Math.abs(cents);
  const body = (abs / 100).toLocaleString('en-PH', { minimumFractionDigits: abs % 100 ? 2 : 0, maximumFractionDigits: 2 });
  return (cents < 0 ? '-' : '') + 'PHP ' + body;
}

export function manilaStamp(at: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('month')} ${get('day')}, ${get('year')} · ${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`;
}

export type SaleItem = { name: string; qty: number; price: number };

export function saleCaption(order: {
  num: string;
  storeName: string;
  at: Date;
  items: SaleItem[];
  total: number;
  customer?: string;
  note?: string;
}) {
  const items = (order.items || []).map((item) => `${item.qty} × ${escHtml(item.name)} — ${peso((item.price | 0) * (item.qty | 0))}`);
  const head = `<b>${escHtml(order.num)}</b> · ${escHtml(order.storeName)}`;
  const when = escHtml(manilaStamp(order.at));
  const total = `<b>Total ${escHtml(peso(order.total | 0))}</b>`;
  const notes = [order.customer, order.note].map((s) => (s || '').trim()).filter(Boolean).map((s) => escHtml(s));
  const build = (lines: string[], extra: string[]) => [head, when, '', ...lines, '', total, ...(extra.length ? ['', ...extra] : [])].join('\n');
  let text = build(items, notes);
  if (text.length <= CAPTION_MAX) return text;
  text = build(items, []);
  if (text.length <= CAPTION_MAX) return text;
  const kept: string[] = [];
  for (const line of items) {
    const next = build([...kept, line, '…'], []);
    if (kept.length && next.length > CAPTION_MAX) break;
    kept.push(line);
  }
  const shown = kept.length < items.length ? [...kept, '…'] : kept;
  return build(shown, []).slice(0, CAPTION_MAX);
}

export function crossings(before: number, after: number, threshold = RESTOCK_AT) {
  const prev = Math.trunc(Number(before));
  const next = Math.trunc(Number(after));
  const limit = Math.trunc(Number(threshold));
  return {
    low: prev > limit && next <= limit,
    out: prev > 0 && next <= 0,
  };
}

export type StockLevel = { name: string; before: number; after: number; warehouse: number };

export function stockMessages(branch: string, rows: StockLevel[], threshold = RESTOCK_AT) {
  const low: StockLevel[] = [];
  const out: StockLevel[] = [];
  for (const row of rows || []) {
    const hit = crossings(row.before, row.after, threshold);
    if (hit.low) low.push(row);
    if (hit.out) out.push(row);
  }
  const block = (title: string, list: StockLevel[]) => {
    if (!list.length) return '';
    const lines = list.map((r) => `${escHtml(r.name)} — shelf ${r.after} · warehouse ${r.warehouse}`);
    return `<b>${escHtml(title)}</b> · ${escHtml(branch)}\n${lines.join('\n')}`;
  };
  return { low: block('Low stock', low), out: block('Out of stock', out) };
}

export type StockMove = { branch: string; name: string; qty: number; shelf: number; warehouse: number };

export function movementMessage(op: 'restock' | 'receive', rows: StockMove[]) {
  const list = rows || [];
  if (!list.length) return '';
  const title = op === 'receive' ? 'Warehouse received' : 'Shelf restocked';
  const verb = op === 'receive' ? 'received' : 'moved to the shelf';
  const lines = list.map((r) => `${escHtml(r.branch)} · ${escHtml(r.name)} — ${r.qty} ${verb}\nShelf ${r.shelf} · warehouse ${r.warehouse}`);
  return `<b>${title}</b>\n${lines.join('\n')}`;
}
