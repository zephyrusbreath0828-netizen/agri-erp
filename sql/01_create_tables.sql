-- ============================================================================
--  アグリERP（Supabase版） テーブル作成スクリプト  ver 1.0
--  実行場所: Supabase ダッシュボード → SQL Editor（全体を選択して実行）
--  実行順: 本ファイル → sql/02_seed.sql（初期データ）
--  設計方針:
--   - 主キーはアプリ内ID（itm001 等）の text 型。アプリとDBでIDを完全一致させる
--   - 在庫整合・採番などの業務ロジックはアプリ側（Store.applyStock / nextNo）が担当。
--     クライアント同期と干渉するサーバー側トリガは置かない
--   - 外部キー制約は意図的に付けない（アプリが整合性を保証。同期失敗を防ぐ）
--   - パスワード照合は pgcrypto bcrypt を使うサーバー側RPCで行う
--     （パスワードハッシュはクライアントへ送信されない）
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. ユーザー（ユーザーマスタ）
-- ============================================================================
create table if not exists users (
  id                    text primary key,
  login_id              text unique not null,
  name                  text not null,
  email                 text,
  tel                   text,
  role                  text not null default 'office',   -- admin / office / shipping
  password_hash         text not null,                    -- pgcrypto bcrypt ($2a$...)
  force_password_change boolean not null default true,
  enabled               boolean not null default true,
  last_login_at         timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
comment on table users is 'ユーザー（管理者/事務担当/出荷担当）。パスワードはサーバー側RPCでのみ照合';

-- ============================================================================
-- 2. マスタ
-- ============================================================================
create table if not exists suppliers (
  id            text primary key,
  code          text unique not null,
  name          text not null,
  kana          text,
  tel           text,
  address       text,
  closing_day   int default 31,
  payment_terms text default '翌月末',
  lead_time     int default 3,
  email         text,
  contact       text,
  active        boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table suppliers is '仕入先マスタ';

create table if not exists customers (
  id            text primary key,
  code          text unique not null,
  name          text not null,
  kana          text,
  tel           text,
  address       text,
  closing_day   int default 31,
  payment_terms text default '翌月末',
  email         text,
  contact       text,
  active        boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table customers is '顧客（得意先）マスタ';

create table if not exists items (
  id            text primary key,
  kind          text not null,                    -- product=商品 / material=資材
  code          text unique not null,
  name          text not null,
  kana          text,
  category      text,
  unit          text default 'ケース',
  spec          text,
  sale_price    numeric(12,2) default 0,
  cost_price    numeric(12,2) default 0,
  tax_rate      numeric(5,2) default 8,
  reorder_point numeric(12,2) default 0,          -- 発注点
  reorder_qty   numeric(12,2) default 0,          -- 発注ロット
  safety_stock  numeric(12,2) default 0,          -- 安全在庫
  stock         numeric(12,2) not null default 0, -- 現在庫（在庫マスタ）
  location      text,
  jan_code      text,
  barcode       text,
  supplier_id   text,
  active        boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table items is '在庫マスタ（商品・梱包資材を kind で区分）。現在庫は入出庫履歴の合計と一致させる';

-- ============================================================================
-- 3. 受注
-- ============================================================================
create table if not exists orders (
  id            text primary key,
  order_no      text unique not null,             -- ORD-YYYYMMDD-0001
  customer_id   text not null,
  customer_name text,
  order_date    date,
  due_date      date,                             -- 納期
  ship_date     date,                             -- 出荷予定日
  status        text not null default 'received', -- received/instructed/partial/shipped/completed/cancelled
  subtotal      numeric(14,2) default 0,
  tax_amount    numeric(14,2) default 0,
  total_amount  numeric(14,2) default 0,
  remarks       text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table orders is '受注ヘッダ';

create table if not exists order_lines (
  id          text primary key,
  order_id    text not null,
  line_no     int,
  item_id     text,
  item_name   text,
  unit        text,
  quantity    numeric(12,2) not null default 0,
  unit_price  numeric(12,2) default 0,
  tax_rate    numeric(5,2) default 8,
  amount      numeric(14,2) default 0,
  shipped_qty numeric(12,2) not null default 0,   -- 受注残 = quantity - shipped_qty
  due_date    date,
  notes       text
);
comment on table order_lines is '受注明細';
create index if not exists idx_order_lines_order on order_lines(order_id);
create index if not exists idx_orders_status on orders(status, due_date);

-- ============================================================================
-- 4. 発注
-- ============================================================================
create table if not exists purchase_orders (
  id            text primary key,
  po_no         text unique not null,             -- PO-YYYYMMDD-0001
  supplier_id   text not null,
  supplier_name text,
  order_date    date,
  expected_date date,                             -- 入荷予定日
  status        text not null default 'ordered',  -- ordered/partial/received/completed/cancelled
  subtotal      numeric(14,2) default 0,
  tax_amount    numeric(14,2) default 0,
  total_amount  numeric(14,2) default 0,
  remarks       text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table purchase_orders is '発注ヘッダ';

create table if not exists purchase_order_lines (
  id            text primary key,
  po_id         text not null,
  line_no       int,
  item_id       text,
  item_name     text,
  unit          text,
  quantity      numeric(12,2) not null default 0,
  unit_price    numeric(12,2) default 0,
  tax_rate      numeric(5,2) default 8,
  amount        numeric(14,2) default 0,
  received_qty  numeric(12,2) not null default 0, -- 発注残 = quantity - received_qty
  expected_date date,
  notes         text
);
comment on table purchase_order_lines is '発注明細';
create index if not exists idx_po_lines_po on purchase_order_lines(po_id);
create index if not exists idx_po_status on purchase_orders(status, expected_date);

-- ============================================================================
-- 5. 入荷
-- ============================================================================
create table if not exists receipts (
  id            text primary key,
  receipt_no    text unique not null,             -- RC-YYYYMMDD-0001
  po_id         text,
  supplier_id   text not null,
  supplier_name text,
  receipt_date  date,
  status        text not null default 'confirmed',
  subtotal      numeric(14,2) default 0,
  tax_amount    numeric(14,2) default 0,
  total_amount  numeric(14,2) default 0,
  remarks       text,
  received_by   text,
  created_at    timestamptz not null default now()
);
comment on table receipts is '入荷ヘッダ';

create table if not exists receipt_lines (
  id          text primary key,
  receipt_id  text not null,
  po_line_id  text,
  item_id     text,
  item_name   text,
  quantity    numeric(12,2) not null default 0,
  unit_cost   numeric(12,2) default 0,
  amount      numeric(14,2) default 0,
  lot_no      text,
  expiry      text,                               -- 有効期限（アプリは文字列扱い）
  notes       text
);
comment on table receipt_lines is '入荷明細';
create index if not exists idx_receipt_lines on receipt_lines(receipt_id);

-- ============================================================================
-- 6. 出荷
-- ============================================================================
create table if not exists shipments (
  id            text primary key,
  shipment_no   text unique not null,             -- SH-YYYYMMDD-0001
  order_id      text,
  order_no      text,
  customer_id   text not null,
  customer_name text,
  ship_date     date,
  status        text not null default 'instructed', -- instructed/confirmed/cancelled
  carrier       text,
  tracking_no   text,
  ship_to_name  text,
  ship_to_addr  text,
  remarks       text,
  confirmed_at  timestamptz,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table shipments is '出荷ヘッダ。確定時に在庫が減算される（アプリ側）';

create table if not exists shipment_lines (
  id            text primary key,
  shipment_id   text not null,
  order_line_id text,
  item_id       text,
  item_name     text,
  unit          text,
  quantity      numeric(12,2) not null default 0,
  lot_no        text,
  notes         text
);
comment on table shipment_lines is '出荷明細';
create index if not exists idx_ship_lines on shipment_lines(shipment_id);
create index if not exists idx_shipments_status on shipments(status, ship_date);

-- ============================================================================
-- 7. 入出庫履歴
-- ============================================================================
create table if not exists stock_movements (
  id            text primary key,
  moved_at      timestamptz,
  move_date     date,
  move_type     text not null,                    -- receipt/shipment/adjustment/return/loss
  item_id       text,
  item_name     text,
  quantity      numeric(12,2) not null default 0, -- 入荷=正 / 出荷=負
  balance_after numeric(12,2),
  ref_table     text,
  ref_id        text,
  ref_no        text,
  operator_id   text,
  notes         text,
  created_at    timestamptz not null default now()
);
comment on table stock_movements is '入出庫履歴。在庫増減はアプリの applyStock() 経由のみでここに記録される';
create index if not exists idx_moves_item on stock_movements(item_id, move_date desc);
create index if not exists idx_moves_date on stock_movements(move_date desc);
create index if not exists idx_moves_ref on stock_movements(ref_no);

-- ============================================================================
-- 8. 採番・帳票・設定
-- ============================================================================
create table if not exists number_sequences (
  seq_key     text primary key,                   -- 'ORD-20261019'
  prefix      text not null,
  seq_date    date not null,
  last_number int not null default 0,
  updated_at  timestamptz not null default now()
);
comment on table number_sequences is '帳票番号の採番カウンタ（日付ごとの連番）';

create table if not exists documents (
  id            text primary key,
  doc_kind      text,                             -- delivery_note/shipping_slip/picking_list
  doc_no        text,
  shipment_id   text,
  shipment_no   text,
  order_id      text,
  customer_id   text,
  customer_name text,
  issued_at     timestamptz,
  issued_by     text,
  printed_count int default 1,
  payload       jsonb
);
comment on table documents is '帳票発行履歴（納品書・出荷伝票・ピッキングリスト）';
create index if not exists idx_documents_kind on documents(doc_kind, issued_at desc);

create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
comment on table app_settings is 'アプリ設定（company=自社情報）';

-- ============================================================================
-- 9. 認証RPC（pgcrypto bcrypt によるサーバー側照合）
-- ============================================================================
create or replace function app_verify_login(p_login_id text, p_password text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row users%rowtype;
begin
  select * into v_row from users
   where login_id = lower(trim(p_login_id)) and enabled limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_user', 'message', '存在しないユーザーIDです');
  end if;
  if v_row.password_hash is null or crypt(p_password, v_row.password_hash) is distinct from v_row.password_hash then
    return jsonb_build_object('ok', false, 'code', 'bad_password', 'message', 'パスワードが一致しません');
  end if;
  update users set last_login_at = now() where id = v_row.id;
  return jsonb_build_object('ok', true, 'user', to_jsonb(v_row) - 'password_hash');
end $$;
comment on function app_verify_login is 'ログイン照合（bcrypt）。成功時はパスワードハッシュを除くユーザー情報を返す';

create or replace function app_set_password(p_login_id text, p_new text, p_force_change boolean default false)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if length(p_new) < 8 then
    raise exception 'パスワードは8文字以上にしてください';
  end if;
  select id into v_id from users where login_id = lower(trim(p_login_id)) limit 1;
  if not found then return false; end if;
  update users
     set password_hash = crypt(p_new, gen_salt('bf', 10)),
         force_password_change = p_force_change,
         updated_at = now()
   where id = v_id;
  return true;
end $$;
comment on function app_set_password is 'パスワード設定（管理者変更・初回変更）。bcryptで保存';

grant execute on function app_verify_login(text, text) to anon, authenticated;
grant execute on function app_set_password(text, text, boolean) to anon, authenticated;

-- ============================================================================
-- 10. RLS（行レベルセキュリティ）
--     ※ アプリ独自認証（ユーザーテーブル）のため、Anon Key 所持者に操作を許可する
--       緩和設定としている。Anon Key は公開情報として扱い、本格運用では
--       Supabase Auth 移行 + ロール別RLS への強化を推奨（将来拡張提案書参照）。
-- ============================================================================
alter table users               enable row level security;
alter table suppliers           enable row level security;
alter table customers           enable row level security;
alter table items               enable row level security;
alter table orders              enable row level security;
alter table order_lines         enable row level security;
alter table purchase_orders     enable row level security;
alter table purchase_order_lines enable row level security;
alter table receipts            enable row level security;
alter table receipt_lines       enable row level security;
alter table shipments           enable row level security;
alter table shipment_lines      enable row level security;
alter table stock_movements     enable row level security;
alter table number_sequences    enable row level security;
alter table documents           enable row level security;
alter table app_settings        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['users','suppliers','customers','items','orders','order_lines',
                           'purchase_orders','purchase_order_lines','receipts','receipt_lines',
                           'shipments','shipment_lines','stock_movements','number_sequences',
                           'documents','app_settings'] loop
    execute format('drop policy if exists p_app_all on %I', t);
    execute format('create policy p_app_all on %I for all using (true) with check (true)', t);
  end loop;
end $$;

-- ============================================================================
-- 11. Realtime（他ユーザーへの変更即時配信）
-- ============================================================================
alter publication supabase_realtime add table users;
alter publication supabase_realtime add table suppliers;
alter publication supabase_realtime add table customers;
alter publication supabase_realtime add table items;
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table order_lines;
alter publication supabase_realtime add table purchase_orders;
alter publication supabase_realtime add table purchase_order_lines;
alter publication supabase_realtime add table receipts;
alter publication supabase_realtime add table receipt_lines;
alter publication supabase_realtime add table shipments;
alter publication supabase_realtime add table shipment_lines;
alter publication supabase_realtime add table stock_movements;
alter publication supabase_realtime add table number_sequences;
alter publication supabase_realtime add table documents;
alter publication supabase_realtime add table app_settings;

-- ============================================================================
-- 12. 動作確認（任意）
-- ============================================================================
-- select app_verify_login('admin', 'Temp1234!');   -- ※02_seed.sql 実行後に ok:true が返れば正常
