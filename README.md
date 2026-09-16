# 被災状況調査システム 開発仕様書 (Phase 6.01)

**Last Updated:** Phase 6.01（この開発仕様書をindex.htmlの「開発方針」タブから完全に分離し、README.mdとして独立管理することにした。アプリ本体には開発者向け情報を埋め込まない方針に変更したため）

App A (Stable)

## 1. プロジェクト背景と目的

大規模災害時、通信遮断下にある現場から、確実に被害状況を事務所へ届けるための建設コンサルタント専用ツール。鹿児島県測量設計業協会の情報専門部会が主導して開発。

- **Local-First:** サーバー・DB不要。PWAとしてスマホにインストールして動作する。
- **Bucket Relay:** データ連携は物理的なファイル移動（JZIP形式）で行う。
- **Offline First:** Service Workerにより地図タイル含めオフライン動作を保証する。

## 2. 開発運用ルール（SSOT）

- **Phase管理:** 会議の局面管理番号（X.XX）。package.jsonのversionおよびconfig.phaseを正とする。
- **永遠のβ版:** 現場フィードバックにより開発は永続する。「完成」と決めつけない。
- **Spec as Code:** 本ファイル（README.md）はプロジェクトの唯一の正解情報（SSOT）である。
- **コード提示ルール:** 省略不可・全文表示・変更ファイルのみ・圧縮不可。最適化と意匠変更は判断を仰ぐ。毎回 package.json と本ファイルを提示する。

## 3. ファイル構成 (File Manifest)

| Filename | Role | Note |
|---|---|---|
| `build.js` | ビルドスクリプト | App A専用。piexif.jsを先頭に結合する |
| `index.html.template` | App A 骨格 | プレースホルダーは /* INSERT: CSS */ 等の形式 |
| `style.css` | 共通スタイル | CSS変数、アコーディオン、地図UI、スケッチUIを定義 |
| `header.html` | 共通ヘッダー | タブ（ホーム/ヘルプ/更新）。ヘルプ内にサブタブ（アプリ化の手順/開発方針） |
| `introduction.html` | アプリ本体UI | アコーディオン群（管理項目〜入出力）。位置図エリアにGPS修正バナー |
| `README.md` | 開発仕様書 | 本ファイル（Phase 6.00でindex.htmlの「開発方針」タブから分離） |
| `install_guide.html` | インストール手順 | iPhone/Android向けPWA追加手順・統合管理版DLリンク |
| `jzip_spec.html` | JZIP連携仕様書 | AppAとAppBの連携仕様を定義する共通ドキュメント。build.jsには組み込まない。両スレッドに毎回渡して同期させる。 |
| `1_script_map.js` | 地図管理 | Leaflet初期化・描画・モード切替・地図画像化・GPS修正モード。maxZoom:25（オーバーズーム対応） |
| `1_script_sketch.js` | 白紙メモ | Canvas描画（ペン/直線/文字/消しゴム/Undo） |
| `2_script_photo.js` | 写真管理・センサー | gpsManager + azimuthManager + photoApp（GPS修正フロー含む） |
| `3_script_main.js` | 制御・入出力 | UIヘルパー・オートセーブ・JZIP入出力（EXIF書き込み含む）・プリセット・更新確認・mapCacheManager |
| `sw.js` | Service Worker | 地図タイル・アプリ本体のキャッシュ管理（自動キャッシュ方式） |
| `manifest.json` | PWAマニフェスト | start_url/scope=/shodo-chosa/。スタンドアロン起動・アイコン定義 |
| `piexif.js` | EXIFライブラリ | piexifjs v1.0.6。src/直下に配置しビルド時にインライン埋め込み |
| `rogo-AAA.txt` | ロゴデータ | Base64エンコード画像（ビルド時にインライン埋め込み） |

## 4. 実装仕様とアーキテクチャ

### 4.1 データ構造 (JZIP)

詳細は `jzip_spec.html` を参照。photoListの各要素：`{ fileName, memo, tag, azimuth, lat, lng, gpsAccuracy, gpsFixed }`

### 4.2 写真機能

