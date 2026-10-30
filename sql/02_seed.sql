-- ============================================================================
--  アグリERP（Supabase版） 初期データ投入スクリプト  生成日: 2026-10-30
--  生成元: アプリ内蔵デモシード buildSeed() と完全一致（scripts/gen_seed.js が自動生成）
--  実行順: 01_create_tables.sql 実行後に本ファイルを Supabase SQL Editor で実行
--  ※ 01_create_tables.sql のみ実行して本ファイルを実行しない場合、
--    アプリ初回アクセス時に同等のデモデータが自動生成されます。
--  初期ユーザー: admin / office / shipping（初期パスワード Temp1234!・初回ログイン時に変更必須）
-- ============================================================================

-- users（5件）
insert into users (id, login_id, name, email, tel, role, password_hash, force_password_change, enabled, last_login_at, created_at) values
  ('usr001', 'admin', '山田 太郎', 'admin@agri-erp.local', '090-1111-2222', 'admin', crypt('Temp1234!', gen_salt('bf', 10)), true, true, DEFAULT, '2026-10-30T02:13:17.308Z'),
  ('usr002', 'office', '佐藤 花子', 'office@agri-erp.local', '090-3333-4444', 'office', crypt('Temp1234!', gen_salt('bf', 10)), true, true, DEFAULT, '2026-10-30T02:13:17.308Z'),
  ('usr003', 'shipping', '鈴木 一郎', 'shipping@agri-erp.local', '090-5555-6666', 'shipping', crypt('Temp1234!', gen_salt('bf', 10)), true, true, DEFAULT, '2026-10-30T02:13:17.308Z'),
  ('usr004', 'sales1', '田中 健二', 'sales1@agri-erp.local', '090-7777-8888', 'office', crypt('Temp1234!', gen_salt('bf', 10)), true, true, DEFAULT, '2026-10-30T02:13:17.308Z'),
  ('usr005', 'sales2', '中村 美咲', 'sales2@agri-erp.local', '090-9999-0000', 'office', crypt('Temp1234!', gen_salt('bf', 10)), true, true, DEFAULT, '2026-10-30T02:13:17.308Z')
on conflict (id) do nothing;

-- companies（4件）
insert into companies (id, company_code, name, postal_code, address, tel, fax, email, invoice_number, logo_url, notes, is_active, visible_fields, created_at) values
  ('co001', 'C001', '株式会社 みどりファーム', '〒321-0000', '栃木県みどり市中央1-2-3', '0123-45-6789', '0123-45-6780', 'info@midori-farm.example', 'T1234567890123', '', '旧「自社情報」から移行した自社（グループ中核会社）', true, '[object Object]', '2026-10-30T02:13:17.308Z'),
  ('co002', 'C002', 'セトラスホールディングス株式会社', '〒760-0023', '香川県高松市寿町1-2-3 セトラスビル5F', '087-811-0000', '087-811-0001', 'info@settras-hd.example', 'T2234567890123', '', 'グループ統括会社', true, '[object Object]', '2026-10-30T02:13:17.308Z'),
  ('co003', 'C003', '○○農産株式会社', '〒761-0000', '香川県高松市○○町1-1', '087-000-0000', '087-000-0001', 'info@maru-nosan.example', 'T3234567890123', '', 'グループ会社（農産物の生産・出荷）', true, '[object Object]', '2026-10-30T02:13:17.308Z'),
  ('co004', 'C004', '○○ファーム株式会社', '〒771-0000', '徳島県名西郡神山町○○字○○1', '088-000-0000', '088-000-0001', 'info@maru-farm.example', 'T4234567890123', '', 'グループ会社（神山農場の運営）', true, '[object Object]', '2026-10-30T02:13:17.308Z')
on conflict (id) do nothing;

-- branches（6件）
insert into branches (id, company_id, branch_code, name, postal_code, address, tel, fax, email, manager_name, notes, is_active, visible_fields, created_at) values
  ('br001', 'co001', 'H001', '本社', '〒321-0000', '栃木県みどり市中央1-2-3', '0123-45-6789', '0123-45-6780', '', '山田 太郎', '本社・事務所', true, '[object Object]', '2026-10-30T02:13:17.308Z'),
  ('br002', 'co002', 'H001', '高松事業所', '〒761-0000', '香川県高松市○○町1-2-3', '087-000-0000', '087-000-0001', 'takamatsu@settras-hd.example', '佐々木 健', '営業・物流拠点', true, '[object Object]', '2026-10-30T02:13:17.308Z'),
  ('br003', 'co002', 'H002', '神山農場', '〒771-0000', '徳島県名西郡神山町○○字○○', '088-000-0000', '', 'kamiyama@settras-hd.example', '大西 誠', '生産拠点', true, '[object Object]', '2026-10-30T02:13:17.308Z'),
  ('br004', 'co003', 'N001', '本社', '〒761-0000', '香川県高松市○○町1-1', '087-000-0000', '', '', '高橋 修', '', true, '[object Object]', '2026-10-30T02:13:17.308Z'),
  ('br005', 'co003', 'N002', '綾川圃場', '〒761-0000', '香川県綾歌郡綾川町○○', '087-000-0002', '', '', '中村 恵', '選果場併設', true, '[object Object]', '2026-10-30T02:13:17.308Z'),
  ('br006', 'co004', 'F001', '神山農場', '〒771-0000', '徳島県名西郡神山町○○字○○1', '088-000-0000', '088-000-0001', '', '大西 誠', '本場（有機JAS）', true, '[object Object]', '2026-10-30T02:13:17.308Z')
on conflict (id) do nothing;

