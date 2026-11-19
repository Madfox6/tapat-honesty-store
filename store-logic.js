// Shared calculations for the Chingu Honesty Store.
// Classic script on the site (window.StoreLogic) and a CommonJS module for tests.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StoreLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var LOW_STOCK = 5;
  var MANILA_MS = 8 * 60 * 60 * 1000;
  var DAY = 24 * 60 * 60 * 1000;
  var WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  function moneyDigits(cents) {
    var n = Number(cents) || 0;
    var sign = n < 0 ? '-' : '';
    var abs = Math.abs(n);
    var body = (abs / 100).toLocaleString('en-PH', { minimumFractionDigits: abs % 100 ? 2 : 0, maximumFractionDigits: 2 });
    return sign + body;
  }

  function money(cents) { return '₱' + moneyDigits(cents); }
  function php(cents) { return 'PHP ' + moneyDigits(cents); }

  function saleWindowOpen(product, at) {
    var t = at instanceof Date ? at : new Date(at);
    if (product.saleStart && t < new Date(product.saleStart)) return false;
    if (product.saleEnd && t > new Date(product.saleEnd)) return false;
    return true;
  }

function onSale(product, at) {
  return !!product && effectivePrice(product, at || new Date()) !== (product.price | 0);
}

function effectivePrice(product, at) {
  var list = product.price | 0;
  at = at || new Date();
  if (!saleWindowOpen(product, at)) return list;
  if (product.salePrice != null && product.salePrice !== '') {
    var sp = product.salePrice | 0;
    if (sp > 0 && sp < list) return sp;
  }
  if (product.salePct != null && product.salePct !== '') {
    var pct = product.salePct | 0;
    if (pct >= 1 && pct <= 90) return Math.max(1, Math.round(list * (100 - pct) / 100));
  }
  return list;
}

  function profitEach(price, cost) { return (price | 0) - (cost == null ? 0 : cost | 0); }

  function marginRatio(price, cost) {
    if (!price) return 0;
    return profitEach(price, cost) / price;
  }

  function priceFromMarkup(cost, markupPct) {
    return Math.max(0, Math.round((Number(cost) || 0) * (1 + Number(markupPct) / 100)));
  }

  function markupFromPrice(cost, price) {
    if (!cost) return 0;
    return ((price - cost) / cost) * 100;
  }

  function formatOrderNo(code, n) {
    var num = Math.max(0, n | 0);
    return String(code) + '-' + String(num).padStart(4, '0');
  }

  function manilaWall(date) { return new Date(date.getTime() + MANILA_MS); }

  function startOfManilaDay(date) {
    var w = manilaWall(date);
    return new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate()) - MANILA_MS);
  }

  function addDays(date, n) { return new Date(date.getTime() + n * DAY); }

  function startOfManilaWeek(date) {
    var start = startOfManilaDay(date);
    var dow = manilaWall(start).getUTCDay();
    var delta = dow === 0 ? 6 : dow - 1;
    return addDays(start, -delta);
  }

  function startOfManilaMonth(date) {
    var w = manilaWall(date);
    return new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), 1) - MANILA_MS);
  }

  function manilaHour(date) { return manilaWall(date).getUTCHours(); }

  function manilaWeekdayIndex(date) {
    var dow = manilaWall(date).getUTCDay();
    return dow === 0 ? 6 : dow - 1;
  }

  function rangeForPreset(preset, now) {
    now = now || new Date();
    if (preset === 'week') return { start: startOfManilaWeek(now), end: now, label: 'This week' };
    if (preset === 'month') return { start: startOfManilaMonth(now), end: now, label: 'This month' };
    return { start: startOfManilaDay(now), end: now, label: 'Today' };
  }

  function customRange(fromDay, toDay) {
    var start = startOfManilaDay(new Date(fromDay + 'T00:00:00+08:00'));
    var end = addDays(startOfManilaDay(new Date(toDay + 'T00:00:00+08:00')), 1);
    if (end <= start) end = addDays(start, 1);
    return { start: start, end: end, label: fromDay + ' – ' + toDay };
  }

  function previousRange(start, end) {
    var len = end.getTime() - start.getTime();
    if (len <= 0) len = DAY;
    return { start: new Date(start.getTime() - len), end: new Date(start.getTime()) };
  }

  function inRange(ts, start, end) {
    var t = new Date(ts).getTime();
    return t >= start.getTime() && t < end.getTime();
  }

  function loadAllCarts(raw) {
    var data = raw;
    if (typeof raw === 'string') {
      try { data = JSON.parse(raw || '{}'); } catch (e) { data = {}; }
    }
    if (!data || typeof data !== 'object') return { O20: {} };
    if (data.v === 2 && data.stores && typeof data.stores === 'object') {
      var stores = {};
      Object.keys(data.stores).forEach(function (code) {
        stores[code] = cleanQtyMap(data.stores[code]);
      });
      return stores;
    }
    return { O20: cleanQtyMap(data) };
  }

  function cleanQtyMap(map) {
    var out = {};
    if (!map || typeof map !== 'object') return out;
    Object.keys(map).forEach(function (k) {
      if (k === 'v' || k === 'stores') return;
      var q = map[k];
      if (typeof q === 'number' && q > 0 && q === Math.floor(q) && q < 1000000) out[k] = q;
    });
    return out;
  }

  function saveAllCarts(stores) {
    return JSON.stringify({ v: 2, stores: stores || {} });
  }

  function linesOf(order) {
    var items = order.items;
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch (e) { items = []; }
    }
    return Array.isArray(items) ? items : [];
  }

  function counted(order) { return order && order.status !== 'Flagged'; }

  function filterOrders(orders, storeId, start, end) {
    return (orders || []).filter(function (o) {
      if (storeId && o.storeId !== storeId) return false;
      if (start && end && !inRange(o.ts, start, end)) return false;
      return true;
    });
  }

  function summarize(orders) {
    var sales = 0, cost = 0, count = 0, verified = 0, verifiedN = 0, pending = 0, pendingN = 0, flagged = 0, flaggedN = 0;
    (orders || []).forEach(function (o) {
      if (o.status === 'Flagged') { flagged += o.total || 0; flaggedN++; return; }
      sales += o.total || 0;
      cost += o.cost || 0;
      count++;
      if (o.status === 'Verified') { verified += o.total || 0; verifiedN++; }
      else { pending += o.total || 0; pendingN++; }
    });
    return {
      sales: sales, cost: cost, profit: sales - cost, orders: count,
      aov: count ? Math.round(sales / count) : 0,
      verified: verified, verifiedN: verifiedN, pending: pending, pendingN: pendingN,
      flagged: flagged, flaggedN: flaggedN
    };
  }

  function delta(current, previous) {
    if (!previous) return current ? null : 0;
    return (current - previous) / previous;
  }

  function expenseTotal(expenses, storeId, start, end) {
    return (expenses || []).reduce(function (sum, e) {
      if (start && end && !inRange(e.ts, start, end)) return sum;
      if (storeId && e.storeId && e.storeId !== storeId) return sum;
      return sum + (e.amount || 0);
    }, 0);
  }

  function productKey(line) { return line.id || ('name:' + (line.name || '')); }

  function aggregateLines(orders) {
    var map = {};
    (orders || []).filter(counted).forEach(function (o) {
      linesOf(o).forEach(function (line) {
        var key = productKey(line);
        var row = map[key] || { key: key, id: line.id || '', name: line.name || 'Item', qty: 0, sales: 0, cost: 0 };
        var qty = line.qty || 0;
        row.qty += qty;
        row.sales += (line.price || 0) * qty;
        row.cost += (line.cost || 0) * qty;
        row.name = line.name || row.name;
        map[key] = row;
      });
    });
    return Object.keys(map).map(function (k) {
      var row = map[k];
      row.profit = row.sales - row.cost;
      return row;
    });
  }

  function lastSaleMap(orders, storeId) {
    var map = {};
    (orders || []).forEach(function (o) {
      if (!counted(o)) return;
      if (storeId && o.storeId !== storeId) return;
      var t = new Date(o.ts).getTime();
      linesOf(o).forEach(function (line) {
        var key = productKey(line);
        if (!map[key] || t > map[key]) map[key] = t;
      });
    });
    return map;
  }

  function soldSince(orders, storeId, productId, name, sinceMs) {
    var qty = 0;
    (orders || []).forEach(function (o) {
      if (!counted(o)) return;
      if (storeId && o.storeId !== storeId) return;
      if (new Date(o.ts).getTime() < sinceMs) return;
      linesOf(o).forEach(function (line) {
        if ((productId && line.id === productId) || (!line.id && line.name === name)) qty += line.qty || 0;
      });
    });
    return qty;
  }

  function suggestRestock(shelf, warehouse, sold14) {
    var target = Math.max(LOW_STOCK, sold14 | 0);
    var need = Math.max(0, target - (shelf | 0));
    var move = Math.min(need, Math.max(0, warehouse | 0));
    var receive = Math.max(0, need - Math.max(0, warehouse | 0));
    return { target: target, move: move, receive: receive, need: need };
  }

  function stockRowsFor(stocks, storeId) {
    return (stocks || []).filter(function (s) { return !storeId || s.storeId === storeId; });
  }

  function sumStock(stocks, productId, storeId) {
    var shelf = 0, warehouse = 0;
    stockRowsFor(stocks, storeId).forEach(function (s) {
      if (s.productId !== productId) return;
      shelf += s.shelf || 0;
      warehouse += s.warehouse || 0;
    });
    return { shelf: shelf, warehouse: warehouse, total: shelf + warehouse };
  }

  function restockAlerts(products, stocks, orders, now, storeId) {
    var since = now.getTime() - 14 * DAY;
    var alerts = [];
    (products || []).forEach(function (p) {
      if (!p.active) return;
      var groups = storeId ? [storeId] : uniqueStores(stocks, p.id);
      groups.forEach(function (code) {
        var st = sumStock(stocks, p.id, code);
        if (st.shelf > LOW_STOCK) return;
        var sold = soldSince(orders, code, p.id, p.name, since);
        if (!st.shelf && !st.warehouse && !sold) return;
        var sug = suggestRestock(st.shelf, st.warehouse, sold);
        alerts.push({
          productId: p.id, name: p.name, storeId: code, shelf: st.shelf, warehouse: st.warehouse,
          sold14: sold, move: sug.move, receive: sug.receive, target: sug.target
        });
      });
    });
    alerts.sort(function (a, b) { return a.shelf - b.shelf || b.sold14 - a.sold14 || a.name.localeCompare(b.name); });
    return alerts;
  }

  function uniqueStores(stocks, productId) {
    var seen = {};
    (stocks || []).forEach(function (s) { if (s.productId === productId) seen[s.storeId] = 1; });
    var list = Object.keys(seen);
    return list.length ? list : [];
  }

  function slowMovers(products, stocks, orders, now, storeId) {
    var last = lastSaleMap(orders, storeId);
    var rows = [];
    (products || []).forEach(function (p) {
      if (!p.active) return;
      var st = sumStock(stocks, p.id, storeId);
      if (st.total <= 0) return;
      var key = p.id;
      var nameKey = 'name:' + p.name;
      var ts = last[key] || last[nameKey] || 0;
      var idleDays = ts ? Math.floor((now.getTime() - ts) / DAY) : null;
      if (idleDays !== null && idleDays < 14) return;
      var band = idleDays == null || idleDays >= 28 ? '4w+' : '2-4w';
      rows.push({ productId: p.id, name: p.name, shelf: st.shelf, warehouse: st.warehouse, idleDays: idleDays, band: band, lastTs: ts || null });
    });
    rows.sort(function (a, b) {
      var ai = a.idleDays == null ? 9999 : a.idleDays;
      var bi = b.idleDays == null ? 9999 : b.idleDays;
      return bi - ai || a.name.localeCompare(b.name);
    });
    return rows;
  }

  function hoursSeries(orders) {
    var rows = [];
    for (var h = 0; h < 24; h++) rows.push({ hour: h, label: String(h).padStart(2, '0'), sales: 0, count: 0 });
    (orders || []).filter(counted).forEach(function (o) {
      var row = rows[manilaHour(new Date(o.ts))];
      row.sales += o.total || 0;
      row.count++;
    });
    return rows;
  }

  function daysSeries(orders) {
    var rows = WEEKDAYS.map(function (label) { return { label: label, sales: 0, count: 0 }; });
    (orders || []).filter(counted).forEach(function (o) {
      var row = rows[manilaWeekdayIndex(new Date(o.ts))];
      row.sales += o.total || 0;
      row.count++;
    });
    return rows;
  }

  function storeComparison(orders, stores) {
    return (stores || []).map(function (s) {
      var subset = (orders || []).filter(function (o) { return o.storeId === s.id && counted(o); });
      var sum = summarize(subset);
      return { id: s.id, name: s.name, sales: sum.sales, cost: sum.cost, profit: sum.profit, orders: sum.orders };
    });
  }

  function salePerformance(products, orders) {
    return (products || []).filter(function (p) { return onSale(p); }).map(function (p) {
      var qty = 0, sales = 0, list = 0;
      (orders || []).filter(counted).forEach(function (o) {
        linesOf(o).forEach(function (line) {
          if (line.id !== p.id && line.name !== p.name) return;
          qty += line.qty || 0;
          sales += (line.price || 0) * (line.qty || 0);
          list += (p.price || 0) * (line.qty || 0);
        });
      });
      return { id: p.id, name: p.name, qty: qty, sales: sales, discount: Math.max(0, list - sales), pay: effectivePrice(p) };
    }).sort(function (a, b) { return b.qty - a.qty || a.name.localeCompare(b.name); });
  }

  function adPerformance(ads, orders, start, end) {
    return (ads || []).map(function (ad) {
      var views = ad.views || 0, clicks = ad.clicks || 0;
      var qty = 0, sales = 0;
      if (ad.productId) {
        (orders || []).filter(counted).forEach(function (o) {
          if (ad.stores && ad.stores.length && ad.stores.indexOf(o.storeId) < 0) return;
          var t = new Date(o.ts);
          if (ad.starts && t < new Date(ad.starts)) return;
          if (ad.ends && t > new Date(ad.ends)) return;
          if (start && end && !inRange(o.ts, start, end)) return;
          linesOf(o).forEach(function (line) {
            if (line.id !== ad.productId) return;
            qty += line.qty || 0;
            sales += (line.price || 0) * (line.qty || 0);
          });
        });
      }
      return {
        id: ad.id, productId: ad.productId || '', views: views, clicks: clicks,
        ctr: views ? clicks / views : 0, qty: qty, sales: sales
      };
    });
  }

  function missingCostCount(products) {
    return (products || []).filter(function (p) { return p.active && (p.cost == null || p.cost === ''); }).length;
  }

  function dashboard(input) {
    var now = input.now || new Date();
    var range = input.start && input.end ? { start: input.start, end: input.end } : rangeForPreset(input.preset || 'today', now);
    var prev = previousRange(range.start, range.end);
    var currentOrders = filterOrders(input.orders, input.storeId, range.start, range.end);
    var previousOrders = filterOrders(input.orders, input.storeId, prev.start, prev.end);
    var current = summarize(currentOrders);
    var previous = summarize(previousOrders);
    var expenses = expenseTotal(input.expenses, input.storeId, range.start, range.end);
    var lines = aggregateLines(currentOrders);
    lines.sort(function (a, b) { return b.qty - a.qty || b.sales - a.sales; });
    var byProfit = lines.slice().sort(function (a, b) { return b.profit - a.profit || a.name.localeCompare(b.name); });
    return {
      range: range,
      previousRange: prev,
      current: current,
      previous: previous,
      deltas: {
        sales: delta(current.sales, previous.sales),
        profit: delta(current.profit, previous.profit),
        orders: delta(current.orders, previous.orders)
      },
      hours: hoursSeries(currentOrders),
      days: daysSeries(currentOrders),
      top: lines.slice(0, 10),
      byProduct: byProfit,
      slow: slowMovers(input.products, input.stocks, input.orders, now, input.storeId || ''),
      restock: restockAlerts(input.products, input.stocks, input.orders, now, input.storeId || ''),
      stores: storeComparison(currentOrders, input.stores),
      salePerf: salePerformance(input.products, currentOrders),
      adPerf: adPerformance(input.ads, input.orders, range.start, range.end),
      expenses: expenses,
      net: current.profit - expenses,
      missingCost: missingCostCount(input.products),
      lowStock: restockAlerts(input.products, input.stocks, input.orders, now, input.storeId || '').length
    };
  }

  function csvCell(value) {
    var s = value == null ? '' : String(value);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function inventoryCsv(products, stocks, stores) {
    var headers = ['Name', 'Category', 'Unit', 'Price', 'Cost', 'Margin %', 'Sale'];
    (stores || []).forEach(function (s) { headers.push(s.id + ' shelf', s.id + ' warehouse'); });
    var lines = [headers.join(',')];
    (products || []).forEach(function (p) {
      var margin = p.price ? Math.round(marginRatio(p.price, p.cost || 0) * 1000) / 10 : 0;
      var sale = onSale(p) ? (p.salePrice != null && p.salePrice !== '' ? (p.salePrice / 100) : (p.salePct + '%')) : '';
      var row = [p.name, p.cat, p.unit, (p.price || 0) / 100, p.cost == null ? '' : p.cost / 100, margin, sale];
      (stores || []).forEach(function (s) {
        var st = sumStock(stocks, p.id, s.id);
        row.push(st.shelf, st.warehouse);
      });
      lines.push(row.map(csvCell).join(','));
    });
    return lines.join('\n');
  }

  function pdfEscape(text) {
    return String(text).replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '?').replace(/[()\\]/g, function (c) { return '\\' + c; });
  }

