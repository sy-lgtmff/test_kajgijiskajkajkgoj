// 現場踏査写真管理アプリ Service Worker
// 役割: アプリ本体（HTML・外部ライブラリ）と地図タイルをオフラインでも使えるようキャッシュする。
// キャッシュ名にバージョン番号を持たせ、更新時はここを書き換えて古いキャッシュを破棄する。
const SHELL_CACHE = 'app-shell-v1';
const TILE_CACHE  = 'map-tiles-v1';

// アプリが読み込む外部ライブラリ（CDN）。install時に先読みキャッシュする。
// 本体HTML自体はファイル名を問わず、fetchハンドラで初回アクセス時に自動キャッシュされる。
const SHELL_URLS = [
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'https://unpkg.com/leaflet-image@0.4.0/leaflet-image.js'
];

// 地図タイルのサーバー（地理院・ESRI）
function isMapTile(url) {
    return url.includes('cyberjapandata.gsi.go.jp') || url.includes('server.arcgisonline.com');
}

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(cache => cache.addAll(SHELL_URLS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== SHELL_CACHE && k !== TILE_CACHE).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;

    // 地図タイル: Stale-While-Revalidate（キャッシュを即返しつつ裏で更新）
    if (isMapTile(req.url)) {
        event.respondWith(
            caches.open(TILE_CACHE).then(cache =>
                cache.match(req).then(cached => {
                    const network = fetch(req).then(res => {
                        if (res.ok) cache.put(req, res.clone());
                        return res;
                    }).catch(() => cached);
                    return cached || network;
                })
            )
        );
        return;
    }

    // アプリ本体・外部ライブラリ: Cache First（キャッシュになければ取得して保存）
    event.respondWith(
        caches.match(req).then(cached => {
            if (cached) return cached;
            return fetch(req).then(res => {
                if (res.ok) {
                    const copy = res.clone();
                    caches.open(SHELL_CACHE).then(cache => cache.put(req, copy));
                }
                return res;
            }).catch(() => cached);
        })
    );
});

self.addEventListener('message', event => {
    const action = event.data && event.data.action;
    if (action === 'skip-waiting') {
        self.skipWaiting();
    } else if (action === 'clear-tile-cache') {
        caches.delete(TILE_CACHE);
    }
});
