# Supabase 接続方式の変更（環境変数化）— ver 3.6

## 変更前の問題
`src/00-supabase.js` に `FIXED_URL` / `FIXED_KEY` を直書きしていたため、
ZIP を再生成するたびに接続情報がプレースホルダへ戻り、設定が失われていた。

## 変更後
接続情報を**ソースコードに一切書かない**。実行時に次の優先順位で解決する（上から順に試し、失敗しても停止しない）。

| # | ソース | 設定方法 | 用途 |
|---|---|---|---|
| ① | `window.__AGRI_ENV__` | Vercel の環境変数（ビルド時に焼き込み） | 本番（推奨） |
| ② | `window.__AGRI_SUPABASE__` | 配信HTMLの前に1行追加 | 配信側での差し替え |
| ③ | `<meta name="agri-supabase-url" / "...-anon-key">` | `index.html` のメタタグ | HTML編集のみで設定 |
| ④ | `/api/config` | Vercel サーバーレス関数（`api/config.js`） | 静的配信＋実行時取得 |
| ⑤ | `supabase.config.json` | 静的ファイル（Git管理外） | 非Vercelの静的ホスティング |
| ⑥ | `sessionStorage agri_sb_cfg` | 設定画面の「暫定設定」 | 障害時の一時回避（タブを閉じると消える） |
| — | なし | — | **オフラインモード**で起動（データはセッション内のみ） |

## Vercel の環境変数
Project Settings → Environment Variables に登録する。

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

- ビルドコマンド `node build/assemble.js --dist` がビルド時に値を検出し、`window.__AGRI_ENV__` として HTML に焼き込む。
- 値が無い場合でもビルドは成功し、実行時に `/api/config`（Vercel 関数）から取得する。
- Anon Key は公開前提のキー。**Service Role Key は使用しない**（`api/config.js` も返さない）。

## 再生成時に接続情報が消えない理由
接続情報はソースにもリポジトリにも存在しないため、`assemble.py` / `assemble.js` を何度実行しても**消えるものが無い**。
Vercel ではデプロイのたびに環境変数から再注入される。ローカルで環境変数が無い場合も、配信先の `/api/config` 等から解決される。

## オフラインモード
接続情報が1つも無い、または Supabase へ接続できない場合は、従来どおり `Store.load({ offline: true })` でセッション内動作へフォールバックする。ログイン画面の警告バーに、必要な環境変数名を表示する。

## 設定画面
「システム設定 → Supabase 接続設定」で次を確認できる。

- 取得元（環境変数 / /api/config / meta / セッション など）
- プロジェクト（マスク表示）・接続方式・最終同期・直近エラー
- **接続テスト**（`/rest/v1/` への到達性）
- **接続情報を再取得**（再解決して再読み込み）
- **暫定設定**（システム管理者のみ・セッション内のみ）

## 変更ファイル

| ファイル | 区分 | 内容 |
|---|---|---|
| `src/00-supabase.js` | 改修 | `FIXED_URL` / `FIXED_KEY` を削除し、`discoverConfig()`（6段階解決）・`testConnection()`・`reloadConfig()`・`configInfo()` を追加。`init()` が解決結果を使用 |
| `index.html` | 改修 | 接続用メタタグ（空）と接続設定カードの CSS |
| `src/04-views-b.js` | 改修 | システム設定に「Supabase 接続設定」カード |
| `src/06-app.js` | 改修 | `testSupabaseConnection` / `reloadSupabaseConfig` / `tempSupabaseConfigForm` / `saveTempSupabaseConfig` / `clearTempSupabaseConfig` |
| `build/assemble.py` | 改修 | 環境変数の有無を検出して `window.__AGRI_ENV__` を焼き込み、`--dist` で `dist/index.html` を出力（無くても成功） |
| `build/assemble.js` | 新規 | Vercel 用の Node 版アセンブラ（Python 不要）。`assemble.py` と同一出力（`scripts/build_parity.js` で検証） |
| `api/config.js` | 新規 | Vercel サーバーレス関数。`NEXT_PUBLIC_SUPABASE_URL` / `..._ANON_KEY` を返す |
| `vercel.json` | 新規 | `build/assemble.js --dist` / `outputDirectory: dist` / `/api/config` の no-store |
| `.env.example` / `supabase.config.example.json` | 新規 | 設定例（実値は入れない） |
| `.gitignore` | 新規 | `.env*` / `dist/` / `supabase.config.json` を除外 |
| `scripts/build_parity.js` | 新規 | Python版とNode版の出力一致検証 |
| `scripts/env_smoke.js` | 新規 | 解決チェーン・オフラインfallback・再生成の同一性・Vercel設定の検証 |

## デプロイ手順（Vercel）
1. リポジトリ直下に `vercel.json` / `api/config.js` / `build/` / `src/` / `index.html` を配置
2. Vercel の Environment Variables に `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` を登録
3. デプロイ（Build: `node build/assemble.js --dist` / Output: `dist`）
4. サイト表示 → ログイン → システム設定で「取得元：/api/config（Vercel環境変数）」または「環境変数（ビルド時）」を確認

## ローカル確認
```
node scripts/env_smoke.js          # 解決チェーンとfallback
node scripts/build_parity.js       # 2つのアセンブラの出力一致
NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... node build/assemble.js --dist
```
