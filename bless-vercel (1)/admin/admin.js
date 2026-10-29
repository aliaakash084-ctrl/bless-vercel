/* BLESS admin panel. Plain JS, no build step. Every value that comes from the database is escaped before it is shown. */
(function () {
'use strict';
var root = document.getElementById('root'), TOKEN = '', cur = 'dashboard', unseen = 0, timer = null;
try { TOKEN = sessionStorage.getItem('bless_admin') || ''; } catch (e) { /* private mode */ }

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function $(sel, el) { return (el || document).querySelector(sel); }
function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
function toast(msg) { var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600); }
function money(n) { return 'Rs. ' + Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 }); }
function when(s) { return new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function imgUrl(u) { u = String(u || ''); return /^assets\//.test(u) ? '/' + u : u; }

function api(method, path, body, form) {
  var opt = { method: method, headers: { Authorization: 'Bearer ' + TOKEN } };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  if (form) { opt.body = form; }
  return fetch('/admin/api' + path, opt).then(function (r) {
    return r.text().then(function (t) {
      var d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { d = null; }
      if (r.status === 401 && path !== '/login') { logout(true); throw new Error('Please sign in again.'); }
      if (!r.ok) { throw new Error((d && d.error) || 'Something went wrong (' + r.status + ').'); }
      return d;
    });
  });
}
function fail(e) { toast(e && e.message ? e.message : 'Something went wrong.'); }

/* ---------------- login / shell ---------------- */
function logout(expired) { TOKEN = ''; try { sessionStorage.removeItem('bless_admin'); } catch (e) { /* ignore */ } clearInterval(timer); loginView(expired ? 'Your session ended. Please sign in again.' : ''); }
function loginView(msg) {
  root.innerHTML = '<form class="login"><h1>BLESS Admin</h1><p class="muted">Sign in to manage your shop.</p><label>Password</label><input type="password" name="p" autocomplete="current-password" autofocus><p class="err" id="le">' + esc(msg || '') + '</p><button class="btn">Sign in</button></form>';
  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    api('POST', '/login', { password: $('input').value }).then(function (d) { TOKEN = d.token; try { sessionStorage.setItem('bless_admin', TOKEN); } catch (x) { /* ignore */ } shell(); }).catch(function (x) { $('#le').textContent = x.message; });
  });
}
var NAV = [['dashboard', 'Dashboard'], ['orders', 'Orders'], ['products', 'Products'], ['categories', 'Categories'], ['coupons', 'Coupons'], ['banners', 'Banners'], ['settings', 'Settings']];
function shell() {
  root.innerHTML = '<div class="app"><nav class="side"><div class="brand">BLESS</div>' + NAV.map(function (n) { return '<a class="nav" href="#' + n[0] + '" data-n="' + n[0] + '"><span>' + n[1] + '</span>' + (n[0] === 'orders' ? '<span class="pill" id="ubadge" hidden></span>' : '') + '</a>'; }).join('') + '<div class="sp"></div><a class="nav" href="/" target="_blank" rel="noopener">View shop ↗</a><button class="out" id="lo">Sign out</button></nav><main id="main"></main></div>';
  $('#lo').onclick = function () { logout(); };
  window.onhashchange = route; route(); poll(); clearInterval(timer); timer = setInterval(poll, 30000);
}
function poll() { api('GET', '/stats').then(function (s) { unseen = Number(s.unseen); var b = $('#ubadge'); if (b) { b.hidden = !unseen; b.textContent = unseen; } document.title = (unseen ? '(' + unseen + ') ' : '') + 'BLESS Admin'; }).catch(function () {}); }
function route() {
  cur = (location.hash || '#dashboard').slice(1).split('/')[0]; if (!VIEWS[cur]) { cur = 'dashboard'; }
  $$('.side a.nav[data-n]').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-n') === cur); });
  var m = $('#main'); m.innerHTML = '<p class="muted">Loading…</p>'; VIEWS[cur](m);
}

/* ---------------- modal helper ---------------- */
function modal(title, body, narrow) {
  var bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = '<div class="modal' + (narrow ? ' narrow' : '') + '"><div class="hd"><h2>' + esc(title) + '</h2><button class="noprint" aria-label="Close">×</button></div><div class="mb">' + body + '</div></div>';
  document.body.appendChild(bg);
  function close() { bg.remove(); }
  $('.hd button', bg).onclick = close; bg.addEventListener('mousedown', function (e) { if (e.target === bg) { close(); } });
  return { el: $('.mb', bg), close: close };
}

