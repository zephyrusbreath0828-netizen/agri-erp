-- ============================================================================
--  アグリERP（Supabase版） 追加マイグレーション ver 3.7
--  担当者管理（受注・発注・入荷・出荷の担当者 / ユーザープロフィール / 帳票の担当者表示）
--  実行場所: Supabase ダッシュボード → SQL Editor
--  ※ 冪等（何度実行しても安全）。既存データは削除・変更しません。
--  ※ 追加列はすべて NULL 許可。既存データは「担当者未設定」として扱われます。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 伝票の担当者（すべて users.id への外部キー）
-- ---------------------------------------------------------------------------
alter table orders          add column if not exists sales_user_id    text references users(id) on delete set null;
alter table purchase_orders add column if not exists purchase_user_id text references users(id) on delete set null;
alter table receipts        add column if not exists receipt_user_id  text references users(id) on delete set null;

-- shipments は organization_id を持たない旧版もあるため、列の有無のみ確認して追加
alter table shipments       add column if not exists shipment_user_id text references users(id) on delete set null;

comment on column orders.sales_user_id          is '担当営業（users.id）。受注登録画面で選択。旧 sales_rep_id は読み替え表示';
comment on column purchase_orders.purchase_user_id is '発注担当（users.id）';
comment on column receipts.receipt_user_id      is '受入担当（users.id）。旧 received_by は読み替え表示';
comment on column shipments.shipment_user_id    is '出荷担当（users.id）';

-- 在庫移動（入出庫履歴）の担当者。入荷・出荷の担当者を引き継ぐ
alter table stock_movements add column if not exists owner_id text references users(id) on delete set null;
comment on column stock_movements.owner_id is '在庫移動の担当者（users.id）。未設定時は operator_id を表示';

-- ---------------------------------------------------------------------------
-- 2. ユーザー（担当者）プロフィール
-- ---------------------------------------------------------------------------
alter table users add column if not exists owner_code  text;
alter table users add column if not exists department  text;
alter table users add column if not exists extension   text;
alter table users add column if not exists company_id  text references companies(id) on delete set null;
alter table users add column if not exists branch_id   text references branches(id)  on delete set null;
comment on column users.owner_code is '担当者コード（候補プルダウンの並び順・検索に使用）';
comment on column users.department is '担当部署';
comment on column users.extension  is '内線番号';

-- ---------------------------------------------------------------------------
-- 3. 帳票テンプレート: 担当者表示の ON/OFF
-- ---------------------------------------------------------------------------
alter table doc_templates add column if not exists owner boolean not null default true;
comment on column doc_templates.owner is '帳票に担当者を表示する（true=表示 / false=非表示）';

-- ---------------------------------------------------------------------------
-- 4. 監査ログ: 担当者変更の内容
-- ---------------------------------------------------------------------------
alter table audit_logs add column if not exists detail   text;
alter table audit_logs add column if not exists doc_kind text;
alter table audit_logs add column if not exists doc_no   text;
alter table audit_logs add column if not exists organization_id bigint;
comment on column audit_logs.detail is '変更内容（例：担当営業：田中 健二 → 山田 太郎）';

-- ---------------------------------------------------------------------------
-- 5. 検索用インデックス（担当者別の絞り込み・集計を高速化）
-- ---------------------------------------------------------------------------
create index if not exists idx_orders_sales_user       on orders(organization_id, sales_user_id, order_date);
create index if not exists idx_purchase_orders_purchaser on purchase_orders(organization_id, purchase_user_id, order_date);
create index if not exists idx_receipts_receipt_user   on receipts(organization_id, receipt_user_id, receipt_date);
create index if not exists idx_shipments_shipment_user on shipments(organization_id, shipment_user_id, ship_date);
create index if not exists idx_stock_movements_owner   on stock_movements(organization_id, owner_id, move_date);
create index if not exists idx_users_owner_code        on users(organization_id, owner_code);
create index if not exists idx_audit_logs_doc          on audit_logs(doc_kind, doc_no);

-- ---------------------------------------------------------------------------
-- 6. 既存データの扱い（任意・実行しない場合は「担当者未設定」のまま）
--    ※ 既定では実行しません。旧「営業担当（sales_rep_id）」を新列へ引き継ぐ場合のみ、
--      以下のコメントを外して実行してください（履歴の一括変更は監査ログに残りません）。
-- ---------------------------------------------------------------------------
-- update orders set sales_user_id = sales_rep_id
--  where sales_user_id is null and sales_rep_id is not null
--    and exists (select 1 from users u where u.id = orders.sales_rep_id);

-- ---------------------------------------------------------------------------
-- 動作確認（任意）
-- ---------------------------------------------------------------------------
-- select count(*) filter (where sales_user_id is null) as unassigned_orders, count(*) from orders;
-- select u.name, count(o.id) from users u left join orders o on o.sales_user_id = u.id group by u.name order by 2 desc;
