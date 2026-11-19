// Chingu Honesty Store API. The browser only ever sends the publishable key.
// This function uses the service role, and Postgres RLS stays on with no policies.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { movementMessage, plainNote, RESTOCK_AT, saleCaption, stockMessages, type SaleItem, type StockLevel, type StockMove } from './telegram.ts';

const SETUP = '124ed15d7d5eb49b7967b7024a96f520eabf7be15629739e25272291129fbf0f';
const BUCKET = 'store-files';
const banks = ['GCash', 'Maya (PayMaya)', 'BPI', 'MariBank'];
const samples = ['bread', 'banana', 'milk', 'croissant', 'apple', 'coffee', 'orange', 'eggs'];
const SITE = 'https://madfox6.github.io/tapat-honesty-store/';
const OWNER_PAGE = 'https://madfox6.github.io/tapat-honesty-store/owner.html';

const url = Deno.env.get('SUPABASE_URL')!;
let key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
try { const s = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); if (s.default) key = s.default; } catch { /* use legacy key */ }
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const PUBLIC_FN = url.replace(/\/$/, '') + '/functions/v1/store';

const ALLOWED = ['https://madfox6.github.io'];
const allowed = (o: string | null) => !!o && ALLOWED.includes(o);
function cors(req: Request): Record<string, string> {
  const o = req.headers.get('Origin');
  return allowed(o)
    ? { 'Access-Control-Allow-Origin': o!, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Max-Age': '86400' }
    : { 'Vary': 'Origin' };
}

class HttpError extends Error { constructor(msg: string, public status = 400) { super(msg); } }
function need(ok: unknown, msg: string, status = 400): asserts ok { if (!ok) throw new HttpError(msg, status); }
const isUuid = (s: unknown) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const isCode = (s: unknown) => typeof s === 'string' && /^[A-Z0-9]{2,6}$/.test(s);
const fileImage = (s: unknown) => typeof s === 'string' && /^\/file\/image-[0-9a-f-]{36}$/i.test(s);
const fileProof = (s: unknown) => typeof s === 'string' && /^\/file\/proof-[0-9a-f-]{36}$/i.test(s);
const photoPath = (s: unknown) => typeof s === 'string' && (/^\/photo\/[a-z0-9-]{1,80}$/.test(s) || fileImage(s));
const textOk = (s: unknown, max: number) => typeof s === 'string' && !!s.trim() && s.trim().length <= max && !/[\u0000-\u001f]/.test(s);
const cents = (n: unknown, min = 0) => typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= 100000000;
const emailOk = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 200;
const isoOk = (s: unknown) => s == null || s === '' || (typeof s === 'string' && !Number.isNaN(Date.parse(s)));

function priceOf(p: { price: number; sale_price: number | null; sale_pct: number | null; sale_start: string | null; sale_end: string | null }, at = new Date()) {
  const list = p.price;
  if (p.sale_start && at < new Date(p.sale_start)) return list;
  if (p.sale_end && at > new Date(p.sale_end)) return list;
  if (p.sale_price != null && p.sale_price > 0 && p.sale_price < list) return p.sale_price;
  if (p.sale_pct != null && p.sale_pct >= 1 && p.sale_pct <= 90) return Math.max(1, Math.round(list * (100 - p.sale_pct) / 100));
  return list;
}

function escHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
function absImage(path: string) {
  if (path.startsWith('/photo/')) return SITE + 'photos/' + encodeURIComponent(path.slice(7)) + '.jpg';
  if (path.startsWith('/file/')) return PUBLIC_FN + path;
  return '';
}
function mailer() {
  const apiKey = Deno.env.get('RESEND_API_KEY') || '';
  const from = Deno.env.get('EMAIL_FROM') || '';
  return { ok: apiKey.length > 0 && from.length > 0, apiKey, from };
}
function peso(cents: number) {
  const abs = Math.abs(cents);
  const body = (abs / 100).toLocaleString('en-PH', { minimumFractionDigits: abs % 100 ? 2 : 0, maximumFractionDigits: 2 });
  return (cents < 0 ? '-' : '') + 'PHP ' + body;
}

async function val(k: string): Promise<string | undefined> {
  const { data, error } = await db.from('config').select('v').eq('k', k).maybeSingle();
  if (error) throw error;
  return data?.v;
}
function missingRelation(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const code = error.code || '';
  return code === 'PGRST205' || code === '42P01' || /schema cache/i.test(error.message || '');
}
async function findAuthUser(email: string): Promise<{ id: string; email?: string } | null> {
  const root = url.replace(/\/$/, '');
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(root + '/auth/v1/admin/users?page=' + page + '&per_page=200&filter=' + encodeURIComponent(email), {
      headers: { apikey: key, Authorization: 'Bearer ' + key },
    });
    if (!res.ok) {
      console.error('auth user lookup', res.status);
      throw new HttpError('Could not look up that account', 502);
    }
    const body = await res.json().catch(() => ({}));
    const users: { id?: string; email?: string }[] = Array.isArray(body) ? body : Array.isArray(body?.users) ? body.users : [];
    const hit = users.find((u) => String(u?.email || '').toLowerCase() === email);
    if (hit?.id) return { id: String(hit.id), email: hit.email };
    if (users.length < 200) return null;
  }
  return null;
}
async function accountForOwner(email: string) {
  const existing = await findAuthUser(email);
  if (existing && isUuid(existing.id)) return { ...existing, invited: false };
  const { data, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: OWNER_PAGE });
  if (!error) {
    const id = data?.user?.id || '';
    need(isUuid(id), 'The invite email could not be sent', 502);
    return { id, email: data?.user?.email || email, invited: true };
  }
  const code = (error as { code?: string }).code || '';
  const message = error.message || '';
  if (code === 'email_exists' || /already been registered/i.test(message)) {
    const again = await findAuthUser(email);
    if (!again || !isUuid(again.id)) throw new HttpError('That account already exists, but it could not be linked', 409);
    return { ...again, invited: false };
  }
  if ((error as { status?: number }).status === 429 || /rate limit/i.test(message)) {
    throw new HttpError('Too many emails were sent. Wait a while and try again.', 429);
  }
  console.error('invite failed', code, message.slice(0, 180));
  throw new HttpError('The invite email could not be sent', 502);
}
async function objectExists(name: string) {
  const { data, error } = await db.storage.from(BUCKET).list('', { search: name, limit: 5 });
  if (error) throw error;
  return !!data?.some((o) => o.name === name);
}
const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (x) => x.toString(16).padStart(2, '0')).join('');