-- doc_templates（9件）
insert into doc_templates (id, template_code, name, doc_kind, company_id, company_name, branch_name, branch1, branch2, address, tel, fax, email, invoice_number, manager, logo, is_default, is_active, notes, branch_mode, paper, watermark, footer, created_at) values
  ('tpl001', 'Q-STD', '標準見積書', 'quote', NULL, true, true, true, true, true, true, true, false, true, false, true, true, true, '会社名・拠点・住所・TEL/FAX・登録番号・ロゴを表示', 'both', 'portrait', true, true, '2026-10-30T02:13:17.308Z'),
  ('tpl002', 'Q-SMP', '簡易見積書', 'quote', NULL, true, true, true, true, false, false, false, false, false, false, false, false, true, '会社名と拠点名のみ（社内確認用）', 'both', 'portrait', true, true, '2026-10-30T02:13:17.308Z'),
  ('tpl003', 'P-STD', '標準発注書', 'purchase_order', NULL, true, true, true, true, true, true, true, false, true, false, true, true, true, '仕入先へ送付する標準発注書', 'both', 'portrait', true, true, '2026-10-30T02:13:17.308Z'),
  ('tpl004', 'P-SMP', '簡易発注書', 'purchase_order', NULL, true, true, true, true, false, true, false, false, false, false, false, false, true, '電話・FAX番号のみ表示', 'both', 'portrait', true, true, '2026-10-30T02:13:17.308Z'),
  ('tpl005', 'D-STD', '標準納品書', 'delivery_note', NULL, true, true, true, true, true, true, false, false, true, false, true, true, true, '納品書の標準レイアウト', 'both', 'portrait', true, true, '2026-10-30T02:13:17.308Z'),
  ('tpl006', 'I-STD', '標準請求書', 'invoice', NULL, true, true, true, true, true, true, true, false, true, false, true, true, true, '適格請求書（インボイス）対応', 'both', 'portrait', true, true, '2026-10-30T02:13:17.308Z'),
  ('tpl007', 'R-STD', '標準入庫伝票', 'receipt_note', NULL, true, true, true, true, true, true, false, false, false, false, false, true, true, '入荷（入庫）伝票', 'both', 'portrait', true, true, '2026-10-30T02:13:17.308Z'),
  ('tpl008', 'S-STD', '標準出庫伝票', 'shipping_slip', NULL, true, true, true, true, true, true, false, false, false, false, false, true, true, '出荷（出庫）伝票', 'both', 'portrait', true, true, '2026-10-30T02:13:17.308Z'),
  ('tpl009', 'K-STD', '標準ピッキングリスト', 'picking_list', NULL, true, true, true, true, false, false, false, false, false, false, false, true, true, '倉庫作業用（会社名・拠点名のみ）', 'both', 'portrait', true, true, '2026-10-30T02:13:17.308Z')
on conflict (id) do nothing;

-- suppliers（4件）
insert into suppliers (id, code, name, kana, tel, address, closing_day, payment_terms, lead_time, email, contact, active, notes, created_at) values
  ('sup001', 'S001', 'JAみどり資材センター', 'ジェイエイミドリシザイセンター', '0123-45-6789', '〒321-1000 栃木県みどり市資材町1-1', 31, '翌月末', 3, '', '', true, '', DEFAULT),
  ('sup002', 'S002', '北関東包装資材株式会社', 'キタカントウホウソウシザイ', '028-555-1234', '〒320-0800 栃木県宇都宮市包装1-5', 31, '翌月末', 5, '', '', true, '', DEFAULT),
  ('sup003', 'S003', '株式会社みらい種苗', 'ミライシュビョウ', '03-1234-5678', '〒101-0000 東京都千代田区種苗1-1', 31, '翌々月末', 7, '', '', true, '', DEFAULT),
  ('sup004', 'S004', 'みどり市農協 出荷部会', 'ミドリシ ノウキョウ シュッカブカイ', '0123-45-9999', '〒321-0005 栃木県みどり市農協前1', 31, '翌月末', 2, '', '', true, '', DEFAULT)
on conflict (id) do nothing;

-- customers（5件）
insert into customers (id, code, name, kana, tel, address, closing_day, payment_terms, email, contact, sales_rep_id, active, notes, created_at) values
  ('cus001', 'C001', 'JAみどり 農産物直売所', 'ジェイエイミドリ ノウサンブツチョクバイショ', '0123-45-1111', '〒321-0000 栃木県みどり市中央1-2-3', 31, '翌月末', '', '', 'usr002', true, '', DEFAULT),
  ('cus002', 'C002', 'スーパーマルヨシ 本店', 'スーパーマルヨシ ホンテン', '0123-45-2222', '〒321-0001 栃木県みどり市駅前4-5-6', 20, '翌月末', '', '', 'usr004', true, '', DEFAULT),
  ('cus003', 'C003', 'みどり市学校給食センター', 'ミドリシ ガッコウキュウショクセンター', '0123-45-3333', '〒321-0002 栃木県みどり市学園台7-8', 31, '翌月末', '', '', 'usr005', true, '', DEFAULT),
  ('cus004', 'C004', '道の駅 みどりの里', 'ミチノエキ ミドリノサト', '0123-45-4444', '〒321-0003 栃木県みどり市山手9-10', 31, '翌月末', '', '', 'usr002', true, '', DEFAULT),
  ('cus005', 'C005', 'レストラン ファームキッチン', 'レストラン ファームキッチン', '0123-45-5555', '〒321-0004 栃木県みどり市大通り2-1', 15, '翌月末', '', '', 'usr004', true, '', DEFAULT)
on conflict (id) do nothing;

