// Chingu Honesty Store — storefront and owner dashboard.
const C = window.TAPAT_CONFIG;
const L = window.StoreLogic;
const demo = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && new URLSearchParams(location.search).get('demo') === '1';
const FN = (demo ? location.origin : C.FUNCTION_URL).replace(/\/$/, '');
const $ = (s) => document.querySelector(s);
const main = $('#main');
const dlg = $('#dlg');
const own = /\/owner(\.html)?$/.test(location.pathname);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => L.money(n);
const src = (p) => !p ? '' : p.startsWith('/photo/') ? 'photos/' + encodeURIComponent(p.slice(7)) + '.jpg' : p.startsWith('/file/') ? FN + p : p;
const sb = own && !demo && window.supabase ? window.supabase.createClient(C.SUPABASE_URL, C.PUBLISHABLE_KEY) : null;
const TABS = ['Dashboard', 'Sales', 'Inventory', 'Requests', 'Ads', 'Expenses', 'Email', 'Payment QRs', 'Store QR'];
const HASH = { dashboard: 'Dashboard', sales: 'Sales', inventory: 'Inventory', requests: 'Requests', ads: 'Ads', expenses: 'Expenses', email: 'Email', qrs: 'Payment QRs', qr: 'Store QR' };
const UIKEY = 'tapat-owner-ui';

let ui = {};
try { ui = JSON.parse(localStorage.getItem(UIKEY) || '{}') || {}; } catch { ui = {}; }
function saveUi(patch) { ui = Object.assign(ui, patch || {}); localStorage.setItem(UIKEY, JSON.stringify(ui)); }
if (HASH[location.hash.slice(1)]) ui.tab = HASH[location.hash.slice(1)];

let cat = 'All items', search = '', data, adminData, tab = ui.tab || 'Dashboard';
let carts = L.loadAllCarts(localStorage.getItem('tapat-cart') || '');
let storeId = (new URLSearchParams(location.search).get('store') || localStorage.getItem('tapat-store') || '').toUpperCase();
let picking = false, proof = '', timer, session = null, selected = new Set(), paintTimer;

function bag() { if (!carts[storeId]) carts[storeId] = {}; return carts[storeId]; }
function persistCart() { localStorage.setItem('tapat-cart', L.saveAllCarts(carts)); }
function lines() { const q = bag(); return (data.products || []).filter((p) => q[p.id] > 0); }
function linePrice(p) { return p.pay ?? L.effectivePrice(p); }
function total() { const q = bag(); return lines().reduce((s, p) => s + q[p.id] * linePrice(p), 0); }
function storeName(id) { return (data?.stores || adminData?.stores || []).find((s) => s.id === id)?.name || id || ''; }
function ownerStores() { return (adminData?.stores || []).filter((s) => s.active !== 0); }

async function token() { if (!sb) return ''; const { data: d } = await sb.auth.getSession(); session = d.session; return session?.access_token || ''; }
async function api(path, body) {
  const h = {};
  const t = await token();
  if (t) h.Authorization = 'Bearer ' + t;
  if (body instanceof File) h['Content-Type'] = body.type || 'application/octet-stream';
  else if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(FN + path, body === undefined ? { headers: h } : { method: 'POST', headers: h, body: body instanceof File ? body : JSON.stringify(body) });
  let v;
  try { v = await r.json(); } catch { throw Error('The store could not be reached. Please retry.'); }
  if (!r.ok) throw Error(v.error || 'Request failed');
  return v;
}
async function blobOf(path) { const h = {}; const t = await token(); if (t) h.Authorization = 'Bearer ' + t; const r = await fetch(FN + path, { headers: h }); if (!r.ok) throw Error(r.status === 403 ? 'Owner sign-in required' : 'Could not load the file'); return r.blob(); }
function save(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
async function downloadFile(p, name) { try { save(p.startsWith('/file/') ? await blobOf(p) : await (await fetch(src(p))).blob(), name); } catch (e) { fail(e); } }
function msg(s, kind) { const t = $('#toast'); t.hidden = false; t.className = 'toast ' + (kind === 'error' ? 'error' : 'ok'); t.textContent = s; clearTimeout(timer); timer = setTimeout(() => t.hidden = true, 4500); }
function modal(title, body, wide) { dlg.classList.toggle('wide', !!wide); dlg.innerHTML = '<div class="row"><h2 id="dlg-title">' + title + '</h2><button type="button" class="icon-btn" data-act="close" aria-label="Close">×</button></div>' + body + '<p class="error" id="err" role="alert"></p>'; dlg.setAttribute('aria-labelledby', 'dlg-title'); if (!dlg.open) dlg.showModal(); }
function fail(e) { const text = e && e.message ? e.message : 'Something went wrong'; if (dlg.open && $('#err')) $('#err').textContent = text; else msg(text, 'error'); }
function confirmBox(title, copy, yesLabel, onYes) {
  modal(title, '<p>' + copy + '</p><div class="dialog-actions"><button type="button" class="btn btn-secondary" data-act="close">Cancel</button><button type="button" class="btn btn-danger" id="confirm-yes">' + yesLabel + '</button></div>');
  $('#confirm-yes').onclick = onYes;
}
function shortStoreLabel(id, name) {
  const clean = String(name || '').replace(/\s+floor$/i, '').replace(/\s+/g, ' ').trim();
  if (clean && clean.length <= 14) return clean;
  const two = clean.split(' ').slice(0, 2).join(' ');
  if (two && two.length <= 14) return two;
  return id || clean || 'Store';
}
const SWAP_ICON = '<svg class="swapicon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"/></svg>';
const CHEVRON_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 3.2 10.8 8 6 12.8"/></svg>';
function showStoreChip() {
  const chip = $('#storechip');
  if (!chip) return;
  if (own || picking || !storeId) { chip.hidden = true; return; }
  const name = storeName(storeId);
  chip.hidden = false;
  chip.innerHTML = '<span class="storechip-full">' + esc(name) + '</span><span class="storechip-short">' + esc(shortStoreLabel(storeId, name)) + '</span>' + SWAP_ICON + '<span class="storechip-action" aria-hidden="true">Switch</span>';
  chip.setAttribute('aria-label', 'Switch store, currently ' + name);
}
function syncChipRail(row) {
  const rail = row.closest('.chiprail');
  if (!rail) return;
  const max = row.scrollWidth - row.clientWidth;
  const left = row.scrollLeft > 2;
  const right = max > 2 && row.scrollLeft < max - 2;
  rail.classList.toggle('can-left', left);
  rail.classList.toggle('can-right', right);
  const prev = rail.querySelector('.chiprail-btn.prev');
  const next = rail.querySelector('.chiprail-btn.next');
  if (prev) prev.hidden = !left;
  if (next) next.hidden = !right;
}
function revealChip(row, chip) {
  const rowBox = row.getBoundingClientRect();
  const box = chip.getBoundingClientRect();
  const pad = 18;
  if (box.left < rowBox.left + pad) row.scrollBy({ left: box.left - rowBox.left - pad, behavior: 'smooth' });
  else if (box.right > rowBox.right - pad) row.scrollBy({ left: box.right - rowBox.right + pad, behavior: 'smooth' });
}
function focusActiveChip(row) {
  if (!row) return;
  const active = row.querySelector('.chip.active, .chip[aria-pressed="true"]');
  if (active) revealChip(row, active);
}
function mountChipRails(scope) {
  (scope || document).querySelectorAll('.chips').forEach((row) => {
    if (!row.closest('.chiprail')) {
      const rail = document.createElement('div');
      rail.className = 'chiprail';
      row.parentNode.insertBefore(rail, row);
      const prev = document.createElement('button');
      prev.type = 'button';
      prev.className = 'chiprail-btn prev';
      prev.setAttribute('aria-label', 'Scroll categories left');
      prev.innerHTML = CHEVRON_ICON;
      prev.hidden = true;
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'chiprail-btn next';
      next.setAttribute('aria-label', 'Scroll categories right');
      next.innerHTML = CHEVRON_ICON;
      next.hidden = true;
      rail.append(prev, row, next);
      const step = () => Math.max(140, Math.round(row.clientWidth * 0.72));
      prev.addEventListener('click', () => row.scrollBy({ left: -step(), behavior: 'smooth' }));
      next.addEventListener('click', () => row.scrollBy({ left: step(), behavior: 'smooth' }));
      row.addEventListener('scroll', () => syncChipRail(row), { passive: true });
      if (window.ResizeObserver) new ResizeObserver(() => syncChipRail(row)).observe(row);
    }
    syncChipRail(row);
  });
}
function toManilaInput(iso) { if (!iso) return ''; const w = new Date(new Date(iso).getTime() + 8 * 3600000); return w.toISOString().slice(0, 16); }
function fromManilaInput(v) { return v ? new Date(v + ':00+08:00').toISOString() : null; }
function whenManila(ts) { return new Date(ts).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }); }
function queuePaint() { clearTimeout(paintTimer); paintTimer = setTimeout(paint, 160); }

async function start() {
  const asked = (new URLSearchParams(location.search).get('store') || '').toUpperCase();
  if (asked) storeId = asked;
  data = await api('/api/catalog' + (storeId && !own ? '?store=' + encodeURIComponent(storeId) : ''));
  if (storeId && !(data.stores || []).some((s) => s.id === storeId)) storeId = '';
  if (storeId) localStorage.setItem('tapat-store', storeId);
  const nav = $('#nav');
  nav.className = 'btn btn-ghost';
  nav.textContent = own ? 'Storefront' : 'Owner';
  nav.href = own ? './' : 'owner.html';
  if (own) return owner();
  if (!storeId) return picker();
  storefront();
}

function picker() {
  picking = true;
  showStoreChip();
  const remembered = localStorage.getItem('tapat-store') || '';
  const cards = (data.stores || []).map((s) => '<button type="button" class="storecard' + (s.id === remembered ? ' remembered' : '') + '" data-act="pick" data-id="' + esc(s.id) + '"><span class="codepill">' + esc(s.id) + '</span><h2>' + esc(s.name) + '</h2><p>' + (s.shelfUnits || 0) + ' on the shelf</p>' + (s.id === remembered ? '<span class="badge low">Last shopped here</span>' : '') + '<span class="btn btn-primary">Shop this store</span></button>').join('');
  main.innerHTML = '<section class="hero"><div class="eyebrow">Chingu Honesty Store</div><h1>Which store are you at?</h1><p>Same prices at every store. Stock is counted on that shelf only.</p></section><div class="storegrid">' + (cards || '<div class="empty-state"><b>No stores yet</b><p>Ask the owner to add one.</p></div>') + '</div>';
}

