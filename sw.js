// 現場踏査写真管理アプリ Service Worker
// 役割: アプリ本体（HTML・外部ライブラリ）と地図タイルをオフラインでも使えるようキャッシュする。
// キャッシュ名にバージョン番号を持たせ、更新時はここを書き換えて古いキャッシュを破棄する。
const SHELL_CACHE = 'app-shell-v1';
const TILE_CACHE  = 'map-tiles-v1';

// アプリが読み込む外部ライブラリ（CDN）＋ PWA関連ファイル。install時に先読みキャッシュする。
// 本体HTML自体はファイル名を問わず、fetchハンドラで初回アクセス時に自動キャッシュされる。
const SHELL_URLS = [
    'manifest.json',
    'icon-192.png',
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

// Googleタイル（個人カスタマイズ版でのみ使用）。Googleの利用規約上、タイルの
// キャッシュ・保存は明確に禁止されているため、このSWでは一切キャッシュに書き込まず、
// 常にネットワークへそのまま素通しする（オフライン機能の対象外）。
function isGoogleTile(url) {
    return url.includes('mt1.google.com/vt');
}

// アプリ側の更新確認（appControl.checkForUpdate）が投げる index.html?t=<timestamp> を判定する。
// 【重要】ページ側はfetch()にcache:"no-store"を付けてブラウザのHTTPキャッシュを回避して
// いたが、それだけではこのSW自身のCache Storageは回避できない。stale-while-revalidate
// ハンドラは「キャッシュがあれば即返す」ため、SWのキャッシュがまだ古いバージョンのままだと
// 更新確認が古い内容を見てしまい「最新です」と誤判定される（＝1回目は反応せず、裏で走る
// revalidateでキャッシュが更新された後の2回目でようやく新バージョンを検知できてしまう
// 不具合の原因だった）。更新確認だけはキャッシュを一切使わず常にネットワークへ直接
// フェッチすることで、1回目から確実に最新の内容を取得できるようにする。
function isUpdateCheck(url) {
    try { return new URL(url).searchParams.has('t'); } catch (e) { return false; }
}

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            // 【重要】cache.addAll()は1件でも取得に失敗すると全体が失敗しinstallが止まる。
            // ファイルの一時的な欠落・ネットワーク不調で他の資材まで巻き添えにしないよう、
            // 失敗しても警告だけ出して続行する。
            .then(cache => cache.addAll(SHELL_URLS).catch(err => console.warn('Shell cache warning:', err)))
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

    // Googleタイル: キャッシュ一切なしでネットワークへ素通し（保存禁止のため）
    if (isGoogleTile(req.url)) {
        event.respondWith(fetch(req));
        return;
    }

    // 更新確認: キャッシュを一切使わず常にネットワークへ直接フェッチ（1回目から最新判定できるように）
    if (isUpdateCheck(req.url)) {
        event.respondWith(fetch(req));
        return;
    }

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

    // アプリ本体・外部ライブラリ: Stale-While-Revalidate
    // （キャッシュがあれば即返しつつ、裏で最新版を取得してキャッシュを更新する。
    //   Cache Firstだと更新後もオフラインになるまで古い版を返し続けてしまうため、
    //   オンライン中は常に裏で最新化されるこの方式にする。）
    // 【重要】fetch(req)を素のまま呼ぶと、この裏取得のリクエスト自体がブラウザ自身の
    // HTTPキャッシュ（GitHub Pages等が付与するCache-Controlによるもの）で解決されてしまい、
    // ネットワークに一切出ずに古いレスポンスがそのままcache.put()されてしまうことがあった
    // （＝更新ボタンでその場は最新表示になっても、次回起動時にタスクキル後は結局この
    // stale-while-revalidateが拾った古いキャッシュに戻ってしまう不具合の原因）。
    // {cache:'reload'}でブラウザのHTTPキャッシュを読み取り時だけ迂回し、必ずサーバーへ
    // 到達させることで、裏取得が常に本当に最新の内容になるようにする。
    event.respondWith(
        caches.open(SHELL_CACHE).then(cache =>
            cache.match(req).then(cached => {
                const network = fetch(req, { cache: 'reload' }).then(res => {
                    if (res.ok) cache.put(req, res.clone());
                    return res;
                }).catch(() => cached);
                return cached || network;
            })
        )
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