async function readJson(req: Request) {
  try { return await req.json(); } catch { throw new HttpError('Invalid request'); }
}

async function ensureStock(productId: string) {
  const { data: stores, error } = await db.from('stores').select('id');
  if (error) throw error;
  const { data: have, error: e2 } = await db.from('stock').select('store_id').eq('product_id', productId);
  if (e2) throw e2;
  const got = new Set((have || []).map((r) => r.store_id));
  const rows = (stores || []).filter((s) => !got.has(s.id)).map((s) => ({ store_id: s.id, product_id: productId, shelf: 0, warehouse: 0 }));
  if (rows.length) {
    const { error: e3 } = await db.from('stock').insert(rows);
    if (e3) throw e3;
  }
}

function saleFields(body: Record<string, unknown>, listPrice: number) {
  const salePrice = body.salePrice == null || body.salePrice === '' ? null : body.salePrice;
  const salePct = body.salePct == null || body.salePct === '' ? null : body.salePct;
  need(!(salePrice != null && salePct != null), 'Use a sale price or a percent, not both');
  need(salePrice == null || (cents(salePrice, 1) && (salePrice as number) < listPrice), 'Sale price must be below the regular price');
  need(salePct == null || (typeof salePct === 'number' && Number.isSafeInteger(salePct) && salePct >= 1 && salePct <= 90), 'Percent off must be from 1 to 90');
  need(isoOk(body.saleStart) && isoOk(body.saleEnd), 'Check the sale dates');
  const start = body.saleStart ? new Date(String(body.saleStart)).toISOString() : null;
  const end = body.saleEnd ? new Date(String(body.saleEnd)).toISOString() : null;
  need(!start || !end || start < end, 'The sale end is before the start');
  return { sale_price: salePrice as number | null, sale_pct: salePct as number | null, sale_start: start, sale_end: end };
}

async function applyStockEdits(productId: string, edits: unknown) {
  need(Array.isArray(edits) && edits.length <= 20, 'Check the stock counts');
  for (const ed of edits) {
    const row = ed as Record<string, unknown>;
    need(isCode(row.storeId), 'Unknown store');
    need([row.shelf, row.warehouse, row.originalShelf, row.originalWarehouse].every((n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n < 1000000), 'Check the stock counts');
    const { error } = await db.rpc('adjust_stock', {
      p_store: row.storeId, p_product: productId, p_op: 'set', p_qty: null,
      p_shelf: row.shelf, p_warehouse: row.warehouse, p_oshelf: row.originalShelf, p_owarehouse: row.originalWarehouse,
    });
    if (error) throw new HttpError('Stock changed. Refresh and retry', 409);
  }
}

function emailDocument(opts: { subject: string; message: string; banner?: string; products: { name: string; priceLabel: string }[]; storeName?: string; unsubUrl?: string }) {
  const items = opts.products.map((p) => `<p style="margin:12px 0;padding:12px;background:#FFF8EF;border-radius:12px"><b>${escHtml(p.name)}</b><br>${escHtml(p.priceLabel)}</p>`).join('');
  const banner = opts.banner ? `<p><img alt="" src="${escHtml(opts.banner)}" style="max-width:100%;border-radius:12px"></p>` : '';
  const unsub = opts.unsubUrl ? `<p style="font-size:12px"><a href="${escHtml(opts.unsubUrl)}">Unsubscribe</a></p>` : '';
  return `<div style="font-family:Nunito,Arial,sans-serif;background:#FFF8EF;padding:24px;color:#2B2420"><div style="max-width:560px;margin:auto;background:#fff;border:2px solid #F0D9BE;border-radius:18px;padding:24px"><p style="letter-spacing:2px;text-transform:uppercase;color:#C44E12;font-size:12px;font-weight:800">Chingu Honesty Store</p><h1 style="font-size:28px;margin:8px 0">${escHtml(opts.subject)}</h1><p style="font-size:16px;line-height:1.5">${escHtml(opts.message).replace(/\n/g, '<br>')}</p>${banner}${items}<p style="font-size:12px;color:#7A5A3C">You are receiving this because you shopped at Chingu Honesty Store${opts.storeName ? ' (' + escHtml(opts.storeName) + ')' : ''}.</p>${unsub}</div></div>`;
}

const TELEGRAM_MS = 15000;
const SALES_CHAT = 'telegram_sales_chat_id';
const STOCKS_CHAT = 'telegram_stocks_chat_id';

function botToken() {
  return (Deno.env.get('TELEGRAM_BOT_TOKEN') || '').trim();
}

function defer(task: Promise<unknown>) {
  const run = task.catch(() => { console.warn('telegram notification failed'); });
  try {
    const waitUntil = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil;
    if (typeof waitUntil === 'function') waitUntil(run);
    else void run;
  } catch {
    void run;
  }
}

function usableChat(value: unknown) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > 64 || /[\u0000-\u001f\s]/.test(id)) return '';
  return id;
}

async function chatId(k: string) {
  const { data, error } = await db.from('app_secrets').select('v').eq('k', k).maybeSingle();
  if (error) {
    console.warn('telegram skipped: chat id unavailable', error.code || '');
    return '';
  }
  return usableChat(data?.v);
}

async function telegramFlags() {
  const token = botToken().length > 0;
  const { data, error } = await db.from('app_secrets').select('k,v').in('k', [SALES_CHAT, STOCKS_CHAT]);
  if (error) {
    if (!missingRelation(error)) console.warn('telegram status unavailable', error.code || '');
    return { token, salesChat: false, stocksChat: false };
  }
  const on = (k: string) => (data || []).some((row) => row.k === k && !!usableChat(row.v));
  return { token, salesChat: on(SALES_CHAT), stocksChat: on(STOCKS_CHAT) };
}

async function telegramCall(method: string, body: FormData | Record<string, unknown>) {
  const token = botToken();
  if (!token) return { ok: false, skipped: true };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TELEGRAM_MS);
  try {
    const init: RequestInit = { method: 'POST', signal: ctrl.signal };
    if (body instanceof FormData) init.body = body;
    else {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const res = await fetch('https://api.telegram.org/bot' + token + '/' + method, init);
    const ok = res.ok;
    const status = res.status;
    try { await res.body?.cancel(); } catch { /* the status is what matters */ }
    if (!ok) {
      console.warn('telegram', method, 'rejected', status);
      return { ok: false, skipped: false };
    }
    return { ok: true, skipped: false };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    console.warn('telegram', method, aborted ? 'timed out' : 'failed');
    return { ok: false, skipped: false };
  } finally {
    clearTimeout(timer);
  }
}