function storefront() {
  picking = false;
  showStoreChip();
  const store = data.store || { id: storeId, name: storeName(storeId) };
  const hero = (data.ads || []).length ? '<section class="carousel" id="carousel" aria-roledescription="carousel" aria-label="Store ads"></section>' : '<section class="hero"><div class="eyebrow">' + esc(store.name) + '</div><h1>Grab, pay, enjoy.</h1><p>Pick a snack, pay the exact total, and go.</p></section>';
  main.innerHTML = hero + '<div class="stickytop"><div class="heading"><div><p class="eyebrow">' + esc(store.id) + ' · ' + esc(store.name) + '</p><h2>Shop the shelves</h2></div></div><div class="searchrow"><input class="search" type="search" placeholder="Search products" aria-label="Search products"></div><div class="chips" id="filters" role="toolbar" aria-label="Categories"></div></div><div class="layout"><section><div class="grid" id="grid"></div></section><aside class="panel cart" id="cart"></aside></div><button type="button" class="cartbar" id="float">View cart</button>';
  $('.search').value = search;
  $('.search').oninput = (e) => { search = e.target.value; renderFilters(); renderProducts(); };
  $('#float').onclick = () => $('#cart').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if ((data.ads || []).length) mountAds(data.ads);
  renderFilters();
  renderProducts();
  basket();
}

function mountAds(ads) {
  const root = $('#carousel');
  let i = 0, timerId, startX = 0, seen = new Set();
  const show = () => {
    const ad = ads[i];
    const desk = src(ad.desktop || ad.mobile);
    const mob = src(ad.mobile || ad.desktop);
    root.innerHTML = '<button type="button" class="slide" data-act="ad" data-id="' + esc(ad.id) + '" data-product="' + esc(ad.productId || '') + '" aria-label="Store promotion"><img class="ad-desktop" alt="" src="' + esc(desk) + '"><img class="ad-mobile" alt="" src="' + esc(mob) + '"></button>' +
      (ads.length > 1 ? '<button type="button" class="icon-btn arrow prev" data-act="ad-prev" aria-label="Previous ad">‹</button><button type="button" class="icon-btn arrow next" data-act="ad-next" aria-label="Next ad">›</button><div class="dots" role="tablist">' + ads.map((_, n) => '<button type="button" data-act="ad-go" data-i="' + n + '" class="' + (n === i ? 'active' : '') + '" aria-label="Ad ' + (n + 1) + '"></button>').join('') + '</div>' : '');
    if (!seen.has(ad.id)) { seen.add(ad.id); api('/api/ad-event', { id: ad.id, kind: 'view' }).catch(() => {}); }
  };
  const go = (n) => { i = (n + ads.length) % ads.length; show(); };
  const play = () => { stop(); if (ads.length > 1) timerId = setTimeout(() => { go(i + 1); play(); }, 5000); };
  const stop = () => clearTimeout(timerId);
  root.onmouseenter = stop;
  root.onmouseleave = play;
  root.ontouchstart = (e) => { stop(); startX = e.changedTouches[0].clientX; };
  root.ontouchend = (e) => { const dx = e.changedTouches[0].clientX - startX; if (dx > 40) go(i - 1); else if (dx < -40) go(i + 1); play(); };
  root._go = go;
  show();
  play();
}

function renderFilters() {
  const f = $('#filters');
  if (!f) return;
  const q = search.trim().toLowerCase();
  const pool = (data.products || []).filter((p) => (p.name + ' ' + p.cat).toLowerCase().includes(q));
  const cats = ['All items', ...new Set((data.products || []).map((p) => p.cat))];
  f.innerHTML = cats.map((c) => {
    const n = c === 'All items' ? pool.length : pool.filter((p) => p.cat === c).length;
    return '<button type="button" class="chip' + (c === cat ? ' active' : '') + '" data-act="cat" data-id="' + esc(c) + '" aria-pressed="' + (c === cat) + '">' + esc(c) + ' <span class="count">' + n + '</span></button>';
  }).join('');
  mountChipRails(f.parentElement);
  requestAnimationFrame(() => focusActiveChip(f));
}

function stockBadge(n) {
  if (!n) return '<span class="badge out">Sold out</span>';
  if (n <= L.LOW_STOCK) return '<span class="badge low">Few left · ' + n + '</span>';
  return '<span class="badge ok">In stock</span>';
}
function qtyControl(p) {
  const q = bag()[p.id] || 0;
  if (!p.stock) return '<button type="button" class="btn" disabled>Sold out</button>';
  if (!q) return '<button type="button" class="btn btn-primary add" data-act="add" data-id="' + esc(p.id) + '" aria-label="Add ' + esc(p.name) + '">Add</button>';
  return '<div class="stepper" aria-label="Quantity"><button type="button" class="icon-btn" data-act="add" data-id="' + esc(p.id) + '" data-n="-1" aria-label="Remove one ' + esc(p.name) + '">−</button><span>' + q + '</span><button type="button" class="icon-btn" data-act="add" data-id="' + esc(p.id) + '" data-n="1" aria-label="Add one ' + esc(p.name) + '"' + (q >= p.stock ? ' disabled' : '') + '>+</button></div>';
}
function requestCard() {
  return '<article class="card requestcard"><h3>Looking for something?</h3><p class="muted">Tell the owner and they will see it with the other requests.</p><button type="button" class="btn btn-secondary" data-act="request">Request an item</button></article>';
}

function renderProducts() {
  const grid = $('#grid');
  if (!grid) return;
  const q = search.trim().toLowerCase();
  const list = (data.products || []).filter((p) => (cat === 'All items' || cat === p.cat) && (p.name + ' ' + p.cat).toLowerCase().includes(q));
  const cards = list.map((p) => {
    const pay = linePrice(p);
    const price = p.onSale ? '<span class="tag">Sale</span><span class="was">' + money(p.price) + '</span><strong>' + money(pay) + '</strong>' : '<strong>' + money(pay) + '</strong>';
    return '<article class="card" id="p-' + esc(p.id) + '"><img loading="lazy" src="' + esc(src(p.photo)) + '" alt="' + esc(p.name) + '"><div class="info"><small>' + esc(p.cat) + ' · ' + esc(p.unit) + '</small><h3>' + esc(p.name) + '</h3>' + stockBadge(p.stock) + '<div class="row"><div class="price">' + price + '</div>' + qtyControl(p) + '</div></div></article>';
  }).join('');
  const empty = '<div class="panel empty-state"><b>Nothing matches “' + esc(search.trim()) + '”</b><p class="muted">Try another word, or ask the owner to stock it.</p><button type="button" class="btn btn-secondary" data-act="request">Request an item</button></div>';
  grid.innerHTML = (cards || empty) + (cards ? requestCard() : '');
}

function basket() {
  const l = lines(), q = bag(), count = l.reduce((s, p) => s + q[p.id], 0);
  const cart = $('#cart');
  if (!cart) return;
  cart.innerHTML = '<div class="row"><h2>Your cart</h2><span class="count">' + count + (count === 1 ? ' item' : ' items') + '</span></div>' + (l.length ? l.map((p) => '<div class="line"><strong>' + esc(p.name) + '</strong><div class="row"><div class="stepper"><button type="button" class="icon-btn" data-act="add" data-id="' + esc(p.id) + '" data-n="-1" aria-label="Remove one">−</button><span>' + q[p.id] + '</span><button type="button" class="icon-btn" data-act="add" data-id="' + esc(p.id) + '" data-n="1" aria-label="Add one"' + (q[p.id] >= p.stock ? ' disabled' : '') + '>+</button></div><b>' + money(linePrice(p) * q[p.id]) + '</b></div></div>').join('') : '<div class="empty"><b>Your cart is empty</b><p class="muted">Add something from the shelves. You can switch stores without losing this cart.</p></div>') + '<div class="row total"><b>Total</b><b>' + money(total()) + '</b></div><button type="button" class="btn btn-primary full" data-act="checkout"' + (l.length ? '' : ' disabled') + '>Checkout</button>';
  const float = $('#float');
  if (float) { float.innerHTML = '<span>' + count + (count === 1 ? ' item' : ' items') + '</span><span>View cart</span><strong>' + money(total()) + '</strong>'; float.hidden = !count; }
}

function checkout() {
  proof = '';
  let id = sessionStorage.getItem('tapat-attempt');
  if (!id || sessionStorage.getItem('tapat-attempt-store') !== storeId) {
    id = crypto.randomUUID();
    sessionStorage.setItem('tapat-attempt', id);
    sessionStorage.setItem('tapat-attempt-store', storeId);
  }
  modal('Checkout', '<p>Order total <b>' + money(total()) + '</b> · ' + esc(storeName(storeId)) + '</p><ol class="steps"><li><b>1</b><span>Scan the QR with GCash or Maya.</span></li><li><b>2</b><span>Pay the exact total. No change is given.</span></li><li><b>3</b><span>Upload the screenshot, then tap Place order.</span></li></ol><label>Payment method<select id="mode"><option value="qr">QR payment</option><option value="cash">Cash in the box</option><option value="split">Split · cash + QR</option></select></label><div id="pay"></div><label>Email receipt <span class="hint">Optional. We only email the receipt, unless you opt in below.</span><input type="email" id="buyer" autocomplete="email" placeholder="you@email.com"></label><label class="checkline"><input type="checkbox" id="promo"> Email me promos, new products, and sales</label><button type="button" class="btn btn-primary full" id="submit">Place order</button>', true);
  $('#mode').onchange = payment;
  $('#submit').onclick = submit;
  payment();
}

function payment() {
  const m = $('#mode').value;
  proof = '';
  $('#pay').innerHTML = (m === 'cash' ? '<p class="notice">Put the exact cash in the store cash box. No change is given.</p>' : '') + (m === 'split' ? '<label>Cash already in the box (₱)<input id="cash" type="number" min=".01" step=".01"></label>' : '') + (m !== 'cash' ? '<p id="due" class="notice"></p><label>Pay with<select id="bank">' + Object.keys(data.banks).map((b) => '<option>' + esc(b) + '</option>').join('') + '</select></label><div id="bankqr"></div><label class="dropzone">Tap to upload the payment screenshot<span class="hint">JPG or PNG, up to 5 MB</span><input type="file" id="receipt" accept="image/jpeg,image/png"><div id="previewbox"></div></label>' : '');
  if (m !== 'cash') {
    const bank = $('#bank');
    const show = () => {
      const url = data.banks[bank.value];
      $('#bankqr').innerHTML = url ? '<img class="qr" src="' + esc(src(url)) + '" alt="' + esc(bank.value) + ' payment QR"><button type="button" class="btn btn-secondary" id="dlqr">Download QR</button>' : '<p class="notice">This QR has not been set up yet. Choose another method or pay cash.</p>';
      if (url) $('#dlqr').onclick = () => downloadFile(url, 'payment-qr');
      $('#submit').disabled = !url;
    };
    bank.onchange = () => { const file = $('#receipt'); if (file) file.value = ''; proof = ''; const box = $('#previewbox'); if (box) box.innerHTML = ''; show(); };
    $('#receipt').onchange = () => {
      proof = '';
      const file = $('#receipt').files[0];
      const box = $('#previewbox');
      if (!file) { box.innerHTML = ''; return; }
      box.innerHTML = '<img alt="Payment screenshot preview" src="' + URL.createObjectURL(file) + '">';
    };
    show();
    const due = () => { $('#due').textContent = 'QR amount · ' + money(Math.max(0, total() - Math.round(Number($('#cash')?.value || 0) * 100))); };
    if ($('#cash')) $('#cash').oninput = due;
    due();
  } else $('#submit').disabled = false;
}