- **写真エリアのUI配置順（確定）:** ナビゲーション → プレビュー → タグ・削除 → 📷撮影・📁ファイル選択 → 写真の備考 → センサーエリア（撮影方向・位置情報）
- **カメラinput分離（iPhone対応）:** photo-camera-input（handleCameraFile・GPS自動記録）/ photo-file-input（handleFileSelect・EXIF読み込み）
- **撮影ボタン:** 「誤差○m」を直接表示。未取得時は点滅。GPS起動はDOMContentLoadedで実施。
- **位置情報4状態:** ○m（精度あり）/ 修正済み（地図タップ後・青）/ 不明（EXIFから）/ 未取得
- **GPS修正フロー:** 修正ボタン→写真タブ閉じ→位置図タブ開く（現在ズーム+2）→地図タップ→写真タブに戻る
- **JZIPエクスポート時のEXIF書き込み:** piexifjsでGPS座標・方位をJPEGに書き込む。エラー時フォールバック。
- **リサイズ横幅指定:** 入出力タグで800/1200/1600/2000px・なしを選択。デフォルト1200px。
- **撮影ボタンの許可待ちロック解除ウォッチドッグ（Phase 5.77強化）:** GPS（gpsManager）・方位センサー（azimuthManager）の許可ダイアログ応答前は撮影ボタンをdisabledにして、iOSでネイティブダイアログとカメラ起動が競合し以後カメラが起動しなくなる不具合を防いでいる（既存の仕組み）。これに加え、(1) ボタンのonclickを直接input.click()にせずphotoApp.triggerCameraInput()を経由させ、実行時にも許可待ち状態を再チェックする二重の安全策、(2) gpsManager.start()・azimuthManager.startListening()の双方に独自のウォッチドッグタイマー（12秒）を追加し、iOS側の許可応答（成功・拒否どちらのコールバック／Promise）が何らかの理由で永遠に返ってこなかった場合でも、一定時間後に強制的にpermissionPendingを解除してボタンを復帰させるようにした。watchPositionのtimeoutオプションは許可待ちも含めてカウントされる仕様のはずだが、iOS実機でこれが機能せずコールバックが呼ばれないまま固まるケースが確認されたための対策。
- **撮影時にカメラロールへも保存（Phase 5.77追加、5.79〜5.81で調査・仕様変更）:** 写真設定に「撮影時にカメラロールにも保存する」チェックボックス（既定ON、初期値保存/読み込み対象）を追加。**注意:** iOS Safariの仕様上、input captureで撮影した写真はWebページに渡されるだけでカメラロールへの自動保存はされず、Webページが無断で写真アプリに書き込むAPIも存在しないため、完全な自動・無音保存は不可能。唯一の方法はWeb Share API（navigator.share）でOS標準の共有シートを開き、ユーザーが「イメージを保存」をタップすること。
  **Phase 5.79の修正:** handleCameraFile内でresizeImage()のawaitを待ってから共有を呼んでいたためnavigator.share()に必要なユーザー操作起点（トランジェントアクティベーション）が失効していた不具合を修正（呼び出し順序をリサイズより前に変更）。
  **Phase 5.80〜5.81で判明した根本問題:** 呼び出し順序を直しても、実機ではカメラ撮影後のinput[change]イベントに十分なユーザー操作起点が伴わない端末があり、navigator.share()が必ず失敗することを確認した（診断トーストで`NotAllowedError`等を確認）。changeイベント経由の自動保存はブラウザの実装によって信頼できないため、**写真ツールバーに「📥 保存」ボタン（managerApp.saveCurrentPhotoToCameraRoll）を新設し、表示中の写真をユーザーの直接タップから共有する方式に変更**。ボタンの直接クリックは常に新鮮な操作起点を伴うため確実に動作する。撮影直後の自動保存（_saveToCameraRoll(file, {auto:true})）は既定ONのままベストエフォートで試行し続けるが、失敗時は「📥保存」ボタンの利用を促すトーストを表示する。

### 4.3 地図機能

