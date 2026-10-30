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

## 伝票の発行元（会社・拠点マスタ）対応 ver 3.0（追加）

複数のグループ会社・拠点で利用できるよう、単一の「自社情報」設定を廃止し、以下を追加しました。

- **会社マスタ（companies）**: 会社コード / 会社名 / 郵便番号 / 住所 / TEL / FAX / メール / 適格請求書登録番号 / ロゴURL / 備考 / 有効無効 / 表示可否。**複数登録可**
- **拠点マスタ（branches）**: 会社 1:N 拠点（会社IDは外部キー）。拠点コード / 拠点名 / 住所 / TEL / FAX / メール / 担当者名 / 有効無効 / 表示可否
- **伝票ヘッダーの発行元**: 受注・発注・入荷・出荷の各伝票に `company_id` / `branch1_id` / `branch2_id` を追加（すべて外部キー）。作成画面で「発行会社（必須）→発行拠点①→発行拠点②（任意）」をカスケード選択。**選択できるのは発行会社配下の拠点のみ**
- **帳票の表示**: 発行会社＋拠点①②を伝票上部に印字。拠点②未選択時は非表示、**空行・空白領域は出力しない**
- **表示項目の制御**: 住所 / TEL / FAX / メール / 登録番号 / 担当者 / ロゴ を会社・拠点ごとに表示可否設定
- **帳票テンプレート（doc_templates）**: 標準見積書 / 簡易見積書 / 標準発注書 / 簡易発注書 / 標準請求書 ほか全9種を初期投入。☑会社名 ☑拠点名 ☑住所 ☑TEL ☑FAX ☑登録番号 ☐メール ☑ロゴ をテンプレート単位で設定
- **帳票種別の拡張**: 見積書(QT)・請求書(IV)・発注書・納品書(DN)・出庫伝票(SL)・入庫伝票・ピッキングリスト(PL)
- **移行**: 既存の `app_settings.company` は会社マスタへ自動移行。既存伝票は旧データを保持し、帳票は既定会社で従来どおり印字（`sql/05_add_companies_branches.sql`）

画面は「システム → **会社・拠点マスタ**」「システム → **帳票テンプレート**」に追加。詳細は `docs/会社拠点マスタ_改修ガイド.md`。

### 既存環境への適用手順（ver 3.0）
1. Supabase SQL Editor で `sql/05_add_companies_branches.sql` を実行（冪等）
2. `build/agri-erp-supabase.html`（または .aspx）を再配置（接続設定は変更不要）
3. 会社・拠点マスタ／帳票テンプレートを確認

## ログイン機能の修正と緊急管理者ログイン（ver 3.1）

### 修正した不具合
`Cannot read properties of null (reading 'loginSecurity')` — Supabase 接続に失敗すると `boot()` が中断し
`Store.db` が null のまま残るため、ログイン押下時に `Store.db.loginSecurity` 参照で例外になっていました。

- `boot()` は接続失敗でも中断せず、**必ず `Store.load()` を実行**（接続不可時はオフラインモード）
- `Auth.doLogin()` は `Store.db` / `loginSecurity` / `SB.verifyLogin()` の戻り値を null 安全化し、例外を戻り値へ変換
- ログイン画面は `try/catch` で保護し、**クラッシュせずエラーメッセージを表示**
- 接続失敗時はオフラインモードの警告（ログイン画面）とバナー（アプリ内）を表示

### 緊急管理者ログイン（ブレークグラス）
| 項目 | 値 |
|---|---|
| ユーザーID | `tom` |
| パスワード | `zep` |
| 権限 | admin（管理者） |

- **通常ユーザー認証より先に判定**。Supabase 接続状態・`Store.db` の初期化状態に依存せずログイン可能
- ログイン後は常にダッシュボードへ遷移し、画面上部に「緊急管理者としてログイン中」バナーを表示
- `users` テーブル／Supabase のユーザー行には追加しない（既存データを汚さない）
- 監査ログ（`audit_logs` / 操作ログ）に `緊急管理者ログイン` として記録
- 設定画面「システム設定 → 緊急管理者ログイン」で **有効／無効** を切替（**既定 ON**、Supabase の `app_settings(key='emergency')` に保存）

> 注意: 本アプリは静的配布（単一HTML）のため認証情報はソースに含まれます。配布範囲の管理、
> または `src/02-core.js` の `EMERGENCY` 定義を貴社固有値へ変更してください。詳細は `docs/ログイン改修_変更箇所一覧.md`。

### 検証
```
node --check build/bundle.check.js      # 構文
npx eslint build/bundle.check.js        # ESLint（エラー0）
node scripts/smoke_supabase.js          # 同期・認証
node scripts/ui_smoke_issuer.js         # 会社・拠点・帳票
node scripts/login_smoke.js             # ログイン改修（33項目）
```

## 出荷検索（期間・得意先・営業担当者・出荷状態）ver 3.2