async function upload(file, path) { if (!file || file.size > 5000000) throw Error('Choose a JPG or PNG up to 5 MB'); return (await api(path, file)).file; }

async function submit() {
  const btn = $('#submit');
  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.setAttribute('aria-busy', 'true');
  try {
    const mode = $('#mode').value;
    const cash = mode === 'cash' ? total() : Math.round(Number($('#cash')?.value || 0) * 100);
    const email = $('#buyer').value.trim();
    const promo = $('#promo').checked;
    if (mode === 'split' && !(cash > 0 && cash < total())) throw Error('Cash must be between zero and the order total');
    if (promo && !email) throw Error('Enter an email to get store updates');
    if (mode !== 'cash' && !proof) proof = await upload($('#receipt').files[0], '/api/proof');
    const bought = lines().map((p) => ({ name: p.name, qty: bag()[p.id], price: linePrice(p) }));
    const amount = total();
    const r = await api('/api/order', { id: sessionStorage.getItem('tapat-attempt'), store: storeId, items: lines().map((p) => ({ id: p.id, price: linePrice(p), qty: bag()[p.id] })), cash, mode, bank: $('#bank')?.value, proof, email, promo });
    carts[storeId] = {};
    persistCart();
    sessionStorage.removeItem('tapat-attempt');
    basket();
    if ($('#grid')) renderProducts();
    const note = r.emailSent ? '<p class="notice">Receipt emailed.</p>' : r.emailNote ? '<p class="notice">' + esc(r.emailNote === 'email not configured' ? 'Email is not configured, so the receipt was not emailed.' : r.emailNote) + '</p>' : '';
    modal('Thank you!', '<p>Order <b>' + esc(r.num || '') + '</b> is saved for the owner to check.</p>' + note + '<canvas id="receipt" class="receipt" aria-label="Receipt preview"></canvas><button type="button" class="btn btn-primary full" id="getreceipt">Download receipt</button><button type="button" class="btn btn-secondary full" data-act="reload">Back to the shelves</button>', true);
    const model = L.receiptModel({ num: r.num, storeName: r.store || storeName(storeId), ts: new Date().toISOString(), total: r.total || amount, items: bought });
    const blob = await drawReceipt(model);
    $('#getreceipt').onclick = () => save(blob, (r.num || 'receipt') + '.png');
  } catch (e) { fail(e); if (btn && btn.isConnected) { btn.disabled = false; btn.classList.remove('is-loading'); btn.removeAttribute('aria-busy'); } }
}

function loadImage(url) { return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = url; }); }

async function drawReceipt(model) {
  const canvas = $('#receipt') || document.createElement('canvas');
  const height = 250 + model.items.length * 34;
  canvas.width = 720;
  canvas.height = height;
  const g = canvas.getContext('2d');
  g.fillStyle = '#FFF8EF';
  g.fillRect(0, 0, 720, height);
  g.fillStyle = '#F47B3A';
  g.fillRect(0, 0, 720, 118);
  g.fillStyle = '#fff';
  g.font = '800 30px Nunito, sans-serif';
  g.fillText('Chingu Honesty Store', 36, 52);
  g.font = '700 18px Nunito, sans-serif';
  g.fillText(model.store, 36, 86);
  try { const logo = await loadImage('logo-mark.png'); g.drawImage(logo, 590, 16, 88, 88); } catch { /* logo is optional */ }
  g.fillStyle = '#1E1E1E';
  g.font = '800 22px Nunito, sans-serif';
  g.fillText(model.num || 'Receipt', 36, 160);
  g.font = '600 16px Nunito, sans-serif';
  g.fillStyle = '#7A5A3C';
  g.fillText(whenManila(model.when), 36, 186);
  let y = 230;
  g.font = '700 18px Nunito, sans-serif';
  model.items.forEach((item) => {
    g.fillStyle = '#2B2420';
    g.fillText(item.qty + ' × ' + item.name, 36, y);
    g.fillText(money(item.line), 520, y);
    y += 34;
  });
  g.fillStyle = '#C44E12';
  g.font = '800 26px Nunito, sans-serif';
  g.fillText('Total  ' + money(model.total), 36, y + 20);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  return blob;
}

function requestForm() {
  modal('Request an item', '<label>Item name<span class="hint">What should be on the shelf?</span><input id="rname" maxlength="80" required></label><label>Note<span class="hint">Size, flavor, or anything that helps. Optional.</span><textarea id="rnote" maxlength="400" rows="3"></textarea></label><button type="button" class="btn btn-primary full" id="sendreq">Send request</button>');
  $('#sendreq').onclick = async () => {
    const button = $('#sendreq');
    button.disabled = true;
    try {
      if (!$('#rname').value.trim()) throw Error('Enter the item name.');
      await api('/api/request', { store: storeId, name: $('#rname').value, note: $('#rnote').value, company: '' });
      dlg.close();
      msg('Request sent. The owner can see it.');
    } catch (e) { fail(e); button.disabled = false; }
  };
}

