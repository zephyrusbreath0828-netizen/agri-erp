# Supabaseセットアップ手順書（アグリERP Supabase版）

## 1. 本書について

本書は、アグリERP Supabase版（農業法人向け在庫・受注・発注・出荷管理システム）を Supabase（PostgreSQL）＋静的Webアプリとして導入する手順を説明する。所要時間は約30分。専用サーバーは不要で、無料プランのSupabaseプロジェクトで動作する。

### 1.1 前提条件

- Supabase アカウント（無料プランで可）
- アプリの配置先: 以下のいずれか
  - SharePoint Online の Site Assets（社内配布）
  - 任意の静的ホスティング（GitHub Pages / Netlify / Vercel 等）
  - 社内ファイルサーバーや端末ローカル（https でなくても Supabase 接続は可能。ただし一部ブラウザ機能の制限あり）
- Webブラウザ（Edge / Chrome 最新版）

### 1.2 成果物一覧

| ファイル | 用途 |
|---|---|
| build/agri-erp-supabase.aspx | SharePoint Site Assets 配置用 |
| build/agri-erp-supabase.html | 静的ホスティング用（同一内容） |
| sql/01_create_tables.sql | テーブル・RLS・認証RPC・Realtime設定の作成 |
| sql/02_seed.sql | 初期データ投入（デモデータ一式） |
| src/ | ソース一式（差分改修版） |

## 2. Supabase プロジェクトの作成

1. https://supabase.com にアクセスし、アカウント登録 / サインインする。
2. 「New project」をクリックし、任意のプロジェクト名（例: agri-erp）・データベースパスワード・リージョン（ap-northeast-1 = 東京 推奨）を入力して作成する。
3. 作成完了後、ダッシュボードの「Project Settings → API」(または「API Keys」) を開き、次の2つを控える。
   - **Project URL**（例: https://xxxxxxxxxxxx.supabase.co）
   - **API Key**: Anon / public key（`eyJhbGciOi...` で始まるJWT）または Publishable Key（`sb_publishable_...` で始まる新形式）のいずれか。両者は同等に使える。

## 3. テーブル作成（sql/01_create_tables.sql）

1. ダッシュボード左メニュー「SQL Editor」を開く。
2. `sql/01_create_tables.sql` の内容を全て貼り付け、「Run」を実行する。
3. 「Success」と表示されることを確認する。実行内容:
   - 16テーブルの作成（users / suppliers / customers / items / orders / order_lines / purchase_orders / purchase_order_lines / receipts / receipt_lines / shipments / shipment_lines / stock_movements / number_sequences / documents / app_settings）
   - 認証用RPC関数（app_verify_login / app_set_password）
   - RLS有効化とポリシー設定
   - Realtime publication への全テーブル登録
4. 左メニュー「Table Editor」で 16 テーブルが表示されることを確認する。

## 4. 初期データ投入（sql/02_seed.sql）

1. 引き続き SQL Editor で `sql/02_seed.sql` の内容を実行する。
2. 実行内容（すべてデモ用初期データ。実データ投入前に消去可能）:
   - ユーザー 3件（admin / office / shipping・初期パスワード `Temp1234!`・初回ログイン時に変更必須）
   - 在庫マスタ 25件（商品15 / 梱包資材10）、顧客 5件、仕入先 4件
   - 受注 8件・発注 6件・入荷 5件・出荷 6件・入出庫履歴一式（生成日基準の過去30日分）
   - 会社情報（自社名・住所・インボイス番号）
3. 本番運用でデモデータを投入したくない場合は、02_seed.sql のユーザー3件のみ実行し、残りを削除して使うか、テーブルを空のまま初回アクセスする（初回アクセス時に自動でデモデータ生成される）。いずれの場合も、ユーザーマスタの内容を実データに差し替えてから運用開始すること。
4. 動作確認（任意）: SQL Editor で `select app_verify_login('admin','Temp1234!');` を実行し、`"ok": true` が返れば認証RPCは正常。

## 5. アプリの配置

### 5.1 SharePoint Site Assets に配置する場合

1. SharePoint サイトを開き、「サイト コンテンツ → Site Assets」を開く。
2. `build/agri-erp-supabase.aspx` をアップロードする。
3. アップロード後、ファイルをクリックしてURLを確認する（例: `https://xxx.sharepoint.com/sites/xxx/SiteAssets/agri-erp-supabase.aspx`）。
4. そのURLを従業員に共有する。

