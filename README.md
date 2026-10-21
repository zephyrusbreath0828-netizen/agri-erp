# アグリERP for Supabase（PostgreSQL 版）

農業法人向け業務システム（在庫・受注・発注・出荷 統合）の **Supabase 対応版**。
元版（単一HTML・localStorage保存）に**差分改修**を行い、データ保存を Supabase（PostgreSQL）へ移行しました。
UI・機能は元版から一切削除していません。

## 変更点（元版からの差分）

| 項目 | 元版 | 本版 |
|---|---|---|
| データ保存 | localStorage（端末内） | **Supabase（PostgreSQL）16テーブル** |
| localStorage | 使用 | **廃止**（セッション限定の一時情報のみ sessionStorage） |
| 複数ユーザー同時利用 | 不可（端末ごとに別データ） | **可（リアルタイム同期）** |
| 変更の反映方式 | — | 保存から0.8秒後に差分アップサート。他端末の変更は Realtime（WebSocket）で即時受信（supabase-js 未読込環境は45秒ポーリング） |
| 認証 | localStorage内のPBKDF2ハッシュ | **サーバー側照合**（Postgres RPC `app_verify_login` / pgcrypto bcrypt）。ハッシュはクライアントに送られない |
| 配置 | file:// でも動作 | **静的Webアプリ**（単一HTML/.aspx。SharePoint Site Assets にも配置可） |

保存対象テーブル: **ユーザー(users) / 在庫(items) / 顧客(customers) / 仕入先(suppliers) / 受注(orders+order_lines) / 発注(purchase_orders+purchase_order_lines) / 入荷(receipts+receipt_lines) / 出荷(shipments+shipment_lines) / 入出庫履歴(stock_movements) / 採番(number_sequences) / 帳票(documents) / 設定(app_settings) / 監査ログ(audit_logs)**

## 管理者パスワードリセット機能（追加）

ユーザー管理画面（管理者専用）に以下を追加しました:

- **表示項目**: 最終ログイン日時（`users.last_login_at`。ログイン照合RPC `app_verify_login` がサーバー側で記録）／パスワード変更要求フラグ（`force_password_change`、要求中はバッジ表示）。既存の表示項目（ユーザーID・氏名・ロール等）はすべて維持。
- **【パスワードリセット】ボタン**: 確認ダイアログ（「ユーザー：〇〇 ／ 仮パスワードを発行します。続行しますか？」[実行][キャンセル]）→ ランダムな仮パスワード（例: `Temp1234!` `AbCd5678!` 形式。大文字／小文字／数字／記号を必ず含む9文字）を生成し、**既存RPC `app_set_password`（`p_login_id` / `p_new` / `p_force_change: true`）** で設定。戻り値を確認し、失敗時はエラートースト表示。成功時はダイアログでログインID・仮パスワードを表示（**コピーボタン付き**）。次回ログイン時にパスワード変更が必須になります。
- **権限制御**: ユーザー管理画面自体が管理者専用（MENU定義 `roles: ['admin']`）＋アクション実行時にも管理者ロールを再チェック。一般ユーザーには表示されません。
- **操作ログ（監査ログ）**: リセット実行時に**実行者・対象ユーザー・実行日時・IPアドレス**（ベストエフォート取得。取得不可時は「—」）を記録。ユーザー管理画面下部の「操作ログ（監査ログ）」カードに直近20件を表示します。仮パスワード自体は記録しません。

### 既存環境への適用手順（差分適用）

1. Supabase SQL Editor で `sql/03_add_audit_logs.sql` を実行（**推奨・任意**。新規テーブルの追加のみで、既存テーブル定義・既存RPC・接続設定は一切変更しません。未実行でもアプリは動作し、その場合監査ログはその端末のセッション内のみ保持されます）
2. `build/agri-erp-supabase.html`（または .aspx）を再配置。接続設定（Project URL / Anon Key）は変更不要です。

## ディレクトリ構成

