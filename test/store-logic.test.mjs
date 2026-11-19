import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('../store-logic.js');

const at = (iso) => new Date(iso);

test('sale price and percent follow the Manila window', () => {
  const fixed = { price: 10000, salePrice: 8000, salePct: null, saleStart: '2026-11-01T00:00:00+08:00', saleEnd: '2026-11-30T23:59:59+08:00' };
  assert.equal(L.onSale(fixed, at('2026-11-19T02:00:00Z')), true);
  assert.equal(L.effectivePrice(fixed, at('2026-11-19T02:00:00Z')), 8000);
  assert.equal(L.effectivePrice(fixed, at('2026-12-01T00:00:00+08:00')), 10000);
  const pct = { price: 10000, salePrice: null, salePct: 15, saleStart: null, saleEnd: null };
  assert.equal(L.effectivePrice(pct), 8500);
  const odd = { price: 1001, salePrice: null, salePct: 10, saleStart: null, saleEnd: null };
  assert.equal(L.effectivePrice(odd), Math.max(1, Math.round(1001 * 90 / 100)));
  assert.equal(L.effectivePrice({ price: 2500 }), 2500);
});

test('cost calculator shows the other side and profit per piece', () => {
  assert.equal(L.priceFromMarkup(1685, 50), Math.round(1685 * 1.5));
  assert.ok(Math.abs(L.markupFromPrice(1685, 2500) - ((2500 - 1685) / 1685) * 100) < 1e-9);
  assert.equal(L.profitEach(2500, 1685), 815);
  assert.equal(L.marginRatio(2500, 1685), 815 / 2500);
});

test('order numbers are per-store and zero padded', () => {
  assert.equal(L.formatOrderNo('O20', 1), 'O20-0001');
  assert.equal(L.formatOrderNo('NEO', 42), 'NEO-0042');
  assert.equal(L.formatOrderNo('O15', 10000), 'O15-10000');
});

test('Manila day, week, and month boundaries', () => {
  const now = at('2026-11-18T16:30:00Z'); // 00:30 Nov 19 Manila
  assert.equal(L.startOfManilaDay(now).toISOString(), '2026-11-18T16:00:00.000Z');
  assert.equal(L.startOfManilaWeek(now).toISOString(), '2026-11-15T16:00:00.000Z');
  assert.equal(L.startOfManilaMonth(now).toISOString(), '2026-10-31T16:00:00.000Z');
  assert.equal(L.manilaHour(now), 0);
  const today = L.rangeForPreset('today', now);
  const prev = L.previousRange(today.start, today.end);
  assert.equal(prev.end.getTime(), today.start.getTime());
  assert.equal(today.end.getTime() - today.start.getTime(), prev.end.getTime() - prev.start.getTime());
});

test('legacy cart stays on O20 and round-trips', () => {
  const carts = L.loadAllCarts('{"abc":2,"bad":0,"x":1.5}');
  assert.deepEqual(carts, { O20: { abc: 2 } });
  const again = L.loadAllCarts(L.saveAllCarts({ O20: { abc: 2 }, O15: { z: 1 } }));
  assert.deepEqual(again.O20, { abc: 2 });
  assert.deepEqual(again.O15, { z: 1 });
});