-- items（25件）
insert into items (id, kind, code, name, kana, category, unit, spec, sale_price, cost_price, tax_rate, reorder_point, reorder_qty, safety_stock, stock, location, jan_code, barcode, supplier_id, active, notes, created_at) values
  ('itm001', 'product', 'P001', 'トマト', 'トマト', '果菜類', 'ケース', '10kg/ケース', 3800, 2400, DEFAULT, 30, 50, 15, 182, 'A-01', '49100000000', 'AGP001', 'sup004', true, '', DEFAULT),
  ('itm002', 'product', 'P002', 'ミニトマト', 'ミニトマト', '果菜類', 'ケース', '5kg/ケース', 4200, 2700, DEFAULT, 20, 40, 10, 18, 'A-02', '49100000137', 'AGP002', 'sup004', true, '', DEFAULT),
  ('itm003', 'product', 'P003', 'きゅうり', 'キュウリ', '果菜類', 'ケース', '5kg/ケース', 2600, 1600, DEFAULT, 25, 50, 10, 72, 'A-03', '49100000274', 'AGP003', 'sup004', true, '', DEFAULT),
  ('itm004', 'product', 'P004', 'なす', 'ナス', '果菜類', 'ケース', '5kg/ケース', 2400, 1500, DEFAULT, 20, 40, 10, 83, 'A-04', '49100000411', 'AGP004', 'sup004', true, '', DEFAULT),
  ('itm005', 'product', 'P005', 'ピーマン', 'ピーマン', '果菜類', 'ケース', '3kg/ケース', 2200, 1300, DEFAULT, 15, 30, 8, 9, 'A-05', '49100000548', 'AGP005', 'sup004', true, '', DEFAULT),
  ('itm006', 'product', 'P006', 'キャベツ', 'キャベツ', '葉菜類', 'ケース', '10kg/ケース', 1800, 1000, DEFAULT, 40, 80, 20, 156, 'B-01', '49100000685', 'AGP006', 'sup004', true, '', DEFAULT),
  ('itm007', 'product', 'P007', 'レタス', 'レタス', '葉菜類', 'ケース', '8kg/ケース', 2100, 1200, DEFAULT, 30, 60, 15, 64, 'B-02', '49100000822', 'AGP007', 'sup004', true, '', DEFAULT),
  ('itm008', 'product', 'P008', 'ほうれん草', 'ホウレンソウ', '葉菜類', 'ケース', '5kg/ケース', 2800, 1700, DEFAULT, 20, 40, 10, 8, 'B-03', '49100000959', 'AGP008', 'sup004', true, '', DEFAULT),
  ('itm009', 'product', 'P009', 'だいこん', 'ダイコン', '根菜類', 'ケース', '10kg/ケース', 1600, 900, DEFAULT, 35, 70, 20, 101, 'C-01', '49100001096', 'AGP009', 'sup004', true, '', DEFAULT),
  ('itm010', 'product', 'P010', 'にんじん', 'ニンジン', '根菜類', 'ケース', '10kg/ケース', 1900, 1100, DEFAULT, 30, 60, 15, 27, 'C-02', '49100001233', 'AGP010', 'sup004', true, '', DEFAULT),
  ('itm011', 'product', 'P011', 'たまねぎ', 'タマネギ', '根菜類', 'ケース', '10kg/ケース', 1700, 950, DEFAULT, 40, 80, 20, 173, 'C-03', '49100001370', 'AGP011', 'sup004', true, '', DEFAULT),
  ('itm012', 'product', 'P012', 'じゃがいも', 'ジャガイモ', '根菜類', 'ケース', '10kg/ケース', 1750, 980, DEFAULT, 40, 80, 20, -21, 'C-04', '49100001507', 'AGP012', 'sup004', true, '', DEFAULT),
  ('itm013', 'product', 'P013', 'ねぎ', 'ネギ', '葉菜類', 'ケース', '5kg/ケース', 2300, 1400, DEFAULT, 20, 40, 10, 66, 'B-04', '49100001644', 'AGP013', 'sup004', true, '', DEFAULT),
  ('itm014', 'product', 'P014', 'ブロッコリー', 'ブロッコリー', '花菜類', 'ケース', '5kg/ケース', 2900, 1800, DEFAULT, 15, 30, 8, -6, 'B-05', '49100001781', 'AGP014', 'sup004', true, '', DEFAULT),
  ('itm015', 'product', 'P015', 'いちご', 'イチゴ', '果実類', 'パック', '300g/パック', 780, 480, DEFAULT, 50, 100, 25, 130, 'D-01', '49100001918', 'AGP015', 'sup004', true, '', DEFAULT),
  ('itm016', 'material', 'M001', '段ボール箱 10kg', 'ダンボールバコ', '梱包資材', '枚', '10kg用', 95, 62, DEFAULT, 500, 1000, 200, 1720, 'E-01', '49100002055', 'AGM001', 'sup002', true, '', DEFAULT),
  ('itm017', 'material', 'M002', '段ボール箱 5kg', 'ダンボールバコ', '梱包資材', '枚', '5kg用', 78, 50, DEFAULT, 500, 1000, 200, 1210, 'E-02', '49100002192', 'AGM002', 'sup002', true, '', DEFAULT),
  ('itm018', 'material', 'M003', '発泡スチロール箱', 'ハッポウスチロールバコ', '梱包資材', '個', '20L', 320, 210, DEFAULT, 100, 200, 40, 208, 'E-03', '49100002329', 'AGM003', 'sup002', true, '', DEFAULT),
  ('itm019', 'material', 'M004', 'プラスチックコンテナ', 'プラスチックコンテナ', '梱包資材', '個', '40L', 1250, 900, DEFAULT, 50, 100, 20, 124, 'E-04', '49100002466', 'AGM004', 'sup002', true, '', DEFAULT),
  ('itm020', 'material', 'M005', '結束バンド', 'ケッソクバンド', '梱包資材', '本', '200mm', 3, 1.5, DEFAULT, 2000, 5000, 800, 4450, 'E-05', '49100002603', 'AGM005', 'sup002', true, '', DEFAULT),
  ('itm021', 'material', 'M006', 'ラップフィルム', 'ラップフィルム', '梱包資材', '巻', '30cm×300m', 480, 320, DEFAULT, 60, 120, 25, 31, 'E-06', '49100002740', 'AGM006', 'sup002', true, '', DEFAULT),
  ('itm022', 'material', 'M007', '梱包テープ', 'コンポウテープ', '梱包資材', '巻', '50mm×50m', 210, 140, DEFAULT, 100, 200, 40, 76, 'E-07', '49100002877', 'AGM007', 'sup002', true, '', DEFAULT),
  ('itm023', 'material', 'M008', '緩衝材', 'カンショウザイ', '梱包資材', '袋', 'エアクッション', 45, 28, DEFAULT, 800, 1600, 300, 920, 'E-08', '49100003014', 'AGM008', 'sup002', true, '', DEFAULT),
  ('itm024', 'material', 'M009', '保冷剤', 'ホレイザイ', '梱包資材', '個', '400g', 65, 40, DEFAULT, 300, 600, 100, 155, 'E-09', '49100003151', 'AGM009', 'sup002', true, '', DEFAULT),
  ('itm025', 'material', 'M010', 'ラベルシール', 'ラベルシール', '梱包資材', '枚', '50×30mm', 5, 2.5, DEFAULT, 3000, 6000, 1000, 8800, 'E-10', '49100003288', 'AGM010', 'sup002', true, '', DEFAULT)