```
agri-erp-supabase/
├─ index.html                 開発用シェル（CDN + src/ を個別読み込み。このまま起動可）
├─ src/
│  ├─ 00-supabase.js          ★新規: Supabaseアダプタ（差分同期・Realtime・RPC認証）
│  ├─ 01-store.js             改修: load/save/reset（localStorage廃止 → SB同期）
│  ├─ 02-core.js              改修: ログイン/パスワード変更をサーバー照合に分岐・仮パスワード生成/監査ログ/コピー
│  ├─ 03-views-a.js           無変更
│  ├─ 04-views-b.js           改修: データ管理の説明文・ユーザー管理（最終ログイン/変更要求フラグ列・リセットボタン・操作ログ）
│  ├─ 05-print.js             無変更
│  └─ 06-app.js               改修: 非同期起動（Supabase接続→UI起動）・パスワードRPC・パスワードリセット（管理者専用）
├─ build/
│  ├─ agri-erp-supabase.html  ビルド済み単一ファイル（静的ホスティング用）
│  └─ agri-erp-supabase.aspx  ビルド済み単一ファイル（SharePoint Site Assets 配置用）
├─ sql/
│  ├─ 01_create_tables.sql    ★テーブル作成スクリプト（RLS・Realtime・認証RPC込み）
│  ├─ 02_seed.sql             ★初期データ投入スクリプト（デモデータ一式・自動生成）
│  ├─ 03_add_audit_logs.sql   ★追加: 監査ログテーブル（既存環境にはこのSQLのみ追加実行）
│  └─ 04_reset_initial_passwords.sql ★修復用: 初期ユーザーのパスワードを Temp1234! に再設定（データ更新のみ）
├─ scripts/
│  ├─ smoke_supabase.js       同期・認証のスモークテスト（PostgRESTモック）
│  └─ gen_seed.js             02_seed.sql の再生成スクリプト
└─ build/assemble.py          単一ファイル結合ビルド
```

## セットアップ（3ステップ）

1. **Supabase プロジェクト作成**（無料プランで可）
2. **SQL Editor で実行**: `sql/01_create_tables.sql` → 続けて `sql/02_seed.sql`
3. **接続設定を焼き込んで再ビルド**: `src/00-supabase.js` 冒頭の `FIXED_URL` / `FIXED_KEY` に
   本番の Project URL と API Key（Anon Key `eyJ...` ／ Publishable Key `sb_publishable_...` のどちらでも可。Settings → API Keys で確認）を記入し、`python3 build/assemble.py` で再ビルド
   → 利用者の入力は**ログインIDとパスワードのみ**。配布先PCでも初期設定は不要
   ※ 配置・動作確認には必ず **build/ 配下の単一ファイル**を使う。src/index.html は開発用（src/ を個別読み込み）。

初期アカウント（いずれも初回ログイン時にパスワード変更が必須）:

| ログインID | 氏名 | 権限 | 初期パスワード |
|---|---|---|---|
| `admin` | 山田 太郎 | 管理者 | `Temp1234!` |
| `office` | 佐藤 花子 | 事務担当 | `Temp1234!` |
| `shipping` | 鈴木 一郎 | 出荷担当 | `Temp1234!` |

02_seed.sql を実行しない場合、初回アクセス時に同等のデモデータが自動生成されます
（自動生成の場合も初期パスワードはサーバー側RPC `app_set_password` で bcrypt 化して設定するため、上表どおり `Temp1234!` でログインできます）。

### 初期パスワードでログインできない場合（トラブルシューティング）

旧版で初期化済みのDBでは、`users.password_hash` に画面表示と不一致のハッシュ（クライアント製PBKDF2形式など）が
保存されていることがあります。その場合は Supabase SQL Editor で **`sql/04_reset_initial_passwords.sql`** を一度実行してください。
admin / office / shipping のパスワードが `Temp1234!` に再設定されます（データ更新のみ・テーブル定義は変更しません）。

詳細手順は **Supabaseセットアップ手順書** を参照してください。

## 接続設定について（ソース焼き込み・入力フォーム廃止）

接続設定（Supabase Project URL / Anon Key）は `src/00-supabase.js` 冒頭の `FIXED_URL` / `FIXED_KEY` に
**アプリ内部に固定**してあります。ログイン画面のURL入力欄・API Key入力欄・「接続して保存」ボタン、
URLパラメータ（`?sb_url=&sb_key=`）・sessionStorage 保持は廃止済みです。利用者はログインIDとパスワードのみ入力します。

接続設定の変更手順:

1. `src/00-supabase.js` の `FIXED_URL`（例: `https://xxxxxxxx.supabase.co`）と `FIXED_KEY`（Anon Key）を書き換える
2. `python3 build/assemble.py` で再ビルド
3. `build/agri-erp-supabase.html`（または .aspx）を配置し直す — 配布先PCでの初期設定は不要

## セキュリティ上の注意

- Anon Key は公開情報です。本版のRLSはアプリ独自認証用の緩和設定（全行操作許可）です。
  本格運用では Supabase Auth への移行とロール別RLSの適用を推奨します（将来拡張提案書に記載）。
- パスワードは bcrypt でDB保存され、照合はサーバー側RPCで実行されます（平文・ハッシュともクライアント未送信）。
- 同時編集は「後勝ち（last-write-wins）」です。同一行の同時編集競合は運用で回避してください。

## 検証

```
node --check build/bundle.check.js     # 構文
node scripts/smoke_supabase.js         # 差分同期・認証・削除順序・pending保護のスモークテスト
```
