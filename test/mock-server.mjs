// Local stand-in for the store edge function. Used with ?demo=1 on localhost only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const L = require('../store-logic.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hours = (n) => new Date(Date.now() - n * 3600 * 1000).toISOString();

const banks = { GCash: '/photo/placeholder', 'Maya (PayMaya)': null, BPI: null, MariBank: null };
const stores = [
  { id: 'O20', name: 'Ore 20th Floor', active: 1, seq: 1 },
  { id: 'O15', name: 'Ore 15th Floor', active: 1, seq: 2 },
  { id: 'NEO', name: '2 Neo', active: 1, seq: 3 },
];
const products = [
  { id: 'p-cheese', name: 'Cheese Ring', cat: 'Chips', unit: '60g', price: 2500, cost: 1685, photo: '/photo/cheese-ring', active: 1, salePrice: null, salePct: null, saleStart: null, saleEnd: null },
  { id: 'p-lays', name: "Lay's Classic 170g", cat: 'Chips', unit: '170g', price: 17000, cost: 5600, photo: '/photo/lays-classic-170g', active: 1, salePrice: 15000, salePct: null, saleStart: null, saleEnd: null },
  { id: 'p-nova', name: "Jack 'n Jill Nova 40g", cat: 'Chips', unit: '40g', price: 2500, cost: 1450, photo: '/photo/jack-n-jill-nova-40g', active: 1, salePrice: null, salePct: 10, saleStart: null, saleEnd: null },
  { id: 'p-mentos', name: 'Mentos Mint', cat: 'Candies', unit: '1 pc', price: 500, cost: 240, photo: '/photo/mentos-mint', active: 1, salePrice: null, salePct: null, saleStart: null, saleEnd: null },
  { id: 'p-choco', name: 'Choco Mucho Original Choco 30g', cat: 'Cookies & Biscuits', unit: '30g', price: 1200, cost: 887, photo: '/photo/choco-mucho-30g', active: 1, salePrice: null, salePct: null, saleStart: null, saleEnd: null },
  { id: 'p-kopi', name: 'Kopiko Blanca Twin', cat: '3-in-1 Coffee & Tea', unit: '1 sachet', price: 1800, cost: 1360, photo: '/photo/kopiko-blanca-twin', active: 1, salePrice: null, salePct: null, saleStart: null, saleEnd: null },
  { id: 'p-water', name: 'Wilkins Water 500ml', cat: 'Bottled & Canned Drinks', unit: '500ml', price: 2000, cost: 916, photo: '/photo/wilkins-water-500ml', active: 1, salePrice: null, salePct: null, saleStart: null, saleEnd: null },
  { id: 'p-piattos', name: "Jack 'n Jill Piattos Cheese 40g", cat: 'Chips', unit: '40g', price: 2500, cost: 1450, photo: '/photo/jack-n-jill-piattos-cheese-40g', active: 1, salePrice: null, salePct: null, saleStart: null, saleEnd: null },
];
const stock = {};
function put(store, id, shelf, warehouse) { stock[store + ':' + id] = { storeId: store, productId: id, shelf, warehouse }; }
products.forEach((p) => stores.forEach((s) => put(s.id, p.id, 0, 0)));
put('O20', 'p-cheese', 4, 2);
put('O20', 'p-lays', 2, 0);
put('O20', 'p-nova', 3, 1);
put('O20', 'p-mentos', 18, 0);
put('O20', 'p-choco', 0, 6);
put('O20', 'p-water', 8, 4);
put('O15', 'p-kopi', 3, 0);
put('O15', 'p-water', 2, 0);
put('NEO', 'p-piattos', 5, 1);
put('NEO', 'p-mentos', 4, 0);