test('dashboard totals, comparison, hours, and net profit', () => {
  const now = at('2026-11-19T06:00:00Z'); // 14:00 Manila
  const orders = [
    { id: 'a', storeId: 'O20', ts: '2026-11-19T02:00:00Z', total: 5000, cost: 2000, status: 'Verified', items: [{ id: 'p1', name: 'Cheese Ring', qty: 2, price: 2500, cost: 1000 }] },
    { id: 'b', storeId: 'O20', ts: '2026-11-19T03:00:00Z', total: 1500, cost: 500, status: 'Pending', items: [{ id: 'p2', name: 'Nova', qty: 1, price: 1500, cost: 500 }] },
    { id: 'c', storeId: 'O15', ts: '2026-11-19T04:00:00Z', total: 9000, cost: 4000, status: 'Verified', items: [{ id: 'p1', name: 'Cheese Ring', qty: 1, price: 9000, cost: 4000 }] },
    { id: 'd', storeId: 'O20', ts: '2026-11-18T02:00:00Z', total: 2500, cost: 1000, status: 'Verified', items: [{ id: 'p1', name: 'Cheese Ring', qty: 1, price: 2500, cost: 1000 }] },
    { id: 'e', storeId: 'O20', ts: '2026-11-19T05:00:00Z', total: 9999, cost: 0, status: 'Flagged', items: [{ id: 'p1', name: 'Cheese Ring', qty: 1, price: 9999, cost: 0 }] }
  ];
  const products = [
    { id: 'p1', name: 'Cheese Ring', price: 2500, cost: 1000, active: 1, cat: 'Chips', unit: '60g' },
    { id: 'p2', name: 'Nova', price: 1500, cost: null, active: 1, cat: 'Chips', unit: '40g', salePrice: 1200, salePct: null, saleStart: null, saleEnd: null },
    { id: 'p3', name: 'Quiet', price: 1000, cost: 400, active: 1, cat: 'Chips', unit: '1' }
  ];
  const stocks = [
    { storeId: 'O20', productId: 'p1', shelf: 2, warehouse: 0 },
    { storeId: 'O20', productId: 'p2', shelf: 1, warehouse: 8 },
    { storeId: 'O20', productId: 'p3', shelf: 6, warehouse: 0 },
    { storeId: 'O15', productId: 'p1', shelf: 0, warehouse: 0 }
  ];
  const expenses = [{ storeId: 'O20', amount: 500, ts: '2026-11-19T01:00:00Z' }, { storeId: null, amount: 100, ts: '2026-11-19T01:00:00Z' }];
  const model = L.dashboard({
    now, preset: 'today', storeId: 'O20', orders, products, stocks, expenses,
    stores: [{ id: 'O20', name: 'Ore 20th Floor' }], ads: []
  });
  assert.equal(model.current.sales, 6500);
  assert.equal(model.current.cost, 2500);
  assert.equal(model.current.profit, 4000);
  assert.equal(model.current.orders, 2);
  assert.equal(model.current.pendingN, 1);
  assert.equal(model.current.flagged, 9999);
  assert.equal(model.previous.sales, 2500);
  assert.equal(model.expenses, 600);
  assert.equal(model.net, 3400);
  assert.equal(model.top[0].name, 'Cheese Ring');
  assert.equal(model.top[0].qty, 2);
  assert.ok(model.hours.some((h) => h.sales > 0));
  assert.equal(model.missingCost, 1);
  const all = L.dashboard({
    now, preset: 'today', storeId: '', orders, products, stocks, expenses: [],
    stores: [{ id: 'O20', name: 'Ore 20' }, { id: 'O15', name: 'Ore 15' }], ads: []
  });
  assert.equal(all.current.sales, 15500);
  assert.equal(all.stores.find((s) => s.id === 'O15').sales, 9000);
});

test('slow movers are quiet for 2 weeks and restock suggests a quantity', () => {
  const now = at('2026-11-19T06:00:00Z');
  const products = [
    { id: 'hot', name: 'Hot', active: 1, price: 1000, cost: 100 },
    { id: 'warm', name: 'Warm', active: 1, price: 1000, cost: 100 },
    { id: 'cold', name: 'Cold', active: 1, price: 1000, cost: 100 },
    { id: 'never', name: 'Never', active: 1, price: 1000, cost: 100 }
  ];
  const stocks = [
    { storeId: 'O20', productId: 'hot', shelf: 4, warehouse: 10 },
    { storeId: 'O20', productId: 'warm', shelf: 3, warehouse: 1 },
    { storeId: 'O20', productId: 'cold', shelf: 9, warehouse: 0 },
    { storeId: 'O20', productId: 'never', shelf: 2, warehouse: 0 }
  ];
  const orders = [
    { storeId: 'O20', ts: '2026-11-18T06:00:00Z', status: 'Verified', total: 1000, cost: 100, items: [{ id: 'hot', name: 'Hot', qty: 8, price: 1000, cost: 100 }] },
    { storeId: 'O20', ts: '2026-11-01T06:00:00Z', status: 'Verified', total: 1000, cost: 100, items: [{ id: 'warm', name: 'Warm', qty: 1, price: 1000, cost: 100 }] },
    { storeId: 'O20', ts: '2026-10-01T06:00:00Z', status: 'Verified', total: 1000, cost: 100, items: [{ id: 'cold', name: 'Cold', qty: 1, price: 1000, cost: 100 }] }
  ];
  const model = L.dashboard({ now, preset: 'month', storeId: 'O20', orders, products, stocks, expenses: [], stores: [{ id: 'O20', name: 'O20' }], ads: [] });
  const bands = Object.fromEntries(model.slow.map((r) => [r.productId, r.band]));
  assert.equal(bands.hot, undefined);
  assert.equal(bands.warm, '2-4w');
  assert.equal(bands.cold, '4w+');
  assert.equal(bands.never, '4w+');
  const hot = model.restock.find((r) => r.productId === 'hot');
  assert.equal(hot.move, 4);
  assert.equal(hot.receive, 0);
  assert.equal(L.suggestRestock(1, 0, 2).receive, 4);
  assert.equal(L.suggestRestock(0, 9, 0).move, 5);
});