/* ---------------- dashboard ---------------- */
var VIEWS = {};
VIEWS.dashboard = function (m) {
  api('GET', '/stats').then(function (s) {
    m.innerHTML = '<div class="bar"><h1>Dashboard</h1></div><div class="stats">' +
      [['New orders', s.unseen], ['Awaiting confirmation', s.pending], ['Due today', s.due_today], ['Orders (30 days)', s.orders30], ['Sales (30 days)', money(s.revenue30)], ['Products', s.products]].map(function (x) { return '<div class="stat"><span class="muted">' + x[0] + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('') +
      '</div><div class="card"><h2>Quick start</h2><p>1. <a href="#settings">Settings</a>: add your phone, WhatsApp, bank/wallet details and delivery charges.<br>2. <a href="#products">Products</a>: replace the sample products with yours.<br>3. <a href="#banners">Banners</a>: set the home-page slides.<br>4. Watch <a href="#orders">Orders</a>: the badge shows new orders and refreshes every 30 seconds.</p></div>';
  }).catch(fail);
};

/* ---------------- orders ---------------- */
var STATUS = [['pending', 'Pending'], ['confirmed', 'Confirmed'], ['preparing', 'Preparing'], ['out_for_delivery', 'Out for delivery'], ['ready', 'Ready for pickup'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']];
function statusName(k) { var f = STATUS.filter(function (s) { return s[0] === k; })[0]; return f ? f[1] : k; }
var ofilter = { status: '', q: '', date: '', page: 1 };
VIEWS.orders = function (m) {
  m.innerHTML = '<div class="bar"><h1>Orders</h1><span class="sp"></span><select id="fs"><option value="">All statuses</option>' + STATUS.map(function (s) { return '<option value="' + s[0] + '"' + (ofilter.status === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select><input type="date" id="fd" value="' + esc(ofilter.date) + '" title="Delivery date"><input type="search" id="fq" placeholder="Name, phone or order no." value="' + esc(ofilter.q) + '"></div><div id="ol"></div>';
  function load() {
    var qs = Object.keys(ofilter).filter(function (k) { return ofilter[k]; }).map(function (k) { return k + '=' + encodeURIComponent(ofilter[k]); }).join('&');
    api('GET', '/orders?' + qs).then(function (d) {
      $('#ol').innerHTML = (d.items.length ? '<div class="tw"><table><tr><th>#</th><th>Customer</th><th>For</th><th>Total</th><th>Payment</th><th>Status</th><th>Placed</th></tr>' + d.items.map(function (o) {
        return '<tr class="click' + (o.seen ? '' : ' new') + '" data-id="' + o.id + '"><td><b>' + o.id + '</b></td><td>' + esc(o.customer_name) + '<br><small class="muted">' + esc(o.customer_phone) + '</small></td><td>' + esc(o.delivery_date) + '<br><small class="muted">' + esc(o.delivery_method === 'pickup' ? 'Pickup' : o.delivery_city) + ' · ' + esc(o.delivery_time) + '</small></td><td>' + money(o.total) + '</td><td>' + esc(o.payment_method) + '<br><span class="tag ' + esc(o.payment_status) + '">' + esc(o.payment_status) + '</span></td><td><span class="tag ' + esc(o.status) + '">' + esc(statusName(o.status)) + '</span></td><td class="muted">' + when(o.created_at) + '</td></tr>';
      }).join('') + '</table></div>' : '<div class="card muted">No orders yet.</div>') +
      (d.pages > 1 ? '<div class="bar" style="margin-top:12px"><button class="btn ghost sm" id="pp"' + (d.page <= 1 ? ' disabled' : '') + '>← Newer</button><span class="muted">Page ' + d.page + ' of ' + d.pages + '</span><button class="btn ghost sm" id="pn"' + (d.page >= d.pages ? ' disabled' : '') + '>Older →</button></div>' : '');
      $$('tr.click', $('#ol')).forEach(function (tr) { tr.onclick = function () { orderDetail(tr.getAttribute('data-id'), load); }; });
      if ($('#pp')) { $('#pp').onclick = function () { ofilter.page--; load(); }; $('#pn').onclick = function () { ofilter.page++; load(); }; }
      poll();
    }).catch(fail);
  }
  $('#fs').onchange = function () { ofilter.status = this.value; ofilter.page = 1; load(); };
  $('#fd').onchange = function () { ofilter.date = this.value; ofilter.page = 1; load(); };
  var t; $('#fq').oninput = function () { var v = this.value; clearTimeout(t); t = setTimeout(function () { ofilter.q = v; ofilter.page = 1; load(); }, 350); };
  load();
};
function orderDetail(id, done) {
  api('GET', '/orders/' + id).then(function (o) {
    var items = o.items.map(function (i) {
      var opts = (i.options || []).map(function (p) { return '<div class="muted">' + esc(p.label) + ': ' + (p.type === 'image_upload' ? '<a href="/admin/api/files/' + esc(p.value) + '?t=' + encodeURIComponent(TOKEN) + '" target="_blank" rel="noopener">View uploaded photo</a>' : esc(p.value)) + (Number(p.price) > 0 ? ' (+' + money(p.price) + ')' : '') + '</div>'; }).join('');
      var vr = Object.keys(i.variation || {}).map(function (k) { return '<div class="muted">' + esc(k) + ': ' + esc(i.variation[k]) + '</div>'; }).join('');
      return '<tr><td><b>' + esc(i.name) + '</b> × ' + i.qty + vr + opts + '</td><td>' + money(i.unit_price) + '</td><td>' + money(i.line_total) + '</td></tr>';
    }).join('');
    var wa = String(o.customer_phone).replace(/\D+/g, ''); if (wa.indexOf('0') === 0) { wa = '92' + wa.slice(1); }
    var M = modal('Order #' + o.id, '<div class="grid2"><div><dl class="kv"><dt>Customer</dt><dd>' + esc(o.customer_name) + '</dd><dt>Phone</dt><dd><a href="tel:' + esc(o.customer_phone) + '">' + esc(o.customer_phone) + '</a> · <a target="_blank" rel="noopener" href="https://wa.me/' + esc(wa) + '?text=' + encodeURIComponent('Hello ' + o.customer_name + ', this is BLESS about your order #' + o.id + '.') + '">WhatsApp</a></dd>' + (o.customer_email ? '<dt>Email</dt><dd>' + esc(o.customer_email) + '</dd>' : '') +
      '<dt>' + (o.delivery_method === 'pickup' ? 'Pickup' : 'Delivery') + '</dt><dd><b>' + esc(o.delivery_date) + '</b>, ' + esc(o.delivery_time) + '</dd>' +
      (o.delivery_method === 'delivery' ? '<dt>Address</dt><dd>' + esc(o.delivery_address) + ', ' + esc(o.delivery_city) + '</dd>' + (o.recipient_name ? '<dt>Recipient</dt><dd>' + esc(o.recipient_name) + ' ' + esc(o.recipient_phone) + '</dd>' : '') : '') +
      (o.gift_message ? '<dt>Gift message</dt><dd>' + esc(o.gift_message) + '</dd>' : '') + (o.notes ? '<dt>Notes</dt><dd>' + esc(o.notes) + '</dd>' : '') + (o.video_whatsapp ? '<dt>Video approval</dt><dd>WhatsApp ' + esc(o.video_whatsapp) + '</dd>' : '') + '<dt>Placed</dt><dd>' + when(o.created_at) + '</dd></dl></div>' +
      '<div><dl class="kv"><dt>Payment</dt><dd>' + esc(o.payment_method) + ' <span class="tag ' + esc(o.payment_status) + '">' + esc(o.payment_status) + '</span></dd><dt>Reference</dt><dd><input id="pref" value="' + esc(o.payment_reference) + '" placeholder="Transaction ID"></dd></dl>' +
      '<label>Status</label><div class="steps" id="st">' + STATUS.map(function (s) { return '<button type="button" class="btn sm ' + (o.status === s[0] ? '' : 'ghost') + '" data-s="' + s[0] + '">' + s[1] + '</button>'; }).join('') + '</div>' +
      '<label>Payment status</label><select id="ps">' + ['unpaid', 'paid', 'refunded'].map(function (p) { return '<option' + (o.payment_status === p ? ' selected' : '') + '>' + p + '</option>'; }).join('') + '</select>' +
      '<label>Internal note (customers never see this)</label><textarea id="an">' + esc(o.admin_note) + '</textarea><p><button class="btn" id="sv">Save changes</button> <button class="btn ghost noprint" onclick="window.print()">Print</button></p></div></div>' +
      '<h3>Items</h3><div class="tw"><table><tr><th>Item</th><th>Each</th><th>Total</th></tr>' + items + '</table></div>' +
      '<p style="text-align:right">Subtotal ' + money(o.subtotal) + (Number(o.discount) > 0 ? ' · Discount −' + money(o.discount) + (o.coupon_code ? ' (' + esc(o.coupon_code) + ')' : '') : '') + ' · ' + (o.delivery_method === 'pickup' ? 'Pickup' : 'Delivery') + ' ' + money(o.delivery_fee) + '<br><b style="font-size:18px">Total ' + money(o.total) + '</b></p>' +
      '<h3>History</h3>' + o.history.map(function (h) { return '<div class="muted">' + when(h.at) + ' — ' + esc(h.status.indexOf('payment_') === 0 ? 'Payment ' + h.status.slice(8) : statusName(h.status)) + (h.note ? ' · ' + esc(h.note) : '') + '</div>'; }).join(''));
    var status = o.status;
    $$('#st button', M.el).forEach(function (b) { b.onclick = function () { status = b.getAttribute('data-s'); $$('#st button', M.el).forEach(function (x) { x.classList.toggle('ghost', x !== b); }); }; });
    $('#sv', M.el).onclick = function () {
      api('PATCH', '/orders/' + id, { status: status, payment_status: $('#ps', M.el).value, admin_note: $('#an', M.el).value, payment_reference: $('#pref', M.el).value }).then(function () { toast('Saved'); M.close(); done(); }).catch(fail);
    };
  }).catch(fail);
}

/* ---------------- products ---------------- */
var pfilter = { q: '', page: 1 }, CATS = [];
VIEWS.products = function (m) {
  m.innerHTML = '<div class="bar"><h1>Products</h1><span class="sp"></span><input type="search" id="pq" placeholder="Search products" value="' + esc(pfilter.q) + '"><button class="btn" id="pn">+ Add product</button></div><div id="pl"></div>';
  function load() {
    api('GET', '/products?q=' + encodeURIComponent(pfilter.q) + '&page=' + pfilter.page).then(function (d) {
      $('#pl').innerHTML = (d.items.length ? '<div class="tw"><table><tr><th></th><th>Name</th><th>Price</th><th>Stock</th><th>Shown</th><th></th></tr>' + d.items.map(function (p) {
        var prices = (p.variations || []).map(function (v) { return Number(v.price); }), pr = prices.length ? money(Math.min.apply(null, prices)) + (Math.max.apply(null, prices) > Math.min.apply(null, prices) ? ' – ' + money(Math.max.apply(null, prices)) : '') : money(p.base_price);
        return '<tr><td>' + (p.image_urls[0] ? '<img class="thumb" src="' + esc(imgUrl(p.image_urls[0])) + '" alt="">' : '') + '</td><td><b>' + esc(p.name) + '</b>' + (p.featured ? ' <span class="tag">Best seller</span>' : '') + '</td><td>' + pr + '</td><td>' + esc(p.availability.replace(/_/g, ' ')) + '</td><td>' + (p.active ? 'Yes' : '<span class="err">Hidden</span>') + '</td><td><button class="btn ghost sm" data-e="' + p.id + '">Edit</button> <button class="btn danger sm" data-d="' + p.id + '">Delete</button></td></tr>';
      }).join('') + '</table></div>' : '<div class="card muted">No products found.</div>') +
      (d.pages > 1 ? '<div class="bar" style="margin-top:12px"><button class="btn ghost sm" id="pp"' + (d.page <= 1 ? ' disabled' : '') + '>← Previous</button><span class="muted">Page ' + d.page + ' of ' + d.pages + '</span><button class="btn ghost sm" id="px"' + (d.page >= d.pages ? ' disabled' : '') + '>Next →</button></div>' : '');
      $$('[data-e]', $('#pl')).forEach(function (b) { b.onclick = function () { productForm(b.getAttribute('data-e'), load); }; });
      $$('[data-d]', $('#pl')).forEach(function (b) { b.onclick = function () { if (confirm('Delete this product? Orders already placed keep their details.')) { api('DELETE', '/products/' + b.getAttribute('data-d')).then(function () { toast('Deleted'); load(); }).catch(fail); } }; });
      if ($('#pp')) { $('#pp').onclick = function () { pfilter.page--; load(); }; $('#px').onclick = function () { pfilter.page++; load(); }; }
    }).catch(fail);
  }
  var t; $('#pq').oninput = function () { var v = this.value; clearTimeout(t); t = setTimeout(function () { pfilter.q = v; pfilter.page = 1; load(); }, 350); };
  $('#pn').onclick = function () { productForm(null, load); };
  api('GET', '/categories').then(function (c) { CATS = c; load(); }).catch(fail);
};

function uploadInto(file) { var fd = new FormData(); fd.append('file', file); return api('POST', '/upload', undefined, fd); }
function imageList(el, list, urls) { /* renders thumbnails with remove buttons, keeps `list` (refs) and `urls` in sync */
  el.innerHTML = list.map(function (r, i) { return '<div class="im"><img src="' + esc(imgUrl(urls[i] || r)) + '" alt=""><button type="button" class="x" data-i="' + i + '" aria-label="Remove">×</button></div>'; }).join('');
  $$('.x', el).forEach(function (b) { b.onclick = function () { var i = Number(b.getAttribute('data-i')); list.splice(i, 1); urls.splice(i, 1); imageList(el, list, urls); }; });
}
function productForm(id, done) {
  (id ? api('GET', '/products/' + id) : Promise.resolve({ name: '', slug: '', short: '', description: '', base_price: '', regular_price: '', on_sale: false, availability: 'made_to_order', images: [], image_urls: [], attributes: {}, variations: [], options: [], cats: [], featured: false, active: true })).then(function (p) {
    var images = p.images.slice(), urls = p.image_urls.slice(), attrs = JSON.parse(JSON.stringify(p.attributes || {})), vars = JSON.parse(JSON.stringify(p.variations || [])), opts = JSON.parse(JSON.stringify(p.options || []));
    var attrNames = Object.keys(attrs);
    var body = '<div class="grid2"><div><label>Name *</label><input id="f_name" value="' + esc(p.name) + '"></div><div><label>Short description (shown in lists)</label><input id="f_short" value="' + esc(p.short) + '"></div></div>' +
      '<label>Full description</label><textarea id="f_desc" rows="4">' + esc(p.description) + '</textarea>' +
      '<div class="grid3"><div><label>Price (Rs.) *</label><input id="f_price" type="number" min="0" step="1" value="' + esc(p.base_price) + '"></div><div><label>Old price (optional, shows as sale)</label><input id="f_reg" type="number" min="0" step="1" value="' + esc(p.regular_price == null ? '' : p.regular_price) + '"></div><div><label>Availability</label><select id="f_av">' + [['made_to_order', 'Made to order'], ['in_stock', 'In stock'], ['out_of_stock', 'Out of stock']].map(function (a) { return '<option value="' + a[0] + '"' + (p.availability === a[0] ? ' selected' : '') + '>' + a[1] + '</option>'; }).join('') + '</select></div></div>' +
      '<label class="inline"><input type="checkbox" id="f_sale"' + (p.on_sale ? ' checked' : '') + '> Show the old price as a sale</label><label class="inline"><input type="checkbox" id="f_feat"' + (p.featured ? ' checked' : '') + '> Best seller (shown on the home page)</label><label class="inline"><input type="checkbox" id="f_act"' + (p.active ? ' checked' : '') + '> Visible in the shop</label>' +
      '<h3>Categories</h3><div class="cats">' + CATS.map(function (c) { return '<label class="inline"><input type="checkbox" name="cat" value="' + esc(c.slug) + '"' + (p.cats.indexOf(c.slug) > -1 ? ' checked' : '') + '> ' + (c.parent ? '— ' : '') + esc(c.name) + ' <small class="muted">' + esc(c.type) + '</small></label>'; }).join('') + '</div>' +
      '<h3>Photos</h3><div class="imgs" id="f_imgs"></div><input type="file" id="f_file" accept="image/jpeg,image/png,image/webp" multiple><p class="muted">The first photo is the main one. JPG/PNG/WebP up to 4 MB each.</p>' +
      '<h3>Sizes / variants <small class="muted">(optional, each combination has its own price)</small></h3><div class="row"><div><label>Option name (e.g. Size)</label><input id="a1n" value="' + esc(attrNames[0] || '') + '"></div><div><label>Values, comma separated</label><input id="a1v" value="' + esc((attrs[attrNames[0]] || []).join(', ')) + '"></div></div>' +
      '<div class="row"><div><label>Second option (optional, e.g. Weight)</label><input id="a2n" value="' + esc(attrNames[1] || '') + '"></div><div><label>Values</label><input id="a2v" value="' + esc((attrs[attrNames[1]] || []).join(', ')) + '"></div></div><p><button type="button" class="btn ghost sm" id="f_build">Build price table</button></p><div id="f_vars"></div>' +
      '<h3>Customer choices <small class="muted">(flavour, name on cake, message, photo upload, gift wrap…)</small></h3><div id="f_opts"></div><p><button type="button" class="btn ghost sm" id="f_addopt">+ Add a choice</button></p><p class="err" id="f_err"></p><p><button class="btn" id="f_save">Save product</button></p>';
    var M = modal(id ? 'Edit product' : 'Add product', body);
    var el = M.el; imageList($('#f_imgs', el), images, urls);
    $('#f_file', el).onchange = function () {
      var files = Array.prototype.slice.call(this.files), inp = this;
      files.reduce(function (pr, f) { return pr.then(function () { return uploadInto(f).then(function (r) { images.push(r.ref); urls.push(r.url); imageList($('#f_imgs', el), images, urls); }); }); }, Promise.resolve()).catch(fail).then(function () { inp.value = ''; });
    };
    function names() { var o = []; [['a1n', 'a1v'], ['a2n', 'a2v']].forEach(function (k) { var n = $('#' + k[0], el).value.trim(), v = $('#' + k[1], el).value.split(',').map(function (x) { return x.trim(); }).filter(Boolean); if (n && v.length) { o.push([n, v]); } }); return o; }
    function drawVars() {
      var box = $('#f_vars', el); if (!vars.length) { box.innerHTML = ''; return; }
      var keys = Object.keys(vars[0].attributes);
      box.innerHTML = '<div class="tw"><table><tr>' + keys.map(function (k) { return '<th>' + esc(k) + '</th>'; }).join('') + '<th>Price (Rs.)</th><th>In stock</th></tr>' + vars.map(function (v, i) { return '<tr>' + keys.map(function (k) { return '<td>' + esc(v.attributes[k]) + '</td>'; }).join('') + '<td><input type="number" min="0" step="1" data-vp="' + i + '" value="' + esc(v.price) + '"></td><td><input type="checkbox" data-vs="' + i + '"' + (v.in_stock !== false ? ' checked' : '') + '></td></tr>'; }).join('') + '</table></div>';
      $$('[data-vp]', box).forEach(function (x) { x.oninput = function () { vars[x.getAttribute('data-vp')].price = x.value; }; });
      $$('[data-vs]', box).forEach(function (x) { x.onchange = function () { vars[x.getAttribute('data-vs')].in_stock = x.checked; }; });
    }
    $('#f_build', el).onclick = function () {
      var n = names(), old = vars.slice(); if (!n.length) { vars = []; drawVars(); return; }
      var combos = [{}]; n.forEach(function (a) { var next = []; combos.forEach(function (c) { a[1].forEach(function (v) { var x = Object.assign({}, c); x[a[0]] = v; next.push(x); }); }); combos = next; });
      vars = combos.map(function (c) { var f = old.filter(function (o) { return Object.keys(c).every(function (k) { return o.attributes[k] === c[k]; }); })[0]; return f || { attributes: c, price: Number($('#f_price', el).value) || 0, image: '', in_stock: true }; }); drawVars();
    };
    drawVars();
    function drawOpts() {
      $('#f_opts', el).innerHTML = opts.map(function (o, i) {
        return '<div class="opt" data-i="' + i + '"><div class="row"><div><label>Label</label><input data-k="label" value="' + esc(o.label) + '"></div><div><label>Type</label><select data-k="type">' + [['select', 'Dropdown (flavours…)'], ['radio', 'Radio list'], ['checkbox', 'Yes / No add-on'], ['text', 'Short text (name on cake)'], ['textarea', 'Long text (message)'], ['color', 'Colour picker'], ['image_upload', 'Customer photo upload']].map(function (t) { return '<option value="' + t[0] + '"' + (o.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select></div><div><label>Extra price (Rs.)</label><input type="number" min="0" step="1" data-k="extra" value="' + esc(o.extra || 0) + '"></div></div>' +
          (o.type === 'select' || o.type === 'radio' ? '<label>Choices, one per line. Add an extra price after a | (e.g. <i>Red Velvet | 300</i>)</label><textarea data-k="choices" rows="4">' + esc((o.choices || []).map(function (c) { return c.label + (Number(c.extra) > 0 ? ' | ' + c.extra : ''); }).join('\n')) + '</textarea>' : '') +
          '<div class="row"><label class="inline"><input type="checkbox" data-k="required"' + (o.required ? ' checked' : '') + '> Customer must fill this in</label><span class="fit"><button type="button" class="btn danger sm" data-rm="' + i + '">Remove</button></span></div></div>';
      }).join('');
      $$('.opt', el).forEach(function (box) {
        var i = Number(box.getAttribute('data-i'));
        $$('[data-k]', box).forEach(function (inp) { inp.onchange = inp.oninput = function () {
          var k = inp.getAttribute('data-k'); if (k === 'required') { opts[i].required = inp.checked; return; }
          if (k === 'choices') { opts[i].choices = inp.value.split('\n').map(function (l) { var s = l.split('|'); return { label: s[0].trim(), value: s[0].trim(), extra: Number(s[1]) || 0 }; }).filter(function (c) { return c.label; }); return; }
          opts[i][k] = inp.value; if (k === 'type' && inp.tagName === 'SELECT') { drawOpts(); }
        }; });
        $('[data-rm]', box).onclick = function () { opts.splice(i, 1); drawOpts(); };
      });
    }
    $('#f_addopt', el).onclick = function () { opts.push({ label: '', type: 'select', required: false, extra: 0, choices: [] }); drawOpts(); };
    drawOpts();
    $('#f_save', el).onclick = function () {
      var n = names(), a = {}; n.forEach(function (x) { a[x[0]] = x[1]; });
      var data = { name: $('#f_name', el).value, short: $('#f_short', el).value, description: $('#f_desc', el).value, base_price: $('#f_price', el).value, regular_price: $('#f_reg', el).value, on_sale: $('#f_sale', el).checked, availability: $('#f_av', el).value, featured: $('#f_feat', el).checked, active: $('#f_act', el).checked,
        cats: $$('input[name=cat]:checked', el).map(function (c) { return c.value; }), images: images, attributes: a, variations: n.length ? vars : [], options: opts };
      if (n.length && !vars.length) { $('#f_err', el).textContent = 'Click "Build price table" and set a price for each size.'; return; }
      this.disabled = true; var btn = this;
      api(id ? 'PUT' : 'POST', '/products' + (id ? '/' + id : ''), data).then(function () { toast('Product saved'); M.close(); done(); }).catch(function (e) { $('#f_err', el).textContent = e.message; btn.disabled = false; });
    };
  }).catch(fail);
}

/* ---------------- categories ---------------- */
VIEWS.categories = function (m) {
  function load() {
    api('GET', '/categories').then(function (cs) {
      CATS = cs;
      var by = {}; cs.forEach(function (c) { by[c.slug] = c; });
      m.innerHTML = '<div class="bar"><h1>Categories</h1><span class="sp"></span><button class="btn" id="cn">+ Add category</button></div><p class="muted">"Shop" categories appear on the home page (each with its own product section) and in the sidebar. A sub-category belongs to a parent. "Occasion" and "Collection" are shortcut chips.</p><div class="tw"><table><tr><th></th><th>Name</th><th>Type</th><th>Parent</th><th>Order</th><th></th></tr>' +
        cs.map(function (c) { return '<tr><td>' + (c.image ? '<img class="thumb" src="' + esc(imgUrl(c.image.indexOf('media:') === 0 ? '/media/' + c.image.slice(6) : c.image)) + '" alt="">' : '') + '</td><td>' + (c.parent ? '— ' : '') + '<b>' + esc(c.name) + '</b></td><td>' + esc(c.type === 'product' ? 'Shop' : c.type) + '</td><td>' + esc(c.parent ? (by[c.parent] ? by[c.parent].name : c.parent) : '') + '</td><td>' + c.sort + '</td><td><button class="btn ghost sm" data-e="' + c.id + '">Edit</button> <button class="btn danger sm" data-d="' + c.id + '">Delete</button></td></tr>'; }).join('') + '</table></div>';
      $('#cn').onclick = function () { catForm(null, by, load); };
      $$('[data-e]', m).forEach(function (b) { b.onclick = function () { catForm(cs.filter(function (c) { return String(c.id) === b.getAttribute('data-e'); })[0], by, load); }; });
      $$('[data-d]', m).forEach(function (b) { b.onclick = function () { if (confirm('Delete this category? Products stay, but lose this category.')) { api('DELETE', '/categories/' + b.getAttribute('data-d')).then(function () { toast('Deleted'); load(); }).catch(fail); } }; });
    }).catch(fail);
  }
  load();
};
function catForm(c, by, done) {
  c = c || { name: '', slug: '', type: 'product', parent: '', image: '', sort: 0 };
  var img = c.image;
  var M = modal(c.id ? 'Edit category' : 'Add category', '<label>Name *</label><input id="c_name" value="' + esc(c.name) + '"><div class="grid2"><div><label>Type</label><select id="c_type">' + [['product', 'Shop category'], ['occasion', 'Occasion'], ['collection', 'Collection']].map(function (t) { return '<option value="' + t[0] + '"' + (c.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select></div><div><label>Parent (for a sub-category)</label><select id="c_par"><option value="">— none —</option>' + Object.keys(by).filter(function (k) { return by[k].id !== c.id && by[k].type === 'product'; }).map(function (k) { return '<option value="' + esc(k) + '"' + (c.parent === k ? ' selected' : '') + '>' + esc(by[k].name) + '</option>'; }).join('') + '</select></div></div><label>Display order (small numbers first)</label><input id="c_sort" type="number" value="' + esc(c.sort) + '"><label>Picture (shown in the round category buttons)</label><div id="c_pic"></div><input type="file" id="c_file" accept="image/jpeg,image/png,image/webp"><p class="err" id="c_err"></p><p><button class="btn" id="c_save">Save</button></p>', true);
  function pic() { $('#c_pic', M.el).innerHTML = img ? '<div class="imgs"><div class="im"><img src="' + esc(imgUrl(img.indexOf('media:') === 0 ? '/media/' + img.slice(6) : img)) + '" alt=""><button type="button" class="x" id="c_rm">×</button></div></div>' : ''; if ($('#c_rm', M.el)) { $('#c_rm', M.el).onclick = function () { img = ''; pic(); }; } }
  pic();
  $('#c_file', M.el).onchange = function () { uploadInto(this.files[0]).then(function (r) { img = r.ref; pic(); }).catch(fail); };
  $('#c_save', M.el).onclick = function () {
    var data = { name: $('#c_name', M.el).value, slug: c.id ? c.slug : '', type: $('#c_type', M.el).value, parent: $('#c_par', M.el).value, sort: $('#c_sort', M.el).value, image: img };
    if (c.id && c.name !== data.name) { data.slug = c.slug; }
    api(c.id ? 'PUT' : 'POST', '/categories' + (c.id ? '/' + c.id : ''), data).then(function () { toast('Saved'); M.close(); done(); }).catch(function (e) { $('#c_err', M.el).textContent = e.message; });
  };
}

/* ---------------- coupons ---------------- */
VIEWS.coupons = function (m) {
  function load() {
    api('GET', '/coupons').then(function (cs) {
      m.innerHTML = '<div class="bar"><h1>Coupons</h1><span class="sp"></span><button class="btn" id="kn">+ Add coupon</button></div>' + (cs.length ? '<div class="tw"><table><tr><th>Code</th><th>Discount</th><th>Min. order</th><th>Used</th><th>Expires</th><th>Active</th><th></th></tr>' + cs.map(function (c) { return '<tr><td><b>' + esc(c.code) + '</b></td><td>' + (c.type === 'percent' ? Number(c.value) + '%' : money(c.value)) + '</td><td>' + (Number(c.min_subtotal) ? money(c.min_subtotal) : '—') + '</td><td>' + c.uses + (c.max_uses ? ' / ' + c.max_uses : '') + '</td><td>' + esc(c.expires ? String(c.expires).slice(0, 10) : '—') + '</td><td>' + (c.active ? 'Yes' : 'No') + '</td><td><button class="btn ghost sm" data-e="' + c.id + '">Edit</button> <button class="btn danger sm" data-d="' + c.id + '">Delete</button></td></tr>'; }).join('') + '</table></div>' : '<div class="card muted">No coupons yet.</div>');
      $('#kn').onclick = function () { couponForm(null, load); };
      $$('[data-e]', m).forEach(function (b) { b.onclick = function () { couponForm(cs.filter(function (c) { return String(c.id) === b.getAttribute('data-e'); })[0], load); }; });
      $$('[data-d]', m).forEach(function (b) { b.onclick = function () { if (confirm('Delete this coupon?')) { api('DELETE', '/coupons/' + b.getAttribute('data-d')).then(load).catch(fail); } }; });
    }).catch(fail);
  }
  load();
};
function couponForm(c, done) {
  c = c || { code: '', type: 'percent', value: '', min_subtotal: 0, active: true, expires: '', max_uses: '' };
  var M = modal(c.id ? 'Edit coupon' : 'Add coupon', '<label>Code *</label><input id="k_code" value="' + esc(c.code) + '" style="text-transform:uppercase"><div class="grid2"><div><label>Type</label><select id="k_type"><option value="percent"' + (c.type === 'percent' ? ' selected' : '') + '>Percent off</option><option value="fixed"' + (c.type === 'fixed' ? ' selected' : '') + '>Fixed amount off (Rs.)</option></select></div><div><label>Amount *</label><input id="k_val" type="number" min="0" step="1" value="' + esc(Number(c.value) || '') + '"></div></div><div class="grid3"><div><label>Minimum order (Rs.)</label><input id="k_min" type="number" min="0" value="' + esc(Number(c.min_subtotal) || 0) + '"></div><div><label>Expires on (optional)</label><input id="k_exp" type="date" value="' + esc(c.expires ? String(c.expires).slice(0, 10) : '') + '"></div><div><label>Max uses (optional)</label><input id="k_max" type="number" min="1" value="' + esc(c.max_uses || '') + '"></div></div><label class="inline"><input type="checkbox" id="k_act"' + (c.active ? ' checked' : '') + '> Active</label><p class="err" id="k_err"></p><p><button class="btn" id="k_save">Save</button></p>', true);
  $('#k_save', M.el).onclick = function () {
    var d = { code: $('#k_code', M.el).value, type: $('#k_type', M.el).value, value: $('#k_val', M.el).value, min_subtotal: $('#k_min', M.el).value, expires: $('#k_exp', M.el).value, max_uses: $('#k_max', M.el).value, active: $('#k_act', M.el).checked };
    api(c.id ? 'PUT' : 'POST', '/coupons' + (c.id ? '/' + c.id : ''), d).then(function () { toast('Saved'); M.close(); done(); }).catch(function (e) { $('#k_err', M.el).textContent = e.message; });
  };
}

/* ---------------- banners ---------------- */
VIEWS.banners = function (m) {
  api('GET', '/settings').then(function (s) {
    var hero = s.hero.slice(), gen = s.general;
    function draw() {
      m.innerHTML = '<div class="bar"><h1>Home banners</h1></div><p class="muted">Slides at the top of the home screen. Use landscape/square photos about 1200 px wide (JPG).</p>' + hero.map(function (h, i) {
        return '<div class="card" data-i="' + i + '"><div class="row"><div class="fit"><img class="thumb" style="width:110px;height:70px" src="' + esc(imgUrl(h.image.indexOf('media:') === 0 ? '/media/' + h.image.slice(6) : h.image)) + '" alt=""></div><div><label>Title</label><input data-k="title" value="' + esc(h.title) + '"></div><div><label>Small text above</label><input data-k="subtitle" value="' + esc(h.subtitle) + '"></div></div><div class="row"><div><label>Button text</label><input data-k="cta" value="' + esc(h.cta) + '"></div><div><label>Link (e.g. #/shop?cat=cakes)</label><input data-k="link" value="' + esc(h.link) + '"></div><div class="fit"><label>&nbsp;</label>' + (i ? '<button class="btn ghost sm" data-up="' + i + '">↑</button> ' : '') + '<button class="btn danger sm" data-rm="' + i + '">Remove</button></div></div></div>';
      }).join('') + '<p><label class="btn ghost" style="cursor:pointer">+ Add slide<input type="file" id="hf" accept="image/jpeg,image/png,image/webp" hidden></label> &nbsp; Auto-change every <input id="hs" type="number" min="3" max="30" value="' + Math.round((gen.hero_autoplay_ms || 6000) / 1000) + '" style="width:70px;display:inline-block"> seconds</p><p><button class="btn" id="hsave">Save banners</button></p>';
      $$('.card[data-i]', m).forEach(function (card) { var i = Number(card.getAttribute('data-i')); $$('[data-k]', card).forEach(function (inp) { inp.oninput = function () { hero[i][inp.getAttribute('data-k')] = inp.value; }; }); });
      $$('[data-rm]', m).forEach(function (b) { b.onclick = function () { hero.splice(Number(b.getAttribute('data-rm')), 1); draw(); }; });
      $$('[data-up]', m).forEach(function (b) { b.onclick = function () { var i = Number(b.getAttribute('data-up')); hero.splice(i - 1, 0, hero.splice(i, 1)[0]); draw(); }; });
      $('#hf').onchange = function () { uploadInto(this.files[0]).then(function (r) { hero.push({ title: '', subtitle: '', cta: 'SHOP NOW', link: '', image: r.ref }); draw(); }).catch(fail); };
      $('#hsave').onclick = function () { api('PUT', '/settings', { hero: hero, general: Object.assign({}, gen, { hero_autoplay_ms: (Number($('#hs').value) || 6) * 1000 }) }).then(function () { toast('Banners saved'); }).catch(fail); };
    }
    draw();
  }).catch(fail);
};

/* ---------------- settings ---------------- */
VIEWS.settings = function (m) {
  api('GET', '/settings').then(function (s) {
    var sh = s.shop, d = s.delivery, g = s.general;
    m.innerHTML = '<div class="bar"><h1>Settings</h1></div>' +
      '<div class="card"><h2>Shop details</h2><p class="muted">Shown in the app (Orders &amp; help screen, sidebar) and on order pages.</p><div class="grid2"><div><label>Shop name</label><input id="s_name" value="' + esc(sh.name) + '"></div><div><label>Phone</label><input id="s_phone" value="' + esc(sh.phone) + '" placeholder="0300 1234567"></div><div><label>WhatsApp number (with country code)</label><input id="s_wa" value="' + esc(sh.whatsapp) + '" placeholder="923001234567"></div><div><label>Email</label><input id="s_mail" value="' + esc(sh.email) + '"></div></div><label>Address</label><input id="s_addr" value="' + esc(sh.address) + '"><div class="grid2"><div><label>Currency symbol</label><input id="s_cur" value="' + esc(g.currency) + '"></div><div><label>Currency code</label><input id="s_code" value="' + esc(g.currency_code) + '"></div></div></div>' +
      '<div class="card"><h2>Delivery</h2><div class="grid3"><div><label>Delivery charge (Rs.)</label><input id="d_fee" type="number" min="0" value="' + esc(d.fee) + '"></div><div><label>Free delivery above (Rs., 0 = never)</label><input id="d_free" type="number" min="0" value="' + esc(d.free_over) + '"></div><div><label>Orders accepted up to (days ahead)</label><input id="d_max" type="number" min="1" value="' + esc(d.max_days) + '"></div></div><div class="grid3"><div><label>Earliest delivery: days after order</label><input id="d_lead" type="number" min="0" value="' + esc(d.lead_days) + '"></div><div><label class="inline"><input type="checkbox" id="d_same"' + (d.same_day ? ' checked' : '') + '> Allow same-day delivery</label></div><div><label>…if ordered before (hour, 0–23)</label><input id="d_cut" type="number" min="0" max="23" value="' + esc(d.cutoff_hour) + '"></div></div><label class="inline"><input type="checkbox" id="d_pick"' + (d.pickup_enabled ? ' checked' : '') + '> Customers can pick up from the shop</label><div class="grid2"><div><label>Cities we deliver to (one per line)</label><textarea id="d_cities" rows="5">' + esc(d.cities.join('\n')) + '</textarea></div><div><label>Time slots (one per line)</label><textarea id="d_slots" rows="5">' + esc(d.slots.join('\n')) + '</textarea></div></div><p class="muted">Dates use Pakistan time.</p></div>' +
      '<div class="card"><h2>Payment methods</h2><p class="muted">Customers pay outside the app (cash, bank, or wallet) and you mark the order as paid. Put your account details in the text, because customers see it at checkout and on their order page.</p>' + s.gateways.map(function (gw, i) { return '<div class="opt" data-g="' + i + '"><label class="inline"><input type="checkbox" data-k="enabled"' + (gw.enabled ? ' checked' : '') + '> <b>' + esc(gw.id === 'cod' ? 'Cash on delivery' : gw.id === 'bank' ? 'Bank transfer' : gw.id === 'jazzcash' ? 'JazzCash' : 'Easypaisa') + '</b> — accept this</label><div class="grid2"><div><label>Title shown to customers</label><input data-k="title" value="' + esc(gw.title) + '"></div><div><label>Instructions</label><textarea data-k="description" rows="3">' + esc(gw.description) + '</textarea></div></div></div>'; }).join('') + '</div>' +
      '<p><button class="btn" id="s_save">Save settings</button></p>';
    $('#s_save').onclick = function () {
      var gws = s.gateways.map(function (gw, i) { var box = $('[data-g="' + i + '"]'); return { id: gw.id, enabled: $('[data-k=enabled]', box).checked, title: $('[data-k=title]', box).value, description: $('[data-k=description]', box).value }; });
      api('PUT', '/settings', {
        shop: { name: $('#s_name').value, phone: $('#s_phone').value, whatsapp: $('#s_wa').value, email: $('#s_mail').value, address: $('#s_addr').value },
        general: Object.assign({}, g, { currency: $('#s_cur').value, currency_code: $('#s_code').value }),
        delivery: { fee: $('#d_fee').value, free_over: $('#d_free').value, max_days: $('#d_max').value, lead_days: $('#d_lead').value, same_day: $('#d_same').checked, cutoff_hour: $('#d_cut').value, pickup_enabled: $('#d_pick').checked, cities: $('#d_cities').value, slots: $('#d_slots').value },
        gateways: gws }).then(function () { toast('Settings saved'); }).catch(fail);
    };
  }).catch(fail);
};

if (TOKEN) { api('GET', '/stats').then(shell).catch(function () { loginView(); }); } else { loginView(); }
})();
