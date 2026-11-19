import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { crossings, manilaStamp, movementMessage, plainNote, RESTOCK_AT, saleCaption, stockMessages } from '../supabase/functions/store/telegram.ts';

const require = createRequire(import.meta.url);
const L = require('../store-logic.js');

const at = new Date('2026-11-19T06:15:00Z');

test('restock threshold matches the dashboard low-stock line', () => {
  assert.equal(RESTOCK_AT, L.LOW_STOCK);
  assert.equal(L.lowOrOut(RESTOCK_AT, 10, 'low-shelf'), true);
  assert.equal(L.lowOrOut(RESTOCK_AT + 1, 10, 'low-shelf'), false);
});

test('sale caption uses Manila time, line totals, and escaped HTML', () => {
  const text = saleCaption({
    num: 'O20-0006',
    storeName: 'Ore 20th Floor',
    at,
    items: [
      { name: 'Cheese Ring', qty: 2, price: 2500 },
      { name: 'A & B <snack>', qty: 1, price: 500 },
    ],
    total: 5500,
    customer: 'Ana',
    note: 'Left on the counter',
  });
  assert.match(text, /<b>O20-0006<\/b> · Ore 20th Floor/);
  assert.match(text, /Nov 19, 2026 · 2:15 PM/);
  assert.match(text, /2 × Cheese Ring — PHP 50/);
  assert.match(text, /1 × A &amp; B &lt;snack&gt; — PHP 5/);
  assert.match(text, /<b>Total PHP 55<\/b>/);
  assert.match(text, /Ana\nLeft on the counter/);
  assert.equal(manilaStamp(at), 'Nov 19, 2026 · 2:15 PM');
});

test('caption omits a blank customer and drops notes when the text is too long', () => {
  const short = saleCaption({
    num: 'NEO-0002',
    storeName: '2 Neo',
    at,
    items: [{ name: 'Water', qty: 1, price: 2000 }],
    total: 2000,
    customer: '   ',
    note: '',
  });
  assert.equal(short.includes('Customer'), false);
  assert.equal(short.endsWith('<b>Total PHP 20</b>'), true);
  assert.equal(plainNote('  hello ', 80), 'hello');
  assert.equal(plainNote('bad\nline', 80), '');
  const longName = 'X'.repeat(80);
  const many = Array.from({ length: 40 }, (_, i) => ({ name: longName + i, qty: 1, price: 100 }));
  const text = saleCaption({ num: 'O20-0099', storeName: 'Ore', at, items: many, total: 4000, customer: 'Ana', note: 'note' });
  assert.ok(text.length <= 1024);
  assert.equal(text.includes('Ana'), false);
  assert.match(text, /…/);
});

test('low stock and out of stock each alert once per crossing', () => {
  assert.deepEqual(crossings(6, 5), { low: true, out: false });
  assert.deepEqual(crossings(6, 0), { low: true, out: true });
  assert.deepEqual(crossings(5, 4), { low: false, out: false });
  assert.deepEqual(crossings(5, 0), { low: false, out: true });
  assert.deepEqual(crossings(1, 0), { low: false, out: true });
  assert.deepEqual(crossings(0, 0), { low: false, out: false });
  assert.deepEqual(crossings(8, 6), { low: false, out: false });

  const first = stockMessages('Ore 20th Floor', [
    { name: 'Cheese Ring', before: 6, after: 4, warehouse: 2 },
    { name: 'Nova', before: 2, after: 1, warehouse: 0 },
    { name: 'Water', before: 3, after: 0, warehouse: 8 },
  ]);
  assert.match(first.low, /<b>Low stock<\/b> · Ore 20th Floor/);
  assert.match(first.low, /Cheese Ring — shelf 4 · warehouse 2/);
  assert.equal(first.low.includes('Nova'), false);
  assert.equal(first.low.includes('Water'), false);
  assert.match(first.out, /<b>Out of stock<\/b> · Ore 20th Floor/);
  assert.match(first.out, /Water — shelf 0 · warehouse 8/);
  assert.equal(first.out.includes('Cheese Ring'), false);

  const again = stockMessages('Ore 20th Floor', [
    { name: 'Cheese Ring', before: 4, after: 3, warehouse: 2 },
  ]);
  assert.equal(again.low, '');
  assert.equal(again.out, '');

  const both = stockMessages('2 Neo', [
    { name: 'A & B', before: 9, after: 0, warehouse: 1 },
  ]);
  assert.match(both.low, /A &amp; B — shelf 0 · warehouse 1/);
  assert.match(both.out, /A &amp; B — shelf 0 · warehouse 1/);
});

test('a restock or receive is one message for the whole action', () => {
  const text = movementMessage('restock', [
    { branch: 'Ore 20th Floor', name: 'Cheese Ring', qty: 4, shelf: 8, warehouse: 1 },
    { branch: 'Ore 15th Floor', name: 'Nova <40g>', qty: 2, shelf: 5, warehouse: 0 },
  ]);
  assert.match(text, /^<b>Shelf restocked<\/b>/);
  assert.match(text, /Ore 20th Floor · Cheese Ring — 4 moved to the shelf/);
  assert.match(text, /Shelf 8 · warehouse 1/);
  assert.match(text, /Ore 15th Floor · Nova &lt;40g&gt; — 2 moved to the shelf/);
  assert.equal(text.split('<b>').length, 2);
  const received = movementMessage('receive', [
    { branch: '2 Neo', name: 'Water', qty: 10, shelf: 2, warehouse: 14 },
  ]);
  assert.match(received, /<b>Warehouse received<\/b>/);
  assert.match(received, /2 Neo · Water — 10 received/);
  assert.match(received, /Shelf 2 · warehouse 14/);
  assert.equal(movementMessage('restock', []), '');
});