const seq = { O20: 4, O15: 1, NEO: 0 };
function line(id, qty) {
  const p = products.find((x) => x.id === id);
  const price = L.effectivePrice(p);
  return { id, name: p.name, qty, price, cost: p.cost || 0 };
}
const orders = [
  { id: 'o1', num: 'O20-0001', ts: hours(2), items: [line('p-cheese', 2)], total: line('p-cheese', 2).price * 2, cost: 1685 * 2, cash: 0, bank: 'GCash', proof: '/photo/placeholder', status: 'Verified', storeId: 'O20', email: 'ana@example.com', promo: 1 },
  { id: 'o2', num: 'O20-0002', ts: hours(5), items: [line('p-nova', 1), line('p-mentos', 2)], total: line('p-nova', 1).price + line('p-mentos', 1).price * 2, cost: 1450 + 480, cash: 0, bank: 'GCash', proof: '/photo/placeholder', status: 'Pending', storeId: 'O20', email: '', promo: 0 },
  { id: 'o3', num: 'O20-0003', ts: hours(26), items: [line('p-water', 2)], total: 4000, cost: 1832, cash: 4000, bank: '', proof: '', status: 'Verified', storeId: 'O20', email: '', promo: 0 },
  { id: 'o4', num: 'O20-0004', ts: hours(30), items: [line('p-lays', 1)], total: 15000, cost: 5600, cash: 15000, bank: '', proof: '', status: 'Flagged', storeId: 'O20', email: '', promo: 0 },
  { id: 'o5', num: 'O15-0001', ts: hours(3), items: [line('p-kopi', 2)], total: 3600, cost: 2720, cash: 0, bank: 'GCash', proof: '/photo/placeholder', status: 'Verified', storeId: 'O15', email: 'juan@example.com', promo: 1 },
];
// Keep the seeded counter ahead of the sample numbers above.
seq.O20 = 4;

const ads = [
  { id: 'ad1', seq: 1, active: 1, desktop: '/photo/lays-classic-170g', mobile: '/photo/lays-classic-170g', productId: 'p-lays', stores: ['O20'], starts: null, ends: null, views: 12, clicks: 3 },
  { id: 'ad2', seq: 2, active: 1, desktop: '/photo/cheese-ring', mobile: '/photo/cheese-ring', productId: 'p-cheese', stores: [], starts: null, ends: null, views: 8, clicks: 1 },
];
const requests = [
  { id: 'r1', storeId: 'O20', name: 'Yakult', note: 'The small bottles, if you can.', status: 'Open', ts: hours(6) },
  { id: 'r2', storeId: 'O15', name: 'Yakult', note: 'Same, please.', status: 'Open', ts: hours(8) },
  { id: 'r3', storeId: 'NEO', name: 'Cup noodles', note: '', status: 'Done', ts: hours(40) },
];
const expenses = [
  { id: 'e1', storeId: 'O20', amount: 25000, note: 'Restock fare', category: 'Transport', ts: hours(4) },
  { id: 'e2', storeId: null, amount: 15000, note: 'Tape and bags', category: 'Supplies', ts: hours(20) },
];
const subscribers = [
  { id: 's1', email: 'ana@example.com', storeId: 'O20', active: 1, ts: hours(2) },
  { id: 's2', email: 'juan@example.com', storeId: 'O15', active: 1, ts: hours(3) },
];
const sends = [];
const owners = [
  { userId: '11111111-1111-4111-8111-111111111111', email: 'owner@chingu.test', addedAt: hours(24 * 40), you: true },
  { userId: '22222222-2222-4222-8222-222222222222', email: 'ana@example.com', addedAt: hours(30), you: false },
];