async function sendTelegramMessage(chat: string, text: string) {
  if (!chat || !text) return { ok: false, skipped: true };
  return telegramCall('sendMessage', { chat_id: chat, text: text.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true });
}

async function sendTelegramPhoto(chat: string, bytes: Uint8Array, mime: string, caption: string) {
  const form = new FormData();
  form.append('chat_id', chat);
  form.append('parse_mode', 'HTML');
  form.append('caption', caption.slice(0, 1024));
  const ext = mime.includes('png') ? 'png' : 'jpg';
  form.append('photo', new Blob([bytes], { type: mime || 'image/jpeg' }), 'payment.' + ext);
  return telegramCall('sendPhoto', form);
}

async function proofBytes(proof: string) {
  if (!fileProof(proof)) return null;
  const { data, error } = await db.storage.from(BUCKET).download(proof.slice(6));
  if (error || !data) {
    console.warn('telegram receipt image unavailable');
    return null;
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!bytes.length) return null;
  return { bytes, mime: data.type || 'image/jpeg' };
}

async function announceOrder(info: { num: string; storeName: string; at: Date; total: number; customer: string; note: string; proof: string; items: SaleItem[]; levels: StockLevel[] }) {
  if (!botToken()) {
    console.warn('telegram skipped: TELEGRAM_BOT_TOKEN is not set');
    return;
  }
  const sales = await chatId(SALES_CHAT);
  if (!sales) console.warn('telegram skipped: sales chat is not configured');
  else {
    const caption = saleCaption(info);
    let sent = false;
    if (info.proof) {
      const file = await proofBytes(info.proof);
      if (file) sent = (await sendTelegramPhoto(sales, file.bytes, file.mime, caption)).ok;
    }
    if (!sent) await sendTelegramMessage(sales, caption);
  }
  const alerts = stockMessages(info.storeName, info.levels, RESTOCK_AT);
  if (!alerts.low && !alerts.out) return;
  const stocks = await chatId(STOCKS_CHAT);
  if (!stocks) {
    console.warn('telegram skipped: stocks chat is not configured');
    return;
  }
  if (alerts.low) await sendTelegramMessage(stocks, alerts.low);
  if (alerts.out) await sendTelegramMessage(stocks, alerts.out);
}

async function announceMovement(op: 'restock' | 'receive', storeId: string, productId: string, qty: number, shelf?: number, warehouse?: number) {
  if (!botToken()) {
    console.warn('telegram skipped: TELEGRAM_BOT_TOKEN is not set');
    return;
  }
  const stocks = await chatId(STOCKS_CHAT);
  if (!stocks) {
    console.warn('telegram skipped: stocks chat is not configured');
    return;
  }
  const [{ data: store }, { data: product }] = await Promise.all([
    db.from('stores').select('name').eq('id', storeId).maybeSingle(),
    db.from('products').select('name').eq('id', productId).maybeSingle(),
  ]);
  let nextShelf = shelf;
  let nextWh = warehouse;
  if (typeof nextShelf !== 'number' || typeof nextWh !== 'number') {
    const { data: row } = await db.from('stock').select('shelf,warehouse').eq('store_id', storeId).eq('product_id', productId).maybeSingle();
    nextShelf = row?.shelf ?? 0;
    nextWh = row?.warehouse ?? 0;
  }
  const line: StockMove = { branch: store?.name || storeId, name: product?.name || 'Product', qty, shelf: nextShelf, warehouse: nextWh };
  const text = movementMessage(op, [line]);
  if (text) await sendTelegramMessage(stocks, text);
}

async function sendResend(messages: { to: string; subject: string; html: string; unsub?: string }[]) {
  const mail = mailer();
  need(mail.ok, 'Email is not configured', 503);
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100).map((m) => ({
      from: mail.from,
      to: [m.to],
      subject: m.subject,
      html: m.html,
      headers: m.unsub ? { 'List-Unsubscribe': `<${m.unsub}>` } : undefined,
    }));
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + mail.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new HttpError('The email service rejected the send. ' + detail.slice(0, 180), 502);
    }
  }
}