on conflict (id) do nothing;

-- orders（8件）
insert into orders (id, order_no, customer_id, customer_name, order_date, due_date, ship_date, status, subtotal, tax_amount, total_amount, remarks, company_id, branch1_id, branch2_id, sales_rep_id, created_by, created_at) values
  ('ord001', 'ORD-20261025-0001', 'cus002', 'スーパーマルヨシ 本店', '2026-10-25', '2026-10-29', '2026-10-29', 'received', 136000, 10880, 146880, '', DEFAULT, DEFAULT, DEFAULT, 'usr004', 'usr002', '2026-10-30T02:13:17.310Z'),
  ('ord002', 'ORD-20261026-0002', 'cus001', 'JAみどり 農産物直売所', '2026-10-26', '2026-10-30', '2026-10-30', 'received', 162500, 13000, 175500, '', DEFAULT, DEFAULT, DEFAULT, 'usr002', 'usr002', '2026-10-30T02:13:17.310Z'),
  ('ord003', 'ORD-20261027-0003', 'cus003', 'みどり市学校給食センター', '2026-10-27', '2026-10-31', '2026-10-31', 'received', 132500, 10600, 143100, '', DEFAULT, DEFAULT, DEFAULT, 'usr005', 'usr002', '2026-10-30T02:13:17.310Z'),
  ('ord004', 'ORD-20261028-0004', 'cus005', 'レストラン ファームキッチン', '2026-10-28', '2026-11-01', '2026-11-01', 'received', 94800, 7584, 102384, '', DEFAULT, DEFAULT, DEFAULT, 'usr004', 'usr002', '2026-10-30T02:13:17.310Z'),
  ('ord005', 'ORD-20261029-0005', 'cus004', '道の駅 みどりの里', '2026-10-29', '2026-11-02', '2026-11-02', 'received', 160800, 12864, 173664, '', DEFAULT, DEFAULT, DEFAULT, 'usr002', 'usr002', '2026-10-30T02:13:17.310Z'),
  ('ord006', 'ORD-20261022-0006', 'cus002', 'スーパーマルヨシ 本店', '2026-10-22', '2026-10-27', '2026-10-27', 'shipped', 96050, 7684, 103734, '', DEFAULT, DEFAULT, DEFAULT, 'usr004', 'usr002', '2026-10-30T02:13:17.310Z'),
  ('ord007', 'ORD-20261023-0007', 'cus001', 'JAみどり 農産物直売所', '2026-10-23', '2026-10-28', '2026-10-28', 'shipped', 86000, 6880, 92880, '', DEFAULT, DEFAULT, DEFAULT, 'usr002', 'usr002', '2026-10-30T02:13:17.310Z'),
  ('ord008', 'ORD-20261024-0008', 'cus003', 'みどり市学校給食センター', '2026-10-24', '2026-11-04', '2026-11-04', 'partial', 72000, 5760, 77760, '', DEFAULT, DEFAULT, DEFAULT, 'usr005', 'usr002', '2026-10-30T02:13:17.310Z')
on conflict (id) do nothing;