test('low and out filters look at shelf and warehouse', () => {
  assert.equal(L.lowOrOut(2, 20, 'low-shelf'), true);
  assert.equal(L.lowOrOut(20, 2, 'low-wh'), true);
  assert.equal(L.lowOrOut(0, 8, 'out'), true);
  assert.equal(L.lowOrOut(9, 9, 'low'), false);
  assert.equal(L.lowOrOut(0, 0, 'out-wh'), true);
});

test('csv and pdf and email escape untrusted text', () => {
  const csv = L.inventoryCsv(
    [{ id: 'p', name: 'Say "hi"', cat: 'Chips', unit: '1', price: 1000, cost: 400, active: 1 }],
    [{ storeId: 'O20', productId: 'p', shelf: 3, warehouse: 1 }],
    [{ id: 'O20', name: 'Ore' }]
  );
  assert.match(csv, /"Say ""hi"""/);
  assert.match(csv, /O20 shelf/);
  const pdfBytes = L.reportPdf({
    range: { label: 'Today' },
    current: { sales: 100, cost: 40, profit: 60, orders: 1, aov: 100, verified: 100, pending: 0 },
    expenses: 10, net: 50, stores: [{ id: 'O20', name: 'Ore', sales: 100, profit: 60, orders: 1 }],
    top: [{ name: 'Cheese', qty: 1, sales: 100 }], missingCost: 2
  }, 'All stores');
  const pdf = new TextDecoder('latin1').decode(pdfBytes);
  assert.ok(pdfBytes instanceof Uint8Array);
  assert.match(pdf, /^%PDF-1.4/);
  assert.match(pdf, /PHP 1/);
  const html = L.emailHtml({ subject: '<b>Sale</b>', message: 'A & B', products: [{ name: '<script>', priceLabel: '₱10' }], unsubUrl: 'https://example.test/unsub?t=1' });
  assert.match(html, /&lt;b&gt;Sale&lt;\/b&gt;/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Unsubscribe/);
  assert.equal(L.receiptModel({ num: 'O20-0006', storeName: 'Ore 20th Floor', ts: '2026-11-19T00:00:00Z', total: 2500, items: [{ name: 'Cheese Ring', qty: 1, price: 2500 }] }).items[0].line, 2500);
});

test('ad click-through and linked sales stay inside the ad window', () => {
  const ads = [{ id: 'ad', productId: 'p1', views: 10, clicks: 2, stores: ['O20'], starts: '2026-11-01T00:00:00Z', ends: '2026-11-20T00:00:00Z' }];
  const orders = [
    { storeId: 'O20', ts: '2026-11-19T00:00:00Z', status: 'Verified', total: 1000, cost: 0, items: [{ id: 'p1', name: 'A', qty: 2, price: 500, cost: 0 }] },
    { storeId: 'O15', ts: '2026-11-19T00:00:00Z', status: 'Verified', total: 1000, cost: 0, items: [{ id: 'p1', name: 'A', qty: 9, price: 500, cost: 0 }] }
  ];
  const rows = L.dashboard({
    now: at('2026-11-19T06:00:00Z'), preset: 'month', storeId: '', orders, products: [], stocks: [], expenses: [],
    stores: [], ads
  }).adPerf;
  assert.equal(rows[0].qty, 2);
  assert.equal(rows[0].ctr, 0.2);
});