function shelf(store, id) { return stock[store + ':' + id]?.shelf ?? 0; }
function catalog(storeId) {
  const rows = stores.map((s) => ({
    id: s.id, name: s.name,
    shelfUnits: products.reduce((n, p) => n + (p.active ? shelf(s.id, p.id) : 0), 0),
  }));
  const chosen = rows.find((s) => s.id === storeId) || null;
  const use = chosen?.id || 'O20';
  return {
    products: products.filter((p) => p.active).map((p) => {
      const pay = L.effectivePrice(p);
      return { ...p, pay, onSale: pay !== p.price, stock: shelf(use, p.id) };
    }),
    banks, stores: rows, store: chosen,
    ads: chosen ? ads.filter((ad) => ad.active && (!ad.stores.length || ad.stores.includes(chosen.id))).map((ad) => ({ id: ad.id, desktop: ad.desktop, mobile: ad.mobile, productId: ad.productId })) : [],
    admin: true, claimed: true, email: false,
  };
}
function admin() {
  return {
    email: false,
    stores, products,
    stocks: Object.values(stock),
    orders: orders.map((o) => ({ ...o, items: JSON.stringify(o.items) })),
    ads, requests, expenses, subscribers, sends,
    teamReady: true,
    owners,
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

export async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/file/')) {
    const raw = req.method === 'POST' ? await readBody(req) : Buffer.alloc(0);
    let body = {};
    if (req.method === 'POST' && (req.headers['content-type'] || '').includes('json')) {
      try { body = JSON.parse(raw.toString() || '{}'); } catch { body = {}; }
    }
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    if (url.pathname === '/api/catalog') return send(200, catalog((url.searchParams.get('store') || '').toUpperCase()));
    if (url.pathname === '/api/admin/data') return send(200, admin());
    if (url.pathname === '/api/admin/owner') {
      if (body.remove) {
        if (body.remove === '11111111-1111-4111-8111-111111111111') return send(400, { error: 'You cannot remove your own access' });
        if (owners.length <= 1) return send(400, { error: 'The store needs at least one owner' });
        const i = owners.findIndex((o) => o.userId === body.remove);
        if (i < 0) return send(404, { error: 'Unknown owner' });
        owners.splice(i, 1);
        return send(200, { ok: true });
      }
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return send(400, { error: 'Check the email address' });
      if (owners.some((o) => o.email === email)) return send(409, { error: 'That person is already an owner' });
      owners.push({ userId: crypto.randomUUID(), email, addedAt: new Date().toISOString(), you: false });
      return send(200, { ok: true, invited: true });
    }
    if (url.pathname === '/api/ad-event') {
      const ad = ads.find((a) => a.id === body.id);
      if (ad) body.kind === 'click' ? ad.clicks++ : ad.views++;
      return send(200, { ok: true });
    }
    if (url.pathname === '/api/request') {
      if (!body.name || !body.name.trim()) return send(400, { error: 'Check the item name' });
      requests.unshift({ id: crypto.randomUUID(), storeId: body.store, name: body.name.trim(), note: body.note || '', status: 'Open', ts: new Date().toISOString() });
      return send(200, { ok: true });
    }
    if (url.pathname === '/api/proof' || url.pathname === '/api/admin/image') return send(200, { file: url.pathname.endsWith('proof') ? '/photo/placeholder' : '/photo/cheese-ring' });
    if (url.pathname === '/api/order') {
      const store = String(body.store || 'O20').toUpperCase();
      for (const item of body.items || []) {
        const have = shelf(store, item.id);
        const p = products.find((x) => x.id === item.id);
        if (!p || item.qty > have || item.price !== L.effectivePrice(p)) return send(409, { error: 'Price or stock changed. Refresh your cart' });
      }
      for (const item of body.items) stock[store + ':' + item.id].shelf -= item.qty;
      seq[store] = (seq[store] || 0) + 1;
      const num = L.formatOrderNo(store, seq[store]);
      const items = (body.items || []).map((item) => line(item.id, item.qty));
      const total = items.reduce((s, i) => s + i.price * i.qty, 0);
      const cost = items.reduce((s, i) => s + i.cost * i.qty, 0);
      orders.unshift({ id: body.id, num, ts: new Date().toISOString(), items, total, cost, cash: body.cash, bank: body.bank || '', proof: body.proof || '', status: 'Pending', storeId: store, email: (body.email || '').toLowerCase(), promo: body.promo ? 1 : 0 });
      const note = body.email ? 'email not configured' : '';
      return send(200, { id: body.id, num, total, store: stores.find((s) => s.id === store)?.name, emailSent: false, emailNote: note });
    }
    if (url.pathname === '/api/admin/product') {
      let p = products.find((x) => x.id === body.id);
      if (!p) { p = { id: body.id, active: 1 }; products.push(p); stores.forEach((s) => put(s.id, p.id, 0, 0)); }
      Object.assign(p, { name: body.name, cat: body.cat, unit: body.unit, price: body.price, photo: body.photo, active: body.active ? 1 : 0 });
      if ('cost' in body) p.cost = body.cost;
      if ('salePrice' in body) { p.salePrice = body.salePrice; p.salePct = body.salePct; p.saleStart = body.saleStart; p.saleEnd = body.saleEnd; }
      for (const ed of body.stockEdits || []) {
        const row = stock[ed.storeId + ':' + body.id];
        if (!row || row.shelf !== ed.originalShelf || row.warehouse !== ed.originalWarehouse) return send(409, { error: 'Stock changed. Refresh and retry' });
        row.shelf = ed.shelf; row.warehouse = ed.warehouse;
      }
      return send(200, { ok: true });
    }
    if (url.pathname === '/api/admin/stock') {
      const row = stock[body.storeId + ':' + body.productId];
      if (!row) return send(409, { error: 'Stock changed. Refresh and retry' });
      if (body.op === 'restock') {
        if (body.qty > row.warehouse) return send(409, { error: 'Not enough in the warehouse' });
        row.warehouse -= body.qty; row.shelf += body.qty;
      } else if (body.op === 'receive') row.warehouse += body.qty;
      return send(200, { ok: true });
    }
    if (url.pathname === '/api/admin/bulk') {
      for (const id of body.ids || []) {
        const p = products.find((x) => x.id === id);
        if (!p) continue;
        if (body.cat) p.cat = body.cat;
        if (body.active != null) p.active = body.active ? 1 : 0;
        if (body.clearSale) { p.salePrice = null; p.salePct = null; }
        if (body.salePct) { p.salePct = body.salePct; p.salePrice = null; }
      }
      return send(200, { ok: true });
    }
    if (url.pathname === '/api/admin/store') {
      const code = String(body.code || '').toUpperCase();
      if (stores.some((s) => s.id === code)) return send(409, { error: 'That store code is already used' });
      stores.push({ id: code, name: body.name, active: 1, seq: stores.length + 1 });
      products.forEach((p) => put(code, p.id, 0, 0));
      return send(200, { ok: true });
    }
    if (url.pathname === '/api/admin/ad') {
      const id = body.id || crypto.randomUUID();
      const row = ads.find((a) => a.id === id) || { id, seq: ads.length + 1, views: 0, clicks: 0 };
      Object.assign(row, { active: body.active ? 1 : 0, desktop: body.desktop || '', mobile: body.mobile || '', productId: body.productId || '', stores: body.stores || [], starts: body.starts || null, ends: body.ends || null });
      if (!ads.includes(row)) ads.push(row);
      return send(200, { ok: true, id });
    }
    if (url.pathname === '/api/admin/ad-order') {
      (body.ids || []).forEach((id, i) => { const ad = ads.find((a) => a.id === id); if (ad) ad.seq = i + 1; });
      return send(200, { ok: true });
    }
    if (url.pathname === '/api/admin/expense') {
      if (body.delete) { const i = expenses.findIndex((e) => e.id === body.id); if (i >= 0) expenses.splice(i, 1); return send(200, { ok: true }); }
      expenses.unshift({ id: crypto.randomUUID(), storeId: body.storeId || null, amount: body.amount, note: body.note, category: body.category || 'General', ts: body.ts || new Date().toISOString() });
      return send(200, { ok: true });
    }
    if (url.pathname === '/api/admin/request-status') {
      const row = requests.find((r) => r.id === body.id);
      if (row) row.status = body.status;
      return send(200, { ok: true });
    }
    if (url.pathname === '/api/admin/review') {
      const row = orders.find((o) => o.id === body.id);
      if (row) row.status = body.status;
      return send(200, { ok: true });
    }
    if (url.pathname === '/api/admin/bank') { banks[body.bank] = body.file; return send(200, { ok: true }); }
    if (url.pathname === '/api/admin/email-preview') {
      return send(200, { html: L.emailHtml({ subject: body.subject, message: body.message, unsubUrl: 'https://example.test/unsub?t=test' }) });
    }
    if (url.pathname === '/api/admin/email') return send(503, { error: 'Email is not configured' });
    if (url.pathname.startsWith('/file/')) {
      const file = fs.readFileSync(path.join(root, 'photos/placeholder.jpg'));
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end(file);
      return;
    }
    return send(404, { error: 'Page unavailable' });
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root)) { res.writeHead(403); res.end('no'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 8765);
  http.createServer((req, res) => handle(req, res).catch((e) => { res.writeHead(500); res.end(e.message); })).listen(port, () => {
    console.log('demo http://localhost:' + port + '/?demo=1');
  });
}