-- order_lines（20件）
insert into order_lines (id, order_id, line_no, item_id, item_name, unit, quantity, unit_price, tax_rate, amount, shipped_qty, due_date, notes) values
  ('ord001l1', 'ord001', 1, 'itm001', 'トマト', 'ケース', 20, 3800, 8, 76000, 0, '2026-10-29', ''),
  ('ord001l2', 'ord001', 2, 'itm003', 'きゅうり', 'ケース', 15, 2600, 8, 39000, 0, '2026-10-29', ''),
  ('ord001l3', 'ord001', 3, 'itm007', 'レタス', 'ケース', 10, 2100, 8, 21000, 0, '2026-10-29', ''),
  ('ord002l1', 'ord002', 1, 'itm006', 'キャベツ', 'ケース', 40, 1800, 8, 72000, 0, '2026-10-30', ''),
  ('ord002l2', 'ord002', 2, 'itm009', 'だいこん', 'ケース', 30, 1600, 8, 48000, 0, '2026-10-30', ''),
  ('ord002l3', 'ord002', 3, 'itm011', 'たまねぎ', 'ケース', 25, 1700, 8, 42500, 0, '2026-10-30', ''),
  ('ord003l1', 'ord003', 1, 'itm004', 'なす', 'ケース', 25, 2400, 8, 60000, 0, '2026-10-31', ''),
  ('ord003l2', 'ord003', 2, 'itm010', 'にんじん', 'ケース', 20, 1900, 8, 38000, 0, '2026-10-31', ''),
  ('ord003l3', 'ord003', 3, 'itm013', 'ねぎ', 'ケース', 15, 2300, 8, 34500, 0, '2026-10-31', ''),
  ('ord004l1', 'ord004', 1, 'itm002', 'ミニトマト', 'ケース', 12, 4200, 8, 50400, 0, '2026-11-01', ''),
  ('ord004l2', 'ord004', 2, 'itm005', 'ピーマン', 'ケース', 10, 2200, 8, 22000, 0, '2026-11-01', ''),
  ('ord004l3', 'ord004', 3, 'itm008', 'ほうれん草', 'ケース', 8, 2800, 8, 22400, 0, '2026-11-01', ''),
  ('ord005l1', 'ord005', 1, 'itm001', 'トマト', 'ケース', 30, 3800, 8, 114000, 0, '2026-11-02', ''),
  ('ord005l2', 'ord005', 2, 'itm015', 'いちご', 'パック', 60, 780, 8, 46800, 0, '2026-11-02', ''),
  ('ord006l1', 'ord006', 1, 'itm012', 'じゃがいも', 'ケース', 35, 1750, 8, 61250, 0, '2026-10-27', ''),
  ('ord006l2', 'ord006', 2, 'itm014', 'ブロッコリー', 'ケース', 12, 2900, 8, 34800, 0, '2026-10-27', ''),
  ('ord007l1', 'ord007', 1, 'itm006', 'キャベツ', 'ケース', 30, 1800, 8, 54000, 0, '2026-10-28', ''),
  ('ord007l2', 'ord007', 2, 'itm009', 'だいこん', 'ケース', 20, 1600, 8, 32000, 0, '2026-10-28', ''),
  ('ord008l1', 'ord008', 1, 'itm003', 'きゅうり', 'ケース', 18, 2600, 8, 46800, 0, '2026-11-04', ''),
  ('ord008l2', 'ord008', 2, 'itm007', 'レタス', 'ケース', 12, 2100, 8, 25200, 0, '2026-11-04', '')
on conflict (id) do nothing;

-- purchase_orders（6件）
insert into purchase_orders (id, po_no, supplier_id, supplier_name, order_date, expected_date, status, subtotal, tax_amount, total_amount, remarks, company_id, branch1_id, branch2_id, created_by, created_at) values
  ('po001', 'PO-20261026-0001', 'sup002', '北関東包装資材株式会社', '2026-10-26', '2026-10-28', 'ordered', 102000, 8160, 110160, '', DEFAULT, DEFAULT, DEFAULT, 'usr002', '2026-10-30T02:13:17.311Z'),
  ('po002', 'PO-20261028-0002', 'sup002', '北関東包装資材株式会社', '2026-10-28', '2026-10-30', 'ordered', 32500, 2600, 35100, '', DEFAULT, DEFAULT, DEFAULT, 'usr002', '2026-10-30T02:13:17.311Z'),
  ('po003', 'PO-20261029-0003', 'sup004', 'みどり市農協 出荷部会', '2026-10-29', '2026-10-31', 'ordered', 368000, 29440, 397440, '', DEFAULT, DEFAULT, DEFAULT, 'usr002', '2026-10-30T02:13:17.311Z'),
  ('po004', 'PO-20261027-0004', 'sup002', '北関東包装資材株式会社', '2026-10-27', '2026-11-01', 'ordered', 37000, 2960, 39960, '', DEFAULT, DEFAULT, DEFAULT, 'usr002', '2026-10-30T02:13:17.311Z'),
  ('po005', 'PO-20261020-0005', 'sup004', 'みどり市農協 出荷部会', '2026-10-20', '2026-10-25', 'received', 142500, 11400, 153900, '', DEFAULT, DEFAULT, DEFAULT, 'usr002', '2026-10-30T02:13:17.311Z'),
  ('po006', 'PO-20261022-0006', 'sup002', '北関東包装資材株式会社', '2026-10-22', '2026-10-26', 'received', 12500, 1000, 13500, '', DEFAULT, DEFAULT, DEFAULT, 'usr002', '2026-10-30T02:13:17.311Z')
on conflict (id) do nothing;

-- purchase_order_lines（10件）
insert into purchase_order_lines (id, po_id, line_no, item_id, item_name, unit, quantity, unit_price, tax_rate, amount, received_qty, expected_date, notes) values
  ('po001l1', 'po001', 1, 'itm016', '段ボール箱 10kg', '枚', 1000, 62, 8, 62000, 0, '2026-10-28', ''),
  ('po001l2', 'po001', 2, 'itm017', '段ボール箱 5kg', '枚', 800, 50, 8, 40000, 0, '2026-10-28', ''),
  ('po002l1', 'po002', 1, 'itm020', '結束バンド', '本', 3000, 1.5, 8, 4500, 0, '2026-10-30', ''),
  ('po002l2', 'po002', 2, 'itm022', '梱包テープ', '巻', 200, 140, 8, 28000, 0, '2026-10-30', ''),
  ('po003l1', 'po003', 1, 'itm001', 'トマト', 'ケース', 100, 2400, 8, 240000, 0, '2026-10-31', ''),
  ('po003l2', 'po003', 2, 'itm003', 'きゅうり', 'ケース', 80, 1600, 8, 128000, 0, '2026-10-31', ''),
  ('po004l1', 'po004', 1, 'itm018', '発泡スチロール箱', '個', 100, 210, 8, 21000, 0, '2026-11-01', ''),
  ('po004l2', 'po004', 2, 'itm024', '保冷剤', '個', 400, 40, 8, 16000, 0, '2026-11-01', ''),
  ('po005l1', 'po005', 1, 'itm011', 'たまねぎ', 'ケース', 150, 950, 8, 142500, 0, '2026-10-25', ''),
  ('po006l1', 'po006', 1, 'itm025', 'ラベルシール', '枚', 5000, 2.5, 8, 12500, 0, '2026-10-26', '')