- ポリライン描画の完了はボタン専用（マーカータップ無効）。
- モード：位置図（メイン・赤）/ 地図メモ（サブ・青）/ 白紙メモ（Canvas）/ GPS修正モード
- **maxZoom:25（オーバーズーム対応）:** maxNativeZoom:18（地理院）/19（ESRI）でタイルを拡大表示。
- **地図初期化タイミング:** storageManager.load()では初期化せず、アコーディオンを開いたときにinvalidateSize()→ペンディングデータ復元の順で実行。DOMサイズ0での初期化を防ぐ。
- **地図の高さを残り領域いっぱいに動的計算（Phase 5.88追加、5.91で.map-controls分の差し引きを廃止）:** `#map`はHTML上`height:55vh`が初期値だが、mapApp.fitMapHeight()が地図要素の現在位置から#main-content（画面の残り表示領域）の下端までを実測し、その分を地図の実高さとして動的に割り当てる。縦横比の異なる端末・画面回転・ウィンドウリサイズでも、地図の下に空白ができないようにするための対策。switchMapMode()（位置図タブを開いた時）とwindow resizeイベントの両方で再計算する。Phase 5.91で「地図を写真に保存」「全て消去」ボタンをフローティング化し地図の下に専有スペースを取る要素が無くなったため、以前あった操作ボタン行の高さの差し引き計算は削除した。
- **フローティング操作ボタン（Phase 5.90〜5.92）:** 「現在地」「地図を写真に保存」（右下、ベースマップ選択と同じ44pxのアイコンボタン、.map-icon-btnで統一。現在地が上、保存が下の縦並び）、「テキスト表示→注釈」（左下、チェックボックス）を、いずれも地図に重ねて表示するフローティングUIとして配置している。「全て消去」ボタンはPhase 5.92で削除した。地図の下に専有スペースを取る固定要素は無くなり、地図表示領域を最大限確保できるようになった。
- **地図キャッシュ:** 表示したタイルを自動でCache Storageに蓄積（Stale-While-Revalidate方式）。意図的な一括先読み機能はUI非搭載。
- **写真の位置図表示（Phase 5.75追加）:** 位置情報を持つ写真をphotos[]から抽出し、mapApp.photoLayerGroupにカメラアイコン（📷）マーカーとして表示。位置図タブを開くたび（アコーディオン展開・GPS修正フロー開始時）にmapApp.renderPhotoMarkers()で再描画する。
- **撮影方向の矢印表示:** azimuth記録済みの写真は、カメラアイコンから赤い矢印を伸ばして撮影方向を示す（0°=真北、時計回りに回転）。azimuth未記録の写真はアイコンのみ。選択中の写真は青リングで強調。マーカータップで写真・タグ・方位・備考をポップアップ表示し、対象写真を選択状態にする。
- **「現在地」ボタンの位置表示（Phase 5.86追加）:** mapApp.setCurrentLocation()はmap.locate({setView:true, maxZoom:16})で地図をパン・ズームするだけで、自分の位置を示すマーカーが表示されていなかった。init()内でmap.on('locationfound', ...)を配線し、取得した座標に青丸マーカー（L.circleMarker）＋精度円（L.circle、半径=accuracy/2）を表示するよう変更。約5秒後にsetTimeoutで自動的に消える。連打された場合は前回のマーカー・円・タイマーを解除してから出し直すため、表示が重複しない。取得失敗時（locationerror）はトースト通知を出す。

### 4.4 キャッシュ管理

- **自動キャッシュ:** 地図表示時に自動でタイルをキャッシュ。ユーザー操作不要。
- **キャッシュ開放:** 入出力データ操作タブの「地図キャッシュを開放する」ボタンでCache Storageを削除。LocalStorage（入力データ・プリセット）には影響しない。
- **iOSの注意:** ストレージ不足時にiOSがPWAのキャッシュを自動削除する場合がある。その際は再度地図を表示してキャッシュを再蓄積する。

### 4.5 オートセーブ仕様