function latin1Bytes(text) {
  var bytes = new Uint8Array(text.length);
  for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 255;
  return bytes;
}

function buildPdf(lines) {
  var commands = ['BT', '/F1 11 Tf', '50 800 Td', '14 TL'];
  (lines || []).forEach(function (line, i) {
    if (i) commands.push('T*');
    commands.push('(' + pdfEscape(line).slice(0, 110) + ') Tj');
  });
  commands.push('ET');
  var stream = commands.join('\n');
  var objects = [];
  objects.push('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n');
  objects.push('2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj\n');
  objects.push('3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n');
  objects.push('4 0 obj << /Length ' + stream.length + ' >> stream\n' + stream + '\nendstream\nendobj\n');
  objects.push('5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n');
  var parts = ['%PDF-1.4\n'];
  var offsets = [0];
  var size = parts[0].length;
  objects.forEach(function (obj) { offsets.push(size); parts.push(obj); size += obj.length; });
  var xref = size;
  var tail = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (var i = 1; i < offsets.length; i++) tail += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  tail += 'trailer << /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  parts.push(tail);
  return latin1Bytes(parts.join(''));
}

  function reportPdf(model, storeLabel) {
    var c = model.current;
    var lines = [
      'Chingu Honesty Store',
      'Sales report — ' + (storeLabel || 'All stores'),
      model.range.label || '',
      '',
      'Sales: ' + php(c.sales),
      'Cost: ' + php(c.cost),
      'Profit: ' + php(c.profit),
      'Expenses: ' + php(model.expenses),
      'Net profit: ' + php(model.net),
      'Orders: ' + c.orders + '    Average order: ' + php(c.aov),
      'Verified: ' + php(c.verified) + '    Unverified: ' + php(c.pending),
      ''
    ];
    lines.push('Sales by store');
    (model.stores || []).forEach(function (s) {
      lines.push(s.id + ' ' + s.name + ': ' + php(s.sales) + '  profit ' + php(s.profit) + '  orders ' + s.orders);
    });
    lines.push('', 'Top sellers');
    (model.top || []).forEach(function (row, i) {
      lines.push((i + 1) + '. ' + row.name + '  x' + row.qty + '  ' + php(row.sales));
    });
    if (model.missingCost) lines.push('', 'Products missing a cost: ' + model.missingCost);
    return buildPdf(lines);
  }

  function receiptModel(order) {
    return {
      num: order.num || '',
      store: order.storeName || order.storeId || '',
      when: order.ts,
      items: linesOf(order).map(function (line) {
        return { name: line.name, qty: line.qty, price: line.price, line: (line.price || 0) * (line.qty || 0) };
      }),
      total: order.total || 0
    };
  }

  function escHtml(s) {
    return String(s ?? '').replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function emailHtml(opts) {
    var o = opts || {};
    var parts = [];
    parts.push('<div style="font-family:Nunito,Arial,sans-serif;background:#FFF8EF;padding:24px;color:#2B2420">');
    parts.push('<div style="max-width:560px;margin:auto;background:#fff;border:2px solid #F0D9BE;border-radius:18px;padding:24px">');
    parts.push('<p style="letter-spacing:2px;text-transform:uppercase;color:#C44E12;font-size:12px;font-weight:800">Chingu Honesty Store</p>');
    parts.push('<h1 style="font-size:28px;margin:8px 0">' + escHtml(o.subject || 'Hello') + '</h1>');
    parts.push('<p style="font-size:16px;line-height:1.5">' + escHtml(o.message || '').replace(/\n/g, '<br>') + '</p>');
    if (o.banner) parts.push('<p><img alt="" src="' + escHtml(o.banner) + '" style="max-width:100%;border-radius:12px"></p>');
    (o.products || []).forEach(function (p) {
      parts.push('<p style="margin:12px 0;padding:12px;background:#FFF8EF;border-radius:12px"><b>' + escHtml(p.name) + '</b><br>' + escHtml(p.priceLabel || '') + '</p>');
    });
    parts.push('<p style="font-size:12px;color:#7A5A3C">You are receiving this because you shopped at Chingu Honesty Store');
    if (o.storeName) parts.push(' (' + escHtml(o.storeName) + ')');
    parts.push('.</p>');
    if (o.unsubUrl) parts.push('<p style="font-size:12px"><a href="' + escHtml(o.unsubUrl) + '">Unsubscribe</a></p>');
    parts.push('</div></div>');
    return parts.join('');
  }

  function lowOrOut(shelf, warehouse, mode) {
    if (mode === 'low-shelf') return shelf > 0 && shelf <= LOW_STOCK;
    if (mode === 'out-shelf') return shelf === 0;
    if (mode === 'low-wh') return warehouse > 0 && warehouse <= LOW_STOCK;
    if (mode === 'out-wh') return warehouse === 0;
    if (mode === 'low') return (shelf > 0 && shelf <= LOW_STOCK) || (warehouse > 0 && warehouse <= LOW_STOCK);
    if (mode === 'out') return shelf === 0 || warehouse === 0;
    return true;
  }

  return {
    LOW_STOCK: LOW_STOCK,
    money: money,
    php: php,
    onSale: onSale,
    effectivePrice: effectivePrice,
    profitEach: profitEach,
    marginRatio: marginRatio,
    priceFromMarkup: priceFromMarkup,
    markupFromPrice: markupFromPrice,
    formatOrderNo: formatOrderNo,
    startOfManilaDay: startOfManilaDay,
    startOfManilaWeek: startOfManilaWeek,
    startOfManilaMonth: startOfManilaMonth,
    manilaHour: manilaHour,
    rangeForPreset: rangeForPreset,
    customRange: customRange,
    previousRange: previousRange,
    loadAllCarts: loadAllCarts,
    saveAllCarts: saveAllCarts,
    summarize: summarize,
    delta: delta,
    suggestRestock: suggestRestock,
    dashboard: dashboard,
    inventoryCsv: inventoryCsv,
    reportPdf: reportPdf,
    receiptModel: receiptModel,
    emailHtml: emailHtml,
    escHtml: escHtml,
    sumStock: sumStock,
    lowOrOut: lowOrOut,
    linesOf: linesOf
  };
});