on conflict (id) do nothing;

-- receipts（5件）
insert into receipts (id, receipt_no, po_id, supplier_id, supplier_name, receipt_date, status, subtotal, tax_amount, total_amount, remarks, received_by, created_at) values
  ('rcv001', 'RC-20261018-0001', NULL, 'sup004', 'みどり市農協 出荷部会', '2026-10-18', 'confirmed', 408000, 32640, 440640, '', 'usr002', '2026-10-30T02:13:17.309Z'),
  ('rcv002', 'RC-20261021-0002', NULL, 'sup002', '北関東包装資材株式会社', '2026-10-21', 'confirmed', 156000, 12480, 168480, '', 'usr002', '2026-10-30T02:13:17.309Z'),
  ('rcv003', 'RC-20261024-0003', NULL, 'sup004', 'みどり市農協 出荷部会', '2026-10-24', 'confirmed', 233000, 18640, 251640, '', 'usr002', '2026-10-30T02:13:17.309Z'),
  ('rcv004', 'RC-20261027-0004', NULL, 'sup002', '北関東包装資材株式会社', '2026-10-27', 'confirmed', 42200, 3376, 45576, '', 'usr002', '2026-10-30T02:13:17.309Z'),
  ('rcv005', 'RC-20261029-0005', NULL, 'sup004', 'みどり市農協 出荷部会', '2026-10-29', 'confirmed', 234000, 18720, 252720, '', 'usr002', '2026-10-30T02:13:17.309Z')
on conflict (id) do nothing;

-- receipt_lines（15件）
insert into receipt_lines (id, receipt_id, po_line_id, item_id, item_name, quantity, unit_cost, amount, lot_no, expiry, notes) values
  ('xpu4mbmdr8g3h', 'rcv001', NULL, 'itm001', 'トマト', 80, 2400, 192000, '', '', DEFAULT),
  ('xzm8s77hd8g3h', 'rcv001', NULL, 'itm003', 'きゅうり', 60, 1600, 96000, '', '', DEFAULT),
  ('xtyjzh9of8g3h', 'rcv001', NULL, 'itm006', 'キャベツ', 120, 1000, 120000, '', '', DEFAULT),
  ('x1mxbc44z8g3h', 'rcv002', NULL, 'itm016', '段ボール箱 10kg', 1000, 62, 62000, '', '', DEFAULT),
  ('x5b3o3bvs8g3h', 'rcv002', NULL, 'itm017', '段ボール箱 5kg', 800, 50, 40000, '', '', DEFAULT),
  ('x1i2svj0c8g3h', 'rcv002', NULL, 'itm019', 'プラスチックコンテナ', 60, 900, 54000, '', '', DEFAULT),
  ('x945pln6w8g3h', 'rcv003', NULL, 'itm004', 'なす', 50, 1500, 75000, '', '', DEFAULT),
  ('xdenkfobq8g3h', 'rcv003', NULL, 'itm011', 'たまねぎ', 100, 950, 95000, '', '', DEFAULT),
  ('x12khsogp8g3h', 'rcv003', NULL, 'itm009', 'だいこん', 70, 900, 63000, '', '', DEFAULT),
  ('xcgkus49l8g3h', 'rcv004', NULL, 'itm018', '発泡スチロール箱', 120, 210, 25200, '', '', DEFAULT),
  ('x3j7b1yx28g3h', 'rcv004', NULL, 'itm020', '結束バンド', 3000, 1.5, 4500, '', '', DEFAULT),
  ('xy3qkrct98g3h', 'rcv004', NULL, 'itm025', 'ラベルシール', 5000, 2.5, 12500, '', '', DEFAULT),
  ('x36bfukjp8g3h', 'rcv005', NULL, 'itm001', 'トマト', 60, 2400, 144000, '', '', DEFAULT),
  ('xlp6qp0oz8g3h', 'rcv005', NULL, 'itm007', 'レタス', 40, 1200, 48000, '', '', DEFAULT),
  ('x84xjxfcs8g3h', 'rcv005', NULL, 'itm013', 'ねぎ', 30, 1400, 42000, '', '', DEFAULT)
on conflict (id) do nothing;

-- shipments（6件）
insert into shipments (id, shipment_no, order_id, order_no, customer_id, customer_name, ship_date, status, carrier, tracking_no, ship_to_name, ship_to_addr, remarks, confirmed_at, created_by, created_at) values
  ('shp001', 'SH-20261027-0001', 'ord006', 'ORD-20261022-0006', 'cus002', 'スーパーマルヨシ 本店', '2026-10-27', 'confirmed', 'ヤマト運輸', 'TRK100037', 'スーパーマルヨシ 本店', '〒321-0001 栃木県みどり市駅前4-5-6', '', '2026-10-27T02:13:17.310Z', 'usr003', '2026-10-30T02:13:17.310Z'),
  ('shp002', 'SH-20261028-0002', 'ord007', 'ORD-20261023-0007', 'cus001', 'JAみどり 農産物直売所', '2026-10-28', 'confirmed', '佐川急便', 'TRK100074', 'JAみどり 農産物直売所', '〒321-0000 栃木県みどり市中央1-2-3', '', '2026-10-28T02:13:17.310Z', 'usr003', '2026-10-30T02:13:17.310Z'),
  ('shp003', 'SH-20261030-0003', 'ord008', 'ORD-20261024-0008', 'cus003', 'みどり市学校給食センター', '2026-10-30', 'instructed', 'ヤマト運輸', '', 'みどり市学校給食センター', '〒321-0002 栃木県みどり市学園台7-8', '', NULL, 'usr003', '2026-10-30T02:13:17.310Z'),
  ('shp004', 'SH-20261030-0004', 'ord002', 'ORD-20261026-0002', 'cus001', 'JAみどり 農産物直売所', '2026-10-30', 'instructed', '自社配送', '', 'JAみどり 農産物直売所', '〒321-0000 栃木県みどり市中央1-2-3', '', NULL, 'usr003', '2026-10-30T02:13:17.310Z'),
  ('shp005', 'SH-20261031-0005', 'ord003', 'ORD-20261027-0003', 'cus003', 'みどり市学校給食センター', '2026-10-31', 'instructed', '佐川急便', '', 'みどり市学校給食センター', '〒321-0002 栃木県みどり市学園台7-8', '', NULL, 'usr003', '2026-10-30T02:13:17.310Z'),
  ('shp006', 'SH-20261101-0006', 'ord004', 'ORD-20261028-0004', 'cus005', 'レストラン ファームキッチン', '2026-11-01', 'instructed', 'ヤマト運輸', '', 'レストラン ファームキッチン', '〒321-0004 栃木県みどり市大通り2-1', '', NULL, 'usr003', '2026-10-30T02:13:17.310Z')