### 5.2 静的ホスティングに配置する場合

`build/agri-erp-supabase.html` を index.html としてアップロードする（GitHub Pages / Netlify 等）。

### 5.3 ローカルで試用する場合

`build/agri-erp-supabase.html` をダブルクリックで開く（file:// でも動作する）。ソース一式の `index.html` は開発用で、src/ フォルダと併せて配置すれば単独でも起動する。

## 6. 接続設定（ソース焼き込み・利用者の入力は不要）

接続設定（Project URL / API Key）は `src/00-supabase.js` 冒頭の `FIXED_URL` / `FIXED_KEY` に**アプリ内部で固定**する（ログイン画面の入力フォーム・`?sb_url=` URLパラメータは廃止済み）。

1. `src/00-supabase.js` の `FIXED_URL`（例: `https://xxxxxxxx.supabase.co`）と `FIXED_KEY`（Anon Key または Publishable Key）を記入する。
2. `python3 build/assemble.py` で再ビルドし、`build/agri-erp-supabase.html`（または .aspx）を配置する。
3. 利用者はログインIDとパスワードのみで利用できる。配布先PCでの初期設定は不要。

## 7. ログインと初期設定

1. 初期アカウント `admin`（パスワード `Temp1234!`）でログインする。
2. 初回ログイン時にパスワード変更が必須。強度基準（8文字以上・大文字/小文字/数字/記号）を満たすパスワードを設定する。
3. 「設定 → ユーザー管理」で実運用ユーザーを登録する（登録時の初期パスワードは `Temp1234!`。ユーザーの初回ログイン時に変更が必須になる）。
4. 「設定 → 自社情報」で自社名・住所・インボイス番号を確認・更新する（帳票に反映される）。
5. 最後の有効な管理者は無効化・ロール変更できないため、管理者は必ず2名以上で運用すること。

## 8. データ移行について

旧版（localStorage保存）のデータはブラウザ内にのみ存在する。移行する場合は旧画面の「設定 → データ管理 → データを書き出す（JSON）」で書き出したファイルを参照し、マスタ（在庫・顧客・仕入先・ユーザー）を本版に再登録するか、SQL Editor で INSERT 文を作成して投入する。トランザクションデータ（受注・発注など）は移行対象に含めず、本版の運用開始日以降を新規データとする運用を推奨する。

## 9. 運用・バックアップ

- データは Supabase 側に保存される。バックアップは Supabase ダッシュボード「Database → Backups」（有料プラン）または Table Editor / SQL による CSV エクスポートで取得する。
- 同時編集の競合は「後勝ち」で解決される。同一伝票を複数人で同時編集しない運用ルールを推奨する。
- 採番（ORD-…等）は number_sequences テーブルで管理される。同時採番で重複した場合はアプリがエラーを表示するため、再操作すれば次番で採番される。

## 10. トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| 「接続設定（FIXED_URL / FIXED_KEY）が未設定です」と表示される | `src/00-supabase.js` の FIXED_URL / FIXED_KEY が未記入。記入して `python3 build/assemble.py` で再ビルドする |
| 「Supabaseに接続できませんでした」 | 01_create_tables.sql 未実行、または Project URL 誤り。SQL Editor 実行状況を確認 |
| ログインできない（パスワードが一致しません） | 02_seed.sql 未実行でユーザー未登録の可能性。SQL Editor で users テーブルを確認 |
| 変更が他端末に反映されない | Realtime 未有効の可能性。Database → Publications で supabase_realtime に全テーブルが登録済みか確認（未登録の場合は本スクリプト再実行）。登録済みなら45秒以内のポーリングで反映される |
| 保存が失敗する（同期に失敗しました） | ネットワーク断または RLS/権限の問題。ブラウザ開発者ツールの Network で REST 応答コードを確認 |

## 11. セキュリティ上の注意

- Anon Key はブラウザから参照可能な公開情報。本版のRLSは「Anon Key所持者は全データ操作可」の緩和設定である。
- 本格運用では (1) Supabase Auth 導入によるユーザー単位認証、(2) ロール別RLS（管理者/事務/出荷）への強化、(3) Supabase ダッシュボードでの IP 制限（有料）を推奨する。
- パスワードは bcrypt（pgcrypto）で保存され、照合はサーバー側RPCで実行される。平文・ハッシュともにブラウザへは送信されない。