Deno.serve(async (req) => {
  const ch = cors(req);
  const json = (v: unknown, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { ...ch, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  const html = (body: string, s = 200) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chingu Honesty Store</title><body style="font-family:Nunito,Arial,sans-serif;background:#FFF8EF;color:#2B2420;padding:32px"><div style="max-width:420px;margin:auto;background:#fff;border:2px solid #F0D9BE;border-radius:18px;padding:24px"><p style="color:#C44E12;font-weight:800;letter-spacing:1px">CHINGU HONESTY STORE</p><p>${escHtml(body)}</p></div></body>`, { status: s, headers: { ...ch, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: allowed(req.headers.get('Origin')) ? 204 : 403, headers: ch });
  try {
    const u = new URL(req.url);
    const path = u.pathname.replace(/^(\/functions\/v1)?\/store(?=\/|$)/, '') || '/';

    let who: string | null = null;
    let whoEmail = '';
    const auth = req.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (token && token.split('.').length === 3) {
      const { data } = await db.auth.getUser(token);
      who = data?.user?.id ?? null;
      whoEmail = String(data?.user?.email || '').trim().toLowerCase();
    }
    const listed = await db.from('store_owners').select('user_id,email,added_by,added_at').order('added_at', { ascending: true });
    const ownersMissing = missingRelation(listed.error);
    if (listed.error && !ownersMissing) throw listed.error;
    const owners = ownersMissing ? [] : (listed.data || []);
    const legacyOwner = await val('owner');
    const inTable = !!who && owners.some((o) => o.user_id === who);
    const admin = inTable || (!!who && (ownersMissing || owners.length === 0) && legacyOwner === who);
    const claimed = !!legacyOwner || owners.length > 0;
    if (req.method !== 'GET') need(allowed(req.headers.get('Origin')), 'Open the store page to continue', 403);

    if (path === '/api/unsub') {
      const t = u.searchParams.get('t') || '';
      if (t === 'test') return html('This was a test link. Nothing was changed.');
      if (!isUuid(t)) return html('This unsubscribe link is not valid.', 404);
      const { data, error } = await db.from('subscribers').select('email').eq('token', t).maybeSingle();
      if (error) throw error;
      if (!data) return html('This unsubscribe link is not valid.', 404);
      const { error: e2 } = await db.from('subscribers').update({ active: 0 }).eq('email', data!.email);
      if (e2) throw e2;
      return html('You are unsubscribed from Chingu Honesty Store emails.');
    }

    if (path === '/api/catalog') {
      const asked = (u.searchParams.get('store') || '').toUpperCase();
      const storeId = isCode(asked) ? asked : '';
      const [products, stores, stock, cfg, ads] = await Promise.all([
        db.from('products').select('id,name,cat,unit,price,stock,photo,active,sale_price,sale_pct,sale_start,sale_end').eq('active', 1).order('seq'),
        db.from('stores').select('id,name,seq').eq('active', 1).order('seq'),
        db.from('stock').select('store_id,product_id,shelf'),
        db.from('config').select('k,v').in('k', banks),
        db.from('ads').select('id,active,desktop,mobile,product_id,stores,starts_at,ends_at,seq').eq('active', 1).order('seq'),
      ]);
      if (products.error) throw products.error;
      if (stores.error) throw stores.error;
      if (stock.error) throw stock.error;
      if (cfg.error) throw cfg.error;
      if (ads.error) throw ads.error;
      const activeIds = new Set((products.data || []).map((p) => p.id));
      const shelfOf = (id: string, store: string) => (stock.data || []).find((s) => s.product_id === id && s.store_id === store)?.shelf ?? 0;
      const now = new Date();
      const storeRows = (stores.data || []).map((s) => ({
        id: s.id,
        name: s.name,
        shelfUnits: (stock.data || []).reduce((n, row) => n + (row.store_id === s.id && activeIds.has(row.product_id) ? row.shelf : 0), 0),
      }));
      const chosen = storeRows.find((s) => s.id === storeId) || null;
      const shelfStore = chosen?.id || 'O20';
      const list = (products.data || []).map((p) => {
        const pay = priceOf(p, now);
        return {
          id: p.id, name: p.name, cat: p.cat, unit: p.unit, price: p.price, pay, onSale: pay !== p.price,
          stock: shelfOf(p.id, shelfStore), photo: p.photo, active: p.active,
          salePrice: p.sale_price, salePct: p.sale_pct,
        };
      });
      const visibleAds = (ads.data || []).filter((ad) => {
        if (ad.starts_at && now < new Date(ad.starts_at)) return false;
        if (ad.ends_at && now > new Date(ad.ends_at)) return false;
        const targets = String(ad.stores || '').split(',').filter(Boolean);
        return !chosen || !targets.length || targets.includes(chosen.id);
      }).map((ad) => ({ id: ad.id, desktop: ad.desktop, mobile: ad.mobile, productId: ad.product_id || '' }));
      const m = Object.fromEntries((cfg.data || []).map((r) => [r.k, r.v]));
      return json({
        products: list,
        banks: Object.fromEntries(banks.map((b) => [b, m[b] ?? null])),
        stores: storeRows,
        store: chosen,
        ads: chosen ? visibleAds : [],
        admin, claimed, email: mailer().ok,
      });
    }

    if (path === '/api/claim') {
      need(req.method === 'POST', 'Invalid request', 405);
      const { key: k } = await readJson(req);
      const h = await sha256(String(k ?? ''));
      need(!claimed && who && h === SETUP, 'Invalid setup key or sign-in required', 403);
      const { error } = await db.from('config').insert({ k: 'owner', v: who });
      need(!error, 'Invalid setup key or sign-in required', 403);
      if (!ownersMissing && emailOk(whoEmail)) {
        const { error: e2 } = await db.from('store_owners').insert({ user_id: who, email: whoEmail, added_by: null });
        if (e2 && e2.code !== '23505') throw e2;
      }
      return json({ ok: true });
    }

    if (path === '/api/request') {
      need(req.method === 'POST', 'Invalid request', 405);
      const body = await readJson(req);
      if (typeof body.company === 'string' && body.company.trim()) return json({ ok: true });
      const store = String(body.store || '').toUpperCase();
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      need(isCode(store) && textOk(name, 80) && note.length <= 400 && !/[\u0000-\u001f]/.test(note), 'Check the item name');
      const { data: st, error } = await db.from('stores').select('id').eq('id', store).eq('active', 1).maybeSingle();
      if (error) throw error;
      need(st, 'Unknown store');
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count, error: e2 } = await db.from('requests').select('id', { count: 'exact', head: true }).eq('store_id', store).eq('name', name).gte('ts', since);
      if (e2) throw e2;
      need((count || 0) < 8, 'That request was already sent. The owner has it.', 429);
      const { error: e3 } = await db.from('requests').insert({ id: crypto.randomUUID(), store_id: store, name, note, status: 'Open' });
      if (e3) throw e3;
      return json({ ok: true });
    }

    if (path === '/api/ad-event') {
      need(req.method === 'POST', 'Invalid request', 405);
      const body = await readJson(req);
      need(isUuid(body.id) && (body.kind === 'view' || body.kind === 'click'), 'Invalid ad');
      const { data, error } = await db.from('ads').select('views,clicks,active').eq('id', body.id).maybeSingle();
      if (error) throw error;
      need(data && data.active === 1, 'Invalid ad', 404);
      const patch = body.kind === 'view' ? { views: data.views + 1 } : { clicks: data.clicks + 1 };
      const { error: e2 } = await db.from('ads').update(patch).eq('id', body.id);
      if (e2) throw e2;
      return json({ ok: true });
    }

    if (path.startsWith('/api/admin')) need(admin, 'Owner sign-in required', 403);

    if (path === '/api/admin/data') {
      const [o, p, s, st, ads, requests, expenses, subs, sends] = await Promise.all([
        db.from('orders').select('id,num,ts,items,total,cost,cash,bank,proof,status,store_id,email,promo').order('ts', { ascending: false }),
        db.from('products').select('id,name,cat,unit,price,cost,stock,photo,active,sale_price,sale_pct,sale_start,sale_end').order('seq'),
        db.from('stock').select('store_id,product_id,shelf,warehouse'),
        db.from('stores').select('id,name,active,seq,order_seq').order('seq'),
        db.from('ads').select('id,seq,active,desktop,mobile,product_id,stores,starts_at,ends_at,views,clicks').order('seq'),
        db.from('requests').select('id,store_id,name,note,status,ts').order('ts', { ascending: false }).limit(500),
        db.from('expenses').select('id,store_id,amount,note,category,ts').order('ts', { ascending: false }).limit(500),
        db.from('subscribers').select('id,email,store_id,active,ts').order('ts', { ascending: false }).limit(1000),
        db.from('email_sends').select('id,ts,store_id,subject,template,recipients,test').order('ts', { ascending: false }).limit(30),
      ]);
      for (const part of [o, p, s, st, ads, requests, expenses, subs, sends]) if (part.error) throw part.error;
      return json({
        email: mailer().ok,
        stores: st.data,
        products: (p.data || []).map((row) => ({
          id: row.id, name: row.name, cat: row.cat, unit: row.unit, price: row.price, cost: row.cost,
          stock: row.stock, photo: row.photo, active: row.active,
          salePrice: row.sale_price, salePct: row.sale_pct, saleStart: row.sale_start, saleEnd: row.sale_end,
        })),
        stocks: (s.data || []).map((row) => ({ storeId: row.store_id, productId: row.product_id, shelf: row.shelf, warehouse: row.warehouse })),
        orders: (o.data || []).map((row) => ({
          id: row.id, num: row.num, ts: row.ts, items: row.items, total: row.total, cost: row.cost, cash: row.cash,
          bank: row.bank, proof: row.proof, status: row.status, storeId: row.store_id, email: row.email, promo: row.promo,
        })),
        ads: (ads.data || []).map((row) => ({
          id: row.id, seq: row.seq, active: row.active, desktop: row.desktop, mobile: row.mobile,
          productId: row.product_id || '', stores: String(row.stores || '').split(',').filter(Boolean),
          starts: row.starts_at, ends: row.ends_at, views: row.views, clicks: row.clicks,
        })),
        requests: (requests.data || []).map((row) => ({ id: row.id, storeId: row.store_id, name: row.name, note: row.note, status: row.status, ts: row.ts })),
        expenses: (expenses.data || []).map((row) => ({ id: row.id, storeId: row.store_id, amount: row.amount, note: row.note, category: row.category, ts: row.ts })),
        subscribers: subs.data?.map((row) => ({ id: row.id, email: row.email, storeId: row.store_id, active: row.active, ts: row.ts })) || [],
        sends: (sends.data || []).map((row) => ({ id: row.id, ts: row.ts, storeId: row.store_id, subject: row.subject, template: row.template, recipients: row.recipients, test: row.test })),
        telegram: await telegramFlags(),
        teamReady: !ownersMissing,
        owners: (ownersMissing && admin && who ? [{ user_id: who, email: whoEmail || 'owner', added_at: null }] : owners).map((row) => ({
          userId: row.user_id,
          email: row.email,
          addedAt: row.added_at,
          you: row.user_id === who,
        })),
      });
    }

    if (path === '/api/admin/owner') {
      need(req.method === 'POST', 'Invalid request', 405);
      need(!ownersMissing, 'Apply the store owners migration, then retry', 503);
      const body = await readJson(req);
      if (body.remove) {
        const id = body.remove;
        need(isUuid(id), 'Unknown owner');
        need(id !== who, 'You cannot remove your own access');
        need(owners.length > 1, 'The store needs at least one owner');
        need(owners.some((o) => o.user_id === id), 'Unknown owner', 404);
        if (legacyOwner === id) {
          const next = owners.find((o) => o.user_id !== id);
          need(next, 'The store needs at least one owner');
          const { error } = await db.from('config').update({ v: next.user_id }).eq('k', 'owner');
          if (error) throw error;
        }
        const { error } = await db.from('store_owners').delete().eq('user_id', id);
        if (error) {
          if (error.code === 'P0001' || /LAST_OWNER/.test(error.message || '')) throw new HttpError('The store needs at least one owner');
          throw error;
        }
        return json({ ok: true });
      }
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      need(emailOk(email), 'Check the email address');
      need(!owners.some((o) => o.email === email), 'That person is already an owner', 409);
      const known = await findAuthUser(email);
      if (known && owners.some((o) => o.user_id === known.id)) throw new HttpError('That person is already an owner', 409);
      const account = known && isUuid(known.id) ? { ...known, invited: false } : await accountForOwner(email);
      need(!owners.some((o) => o.user_id === account.id), 'That person is already an owner', 409);
      const stored = String(account.email || email).trim().toLowerCase();
      need(emailOk(stored), 'Check the email address');
      const { error } = await db.from('store_owners').insert({ user_id: account.id, email: stored, added_by: who });
      if (error) {
        if (error.code === '23505') throw new HttpError('That person is already an owner', 409);
        throw error;
      }
      return json({ ok: true, invited: account.invited });
    }

    if (path === '/api/admin/product') {
      need(req.method === 'POST', 'Invalid request', 405);
      const p = await readJson(req);
      const name = typeof p.name === 'string' ? p.name.trim() : '';
      const cat = typeof p.cat === 'string' ? p.cat.trim() : '';
      const unit = typeof p.unit === 'string' ? p.unit.trim() : '';
      need(textOk(name, 119) && textOk(cat, 119) && textOk(unit, 119) && cents(p.price, 1), 'Check the product details');
      need(!('cost' in p) || p.cost == null || p.cost === '' || cents(p.cost, 0), 'Check the cost');
      need(isUuid(p.id) || samples.includes(p.id), 'Invalid product');
      need(photoPath(p.photo), 'Upload a product photo');
      const row: Record<string, unknown> = { name, cat, unit, price: p.price, photo: p.photo, active: p.active ? 1 : 0 };
      if ('cost' in p) row.cost = p.cost == null || p.cost === '' ? null : p.cost;
      if ('salePrice' in p || 'salePct' in p || 'saleStart' in p || 'saleEnd' in p) Object.assign(row, saleFields(p, p.price));
      const { data: existing, error } = await db.from('products').select('id').eq('id', p.id).maybeSingle();
      if (error) throw error;
      if (existing) {
        const { error: e2 } = await db.from('products').update(row).eq('id', p.id);
        if (e2) throw e2;
      } else {
        const { error: e3 } = await db.from('products').insert({ id: p.id, ...row });
        if (e3) throw e3;
        await ensureStock(p.id);
      }
      if (Array.isArray(p.stockEdits)) await applyStockEdits(p.id, p.stockEdits);
      else if (Number.isSafeInteger(p.stock) && Number.isSafeInteger(p.originalStock)) {
        const { data: cur, error: e4 } = await db.from('stock').select('shelf,warehouse').eq('store_id', 'O20').eq('product_id', p.id).maybeSingle();
        if (e4) throw e4;
        need(cur && cur.shelf === p.originalStock, 'Stock changed. Refresh and retry', 409);
        const { error: e5 } = await db.rpc('adjust_stock', {
          p_store: 'O20', p_product: p.id, p_op: 'set', p_qty: null,
          p_shelf: p.stock, p_warehouse: cur.warehouse, p_oshelf: cur.shelf, p_owarehouse: cur.warehouse,
        });
        if (e5) throw new HttpError('Stock changed. Refresh and retry', 409);
      }
      return json({ ok: true });
    }

    if (path === '/api/admin/stock') {
      need(req.method === 'POST', 'Invalid request', 405);
      const body = await readJson(req);
      const store = String(body.storeId || '').toUpperCase();
      need(isCode(store) && (isUuid(body.productId) || samples.includes(body.productId)), 'Check the stock move');
      need(body.op === 'restock' || body.op === 'receive' || body.op === 'set', 'Check the stock move');
      const qty = body.op === 'set' ? null : body.qty;
      if (body.op !== 'set') need(typeof qty === 'number' && Number.isSafeInteger(qty) && qty > 0 && qty < 1000000, 'Check the quantity');
      const { data: moved, error } = await db.rpc('adjust_stock', {
        p_store: store, p_product: body.productId, p_op: body.op, p_qty: qty,
        p_shelf: body.shelf ?? null, p_warehouse: body.warehouse ?? null,
        p_oshelf: body.originalShelf ?? null, p_owarehouse: body.originalWarehouse ?? null,
      });
      if (error) throw new HttpError(body.op === 'restock' ? 'Not enough in the warehouse' : 'Stock changed. Refresh and retry', 409);
      if (body.op === 'restock' || body.op === 'receive') {
        const levels = (moved || {}) as { shelf?: number; warehouse?: number };
        defer(announceMovement(body.op, store, String(body.productId), qty as number, levels.shelf, levels.warehouse));
      }
      return json({ ok: true });
    }

    if (path === '/api/admin/bulk') {
      need(req.method === 'POST', 'Invalid request', 405);
      const body = await readJson(req);
      const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
      need(ids.length && ids.length <= 200 && ids.every((id) => isUuid(id) || samples.includes(id)), 'Choose the products again');
      const patch: Record<string, unknown> = {};
      if (body.cat != null) {
        need(textOk(body.cat, 119), 'Check the category');
        patch.cat = String(body.cat).trim();
      }
      if (body.active != null) patch.active = body.active ? 1 : 0;
      if (body.clearSale) {
        patch.sale_price = null; patch.sale_pct = null; patch.sale_start = null; patch.sale_end = null;
      } else if (body.salePct != null || body.salePrice != null) {
        const { data: rows, error } = await db.from('products').select('id,price').in('id', ids);
        if (error) throw error;
        const maxPrice = Math.min(...(rows || []).map((r) => r.price));
        const sale = saleFields(body, Number.isFinite(maxPrice) ? maxPrice : 1);
        Object.assign(patch, sale);
      }
      need(Object.keys(patch).length, 'Nothing to change');
      const { error } = await db.from('products').update(patch).in('id', ids);
      if (error) throw error;
      return json({ ok: true });
    }

    if (path === '/api/admin/store') {
      need(req.method === 'POST', 'Invalid request', 405);
      const body = await readJson(req);
      const code = String(body.code || '').toUpperCase().trim();
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      need(isCode(code) && textOk(name, 80), 'Use a short store code and name');
      const { data: last, error } = await db.from('stores').select('seq').order('seq', { ascending: false }).limit(1);
      if (error) throw error;
      const seq = (last?.[0]?.seq || 0) + 1;
      const { error: e2 } = await db.from('stores').insert({ id: code, name, active: 1, seq, order_seq: 0 });
      need(!e2, 'That store code is already used', 409);
      const { data: products, error: e3 } = await db.from('products').select('id');
      if (e3) throw e3;
      const rows = (products || []).map((p) => ({ store_id: code, product_id: p.id, shelf: 0, warehouse: 0 }));
      for (let i = 0; i < rows.length; i += 200) {
        const { error: e4 } = await db.from('stock').insert(rows.slice(i, i + 200));
        if (e4) throw e4;
      }
      return json({ ok: true });
    }

    if (path === '/api/admin/ad') {
      need(req.method === 'POST', 'Invalid request', 405);
      const body = await readJson(req);
      const id = body.id && isUuid(body.id) ? body.id : crypto.randomUUID();
      const desktop = typeof body.desktop === 'string' ? body.desktop : '';
      const mobile = typeof body.mobile === 'string' ? body.mobile : '';
      need((!desktop || fileImage(desktop)) && (!mobile || fileImage(mobile)), 'Upload JPG or PNG ads');
      const active = body.active ? 1 : 0;
      need(!active || (desktop && mobile), 'An ad needs a desktop and a mobile image before it can be on');
      const productId = body.productId ? String(body.productId) : '';
      if (productId) {
        need(isUuid(productId) || samples.includes(productId), 'Unknown product');
        const { data, error } = await db.from('products').select('id').eq('id', productId).maybeSingle();
        if (error) throw error;
        need(data, 'Unknown product');
      }
      const codes = Array.isArray(body.stores) ? body.stores.map((c: unknown) => String(c).toUpperCase()) : [];
      need(codes.length <= 20 && codes.every(isCode), 'Check the stores for this ad');
      if (codes.length) {
        const { data, error } = await db.from('stores').select('id').in('id', codes);
        if (error) throw error;
        need(data && data.length === new Set(codes).size, 'Unknown store');
      }
      need(isoOk(body.starts) && isoOk(body.ends), 'Check the ad dates');
      const starts = body.starts ? new Date(String(body.starts)).toISOString() : null;
      const ends = body.ends ? new Date(String(body.ends)).toISOString() : null;
      need(!starts || !ends || starts < ends, 'The ad end is before the start');
      const row = { id, active, desktop, mobile, product_id: productId || null, stores: codes.join(','), starts_at: starts, ends_at: ends };
      const { error } = await db.from('ads').upsert(row);
      if (error) throw error;
      return json({ ok: true, id });
    }

    if (path === '/api/admin/ad-order') {
      need(req.method === 'POST', 'Invalid request', 405);
      const body = await readJson(req);
      const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
      need(ids.length <= 100 && ids.every(isUuid), 'Check the ad order');
      for (let i = 0; i < ids.length; i++) {
        const { error } = await db.from('ads').update({ seq: i + 1 }).eq('id', ids[i]);
        if (error) throw error;
      }
      return json({ ok: true });
    }

    if (path === '/api/admin/expense') {
      need(req.method === 'POST', 'Invalid request', 405);
      const body = await readJson(req);
      if (body.delete) {
        need(isUuid(body.id), 'Unknown expense');
        const { error } = await db.from('expenses').delete().eq('id', body.id);
        if (error) throw error;
        return json({ ok: true });
      }
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'General';
      const storeId = body.storeId ? String(body.storeId).toUpperCase() : null;
      need(textOk(note, 200) && textOk(category, 40) && cents(body.amount, 0) && isoOk(body.ts), 'Check the expense');
      if (storeId) need(isCode(storeId), 'Unknown store');
      const row = { id: isUuid(body.id) ? body.id : crypto.randomUUID(), store_id: storeId, amount: body.amount, note, category, ts: body.ts ? new Date(String(body.ts)).toISOString() : new Date().toISOString() };
      const { error } = await db.from('expenses').upsert(row);
      if (error) throw error;
      return json({ ok: true });
    }

    if (path === '/api/admin/request-status') {
      need(req.method === 'POST', 'Invalid request', 405);
      const body = await readJson(req);
      need(isUuid(body.id) && (body.status === 'Open' || body.status === 'Done'), 'Invalid request');
      const { error } = await db.from('requests').update({ status: body.status }).eq('id', body.id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (path === '/api/admin/email-preview' || path === '/api/admin/email') {
      need(req.method === 'POST', 'Invalid request', 405);
      const body = await readJson(req);
      const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      need(textOk(subject, 140) && message.length > 0 && message.length <= 4000 && !/[\u0000-\u0008]/.test(message), 'Check the subject and message');
      const ids: string[] = Array.isArray(body.productIds) ? body.productIds.slice(0, 12) : [];
      need(ids.every((id) => isUuid(id) || samples.includes(id)), 'Check the products');
      const banner = body.banner ? String(body.banner) : '';
      need(!banner || fileImage(banner), 'Check the banner');
      const storeId = body.storeId ? String(body.storeId).toUpperCase() : '';
      if (storeId) need(isCode(storeId), 'Unknown store');
      let products: { name: string; priceLabel: string }[] = [];
      if (ids.length) {
        const { data, error } = await db.from('products').select('id,name,price,sale_price,sale_pct,sale_start,sale_end').in('id', ids);
        if (error) throw error;
        products = (data || []).map((p) => ({ name: p.name, priceLabel: peso(priceOf(p)) }));
      }
      const { data: storeRow } = storeId ? await db.from('stores').select('name').eq('id', storeId).maybeSingle() : { data: null };
      const sample = emailDocument({
        subject, message, banner: banner ? absImage(banner) : '', products,
        storeName: storeRow?.name || '', unsubUrl: PUBLIC_FN + '/api/unsub?t=test',
      });
      if (path.endsWith('preview')) return json({ html: sample });
      const sending = mailer();
      need(sending.ok, 'Email is not configured', 503);
      if (body.test) {
        const to = typeof body.testTo === 'string' ? body.testTo.trim().toLowerCase() : '';
        need(emailOk(to), 'Enter a test email address');
        await sendResend([{ to, subject: '[Test] ' + subject, html: sample, unsub: PUBLIC_FN + '/api/unsub?t=test' }]);
        const { error } = await db.from('email_sends').insert({ id: crypto.randomUUID(), store_id: storeId || null, subject, template: String(body.template || ''), recipients: 1, test: 1 });
        if (error) throw error;
        return json({ ok: true, sent: 1 });
      }
      let q = db.from('subscribers').select('email,token,store_id').eq('active', 1);
      if (storeId) q = q.eq('store_id', storeId);
      const { data: people, error } = await q.limit(300);
      if (error) throw error;
      const seen = new Set<string>();
      const recipients = (people || []).filter((person) => {
        if (seen.has(person.email)) return false;
        seen.add(person.email);
        return true;
      });
      need(recipients.length, 'No subscribers for that store');
      need(recipients.length <= 300, 'Too many subscribers for one send');
      await sendResend(recipients.map((person) => ({
        to: person.email,
        subject,
        html: emailDocument({
          subject, message, banner: banner ? absImage(banner) : '', products,
          storeName: storeRow?.name || '', unsubUrl: PUBLIC_FN + '/api/unsub?t=' + person.token,
        }),
        unsub: PUBLIC_FN + '/api/unsub?t=' + person.token,
      })));
      const { error: e2 } = await db.from('email_sends').insert({ id: crypto.randomUUID(), store_id: storeId || null, subject, template: String(body.template || ''), recipients: recipients.length, test: 0 });
      if (e2) throw e2;
      return json({ ok: true, sent: recipients.length });
    }

    if (path === '/api/admin/telegram') {
      if (req.method === 'GET') return json(await telegramFlags());
      need(req.method === 'POST', 'Invalid request', 405);
      const flags = await telegramFlags();
      need(flags.token, 'The bot token is not set', 503);
      need(flags.salesChat || flags.stocksChat, 'The chat ids are not set', 503);
      const text = '<b>Chingu Honesty Store</b>\nThis is a test message. Telegram notifications are connected.';
      const sent: string[] = [];
      if (flags.salesChat) {
        const id = await chatId(SALES_CHAT);
        const result = await sendTelegramMessage(id, text);
        need(result.ok, 'The sales group did not accept the test message', 502);
        sent.push('sales');
      }
      if (flags.stocksChat) {
        const id = await chatId(STOCKS_CHAT);
        const result = await sendTelegramMessage(id, text);
        need(result.ok, 'The stocks group did not accept the test message', 502);
        sent.push('stocks');
      }
      return json({ ok: true, token: flags.token, salesChat: flags.salesChat, stocksChat: flags.stocksChat, sent });
    }

    if (path === '/api/admin/bank') {
      need(req.method === 'POST', 'Invalid request', 405);
      const { bank, file } = await readJson(req);
      need(banks.includes(bank) && fileImage(file), 'Invalid QR');
      const { error } = await db.from('config').upsert({ k: bank, v: file });
      if (error) throw error;
      return json({ ok: true });
    }

    if (path === '/api/admin/review') {
      need(req.method === 'POST', 'Invalid request', 405);
      const { id, status } = await readJson(req);
      need(typeof id === 'string' && id.length <= 80 && ['Verified', 'Flagged'].includes(status), 'Invalid status');
      const { error } = await db.from('orders').update({ status }).eq('id', id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (path === '/api/admin/image' || path === '/api/proof') {
      need(req.method === 'POST', 'Upload a file');
      need(Number(req.headers.get('content-length') || 0) <= 5000000, 'Maximum 5 MB');
      const data = new Uint8Array(await req.arrayBuffer());
      need(data.length <= 5000000, 'Maximum 5 MB');
      const mime = data[0] === 255 && data[1] === 216 ? 'image/jpeg' : Array.from(data.slice(0, 8)).join(',') === '137,80,78,71,13,10,26,10' ? 'image/png' : null;
      need(mime, 'Choose a JPG or PNG image');
      const name = (admin && path.endsWith('image') ? 'image-' : 'proof-') + crypto.randomUUID();
      const { error } = await db.storage.from(BUCKET).upload(name, data, { contentType: mime, upsert: false });
      if (error) throw error;
      return json({ file: '/file/' + name });
    }

    if (path.startsWith('/file/')) {
      const k = path.slice(6);
      need(/^(image|proof)-[0-9a-f-]{36}$/i.test(k) && (!k.startsWith('proof') || admin), 'Private file', 403);
      const { data, error } = await db.storage.from(BUCKET).download(k);
      need(!error && data, 'Missing image', 404);
      return new Response(data, { headers: { ...ch, 'Content-Type': data.type || 'application/octet-stream', 'Cache-Control': k.startsWith('proof') ? 'private, no-store' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
    }

    if (path === '/api/order') {
      need(req.method === 'POST', 'Invalid request', 405);
      const a = await readJson(req);
      need(isUuid(a.id), 'Invalid checkout');
      const store = String(a.store || 'O20').toUpperCase();
      need(isCode(store), 'Choose a store');
      const { data: st, error: es } = await db.from('stores').select('id,name').eq('id', store).eq('active', 1).maybeSingle();
      if (es) throw es;
      need(st, 'Choose a store');
      const { data: old, error: eo } = await db.from('orders').select('id,num,total').eq('id', a.id).maybeSingle();
      if (eo) throw eo;
      if (old) return json({ id: old.id, num: old.num, total: old.total });
      need(Array.isArray(a.items) && a.items.length && a.items.length <= 80 && new Set(a.items.map((i: { id?: string }) => i?.id)).size === a.items.length, 'Check your cart');
      const ids = a.items.map((i: { id?: string }) => String(i.id));
      const { data: prods, error: ep } = await db.from('products').select('id,name,price,sale_price,sale_pct,sale_start,sale_end').in('id', ids).eq('active', 1);
      if (ep) throw ep;
      const { data: shelves, error: ehs } = await db.from('stock').select('product_id,shelf,warehouse').eq('store_id', store).in('product_id', ids);
      if (ehs) throw ehs;
      let total = 0;
      const now = new Date();
      for (const i of a.items) {
        const p = prods?.find((x) => x.id === i.id);
        const shelf = shelves?.find((x) => x.product_id === i.id)?.shelf ?? 0;
        const pay = p ? priceOf(p, now) : 0;
        need(p && Number.isInteger(i.qty) && i.qty > 0 && i.qty <= shelf && i.price === pay, 'Price or stock changed. Refresh your cart', 409);
        total += pay * i.qty;
      }
      const email = typeof a.email === 'string' ? a.email.trim().toLowerCase() : '';
      const promo = a.promo ? 1 : 0;
      need(!email || emailOk(email), 'Check the email address');
      need(!promo || email, 'Enter an email to get store updates');
      need(Number.isInteger(a.cash) && a.cash >= 0 && a.cash <= total && ['cash', 'qr', 'split'].includes(a.mode) && (a.mode === 'cash' ? a.cash === total : a.mode === 'qr' ? a.cash === 0 : a.cash > 0 && a.cash < total), 'Check the payment split');
      if (a.cash < total) {
        need(banks.includes(a.bank) && await val(a.bank) && fileProof(a.proof) && await objectExists(String(a.proof).slice(6)), 'Upload your payment receipt');
      }
      const { data: placed, error } = await db.rpc('place_order', {
        p_id: a.id,
        p_items: a.items.map((i: { id: string; qty: number; price: number }) => ({ id: i.id, qty: i.qty, price: i.price })),
        p_cash: a.cash,
        p_bank: a.cash < total ? a.bank : '',
        p_proof: a.cash < total ? a.proof : '',
        p_store: store,
        p_email: email,
        p_promo: promo,
      });
      if (error) {
        const { data: again } = await db.from('orders').select('id,num,total').eq('id', a.id).maybeSingle();
        if (!again) throw new HttpError('Price or stock changed. Refresh and retry', 409);
        return json({ id: again.id, num: again.num, total: again.total });
      }
      if (!placed?.existing) {
        const lines = a.items.map((i: { id: string; qty: number; price: number }) => {
          const p = prods?.find((x) => x.id === i.id);
          const row = shelves?.find((x) => x.product_id === i.id);
          const before = row?.shelf ?? i.qty;
          return { name: p?.name || 'Item', qty: i.qty, price: i.price, before, after: before - i.qty, warehouse: row?.warehouse ?? 0 };
        });
        defer(announceOrder({
          num: String(placed.num || ''),
          storeName: st.name,
          at: now,
          total,
          customer: plainNote(a.name, 80),
          note: plainNote(a.note, 200),
          proof: a.cash < total && fileProof(a.proof) ? String(a.proof) : '',
          items: lines.map((row) => ({ name: row.name, qty: row.qty, price: row.price })),
          levels: lines.map((row) => ({ name: row.name, before: row.before, after: row.after, warehouse: row.warehouse })),
        }));
      }
      let emailSent = false;
      let emailNote = '';
      if (email && !placed?.existing) {
        if (!mailer().ok) emailNote = 'email not configured';
        else {
          try {
            let unsub = '';
            if (promo) {
              const { data: sub } = await db.from('subscribers').select('token').eq('email', email).eq('store_id', store).maybeSingle();
              if (sub?.token) unsub = PUBLIC_FN + '/api/unsub?t=' + sub.token;
            }
            const lines = a.items.map((i: { id: string; qty: number; price: number }) => {
              const p = prods?.find((x) => x.id === i.id);
              return p ? `${i.qty} x ${p.name} — ${peso(i.price * i.qty)}` : '';
            }).filter(Boolean);
            await sendResend([{
              to: email,
              subject: 'Receipt ' + placed.num,
              html: emailDocument({
                subject: 'Receipt ' + placed.num,
                message: `Thanks for shopping at ${st.name}.\n\n${lines.join('\n')}\n\nTotal ${peso(total)}`,
                storeName: st.name,
                unsubUrl: unsub || undefined,
              }),
              unsub: unsub || undefined,
            }]);
            emailSent = true;
          } catch {
            emailNote = 'The receipt email could not be sent. Download the receipt instead.';
          }
        }
      }
      return json({ id: a.id, num: placed.num, total: placed.total, store: st.name, emailSent, emailNote });
    }

    return json({ error: 'Page unavailable' }, 404);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    return json({ error: e instanceof HttpError ? e.message : 'The store could not complete this request. Please retry.' }, e instanceof HttpError ? e.status : 500);
  }
});
