// Tapat Honesty Store API — Supabase Edge Function port of src/server.js
import { createClient } from 'npm:@supabase/supabase-js@2';

const SETUP = '124ed15d7d5eb49b7967b7024a96f520eabf7be15629739e25272291129fbf0f';
const BUCKET = 'store-files';
const banks = ['GCash', 'Maya (PayMaya)', 'BPI', 'MariBank'];
const samples = ['bread', 'banana', 'milk', 'croissant', 'apple', 'coffee', 'orange', 'eggs'];

const url = Deno.env.get('SUPABASE_URL')!;
let key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
try { const s = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); if (s.default) key = s.default; } catch { /* use legacy key */ }
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// CORS: only the live GitHub Pages site may call this API from a browser.
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
const isUuid = (s: unknown) => typeof s === 'string' && /^[a-f0-9-]{36}$/.test(s);

async function val(k: string): Promise<string | undefined> {
  const { data, error } = await db.from('config').select('v').eq('k', k).maybeSingle();
  if (error) throw error;
  return data?.v;
}
async function objectExists(name: string) {
  const { data, error } = await db.storage.from(BUCKET).list('', { search: name, limit: 5 });
  if (error) throw error;
  return !!data?.some((o) => o.name === name);
}
const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (x) => x.toString(16).padStart(2, '0')).join('');