- 保存先：LocalStorage（キー: survey_app_autosave）
- 写真はdataUrlを保存しない。メタ情報（tag・memo・azimuth・lat・lng・gpsAccuracy・gpsFixed）のみ保存。
- 復元時はメタ情報のみ復元。実画像はJZIP読み込みで復元する運用。
- **写真キャッシュ(IndexedDB/photoStorage)の信頼性強化（Phase 5.82）:** 実画像本体はIndexedDB（photoStorage、id=配列インデックスで管理）にキャッシュしている。以前のsyncAll()は「clearAll()で全消去→1件ずつsave()で書き直し」という別々のトランザクションで実装しており、この間にアプリが強制終了・OSによるバックグラウンド一時停止・電源断等で中断されると、消去後・書き直し未完了のまま写真データが失われるリスクがあった。修正として、clear()と全put()を同一のIndexedDBトランザクションにまとめ、オールオアナッシング（中断時は自動ロールバックされ、消去前の状態がそのまま保持される）にした。また、撮影の度にrunSort()内部と呼び出し元(handleCameraFile/handleFileSelect)の両方でsyncAll()が二重に走っていたのも、runSort()側に一本化して削減した（runSortをasync化し、呼び出し元はawaitするだけに変更）。
- **「新規調査開始」でIndexedDBが消されない不具合修正（Phase 5.82、更新管理UIは5.83で「更新」タブへ移動）:** ツールバーの「新規調査開始」（uiHelper.confirmReset→appControl.executeClear）は画面上の写真一覧（photoApp.photos）を空にするだけで、IndexedDB側の写真データは削除されておらず、前回調査の写真キャッシュが消えずに残り続けていた。appControl.clearAll()側は元々photoStorage.clearAll()を呼んでいたが、こちらのexecuteClear()には無かったための漏れ。executeClear()にもphotoStorage.clearAll()の呼び出しを追加した。

### 4.6 PWA・デプロイ

- GitHub Pages: `https://kspa-joho.github.io/shodo-chosa/`
- manifest.jsonのstart_url/scope: `/shodo-chosa/`
- Service Workerによる完全オフライン起動。更新確認ボタンでPhase番号比較・手動更新。
- **Google Apps Script経由配信時の注意（Phase 5.76追加）:** GASのdoGetはHTMLをGoogle製ラッパーページ内の`<iframe>`として配信するため、iOS SafariがトップページのみのViewportメタタグしか参照しない仕様と衝突し、「拡大縮小が固定されない」現象が発生する。方位センサー・GPSの権限もiframe内では不安定になりうる。対策として、`<head>`先頭で`window.top !== window.self`を検知した場合に`window.top.location`へ自ページURLを代入し、iframeから脱出（トップレベル遷移）する処理を追加した。file://や直接ホスティングされたURLで開く場合は何もしない（無害）。

## 5. 重要な決定事項

- **カメラinput分離方針:** iOSのmultiple不安定問題を根本解決。今後変更しない。
- **位置情報の削除ボタン廃止:** 誤操作防止のため削除ボタンは設けない。修正は地図タップ上書きのみ。
- **EXIFはエクスポート時に書き込む:** リサイズ時にEXIFが消えるため、JZIP生成時にpiexifjsで書き直す。
- **地図タップ修正後はgpsFixed=true:** gpsAccuracyはnull。表示は「修正済み（座標）」。
- **地図キャッシュは自動蓄積方式:** 意図的な一括先読みUIは搭載しない。キャッシュ開放のみUIで提供。
- **地図初期化はアコーディオンopen時:** DOMサイズ0での初期化バグを防ぐため確定。今後変更しない。
- **iPhone動作確認:** 部会メンバーへのお披露目時に実機確認を行う。

## 6. 次に行うタスクの積み残し

- iPhone実機での方位センサー・カメラ・GPS動作確認（部会お披露目時）
- App B帳票への方位・GPS出力対応（要検討・AppBスレッドで実施）
- 試験運用後の現場フィードバック反映
- App Bとのフィールド定義の整合確認（jzip_spec.htmlで管理）

## 7. アプリ更新管理について

アプリのバージョン確認・更新は「更新」タブ（ヘッダーの3つ目のタブ）にある。「更新履歴」も同じく「更新」タブ内で、バージョンごとに開閉できるアコーディオン形式（デフォルトは閉じた状態）で確認できる。

本仕様書自体は、Phase 6.00でindex.htmlの「開発方針」タブから分離し、README.mdとして管理することにした。アプリ内に埋め込む必要のない開発者向け情報のため、リポジトリのREADMEとして独立させ、index.htmlの軽量化とヘルプタブの単純化（「アプリ化の手順」のみに）を図った。
