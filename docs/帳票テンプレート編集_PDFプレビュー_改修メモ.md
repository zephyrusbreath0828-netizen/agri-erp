# 帳票テンプレート編集：PDFプレビュー改修メモ（ver 3.3）

## 目的
帳票テンプレート編集画面から、設定内容をそのまま反映した帳票プレビュー（PDF出力）を確認できるようにする。

## 画面構成（左右2カラム）
- 左：テンプレート設定／表示項目設定／レイアウト設定
- 右：帳票プレビュー（見積書・発注書・納品書・請求書・入庫伝票・出庫伝票のタブ切替、ズーム、PDF出力）

## 実装
| ファイル | 変更内容 |
|---|---|
| `src/08-tpl-editor.js`（新規） | `TplEditor`（2カラム編集画面・即時プレビュー・保存・PDF出力・ズーム） |
| `src/07-issuer.js` | `TPL_FIELDS`（10項目）／`TPL_LAYOUT_DEFAULTS`／`Issuer.tplNorm()`（旧テンプレート補完）／`headerHtml()` の拠点表示3モード対応／`Views.docTemplates` から編集画面へ分岐 |
| `src/05-print.js` | `Print.build(kind, opt)`（HTML生成のみ・履歴/採番なし）／`ctxOf(rec, opt)`／`exportPdf()`／透かし・用紙・フッターの制御 |
| `src/01-store.js` | テンプレートのレイアウト既定値をシード／`migrateIssuerMasters()` で既存テンプレートを補完／`nextNo()` をプレビュー中は採番しない |
| `src/00-supabase.js` | `doc_templates` 同期列に `branch1/branch2/branch_mode/paper/watermark/footer` |
| `index.html` | `.tpl-editor` `.tgl` `.seg` `.tpl-prev-*` `.issuer-branches.two-col` のCSS、読み込みタグ追加 |
| `sql/01_create_tables.sql` / `sql/07_add_template_layout.sql` | 新規列の定義と既存DB向けの冪等マイグレーション |

## 表示項目（10項目）
会社名／主拠点／副拠点／住所／TEL／FAX／メール／担当者／登録番号／ロゴ

- 主拠点・副拠点は「レイアウト設定」の拠点表示方法と組み合わせて制御（`main` では副拠点を描画しない）
- 会社名をOFFにした場合はフッターの会社名も出力しない

## 拠点表示
| 値 | 表示 |
|---|---|
| `main` | 主拠点のみ |
| `both` | 主拠点＋副拠点（縦積み・既定） |
| `two_col` | 主拠点・副拠点を2カラム（`.issuer-branches.two-col`） |

## PDF出力
`Print.exportPdf(html, { paper })` がプレビューと同一のHTMLを `#printRoot` へ出力し、`@page{size:A4[ landscape]}` を動的注入して `window.print()` を実行。ブラウザの「PDFに保存」でPDF化（既存帳票と同じ方式・追加ライブラリ不要）。

## 既存テンプレート移行
1. `sql/07_add_template_layout.sql` を実行（列追加＋NULL行の既定値埋め）
2. アプリ側は `migrateIssuerMasters()` と `Issuer.tplNorm()` の二重で補完するため、SQL未実行でも表示は崩れない
3. 既定値：表示項目すべてON／拠点=both／用紙=portrait／透かし=ON／フッター=ON

## 非破壊性
プレビューは `Print._pv`（プレビューモード）で `record()` を実行せず、`Store._dryRun` により採番もしない。サンプルデータはレンダリング後に必ず削除（`demoClean`）。

## 検証
`node scripts/tpl_preview_smoke.js`（画面構成・6帳票・即時反映・拠点3モード・用紙/透かし/フッター・PDF同一性・保存・移行・非破壊）