Deno.serve(async (req) => {
  const ch = cors(req);
  const json = (v: unknown, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { ...ch, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: allowed(req.headers.get('Origin')) ? 204 : 403, headers: ch });
  try {
    const u = new URL(req.url);
    const path = u.pathname.replace(/^(\/functions\/v1)?\/store(?=\/|$)/, '') || '/';

    // Owner identity from Supabase Auth access token
    let who: string | null = null;
    const auth = req.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (token && token.split('.').length === 3) {
      const { data } = await db.auth.getUser(token);
      who = data?.user?.id ?? null;
    }
    const owner = await val('owner');
    const admin = !!who && owner === who;
    if (req.method !== 'GET') need(allowed(req.headers.get('Origin')), 'Open the store page to continue', 403);

    if (path === '/api/catalog') {
      const { data: products, error } = await db.from('products').select('id,name,cat,unit,price,stock,photo,active').eq('active', 1).order('seq');
      if (error) throw error;
      const { data: cfg, error: e2 } = await db.from('config').select('k,v').in('k', banks);
      if (e2) throw e2;
      const m = Object.fromEntries((cfg || []).map((r) => [r.k, r.v]));
      return json({ products, banks: Object.fromEntries(banks.map((b) => [b, m[b] ?? null])), admin, claimed: !!owner });
    }
    if (path === '/api/claim') {
      need(req.method === 'POST', 'Invalid request', 405);
      const { key: k } = await req.json();
      const h = await sha256(String(k ?? ''));
      need(!owner && who && h === SETUP, 'Invalid setup key or sign-in required', 403);
      const { error } = await db.from('config').insert({ k: 'owner', v: who });
      need(!error, 'Invalid setup key or sign-in required', 403); // someone claimed concurrently
      return json({ ok: true });
    }
    if (path.startsWith('/api/admin')) need(admin, 'Owner sign-in required', 403);
    if (path === '/api/admin/data') {
      const [o, p] = await Promise.all([
        db.from('orders').select('id,ts,items,total,cash,bank,proof,status').order('ts', { ascending: false }),
        db.from('products').select('id,name,cat,unit,price,stock,photo,active').order('seq'),
      ]);
      if (o.error) throw o.error; if (p.error) throw p.error;
      return json({ orders: o.data, products: p.data });
    }
    if (path === '/api/admin/product') {
      need(req.method === 'POST', 'Invalid request', 405);
      const p = await req.json();
      need([p.name, p.cat, p.unit].every((x) => typeof x === 'string' && x.trim() && x.length < 120) && Number.isSafeInteger(p.price) && p.price > 0 && p.price <= 100000000 && Number.isSafeInteger(p.stock) && p.stock >= 0 && p.stock < 1000000, 'Check the product details');
      need(isUuid(p.id) || samples.includes(p.id), 'Invalid product');
      need(samples.some((s) => '/photo/' + s === p.photo) || /^\/file\/image-[a-f0-9-]{36}$/.test(p.photo), 'Upload a product photo');
      const row = { name: p.name, cat: p.cat, unit: p.unit, price: p.price, stock: p.stock, photo: p.photo, active: p.active ? 1 : 0 };
      const { data: existing, error } = await db.from('products').select('id').eq('id', p.id).maybeSingle();
      if (error) throw error;
      if (existing) {
        need(Number.isSafeInteger(p.originalStock), 'Stock changed. Refresh and retry', 409);
        const { data: upd, error: e2 } = await db.from('products').update(row).eq('id', p.id).eq('stock', p.originalStock).select('id');
        if (e2) throw e2;
        need(upd && upd.length, 'Stock changed. Refresh and retry', 409);
      } else {
        const { error: e3 } = await db.from('products').insert({ id: p.id, ...row });
        if (e3) throw e3;
      }
      return json({ ok: true });
    }
    if (path === '/api/admin/bank') {
      need(req.method === 'POST', 'Invalid request', 405);
      const { bank, file } = await req.json();
      need(banks.includes(bank) && typeof file === 'string' && /^\/file\/image-[a-f0-9-]{36}$/.test(file), 'Invalid QR');
      const { error } = await db.from('config').upsert({ k: bank, v: file });
      if (error) throw error;
      return json({ ok: true });
    }
    if (path === '/api/admin/review') {
      need(req.method === 'POST', 'Invalid request', 405);
      const { id, status } = await req.json();
      need(['Verified', 'Flagged'].includes(status), 'Invalid status');
      const { error } = await db.from('orders').update({ status }).eq('id', String(id));
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
      need(/^(image|proof)-[a-f0-9-]{36}$/.test(k) && (!k.startsWith('proof') || admin), 'Private file', 403);
      const { data, error } = await db.storage.from(BUCKET).download(k);
      need(!error && data, 'Missing image', 404);
      return new Response(data, { headers: { ...ch, 'Content-Type': data.type || 'application/octet-stream', 'Cache-Control': k.startsWith('proof') ? 'private, no-store' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
    }
    if (path === '/api/order') {
      need(req.method === 'POST', 'Invalid request', 405);
      const a = await req.json();
      need(isUuid(a.id), 'Invalid checkout');
      const { data: old, error: eo } = await db.from('orders').select('id').eq('id', a.id).maybeSingle();
      if (eo) throw eo;
      if (old) return json(old);
      need(Array.isArray(a.items) && a.items.length && a.items.length <= 80 && new Set(a.items.map((i: any) => i?.id)).size === a.items.length, 'Check your cart');
      const ids = a.items.map((i: any) => String(i.id));
      const { data: prods, error: ep } = await db.from('products').select('id,name,price,stock').in('id', ids).eq('active', 1);
      if (ep) throw ep;
      let total = 0;
      for (const i of a.items) {
        const p = prods?.find((x) => x.id === i.id);
        need(p && Number.isInteger(i.qty) && i.qty > 0 && i.qty <= p.stock && i.price === p.price, 'Price or stock changed. Refresh your cart', 409);
        total += p.price * i.qty;
      }
      need(Number.isInteger(a.cash) && a.cash >= 0 && a.cash <= total && ['cash', 'qr', 'split'].includes(a.mode) && (a.mode === 'cash' ? a.cash === total : a.mode === 'qr' ? a.cash === 0 : a.cash > 0 && a.cash < total), 'Check the payment split');
      if (a.cash < total) {
        need(banks.includes(a.bank) && await val(a.bank) && typeof a.proof === 'string' && /^\/file\/proof-[a-f0-9-]{36}$/.test(a.proof) && await objectExists(a.proof.slice(6)), 'Upload your payment receipt');
      }
      const { error } = await db.rpc('place_order', {
        p_id: a.id, p_items: a.items.map((i: any) => ({ id: i.id, qty: i.qty, price: i.price })), p_cash: a.cash,
        p_bank: a.cash < total ? a.bank : '', p_proof: a.cash < total ? a.proof : '',
      });
      if (error) {
        const { data: again } = await db.from('orders').select('id').eq('id', a.id).maybeSingle();
        if (!again) throw new HttpError('Stock changed. Refresh and retry', 409);
      }
      return json({ id: a.id });
    }
    return json({ error: 'Page unavailable' }, 404);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    return json({ error: e instanceof HttpError ? e.message : 'The store could not complete this request. Please retry.' }, e instanceof HttpError ? e.status : 500);
  }
});
