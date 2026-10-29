/* App-shell cache. The shop API (another origin) is never cached, so prices and carts are always live. */
var V = 'bless-shell-v7';
var SHELL = ['./', 'index.html', 'css/app.css', 'js/config.js', 'js/demo-data.js', 'js/demo.js', 'js/api.js', 'js/app.js', 'assets/bless-emblem.png', 'assets/logo-flourish.svg', 'assets/floral-sprig.svg', 'assets/floral-arch.svg', 'assets/onion-pattern-dark.png'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(V).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== V; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || /^\/(api|admin|order|track-order|account|media)\b/.test(u.pathname)) { return; }
  e.respondWith(fetch(e.request).then(function (r) { if (r && r.ok) { var c = r.clone(); caches.open(V).then(function (x) { x.put(e.request, c); }); } return r; }).catch(function () { return caches.match(e.request).then(function (m) { return m || caches.match('index.html'); }); }));
});