on conflict (id) do nothing;

-- shipment_lines（15件）
insert into shipment_lines (id, shipment_id, order_line_id, item_id, item_name, unit, quantity, lot_no, notes) values
  ('x0hzzp6l18g3i', 'shp001', 'ord006l1', 'itm012', 'じゃがいも', 'ケース', 35, '', ''),
  ('xvbgl7ds08g3i', 'shp001', 'ord006l2', 'itm014', 'ブロッコリー', 'ケース', 12, '', ''),
  ('ximjs8bii8g3i', 'shp002', 'ord007l1', 'itm006', 'キャベツ', 'ケース', 30, '', ''),
  ('xrf78qn7j8g3i', 'shp002', 'ord007l2', 'itm009', 'だいこん', 'ケース', 20, '', ''),
  ('xq5vlrmy08g3i', 'shp003', 'ord008l1', 'itm003', 'きゅうり', 'ケース', 18, '', ''),
  ('xna1jka3l8g3i', 'shp003', 'ord008l2', 'itm007', 'レタス', 'ケース', 12, '', ''),
  ('xz8n1sbb18g3i', 'shp004', 'ord002l1', 'itm006', 'キャベツ', 'ケース', 40, '', ''),
  ('xf137yujf8g3i', 'shp004', 'ord002l2', 'itm009', 'だいこん', 'ケース', 30, '', ''),
  ('xdj60ak868g3i', 'shp004', 'ord002l3', 'itm011', 'たまねぎ', 'ケース', 25, '', ''),
  ('xazds724k8g3i', 'shp005', 'ord003l1', 'itm004', 'なす', 'ケース', 25, '', ''),
  ('xi0yqqvp78g3i', 'shp005', 'ord003l2', 'itm010', 'にんじん', 'ケース', 20, '', ''),
  ('xxku7tje18g3i', 'shp005', 'ord003l3', 'itm013', 'ねぎ', 'ケース', 15, '', ''),
  ('xb2qqa0tm8g3i', 'shp006', 'ord004l1', 'itm002', 'ミニトマト', 'ケース', 12, '', ''),
  ('x5u3n7v2k8g3i', 'shp006', 'ord004l2', 'itm005', 'ピーマン', 'ケース', 10, '', ''),
  ('xlkoeovcf8g3i', 'shp006', 'ord004l3', 'itm008', 'ほうれん草', 'ケース', 8, '', '')
on conflict (id) do nothing;