「出荷履歴」画面を **出荷検索** 画面へ拡張し、4つの検索条件を追加しました。

| 条件 | 内容 |
|---|---|
| 期間 | 出荷日の from〜to。クイック期間（本日／直近7日／今月／先月／全期間）付き。既定は今月 |
| 得意先 | 得意先マスタから選択（すべて可） |
| 営業担当者 | 得意先の既定担当／受注の担当から選択（すべて可） |
| 出荷状態 | すべて／出荷指示済／出荷確定／取消 |

- 条件は変更即時に再検索。条件チップから個別解除、`条件クリア`で既定へ戻せます
- 検索結果は 件数・数量・金額（税抜）を集計し、`CSV出力`で Excel 用に書き出せます
- 画面は 4列 → 2列 → 1列とレスポンシブに変化（モバイル対応）

### 追加したデータ項目（営業担当者）
- `customers.sales_rep_id`（既定の営業担当者）／`orders.sales_rep_id`（受注の担当者）。いずれも `users(id)` への外部キー
- 得意先マスタ・受注登録画面で担当者を選択可能（受注は得意先の既定担当を初期値に追従）
- 既存DBへは **`sql/06_add_sales_rep.sql`** を実行（冪等・データ更新のみ。既存得意先の担当者は受注の作成者から補完）
- デモ初期データに営業担当 `sales1`（田中 健二）/ `sales2`（中村 美咲）を追加（初期パスワード Temp1234!・初回変更必須）

### 検証
```
node scripts/shipsearch_smoke.js   # 出荷検索 25項目
```

## 帳票テンプレート編集：PDFプレビュー（2カラム）ver 3.3

帳票テンプレート編集画面を **左右2カラムのフル画面エディタ** に刷新しました。

| 位置 | 内容 |
|---|---|
| 左 | テンプレート設定／表示項目設定（10項目）／レイアウト設定 |
| 右 | 帳票プレビュー（見積書・発注書・納品書・請求書・入庫伝票・出庫伝票をタブで切替） |

- **変更は即時反映**（入力・チェック・レイアウト変更のたびに右側プレビューを再描画）
- 表示項目：☑会社名 ☑主拠点 ☑副拠点 ☑住所 ☑TEL ☑FAX ☑メール ☑担当者 ☑登録番号 ☑ロゴ
- 拠点表示：**主拠点のみ／主拠点＋副拠点／2カラム表示** を選択
- レイアウト：用紙（A4縦／A4横）・透かし文字・フッターの有無
- **PDF出力**：プレビューと同一HTMLを印刷（ブラウザの「PDFに保存」でPDF化。用紙の向きも一致）
- プレビューは帳票履歴・採番・伝票データを汚さない（印刷用データ生成のみ）。実データが無い環境ではサンプルを一時生成して表示
- 旧テンプレートは `Issuer.tplNorm()` と `sql/07_add_template_layout.sql` で自動移行（未設定項目は「表示・拠点は両方・A4縦」）
- 画面は 2カラム → 1カラム（1080px以下）に追従、モバイルではプレビューを横スクロール／全体フィット表示

### 追加した項目（doc_templates）
`branch1` `branch2`（主/副拠点の表示可否）／`branch_mode`（main|both|two_col）／`paper`（portrait|landscape）／`watermark`／`footer`

### 検証
```
node scripts/tpl_preview_smoke.js   # 帳票テンプレート編集（画面構成・6帳票・即時反映・拠点3モード・PDF・移行）
```

## マルチテナント（複数組織）対応 ver 3.4

1つの Supabase を複数組織で共用できるよう、**組織（テナント）** を最上位に追加しました。

- 階層：**組織 → 会社 → 拠点**（既存の会社・拠点マスタ／帳票テンプレートはそのまま）
- `organizations` テーブル（id / organization_code / organization_name / is_active）＋ 初期組織 `SETOLAS(1)` `A-FARM(2)` `B-FARM(3)`
- `users.organization_id`（必須・FK）と `users.is_system_admin`
- 業務テーブル19個へ `organization_id` を追加（customers / suppliers / items / stock_movements / orders / shipments / purchase_orders / receipts / documents ほか明細・採番・監査ログ）
- **フロント**：ログイン時に `Store.db` を自組織のみへスコープ。新規登録は `organization_id` を自動付与
- **DB**：全テーブルで RLS 有効＋`tenant_isolation` ポリシー、`app_login` のセッショントークン（`x-app-token`）で認可。越境書込は `with check` とトリガで拒否
- **既存データ**：`sql/08_multi_tenant.sql` 実行で全行を `SETOLAS(1)` へ自動移行
- **管理**：システム管理者のみ「組織マスタ」（追加・編集・停止）

### 適用
```
sql/08_multi_tenant.sql   -- Supabase SQL Editor で実行（冪等）
build/agri-erp-supabase.html を差し替え
```

### 検証
```
node scripts/tenant_smoke.js   # 組織隔離・自動付与・組織管理・移行・RLS定義
```
