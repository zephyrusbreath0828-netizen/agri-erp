-- ============================================================================
--  アグリERP（Supabase版） 追加マイグレーション ver 3.2
--  営業担当者（得意先の既定担当・受注の担当）を追加
--  実行場所: Supabase ダッシュボード → SQL Editor
--  ※ 冪等（何度実行しても安全）。既存データは変更しません。
-- ============================================================================

alter table customers add column if not exists sales_rep_id text references users(id) on delete set null;
alter table orders    add column if not exists sales_rep_id text references users(id) on delete set null;

comment on column customers.sales_rep_id is '既定の営業担当者（users.id）';
comment on column orders.sales_rep_id    is '営業担当者（users.id）。得意先の既定担当を初期値に設定';

create index if not exists idx_customers_sales_rep on customers(sales_rep_id);
create index if not exists idx_orders_sales_rep    on orders(sales_rep_id, order_date);
create index if not exists idx_shipments_ship_date on shipments(ship_date desc);

-- 既存得意先に担当者が未設定の場合は、受注の作成者を初期値として補完（任意・データ更新のみ）
update customers c
   set sales_rep_id = src.created_by
  from (
        select customer_id, max(created_by) as created_by
          from orders
         where created_by is not null
         group by customer_id
       ) src
 where c.id = src.customer_id
   and c.sales_rep_id is null
   and exists (select 1 from users u where u.id = src.created_by);