-- stock_movements（19件）
insert into stock_movements (id, moved_at, move_date, move_type, item_id, item_name, quantity, balance_after, ref_table, ref_id, ref_no, operator_id, notes, created_at) values
  ('x4ch05uyz8g3h', '2026-10-18T02:13:17.309Z', '2026-10-18', 'receipt', 'itm001', 'トマト', 80, 122, 'receipts', 'rcv001', 'RC-20261018-0001', 'usr002', '', DEFAULT),
  ('xw9m2ed518g3h', '2026-10-18T02:13:17.309Z', '2026-10-18', 'receipt', 'itm003', 'きゅうり', 60, 72, 'receipts', 'rcv001', 'RC-20261018-0001', 'usr002', '', DEFAULT),
  ('xwxz1duo58g3h', '2026-10-18T02:13:17.309Z', '2026-10-18', 'receipt', 'itm006', 'キャベツ', 120, 186, 'receipts', 'rcv001', 'RC-20261018-0001', 'usr002', '', DEFAULT),
  ('x4bre4aam8g3h', '2026-10-21T02:13:17.309Z', '2026-10-21', 'receipt', 'itm016', '段ボール箱 10kg', 1000, 1720, 'receipts', 'rcv002', 'RC-20261021-0002', 'usr002', '', DEFAULT),
  ('xdzbz88ga8g3h', '2026-10-21T02:13:17.309Z', '2026-10-21', 'receipt', 'itm017', '段ボール箱 5kg', 800, 1210, 'receipts', 'rcv002', 'RC-20261021-0002', 'usr002', '', DEFAULT),
  ('xqv7a50988g3h', '2026-10-21T02:13:17.309Z', '2026-10-21', 'receipt', 'itm019', 'プラスチックコンテナ', 60, 124, 'receipts', 'rcv002', 'RC-20261021-0002', 'usr002', '', DEFAULT),
  ('xf8vzkez88g3h', '2026-10-24T02:13:17.309Z', '2026-10-24', 'receipt', 'itm004', 'なす', 50, 83, 'receipts', 'rcv003', 'RC-20261024-0003', 'usr002', '', DEFAULT),
  ('xwqjit7eh8g3h', '2026-10-24T02:13:17.309Z', '2026-10-24', 'receipt', 'itm011', 'たまねぎ', 100, 173, 'receipts', 'rcv003', 'RC-20261024-0003', 'usr002', '', DEFAULT),
  ('xu3nxhkks8g3h', '2026-10-24T02:13:17.309Z', '2026-10-24', 'receipt', 'itm009', 'だいこん', 70, 121, 'receipts', 'rcv003', 'RC-20261024-0003', 'usr002', '', DEFAULT),
  ('xq48h16m78g3h', '2026-10-27T02:13:17.309Z', '2026-10-27', 'receipt', 'itm018', '発泡スチロール箱', 120, 208, 'receipts', 'rcv004', 'RC-20261027-0004', 'usr002', '', DEFAULT),
  ('x5nm8wtdf8g3h', '2026-10-27T02:13:17.309Z', '2026-10-27', 'receipt', 'itm020', '結束バンド', 3000, 4450, 'receipts', 'rcv004', 'RC-20261027-0004', 'usr002', '', DEFAULT),
  ('xibt6a1p68g3h', '2026-10-27T02:13:17.309Z', '2026-10-27', 'receipt', 'itm025', 'ラベルシール', 5000, 8800, 'receipts', 'rcv004', 'RC-20261027-0004', 'usr002', '', DEFAULT),
  ('x1gvd0kpz8g3h', '2026-10-29T02:13:17.309Z', '2026-10-29', 'receipt', 'itm001', 'トマト', 60, 182, 'receipts', 'rcv005', 'RC-20261029-0005', 'usr002', '', DEFAULT),
  ('xzra7tixx8g3h', '2026-10-29T02:13:17.309Z', '2026-10-29', 'receipt', 'itm007', 'レタス', 40, 64, 'receipts', 'rcv005', 'RC-20261029-0005', 'usr002', '', DEFAULT),
  ('x1qesf6k08g3h', '2026-10-29T02:13:17.309Z', '2026-10-29', 'receipt', 'itm013', 'ねぎ', 30, 66, 'receipts', 'rcv005', 'RC-20261029-0005', 'usr002', '', DEFAULT),
  ('xztvjb50n8g3i', '2026-10-30T02:13:17.310Z', '2026-10-30', 'shipment', 'itm012', 'じゃがいも', -35, -21, 'shipments', 'shp001', 'SH-20261027-0001', 'usr003', '', DEFAULT),
  ('xeecrhtg28g3i', '2026-10-30T02:13:17.310Z', '2026-10-30', 'shipment', 'itm014', 'ブロッコリー', -12, -6, 'shipments', 'shp001', 'SH-20261027-0001', 'usr003', '', DEFAULT),
  ('x6970pqw98g3i', '2026-10-30T02:13:17.310Z', '2026-10-30', 'shipment', 'itm006', 'キャベツ', -30, 156, 'shipments', 'shp002', 'SH-20261028-0002', 'usr003', '', DEFAULT),
  ('x28dmy2wg8g3i', '2026-10-30T02:13:17.310Z', '2026-10-30', 'shipment', 'itm009', 'だいこん', -20, 101, 'shipments', 'shp002', 'SH-20261028-0002', 'usr003', '', DEFAULT)
on conflict (id) do nothing;

-- number_sequences（24件）
insert into number_sequences (seq_key, prefix, seq_date, last_number, updated_at) values
  ('ORD-20261025', 'ORD', '20261025', 1, now()),
  ('ORD-20261026', 'ORD', '20261026', 2, now()),
  ('ORD-20261027', 'ORD', '20261027', 3, now()),
  ('ORD-20261028', 'ORD', '20261028', 4, now()),
  ('ORD-20261029', 'ORD', '20261029', 5, now()),
  ('ORD-20261022', 'ORD', '20261022', 6, now()),
  ('ORD-20261023', 'ORD', '20261023', 7, now()),
  ('ORD-20261024', 'ORD', '20261024', 8, now()),
  ('PO-20261026', 'PO', '20261026', 1, now()),
  ('PO-20261028', 'PO', '20261028', 2, now()),
  ('PO-20261029', 'PO', '20261029', 3, now()),
  ('PO-20261027', 'PO', '20261027', 4, now()),
  ('PO-20261020', 'PO', '20261020', 5, now()),
  ('PO-20261022', 'PO', '20261022', 6, now()),
  ('RC-20261018', 'RC', '20261018', 1, now()),
  ('RC-20261021', 'RC', '20261021', 2, now()),
  ('RC-20261024', 'RC', '20261024', 3, now()),
  ('RC-20261027', 'RC', '20261027', 4, now()),
  ('RC-20261029', 'RC', '20261029', 5, now()),
  ('SH-20261027', 'SH', '20261027', 1, now()),
  ('SH-20261028', 'SH', '20261028', 2, now()),
  ('SH-20261030', 'SH', '20261030', 4, now()),
  ('SH-20261031', 'SH', '20261031', 5, now()),
  ('SH-20261101', 'SH', '20261101', 6, now())
on conflict (seq_key) do nothing;

-- app_settings（会社情報）
insert into app_settings (key, value) values ('company', '{"name":"株式会社 みどりファーム","postal":"〒321-0000","address":"栃木県みどり市中央1-2-3","tel":"0123-45-6789","fax":"0123-45-6780","invoiceNo":"T1234567890123"}'::jsonb)
on conflict (key) do nothing;
-- app_settings（緊急管理者ログインの有効化・既定 ON）
insert into app_settings (key, value) values ('emergency', '{"enabled":true}'::jsonb)
on conflict (key) do nothing;

-- 完了。アプリにアクセスして admin / Temp1234! でログインしてください（初回ログイン時にパスワード変更必須）。