async function signIn(create) {
  const email = $('#email').value.trim(), password = $('#pw').value;
  try {
    if (!email || password.length < 6) throw Error('Enter your email and a password of at least 6 characters');
    if (create) {
      const { data: d, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: (C.SITE_URL || location.href).replace(/[?#].*$/, '').replace(/(owner(\.html)?|index\.html)$/, '') + 'owner.html' } });
      if (error) throw error;
      if (!d.session) { msg('Check your email to confirm your account, then sign in here.'); return; }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
    await start();
  } catch (e) { fail(e); }
}
async function signOut() { if (sb) await sb.auth.signOut(); session = null; location.reload(); }

async function owner() {
  if (!demo && !sb) { main.textContent = 'Owner sign-in could not load. Check your connection and reload.'; return; }
  if (!data.admin) {
    await token();
    const who = session ? '<p class="who">Signed in as ' + esc(session.user.email) + ' · <a href="#" id="out">Sign out</a></p>' : '';
    main.innerHTML = '<div class="panel"><h2>Owner access</h2>' + (!session ? '<p>Sign in with the store owner’s account' + (data.claimed ? '' : ', or create one to set up this store') + '.</p><label>Email<input type="email" id="email" autocomplete="username"></label><label>Password<span class="hint">At least 6 characters.</span><input type="password" id="pw" autocomplete="current-password"></label><div class="authrow"><button type="button" class="btn btn-primary" id="signin">Sign in</button>' + (data.claimed ? '' : '<button type="button" class="btn btn-secondary" id="signup">Create account</button>') + '</div>' : data.claimed ? '<p>This account is not the store owner.</p><button type="button" class="btn btn-secondary" id="outbtn">Sign out</button>' : '<p>Enter the one-time setup key to link this store to your account.</p><label>Setup key<input type="password" id="key"></label><button type="button" class="btn btn-primary" id="claim">Link owner account</button>') + who + '<p class="error" id="err" role="alert"></p></div>';
    if ($('#signin')) $('#signin').onclick = () => signIn(false);
    if ($('#signup')) $('#signup').onclick = () => signIn(true);
    if ($('#out')) $('#out').onclick = (e) => { e.preventDefault(); signOut(); };
    if ($('#outbtn')) $('#outbtn').onclick = signOut;
    if ($('#claim')) $('#claim').onclick = async () => { try { await api('/api/claim', { key: $('#key').value }); await start(); } catch (e) { fail(e); } };
    return;
  }
  adminData = await api('/api/admin/data');
  shell();
}

const BOTTOM = ['Dashboard', 'Sales', 'Inventory', 'Ads'];
const MORE = ['Requests', 'Expenses', 'Email', 'Payment QRs', 'Store QR'];
function goTab(name) { tab = name; saveUi({ tab }); const sheet = $('#moresheet'); if (sheet) sheet.hidden = true; paint(); }
function shell() {
  const stores = ownerStores();
  main.innerHTML = '<div class="owner-layout"><aside class="sidenav"><p class="eyebrow">Owner</p><nav id="tabs" class="sidelist" aria-label="Sections"></nav></aside><div class="owner-content"><div class="ownerbar"><div class="heading"><h1 id="pagetitle">Store dashboard</h1><button type="button" class="btn btn-ghost" id="out">Sign out</button></div><div class="tools"><label class="field">Store<select id="storefilter" aria-label="Store filter"><option value="">All stores</option>' + stores.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>').join('') + '</select></label><button type="button" class="btn btn-secondary" data-act="add-store">Add store</button></div></div><div class="dashboard" id="area"></div></div></div><nav class="bottomnav" aria-label="Sections">' + BOTTOM.map((t) => '<button type="button" data-act="nav" data-id="' + t + '">' + (t === 'Inventory' ? 'Stock' : t) + '</button>').join('') + '<button type="button" data-act="more" aria-expanded="false" aria-controls="moresheet">More</button></nav><div id="moresheet" class="more-sheet" hidden>' + MORE.map((t) => '<button type="button" class="navitem" data-act="nav" data-id="' + t + '">' + esc(t) + '</button>').join('') + '</div>';
  $('#out').onclick = signOut;
  $('#storefilter').value = ui.store || '';
  $('#storefilter').onchange = (e) => { saveUi({ store: e.target.value }); paint(); };
  const tabs = $('#tabs');
  TABS.forEach((t) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.className = 'navitem' + (t === tab ? ' active' : ''); b.dataset.act = 'nav'; b.dataset.id = t; b.setAttribute('aria-current', t === tab ? 'page' : 'false'); tabs.append(b); });
  paint();
}

function dashRange(now) {
  if (ui.preset === 'custom' && ui.from && ui.to) return L.customRange(ui.from, ui.to);
  return L.rangeForPreset(ui.preset || 'today', now || new Date());
}
function logicOrders() {
  return (adminData.orders || []).map((o) => ({ ...o, items: typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []) }));
}
function dashModel() {
  const now = new Date();
  const range = dashRange(now);
  return L.dashboard({
    now, start: range.start, end: range.end, storeId: ui.store || '',
    orders: logicOrders(), products: adminData.products, stocks: adminData.stocks,
    expenses: adminData.expenses, ads: adminData.ads, stores: ownerStores(),
  });
}

function barChart(rows, key, moneyValues) {
  const max = Math.max(1, ...rows.map((r) => r[key] || 0));
  return '<div class="bars">' + rows.map((r) => '<div class="bar" title="' + esc(r.label) + '"><i style="height:' + Math.round(((r[key] || 0) / max) * 100) + '%"></i><span>' + esc(r.label) + '</span></div>').join('') + '</div>' + (moneyValues ? '' : '');
}
function deltaText(d) { if (d == null) return '<small>new</small>'; const pct = Math.round(d * 100); return '<small class="' + (pct >= 0 ? 'up' : 'down') + '">' + (pct >= 0 ? '+' : '') + pct + '%</small>'; }
function kpi(label, value, delta, to) { return '<button type="button" class="kpi" data-act="jump" data-to="' + to + '"><small>' + esc(label) + '</small><strong>' + value + '</strong>' + deltaText(delta) + '</button>'; }

function paintDashboard() {
  const model = dashModel();
  const preset = ui.preset || 'today';
  const c = model.current;
  const hours = model.hours.map((h) => ({ ...h, label: h.hour % 3 === 0 ? h.label : '' }));
  const mix = [{ label: 'Sales', sales: c.sales }, { label: 'Cost', sales: c.cost }, { label: 'Profit', sales: Math.max(0, c.profit) }];
  const list = (title, id, rows, empty) => '<section class="panel" id="' + id + '"><h2>' + title + '</h2>' + (rows || '<div class="empty-state"><b>' + empty + '</b></div>') + '</section>';
  const top = model.top.map((r, i) => '<div class="line"><b>' + (i + 1) + '. ' + esc(r.name) + '</b><span>' + r.qty + ' · ' + money(r.sales) + '</span></div>').join('');
  const profitRows = model.byProduct.slice(0, 8).map((r) => '<div class="line"><b>' + esc(r.name) + '</b><span>' + money(r.profit) + '</span></div>').join('');
  const slow = model.slow.slice(0, 12).map((r) => '<div class="line"><div class="row"><div><b>' + esc(r.name) + '</b><br><small>' + (r.band === '2-4w' ? 'Quiet 2–4 weeks' : 'No sales in 4+ weeks') + (r.idleDays == null ? '' : ' · ' + r.idleDays + ' days') + '</small></div><button type="button" class="btn btn-secondary" data-act="edit" data-id="' + esc(r.productId) + '">Put on sale</button></div></div>').join('');
  const restock = model.restock.slice(0, 12).map((r) => '<div class="line"><div class="row"><div><b>' + esc(r.name) + '</b><br><small>' + esc(r.storeId) + ' · shelf ' + r.shelf + ' · warehouse ' + r.warehouse + ' · move ' + r.move + (r.receive ? ', receive ' + r.receive : '') + '</small></div><button type="button" class="btn btn-primary" data-act="restock" data-id="' + esc(r.productId) + '" data-store="' + esc(r.storeId) + '" data-qty="' + r.move + '">Restock</button></div></div>').join('');
  const salesPerf = model.salePerf.map((r) => '<div class="line"><b>' + esc(r.name) + '</b><span>' + r.qty + ' sold · ' + money(r.sales) + '</span></div>').join('');
  const adPerf = model.adPerf.map((r) => '<div class="line"><b>' + esc(r.productId || 'Ad') + '</b><span>' + r.views + ' views · ' + r.clicks + ' clicks · ' + Math.round(r.ctr * 100) + '%</span></div>').join('');
  const stores = model.stores.map((s) => '<div class="line"><b>' + esc(s.name) + '</b><span>' + money(s.sales) + ' · profit ' + money(s.profit) + ' · ' + s.orders + ' orders</span></div>').join('');
  return '<div class="tools"><div class="seg" role="group" aria-label="Date range">' + [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Dates']].map(([p, label]) => '<button type="button" class="segbtn' + (preset === p ? ' active' : '') + '" data-act="preset" data-id="' + p + '" aria-pressed="' + (preset === p) + '">' + label + '</button>').join('') + '</div>' + (preset === 'custom' ? '<label class="field">From<input type="date" id="from" value="' + esc(ui.from || '') + '"></label><label class="field">To<input type="date" id="to" value="' + esc(ui.to || '') + '"></label>' : '') + '<button type="button" class="btn btn-secondary" data-act="pdf">Download PDF</button></div>' +
    '<div class="kpis">' + kpi(({ today: 'Today', week: 'This week', month: 'This month' }[preset] || 'Selected') + ' sales', money(c.sales), model.deltas.sales, 'sec-hours') + kpi('Profit', money(c.profit), model.deltas.profit, 'sec-mix') + kpi('Orders', String(c.orders), model.deltas.orders, 'sec-aov') + kpi('Unverified', String(c.pendingN), null, 'sec-paid') + kpi('Low stock', String(model.lowStock), null, 'sec-restock') + '</div>' +
    '<p class="muted">Compared with the previous period. Average order ' + money(c.aov) + '. Net profit ' + money(model.net) + ' after ' + money(model.expenses) + ' expenses.' + (model.missingCost ? ' ' + model.missingCost + ' products have no cost, so profit is high until a cost is entered.' : '') + '</p>' +
    '<div class="chartgrid"><section class="panel" id="sec-hours"><h2>Peak hours</h2>' + barChart(hours, 'sales') + '</section><section class="panel" id="sec-days"><h2>Best days</h2>' + barChart(model.days.map((d) => ({ ...d, label: d.label.slice(0, 3) })), 'sales') + '</section><section class="panel" id="sec-mix"><h2>Sales, cost, profit</h2>' + barChart(mix, 'sales') + '<p class="muted">Sales ' + money(c.sales) + ' · cost ' + money(c.cost) + ' · profit ' + money(c.profit) + '</p></section><section class="panel" id="sec-stores"><h2>Stores</h2>' + barChart(model.stores.map((s) => ({ label: s.id, sales: s.sales })), 'sales') + '</section></div>' +
    '<section class="panel" id="sec-paid"><h2>Paid vs unverified</h2><p>Verified ' + money(c.verified) + ' (' + c.verifiedN + ') · Unverified ' + money(c.pending) + ' (' + c.pendingN + ') · Flagged ' + money(c.flagged) + '</p></section>' +
    '<div class="chartgrid">' + list('Top 10', 'sec-top', top, 'No sales in this range.') + list('Profit by product', 'sec-profit', profitRows, 'No sales in this range.') + '</div>' +
    '<div class="chartgrid">' + list('Restock', 'sec-restock', restock, 'Shelves look fine.') + list('Slow movers', 'sec-slow', slow, 'Nothing has been quiet for two weeks.') + '</div>' +
    '<div class="chartgrid">' + list('Sale performance', 'sec-sale', salesPerf, 'Nothing is on sale.') + list('Ad performance', 'sec-ads', adPerf, 'No ads yet.') + '</div>' +
    list('Total per store', 'sec-aov', stores, 'No stores.') ;
}

function paintSales() {
  const q = (ui.salesQ || '').toLowerCase();
  const status = ui.salesStatus || 'All';
  let base = logicOrders().filter((o) => !ui.store || o.storeId === ui.store);
  if (q) base = base.filter((o) => (o.num + ' ' + (o.items || []).map((i) => i.name).join(' ')).toLowerCase().includes(q));
  const counts = { All: base.length, Pending: base.filter((o) => o.status === 'Pending').length, Verified: base.filter((o) => o.status === 'Verified').length, Flagged: base.filter((o) => o.status === 'Flagged').length };
  let rows = status === 'All' ? base : base.filter((o) => o.status === status);
  rows = rows.slice().sort((a, b) => ui.salesSort === 'total' ? b.total - a.total : new Date(b.ts) - new Date(a.ts));
  const dirty = !!(ui.salesQ || (status !== 'All') || ui.salesSort === 'total');
  return '<div class="tools"><input data-filter="salesQ" value="' + esc(ui.salesQ || '') + '" placeholder="Search order or item" aria-label="Search orders"><div class="chips" role="toolbar" aria-label="Order status">' + ['All', 'Pending', 'Verified', 'Flagged'].map((s) => '<button type="button" class="chip' + (s === status ? ' active' : '') + '" data-act="sales-status" data-id="' + s + '" aria-pressed="' + (s === status) + '">' + s + ' <span class="count">' + counts[s] + '</span></button>').join('') + '</div><div class="seg" role="group" aria-label="Sort orders"><button type="button" class="segbtn' + (ui.salesSort !== 'total' ? ' active' : '') + '" data-act="sales-sort" data-id="new">Newest</button><button type="button" class="segbtn' + (ui.salesSort === 'total' ? ' active' : '') + '" data-act="sales-sort" data-id="total">Highest total</button></div>' + (dirty ? '<button type="button" class="btn btn-ghost" data-act="clear-sales">Clear filters</button>' : '') + '</div><section class="panel">' + (rows.map((o) => '<div class="line"><div class="row"><b>' + esc(o.num) + ' · ' + money(o.total) + '</b><span class="count">' + esc(o.status) + '</span></div><small>' + esc(whenManila(o.ts)) + ' · ' + esc(storeName(o.storeId)) + ' · cost ' + money(o.cost || 0) + ' · profit ' + money((o.total || 0) - (o.cost || 0)) + '</small><p>' + (o.items || []).map((i) => i.qty + ' × ' + esc(i.name)).join(', ') + '</p><p>Cash ' + money(o.cash) + (o.bank ? ' · ' + esc(o.bank) + ' ' + money(o.total - o.cash) : '') + (o.email ? ' · ' + esc(o.email) : '') + '</p><div class="row-actions">' + (o.proof ? '<button type="button" class="btn btn-secondary" data-act="proof" data-id="' + esc(o.proof) + '">View receipt</button>' : '') + '<button type="button" class="btn btn-secondary" data-act="review" data-id="' + esc(o.id) + '" data-status="Verified">Verify</button><button type="button" class="btn btn-danger" data-act="review" data-id="' + esc(o.id) + '" data-status="Flagged">Flag</button></div></div>').join('') || '<div class="empty-state"><b>No orders match</b><p class="muted">Clear the filters or wait for the next checkout.</p></div>') + '</section>';
}

function filteredProducts() {
  const q = (ui.invQ || '').toLowerCase();
  const mode = ui.invStock || 'all';
  const catFilter = ui.invCat || 'All';
  let rows = (adminData.products || []).filter((p) => (catFilter === 'All' || p.cat === catFilter) && (p.name + ' ' + p.cat).toLowerCase().includes(q));
  rows = rows.filter((p) => L.lowOrOut(L.sumStock(adminData.stocks, p.id, ui.store || '').shelf, L.sumStock(adminData.stocks, p.id, ui.store || '').warehouse, mode === 'all' ? 'all' : mode));
  const dir = ui.invSort || 'name';
  const sign = ui.invSortDir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const as = L.sumStock(adminData.stocks, a.id, ui.store || ''), bs = L.sumStock(adminData.stocks, b.id, ui.store || '');
    let cmp = a.name.localeCompare(b.name);
    if (dir === 'price') cmp = a.price - b.price;
    else if (dir === 'cost') cmp = (a.cost || 0) - (b.cost || 0);
    else if (dir === 'margin') cmp = L.marginRatio(a.price, a.cost || 0) - L.marginRatio(b.price, b.cost || 0);
    else if (dir === 'shelf') cmp = as.shelf - bs.shelf;
    else if (dir === 'total') cmp = as.total - bs.total;
    return cmp * (dir === 'name' && !ui.invSortDir ? 1 : sign);
  });
  return rows;
}
function sortHead(label, field) {
  const active = (ui.invSort || 'name') === field;
  const aria = !active ? 'none' : (ui.invSortDir === 'asc' ? 'ascending' : 'descending');
  return '<th><button type="button" class="sort" data-act="sort" data-id="' + field + '" aria-sort="' + aria + '">' + label + '</button></th>';
}

function stockCells(p) {
  if (ui.store) {
    const st = L.sumStock(adminData.stocks, p.id, ui.store);
    return '<td>' + st.shelf + '</td><td>' + st.warehouse + '</td><td>' + st.total + '</td>';
  }
  return '<td>' + ownerStores().map((s) => { const st = L.sumStock(adminData.stocks, p.id, s.id); return esc(s.id) + ' ' + st.shelf + '/' + st.warehouse; }).join(' · ') + '</td>';
}

function invCounts() {
  const q = (ui.invQ || '').toLowerCase();
  const catFilter = ui.invCat || 'All';
  const pool = (adminData.products || []).filter((p) => (catFilter === 'All' || p.cat === catFilter) && (p.name + ' ' + p.cat).toLowerCase().includes(q));
  const count = (mode) => pool.filter((p) => { const st = L.sumStock(adminData.stocks, p.id, ui.store || ''); return mode === 'all' || L.lowOrOut(st.shelf, st.warehouse, mode); }).length;
  return { all: count('all'), low: count('low'), out: count('out'), 'low-shelf': count('low-shelf'), 'out-shelf': count('out-shelf') };
}
function paintInventory() {
  const rows = filteredProducts();
  const cats = ['All', ...new Set((adminData.products || []).map((p) => p.cat))];
  const view = ui.invView || (window.innerWidth < 720 ? 'cards' : 'table');
  const counts = invCounts();
  const stock = ui.invStock || 'all';
  const dirty = !!(ui.invQ || (ui.invCat && ui.invCat !== 'All') || stock !== 'all' || (ui.invSort && ui.invSort !== 'name'));
  const head = ui.store ? sortHead('Shelf', 'shelf') + '<th>Warehouse</th>' + sortHead('Total', 'total') : '<th>Shelf / warehouse</th>';
  const actions = (p) => '<div class="row-actions"><button type="button" class="btn btn-secondary" data-act="restock" data-id="' + esc(p.id) + '">Restock</button><button type="button" class="btn btn-secondary" data-act="receive" data-id="' + esc(p.id) + '">Receive</button><button type="button" class="btn btn-ghost" data-act="edit" data-id="' + esc(p.id) + '">Edit</button></div>';
  const body = view === 'table' ? '<div class="tablewrap"><table class="data"><thead><tr><th><input type="checkbox" data-act="select-all" aria-label="Select all shown products"' + (rows.length && rows.every((p) => selected.has(p.id)) ? ' checked' : '') + '></th>' + sortHead('Product', 'name') + sortHead('Price', 'price') + sortHead('Cost', 'cost') + sortHead('Margin', 'margin') + head + '<th>Sale</th><th>Actions</th></tr></thead><tbody>' + rows.map((p) => {
    const margin = p.price ? Math.round(L.marginRatio(p.price, p.cost || 0) * 100) + '%' : '—';
    const on = L.onSale(p);
    return '<tr><td><input type="checkbox" data-act="select" data-id="' + esc(p.id) + '" aria-label="Select ' + esc(p.name) + '"' + (selected.has(p.id) ? ' checked' : '') + '></td><td><div class="productrow"><img class="thumb" src="' + esc(src(p.photo)) + '" alt=""><div><b>' + esc(p.name) + '</b><br><small>' + esc(p.cat) + (p.active ? '' : ' · Hidden') + '</small></div></div></td><td><button type="button" class="linkish" data-act="inline" data-id="' + esc(p.id) + '" data-field="price" aria-label="Edit price for ' + esc(p.name) + '">' + money(p.price) + '</button></td><td><button type="button" class="linkish" data-act="inline" data-id="' + esc(p.id) + '" data-field="cost" aria-label="Edit cost for ' + esc(p.name) + '">' + (p.cost == null ? 'Add cost' : money(p.cost)) + '</button></td><td>' + margin + '</td>' + stockCells(p) + '<td>' + (on ? '<span class="tag">Sale</span> ' + money(L.effectivePrice(p)) : '—') + '</td><td>' + actions(p) + '</td></tr>';
  }).join('') + '</tbody></table></div>' : '<div class="invcards">' + rows.map((p) => {
    const st = L.sumStock(adminData.stocks, p.id, ui.store || '');
    return '<article class="panel productrow"><input type="checkbox" data-act="select" data-id="' + esc(p.id) + '" aria-label="Select ' + esc(p.name) + '"' + (selected.has(p.id) ? ' checked' : '') + '><img class="thumb" src="' + esc(src(p.photo)) + '" alt=""><div><b>' + esc(p.name) + '</b><br><small>' + money(p.price) + ' · cost ' + (p.cost == null ? 'none' : money(p.cost)) + ' · shelf ' + st.shelf + ' · warehouse ' + st.warehouse + '</small>' + actions(p) + '</div></article>';
  }).join('') + '</div>';
  const bulk = selected.size ? '<div class="bulkbar" role="region" aria-label="Bulk actions"><b>' + selected.size + ' selected</b><button type="button" class="btn btn-secondary" data-act="bulk-sale">Percent off</button><button type="button" class="btn btn-secondary" data-act="bulk-clear">Clear sale</button><button type="button" class="btn btn-secondary" data-act="bulk-show">Show</button><button type="button" class="btn btn-danger" data-act="bulk-hide">Hide</button><button type="button" class="btn btn-ghost" data-act="clear-select">Clear selection</button></div>' : '';
  const chips = [['all', 'All', counts.all], ['low', 'Low', counts.low], ['out', 'Out', counts.out], ['low-shelf', 'Low shelf', counts['low-shelf']], ['out-shelf', 'Shelf empty', counts['out-shelf']]].map(([v, l, n]) => '<button type="button" class="chip' + (stock === v ? ' active' : '') + '" data-act="inv-stock" data-id="' + v + '" aria-pressed="' + (stock === v) + '">' + l + ' <span class="count">' + n + '</span></button>').join('');
  return '<section class="panel"><div class="tools"><input data-filter="invQ" value="' + esc(ui.invQ || '') + '" placeholder="Search products" aria-label="Search products"><label class="field">Category<select id="invcat">' + cats.map((c) => '<option' + (c === (ui.invCat || 'All') ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select></label><div class="chips" role="toolbar" aria-label="Stock filters">' + chips + '</div><div class="seg" role="group" aria-label="Inventory view"><button type="button" class="segbtn' + (view === 'table' ? ' active' : '') + '" data-act="view" data-id="table" aria-pressed="' + (view === 'table') + '">Table</button><button type="button" class="segbtn' + (view === 'cards' ? ' active' : '') + '" data-act="view" data-id="cards" aria-pressed="' + (view === 'cards') + '">Cards</button></div>' + (dirty ? '<button type="button" class="btn btn-ghost" data-act="clear-inv">Clear filters</button>' : '') + '<button type="button" class="btn btn-secondary" data-act="csv">Export CSV</button><button type="button" class="btn btn-primary" data-act="edit">Add product</button></div>' + (rows.length ? '' : '<div class="empty-state"><b>No products match</b><p class="muted">Clear the filters or add a product.</p></div>') + bulk + body + '</section>';
}

function paintRequests() {
  const q = (ui.reqQ || '').toLowerCase();
  const status = ui.reqStatus || 'Open';
  let rows = (adminData.requests || []).filter((r) => (!ui.store || r.storeId === ui.store) && (status === 'All' || r.status === status) && (r.name + ' ' + r.note).toLowerCase().includes(q));
  const groups = {};
  rows.forEach((r) => { const k = r.name.toLowerCase(); if (!groups[k]) groups[k] = { name: r.name, rows: [] }; groups[k].rows.push(r); });
  const list = Object.values(groups).sort((a, b) => b.rows.length - a.rows.length);
  return '<div class="tools"><input data-filter="reqQ" value="' + esc(ui.reqQ || '') + '" placeholder="Search requests" aria-label="Search requests"><div class="chips">' + ['Open', 'Done', 'All'].map((s) => '<button type="button" class="chip' + (s === status ? ' active' : '') + '" data-act="req-status" data-id="' + s + '" aria-pressed="' + (s === status) + '">' + s + '</button>').join('') + '</div></div><section class="panel">' + (list.map((g) => '<div class="line"><div class="row"><b>' + esc(g.name) + '</b><span class="count">' + g.rows.length + '</span></div>' + g.rows.map((r) => '<p><small>' + esc(storeName(r.storeId)) + ' · ' + esc(whenManila(r.ts)) + '</small><br>' + esc(r.note || 'No note') + '</p><button type="button" class="btn btn-secondary" data-act="req" data-id="' + esc(r.id) + '" data-status="' + (r.status === 'Open' ? 'Done' : 'Open') + '">' + (r.status === 'Open' ? 'Mark done' : 'Reopen') + '</button>').join('') + '</div>').join('') || '<div class="empty-state"><b>No requests</b><p class="muted">Customers can ask for an item from the storefront.</p></div>') + '</section>';
}

function paintAds() {
  const ads = (adminData.ads || []).slice().sort((a, b) => a.seq - b.seq);
  return '<section class="panel"><div class="row"><h2>Ads</h2><button type="button" class="btn btn-primary" data-act="ad-edit">Add ad</button></div><p class="muted">Each ad needs a desktop and a mobile image. Drag a row to reorder, or use Up and Down.</p>' + (ads.map((ad, i) => '<div class="line adrow" draggable="true" data-drag="' + esc(ad.id) + '"><img class="thumb" src="' + esc(src(ad.mobile || ad.desktop)) + '" alt=""><div><b>' + esc(ad.productId ? ((adminData.products || []).find((p) => p.id === ad.productId)?.name || 'Linked product') : 'Announcement') + '</b><br><small>' + (ad.active ? 'On' : 'Off') + ' · ' + (ad.stores.length ? ad.stores.join(', ') : 'All stores') + ' · ' + ad.views + ' views · ' + ad.clicks + ' clicks</small></div><div class="row-actions"><button type="button" class="btn btn-secondary" data-act="ad-move" data-id="' + esc(ad.id) + '" data-n="-1"' + (i ? '' : ' disabled') + '>Up</button><button type="button" class="btn btn-secondary" data-act="ad-move" data-id="' + esc(ad.id) + '" data-n="1"' + (i < ads.length - 1 ? '' : ' disabled') + '>Down</button><button type="button" class="btn btn-ghost" data-act="ad-edit" data-id="' + esc(ad.id) + '">Edit</button></div></div>').join('') || '<div class="empty-state"><b>No ads yet</b><p class="muted">The storefront keeps the welcome banner until you add one.</p><button type="button" class="btn btn-primary" data-act="ad-edit">Add ad</button></div>') + '</section>';
}

function paintExpenses() {
  let rows = (adminData.expenses || []).filter((e) => !ui.store || !e.storeId || e.storeId === ui.store);
  const q = (ui.expQ || '').toLowerCase();
  if (q) rows = rows.filter((e) => (e.note + ' ' + e.category).toLowerCase().includes(q));
  rows = rows.slice().sort((a, b) => ui.expSort === 'amount' ? b.amount - a.amount : new Date(b.ts) - new Date(a.ts));
  const sum = rows.reduce((s, e) => s + e.amount, 0);
  return '<section class="panel"><h2>Add expense</h2><p class="hint">Expenses reduce net profit for the dates they fall on.</p><div class="tools"><label class="field">Amount (₱)<input id="expamount" type="number" min="0" step="0.01" aria-label="Amount"></label><label class="field">Note<input id="expnote" placeholder="What was it?" aria-label="Note"></label><label class="field">Category<input id="expcat" value="General" aria-label="Category"></label><label class="field">Date<input id="expdate" type="date" aria-label="Date"></label><label class="field">Store<select id="expstore"><option value="">All stores</option>' + ownerStores().map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>').join('') + '</select></label><button type="button" class="btn btn-primary" data-act="expense-add">Add expense</button></div></section><div class="tools"><input data-filter="expQ" value="' + esc(ui.expQ || '') + '" placeholder="Search expenses" aria-label="Search expenses"><div class="seg" role="group" aria-label="Sort expenses"><button type="button" class="segbtn' + (ui.expSort !== 'amount' ? ' active' : '') + '" data-act="exp-sort" data-id="new">Newest</button><button type="button" class="segbtn' + (ui.expSort === 'amount' ? ' active' : '') + '" data-act="exp-sort" data-id="amount">Highest</button></div><b>' + money(sum) + '</b></div><section class="panel">' + (rows.map((e) => '<div class="line"><div class="row"><b>' + money(e.amount) + ' · ' + esc(e.category) + '</b><button type="button" class="btn btn-danger" data-act="expense-del" data-id="' + esc(e.id) + '">Delete</button></div><small>' + esc(whenManila(e.ts)) + ' · ' + esc(e.storeId ? storeName(e.storeId) : 'All stores') + '</small><p>' + esc(e.note) + '</p></div>').join('') || '<div class="empty-state"><b>No expenses in this view</b><p class="muted">Add one above when you spend on the store.</p></div>') + '</section>';
}

function paintEmail() {
  const q = (ui.mailQ || '').toLowerCase();
  let people = (adminData.subscribers || []).filter((s) => !ui.store || s.storeId === ui.store);
  if (q) people = people.filter((s) => s.email.includes(q));
  const products = (adminData.products || []).filter((p) => p.active);
  const ready = !!adminData.email;
  return (ready ? '' : '<p class="banner-warn"><b>Email is not configured.</b> Set the RESEND_API_KEY and EMAIL_FROM function secrets, then reload. You can still write and preview.</p>') +
    '<section class="panel"><h2>Compose</h2><label class="field">Template<select id="template"><option value="announce">Announcement</option><option value="product">New product</option><option value="sale">Sale</option></select></label><label>Subject<input id="subject" maxlength="140" value="Hello from Chingu"></label><label>Message<textarea id="message" rows="4">A quick note from the honesty store.</textarea></label><label>Banner image<span class="hint">Optional. JPG or PNG.</span><input type="file" id="banner" accept="image/jpeg,image/png"></label><fieldset><legend>Products</legend><div class="picklist">' + products.slice(0, 40).map((p) => '<label class="checkline"><input type="checkbox" value="' + esc(p.id) + '"> ' + esc(p.name) + '</label>').join('') + '</div></fieldset><div class="tools"><button type="button" class="btn btn-secondary" data-act="preview">Preview</button><label class="field">Test address<input id="testto" type="email" placeholder="you@email.com" aria-label="Test address"></label><button type="button" class="btn btn-secondary" data-act="send-test"' + (ready ? '' : ' disabled') + '>Send test</button><button type="button" class="btn btn-primary" data-act="send"' + (ready ? '' : ' disabled') + '>Send' + (ui.store ? ' to ' + esc(ui.store) : ' to all stores') + '</button></div></section>' +
    '<div class="tools"><input data-filter="mailQ" value="' + esc(ui.mailQ || '') + '" placeholder="Search subscribers" aria-label="Search subscribers"></div><section class="panel"><h2>Subscribers</h2>' + (people.map((s) => '<div class="line"><b>' + esc(s.email) + '</b><br><small>' + esc(storeName(s.storeId)) + ' · ' + (s.active ? 'Subscribed' : 'Unsubscribed') + '</small></div>').join('') || '<p class="muted">Nobody has opted in yet.</p>') + '</section>' +
    '<section class="panel"><h2>Recent sends</h2>' + ((adminData.sends || []).map((s) => '<div class="line"><b>' + esc(s.subject) + '</b><br><small>' + esc(whenManila(s.ts)) + ' · ' + s.recipients + (s.test ? ' test' : ' sent') + '</small></div>').join('') || '<p class="muted">No emails sent yet.</p>') + '</section>';
}

function paintBanks() {
  return '<section class="panel"><h2>Payment QRs</h2><p>Upload the receiving account’s QR image for each payment method. These are shared by every store.</p>' + Object.entries(data.banks).map(([b, f], i) => '<div class="line bankrow">' + (f ? '<img class="thumb" src="' + esc(src(f)) + '">' : '') + '<strong>' + esc(b) + '</strong><small>' + (f ? 'Configured' : 'Awaiting QR') + '</small><input class="push" type="file" aria-label="Upload ' + esc(b) + ' QR" accept="image/png,image/jpeg" data-bank="' + esc(b) + '" id="bank' + i + '"></div>').join('') + '</section>';
}

function paintQr() {
  const base = C.SITE_URL || location.href.replace(/[?#].*$/, '').replace(/(owner(\.html)?|index\.html)$/, '');
  let svg = '';
  if (window.qrcode) { const q = qrcode(0, 'M'); q.addData(base); q.make(); svg = q.createSvgTag({ cellSize: 8, margin: 4, scalable: true }); }
  return '<section class="panel"><h2>Store entrance QR</h2><p>One code for every store. The customer picks the location after scanning. It opens <b>' + esc(base) + '</b></p><div class="qr" style="width:220px">' + svg + '</div><button type="button" class="btn btn-secondary" id="dlstore">Download store QR</button></section>';
}

function paint() {
  const area = $('#area');
  if (!area) return;
  const focus = document.activeElement && area.contains(document.activeElement) ? document.activeElement.dataset.filter : '';
  const views = { Dashboard: paintDashboard, Sales: paintSales, Inventory: paintInventory, Requests: paintRequests, Ads: paintAds, Expenses: paintExpenses, Email: paintEmail, 'Payment QRs': paintBanks, 'Store QR': paintQr };
  area.innerHTML = (views[tab] || paintDashboard)();
  if (focus) { const el = area.querySelector('[data-filter="' + focus + '"]'); if (el) { el.focus(); const n = el.value.length; if (el.setSelectionRange) el.setSelectionRange(n, n); } }
  area.querySelectorAll('[data-filter]').forEach((el) => el.oninput = () => { saveUi({ [el.dataset.filter]: el.value }); queuePaint(); });
  const bindSelect = (id, key) => { const el = $('#' + id); if (el) el.onchange = () => { saveUi({ [key]: el.value }); paint(); }; };
  bindSelect('salesstatus', 'salesStatus');
  bindSelect('salessort', 'salesSort');
  bindSelect('invcat', 'invCat');
  bindSelect('invstock', 'invStock');
  bindSelect('invsort', 'invSort');
  bindSelect('reqstatus', 'reqStatus');
  bindSelect('expsort', 'expSort');
  const from = $('#from'), to = $('#to');
  if (from) from.onchange = () => { saveUi({ from: from.value }); if (ui.to) paint(); };
  if (to) to.onchange = () => { saveUi({ to: to.value }); if (ui.from) paint(); };
  area.querySelectorAll('[data-bank]').forEach((input) => input.onchange = async () => { try { const file = await upload(input.files[0], '/api/admin/image'); await api('/api/admin/bank', { bank: input.dataset.bank, file }); data = await api('/api/catalog'); paint(); msg('QR saved'); } catch (e) { fail(e); } });
  area.querySelectorAll('[data-drag]').forEach((row) => {
    row.addEventListener('dragstart', () => { row.dataset.dragging = '1'; });
    row.addEventListener('dragover', (e) => e.preventDefault());
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      const fromId = [...area.querySelectorAll('[data-dragging="1"]')][0]?.dataset.drag;
      const ids = (adminData.ads || []).slice().sort((a, b) => a.seq - b.seq).map((a) => a.id);
      const a = ids.indexOf(fromId), b = ids.indexOf(row.dataset.drag);
      if (a < 0 || b < 0 || a === b) return;
      ids.splice(b, 0, ids.splice(a, 1)[0]);
      try { await api('/api/admin/ad-order', { ids }); await reload(); } catch (err) { fail(err); }
    });
  });
  const banner = $('#banner');
  if (banner) banner.onchange = () => { delete banner.dataset.file; };
  const template = $('#template');
  if (template) template.onchange = () => {
    const copy = { product: ['New on the shelf', 'We just added something you might like.'], sale: ['On sale now', 'A few favorites are on sale at the honesty store.'], announce: ['Hello from Chingu', 'A quick note from the honesty store.'] }[template.value];
    $('#subject').value = copy[0];
    $('#message').value = copy[1];
  };
  const dl = $('#dlstore');
  if (dl && window.qrcode) {
    const svg = area.querySelector('.qr').innerHTML;
    dl.onclick = () => save(new Blob([svg], { type: 'image/svg+xml' }), 'chingu-store-qr.svg');
  }
  document.querySelectorAll('[data-act="nav"]').forEach((el) => { el.classList.toggle('active', el.dataset.id === tab); el.setAttribute('aria-current', el.dataset.id === tab ? 'page' : 'false'); });
  const title = $('#pagetitle');
  if (title) title.textContent = tab === 'Inventory' ? 'Inventory' : tab;
  mountChipRails(area);
  requestAnimationFrame(() => area.querySelectorAll('.chips').forEach(focusActiveChip));
}

async function reload() {
  adminData = await api('/api/admin/data');
  const sel = $('#storefilter');
  if (sel) {
    const current = ui.store || '';
    sel.innerHTML = '<option value="">All stores</option>' + ownerStores().map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>').join('');
    sel.value = ownerStores().some((s) => s.id === current) ? current : '';
    if (sel.value !== current) saveUi({ store: sel.value });
  }
  if ($('#area')) paint(); else shell();
}

function productById(id) { return (adminData.products || []).find((p) => p.id === id); }

function editProduct(id) {
  const p = productById(id) || { id: crypto.randomUUID(), active: 1, price: 0, cost: null, photo: '', name: '', cat: '', unit: '' };
  const fresh = !productById(id);
  modal(fresh ? 'New product' : 'Edit product', '<form id="productform"><label>Product name<input required id="pname" maxlength="119" value="' + esc(p.name || '') + '"></label><label>Category<input required id="pcat" maxlength="119" value="' + esc(p.cat || '') + '"></label><label>Pack size<input required id="punit" maxlength="119" value="' + esc(p.unit || '') + '"></label><div class="calc"><label>Cost (₱)<input id="pcost" type="number" min="0" step="0.01" value="' + (p.cost == null ? '' : (p.cost / 100)) + '"></label><label>Markup %<input id="pmarkup" type="number" step="0.1" value="' + (p.cost ? L.markupFromPrice(p.cost, p.price).toFixed(1) : '') + '"></label><label>Price (₱)<input required id="pprice" type="number" min="0.01" step="0.01" value="' + ((p.price || '') && (p.price / 100)) + '"></label><p id="pprofit" class="notice"></p></div><label>Sale<select id="salemode"><option value="">No sale</option><option value="price">Sale price</option><option value="pct">Percent off</option></select></label><label id="salepricewrap">Sale price (₱)<input id="saleprice" type="number" min="0.01" step="0.01" value="' + (p.salePrice ? p.salePrice / 100 : '') + '"></label><label id="salepctwrap">Percent off<input id="salepct" type="number" min="1" max="90" step="1" value="' + (p.salePct || '') + '"></label><label>Starts (Manila time)<input id="salestart" type="datetime-local" value="' + esc(toManilaInput(p.saleStart)) + '"></label><label>Ends (Manila time)<input id="saleend" type="datetime-local" value="' + esc(toManilaInput(p.saleEnd)) + '"></label>' + ownerStores().map((s) => { const st = L.sumStock(adminData.stocks, p.id, s.id); return '<div class="stockedit"><b>' + esc(s.name) + '</b><label>Shelf<input data-shelf data-store="' + esc(s.id) + '" data-orig="' + st.shelf + '" type="number" min="0" step="1" value="' + st.shelf + '"></label><label>Warehouse<input data-wh data-store="' + esc(s.id) + '" data-orig="' + st.warehouse + '" type="number" min="0" step="1" value="' + st.warehouse + '"></label></div>'; }).join('') + '<label>Product photo<input type="file" id="pic" accept="image/jpeg,image/png"' + (p.photo ? '' : ' required') + '></label><label>Visibility<select id="vis"><option value="1">On shelf</option><option value="0">Hidden</option></select></label><button class="btn btn-primary full">Save product</button></form>', true);
  $('#vis').value = String(p.active ? 1 : 0);
  $('#salemode').value = p.salePrice ? 'price' : p.salePct ? 'pct' : '';
  const syncSale = () => { const m = $('#salemode').value; $('#salepricewrap').style.display = m === 'price' ? '' : 'none'; $('#salepctwrap').style.display = m === 'pct' ? '' : 'none'; };
  $('#salemode').onchange = syncSale; syncSale();
  const showProfit = () => {
    const c = Math.round(Number($('#pcost').value || 0) * 100);
    const price = Math.round(Number($('#pprice').value || 0) * 100);
    $('#pprofit').textContent = 'Profit ' + money(L.profitEach(price, c)) + ' per piece · margin ' + Math.round(L.marginRatio(price, c) * 100) + '%';
  };
  $('#pmarkup').oninput = () => { const c = Math.round(Number($('#pcost').value || 0) * 100); if (c > 0 && $('#pmarkup').value !== '') $('#pprice').value = (L.priceFromMarkup(c, Number($('#pmarkup').value)) / 100).toFixed(2); showProfit(); };
  $('#pcost').oninput = () => { if ($('#pmarkup').value !== '') $('#pmarkup').oninput(); else showProfit(); };
  $('#pprice').oninput = () => { const c = Math.round(Number($('#pcost').value || 0) * 100); const price = Math.round(Number($('#pprice').value || 0) * 100); if (c > 0) $('#pmarkup').value = L.markupFromPrice(c, price).toFixed(1); showProfit(); };
  showProfit();
  $('#productform').onsubmit = async (e) => {
    e.preventDefault();
    const button = e.target.querySelector('button');
    button.disabled = true;
    try {
      const mode = $('#salemode').value;
      const edits = [...dlg.querySelectorAll('[data-shelf]')].map((shelf) => {
        const store = shelf.dataset.store;
        const wh = dlg.querySelector('[data-wh][data-store="' + store + '"]');
        return { storeId: store, shelf: Number(shelf.value), warehouse: Number(wh.value), originalShelf: Number(shelf.dataset.orig), originalWarehouse: Number(wh.dataset.orig), changed: Number(shelf.value) !== Number(shelf.dataset.orig) || Number(wh.value) !== Number(wh.dataset.orig) };
      }).filter((row) => fresh || row.changed);
      const photo = $('#pic').files[0] ? await upload($('#pic').files[0], '/api/admin/image') : p.photo;
      await api('/api/admin/product', {
        id: p.id, name: $('#pname').value.trim(), cat: $('#pcat').value.trim(), unit: $('#punit').value.trim(),
        price: Math.round(Number($('#pprice').value) * 100),
        cost: $('#pcost').value === '' ? null : Math.round(Number($('#pcost').value) * 100),
        salePrice: mode === 'price' ? Math.round(Number($('#saleprice').value) * 100) : null,
        salePct: mode === 'pct' ? Math.round(Number($('#salepct').value)) : null,
        saleStart: fromManilaInput($('#salestart').value), saleEnd: fromManilaInput($('#saleend').value),
        photo, active: $('#vis').value === '1', stockEdits: edits,
      });
      dlg.close();
      await reload();
    } catch (err) { fail(err); } finally { button.disabled = false; }
  };
}

function stockDialog(id, op, suggested, storeId) {
  const p = productById(id);
  if (!p) return;
  const store = storeId || ui.store || ownerStores()[0]?.id;
  const st = L.sumStock(adminData.stocks, id, store);
  modal(op === 'restock' ? 'Restock the shelf' : 'Receive stock', '<p>' + esc(p.name) + ' · ' + esc(storeName(store)) + '</p><p class="muted">Shelf ' + st.shelf + ' · warehouse ' + st.warehouse + '</p><label>Quantity<input id="qty" type="number" min="1" step="1" value="' + (suggested || 1) + '"></label><button type="button" class="btn btn-primary full" id="dostock">' + (op === 'restock' ? 'Move to shelf' : 'Add to warehouse') + '</button>');
  $('#dostock').onclick = async () => { try { await api('/api/admin/stock', { productId: id, storeId: store, op, qty: Number($('#qty').value) }); dlg.close(); await reload(); } catch (e) { fail(e); } };
}

function inlineEdit(id, field) {
  const p = productById(id);
  if (!p) return;
  const label = field === 'cost' ? 'Cost (₱)' : 'Price (₱)';
  const current = field === 'cost' ? (p.cost == null ? '' : p.cost / 100) : p.price / 100;
  modal(label, '<label>' + label + '<input id="inline" type="number" min="0" step="0.01" value="' + current + '"></label><button type="button" class="btn btn-primary full" id="saveinline">Save</button>');
  $('#inline').focus();
  $('#saveinline').onclick = async () => {
    try {
      const cents = $('#inline').value === '' ? null : Math.round(Number($('#inline').value) * 100);
      const body = { id: p.id, name: p.name, cat: p.cat, unit: p.unit, price: p.price, photo: p.photo, active: !!p.active, salePrice: p.salePrice, salePct: p.salePct, saleStart: p.saleStart, saleEnd: p.saleEnd };
      if (field === 'price') body.price = cents;
      body.cost = field === 'cost' ? cents : p.cost;
      await api('/api/admin/product', body);
      dlg.close();
      await reload();
    } catch (e) { fail(e); }
  };
}

function emailPayload() {
  return {
    template: $('#template').value,
    subject: $('#subject').value,
    message: $('#message').value,
    productIds: [...dlg.querySelectorAll('.picklist input:checked'), ...main.querySelectorAll('.picklist input:checked')].map((el) => el.value),
    banner: $('#banner').dataset.file || '',
    storeId: ui.store || '',
  };
}

async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const id = b.dataset.id || '';
  try {
    if (act === 'close') { dlg.close(); return; }
    if (act === 'reload') { location.reload(); return; }
    if (act === 'pick') { await choose(id); return; }
    if (act === 'switch') { picker(); return; }
    if (act === 'cat') { cat = id; renderFilters(); renderProducts(); return; }
    if (act === 'nav') { goTab(id); return; }
    if (act === 'more') { const sheet = $('#moresheet'); if (!sheet) return; sheet.hidden = !sheet.hidden; b.setAttribute('aria-expanded', String(!sheet.hidden)); return; }
    if (act === 'add') { const n = Number(b.dataset.n || 1); const p = (data.products || []).find((x) => x.id === id); if (!p) return; const q = (bag()[id] || 0) + n; if (q > p.stock) return msg('Only ' + p.stock + ' left', 'error'); if (q <= 0) delete bag()[id]; else bag()[id] = q; persistCart(); sessionStorage.removeItem('tapat-attempt'); basket(); if ($('#grid')) renderProducts(); return; }
    if (act === 'checkout') { checkout(); return; }
    if (act === 'request') { requestForm(); return; }
    if (act === 'ad-prev' || act === 'ad-next' || act === 'ad-go') { e.preventDefault(); const root = $('#carousel'); const ads = data.ads || []; const cur = [...root.querySelectorAll('.dots button')].findIndex((d) => d.classList.contains('active')); const next = act === 'ad-go' ? Number(b.dataset.i) : (cur < 0 ? 0 : cur) + (act === 'ad-next' ? 1 : -1); if (root._go) root._go(next); return; }
    if (act === 'ad') { api('/api/ad-event', { id, kind: 'click' }).catch(() => {}); if (b.dataset.product) { const card = document.getElementById('p-' + b.dataset.product); if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } return; }
    if (act === 'jump') { if (b.dataset.to === 'sec-paid') { tab = 'Sales'; saveUi({ tab, salesStatus: 'Pending' }); shell(); return; } if (tab !== 'Dashboard') { tab = 'Dashboard'; saveUi({ tab }); paint(); } document.getElementById(b.dataset.to)?.scrollIntoView({ behavior: 'smooth' }); return; }
    if (act === 'preset') { saveUi({ preset: id }); paint(); return; }
    if (act === 'pdf') { const bytes = L.reportPdf(dashModel(), ui.store ? storeName(ui.store) : 'All stores'); save(new Blob([bytes], { type: 'application/pdf' }), 'chingu-sales.pdf'); return; }
    if (act === 'view') { saveUi({ invView: id }); paint(); return; }
    if (act === 'sort') { if ((ui.invSort || 'name') === id) saveUi({ invSortDir: ui.invSortDir === 'asc' ? 'desc' : 'asc' }); else saveUi({ invSort: id, invSortDir: id === 'name' ? 'asc' : 'desc' }); paint(); return; }
    if (act === 'inv-stock') { saveUi({ invStock: id }); paint(); return; }
    if (act === 'clear-inv') { saveUi({ invQ: '', invCat: 'All', invStock: 'all', invSort: 'name', invSortDir: 'asc' }); paint(); return; }
    if (act === 'sales-status') { saveUi({ salesStatus: id }); paint(); return; }
    if (act === 'sales-sort') { saveUi({ salesSort: id }); paint(); return; }
    if (act === 'clear-sales') { saveUi({ salesQ: '', salesStatus: 'All', salesSort: 'new' }); paint(); return; }
    if (act === 'req-status') { saveUi({ reqStatus: id }); paint(); return; }
    if (act === 'exp-sort') { saveUi({ expSort: id }); paint(); return; }
    if (act === 'clear-select') { selected.clear(); paint(); return; }
    if (act === 'select-all') { filteredProducts().forEach((p) => { if (b.checked) selected.add(p.id); else selected.delete(p.id); }); paint(); return; }
    if (act === 'csv') { save(new Blob([L.inventoryCsv(filteredProducts(), adminData.stocks, ownerStores())], { type: 'text/csv' }), 'chingu-inventory.csv'); msg('CSV downloaded'); return; }
    if (act === 'select') { if (b.checked) selected.add(id); else selected.delete(id); const bar = document.querySelector('.bulkbar'); if (bar) paint(); else if (selected.size) paint(); return; }
    if (act === 'edit') { editProduct(id); return; }
    if (act === 'inline') { inlineEdit(id, b.dataset.field); return; }
    if (act === 'restock') { stockDialog(id, 'restock', Number(b.dataset.qty || 1), b.dataset.store); return; }
    if (act === 'receive') { stockDialog(id, 'receive', 1); return; }
    if (act === 'proof') { const u = URL.createObjectURL(await blobOf(id)); modal('Payment receipt', '<img class="proofimg" src="' + u + '" alt="Payment receipt"><a class="btn" href="' + u + '" target="_blank" rel="noopener">Open full size ↗</a>'); return; }
    if (act === 'review') {
      const status = b.dataset.status;
      const run = async () => { await api('/api/admin/review', { id, status }); if (dlg.open) dlg.close(); await reload(); msg(status === 'Verified' ? 'Order verified' : 'Order flagged'); };
      if (status === 'Flagged') confirmBox('Flag this order?', 'Flagged orders stay in the list but drop out of sales and profit.', 'Flag order', run);
      else await run();
      return;
    }
    if (act === 'req') { await api('/api/admin/request-status', { id, status: b.dataset.status }); await reload(); return; }
    if (act === 'add-store') { modal('New store', '<label>Code<input id="scode" maxlength="6" placeholder="NEO"></label><label>Name<input id="sname" maxlength="80"></label><button type="button" class="btn btn-primary full" id="savestore">Add store</button>'); $('#savestore').onclick = async () => { try { await api('/api/admin/store', { code: $('#scode').value, name: $('#sname').value }); dlg.close(); await reload(); } catch (err) { fail(err); } }; return; }
    if (act === 'ad-edit') { editAd(id); return; }
    if (act === 'ad-move') { await moveAd(id, Number(b.dataset.n)); return; }
    if (act === 'expense-add') { const amount = Math.round(Number($('#expamount').value) * 100); await api('/api/admin/expense', { amount, note: $('#expnote').value, category: $('#expcat').value, storeId: $('#expstore').value, ts: $('#expdate').value ? fromManilaInput($('#expdate').value + 'T00:00') : new Date().toISOString() }); await reload(); msg('Expense added'); return; }
    if (act === 'expense-del') { confirmBox('Delete this expense?', 'Net profit will no longer subtract it.', 'Delete', async () => { await api('/api/admin/expense', { id, delete: true }); dlg.close(); await reload(); msg('Expense deleted'); }); return; }
    if (act === 'bulk-sale' || act === 'bulk-clear' || act === 'bulk-show' || act === 'bulk-hide') { await bulk(act); return; }
    if (act === 'preview' || act === 'send-test' || act === 'send') { await sendEmail(act); }
  } catch (err) { fail(err); }
}

async function choose(id) { storeId = id; localStorage.setItem('tapat-store', id); sessionStorage.removeItem('tapat-attempt'); data = await api('/api/catalog?store=' + encodeURIComponent(id)); storefront(); }

function editAd(id) {
  const ad = (adminData.ads || []).find((a) => a.id === id) || { id: '', active: 0, desktop: '', mobile: '', productId: '', stores: [], starts: '', ends: '' };
  modal(ad.id ? 'Edit ad' : 'New ad', '<form id="adform"><label>Desktop image<input type="file" id="desk" accept="image/jpeg,image/png"' + (ad.desktop ? '' : '') + '></label>' + (ad.desktop ? '<img class="thumb" src="' + esc(src(ad.desktop)) + '" alt="">' : '') + '<label>Mobile image<input type="file" id="mob" accept="image/jpeg,image/png"></label>' + (ad.mobile ? '<img class="thumb" src="' + esc(src(ad.mobile)) + '" alt="">' : '') + '<label>Link to product<select id="adproduct"><option value="">No product link</option>' + (adminData.products || []).map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>').join('') + '</select></label><fieldset><legend>Show at</legend>' + ownerStores().map((s) => '<label class="checkline"><input type="checkbox" value="' + esc(s.id) + '"' + (ad.stores.includes(s.id) ? ' checked' : '') + '> ' + esc(s.name) + '</label>').join('') + '<p class="muted">Leave all unchecked to show at every store.</p></fieldset><label>Starts (Manila time)<input id="adstart" type="datetime-local" value="' + esc(toManilaInput(ad.starts)) + '"></label><label>Ends (Manila time)<input id="adend" type="datetime-local" value="' + esc(toManilaInput(ad.ends)) + '"></label><label class="checkline"><input type="checkbox" id="adon"' + (ad.active ? ' checked' : '') + '> On</label><button class="btn btn-primary full">Save ad</button></form>', true);
  if (ad.productId) $('#adproduct').value = ad.productId;
  $('#adform').onsubmit = async (e) => {
    e.preventDefault();
    const button = e.target.querySelector('button');
    button.disabled = true;
    try {
      const desktop = $('#desk').files[0] ? await upload($('#desk').files[0], '/api/admin/image') : ad.desktop;
      const mobile = $('#mob').files[0] ? await upload($('#mob').files[0], '/api/admin/image') : ad.mobile;
      await api('/api/admin/ad', { id: ad.id || undefined, desktop, mobile, productId: $('#adproduct').value, stores: [...dlg.querySelectorAll('fieldset input:checked')].map((el) => el.value), starts: fromManilaInput($('#adstart').value), ends: fromManilaInput($('#adend').value), active: $('#adon').checked });
      dlg.close();
      await reload();
    } catch (err) { fail(err); } finally { button.disabled = false; }
  };
}

async function moveAd(id, dir) {
  const ids = (adminData.ads || []).slice().sort((a, b) => a.seq - b.seq).map((a) => a.id);
  const i = ids.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await api('/api/admin/ad-order', { ids });
  await reload();
}

async function bulk(act) {
  const ids = [...selected];
  if (!ids.length) return;
  if (act === 'bulk-sale') {
    modal('Percent off', '<label>Percent off<input id="bulkpct" type="number" min="1" max="90" value="10"></label><button type="button" class="btn btn-primary full" id="applybulk">Apply to ' + ids.length + '</button>');
    $('#applybulk').onclick = async () => { try { await api('/api/admin/bulk', { ids, salePct: Number($('#bulkpct').value), salePrice: null }); dlg.close(); selected.clear(); await reload(); } catch (e) { fail(e); } };
    return;
  }
  const patch = { ids };
  if (act === 'bulk-clear') patch.clearSale = true;
  if (act === 'bulk-show') patch.active = true;
  if (act === 'bulk-hide') patch.active = false;
  if (act === 'bulk-hide') {
    confirmBox('Hide ' + ids.length + ' products?', 'Hidden products leave the shelf until you show them again.', 'Hide', async () => { await api('/api/admin/bulk', patch); dlg.close(); selected.clear(); await reload(); msg('Products hidden'); });
    return;
  }
  await api('/api/admin/bulk', patch);
  selected.clear();
  await reload();
}

async function sendEmail(act) {
  const file = $('#banner').files && $('#banner').files[0];
  if (file && !$('#banner').dataset.file) $('#banner').dataset.file = await upload(file, '/api/admin/image');
  const body = emailPayload();
  if (act === 'preview') {
    const r = await api('/api/admin/email-preview', body);
    modal('Preview', '<iframe class="preview" id="preview" title="Email preview"></iframe>', true);
    $('#preview').srcdoc = r.html;
    return;
  }
  if (!adminData.email) throw Error('Email is not configured');
  if (act === 'send-test') body.test = true, body.testTo = $('#testto').value;
  const r = await api('/api/admin/email', body);
  msg(act === 'send-test' ? 'Test sent' : 'Sent to ' + r.sent);
  await reload();
}

document.addEventListener('click', onClick);
start().catch((e) => { main.textContent = e.message; const b = document.createElement('button'); b.textContent = 'Retry'; b.onclick = () => location.reload(); main.append(' ', b); });
