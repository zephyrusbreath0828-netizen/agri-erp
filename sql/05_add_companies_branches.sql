-- ============================================================================
--  アグリERP（Supabase版） 追加マイグレーション ver 3.0
--  会社マスタ・拠点マスタ・帳票テンプレートの新設／伝票への発行元追加
--  実行場所: Supabase ダッシュボード → SQL Editor（既存DBへ差分適用）
--  実行順: 01_create_tables.sql（既存）→ 05_add_companies_branches.sql
--  ※ 新規構築で 01_create_tables.sql を最新版から実行する場合、本ファイルの内容は
--    01 に含まれているため実行不要です（冪等なので実行しても安全）。
-- ============================================================================

-- ============================================================================
-- 発行元マスタ（会社・拠点）／帳票テンプレート／伝票ヘッダーの発行元カラム
--   - companies  : 会社マスタ（複数登録可・グループ会社対応）
--   - branches   : 拠点マスタ（Company 1:N Branch、外部キーあり）
--   - doc_templates : 帳票テンプレート（帳票種別ごとの表示項目）
--   - orders / purchase_orders / receipts / shipments / documents に
--     company_id / branch1_id / branch2_id を追加（外部キー）
--   - 既存の単一会社設定（app_settings.company）は会社マスタへ自動移行
-- ============================================================================

create table if not exists companies (
  id               text primary key,
  company_code     text unique not null,
  name             text not null,
  postal_code      text,
  address          text,
  tel              text,
  fax              text,
  email            text,
  invoice_number   text,
  logo_url         text,
  notes            text,
  is_active        boolean not null default true,
  visible_fields   jsonb not null default '{"address":true,"tel":true,"fax":true,"email":false,"invoiceNumber":true,"logo":true}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table companies is '会社マスタ（グループ会社対応・複数登録可）。帳票の発行元';

create table if not exists branches (
  id               text primary key,
  company_id       text not null references companies(id) on delete cascade,
  branch_code      text not null,
  name             text not null,
  postal_code      text,
  address          text,
  tel              text,
  fax              text,
  email            text,
  manager_name     text,
  notes            text,
  is_active        boolean not null default true,
  visible_fields   jsonb not null default '{"address":true,"tel":true,"fax":true,"email":false,"manager":true}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, branch_code)
);
comment on table branches is '拠点マスタ（会社 1:N 拠点）。伝票には最大2拠点を印字';
create index if not exists idx_branches_company on branches(company_id);

create table if not exists doc_templates (
  id               text primary key,
  template_code    text unique not null,
  name             text not null,
  doc_kind         text not null,                 -- quote/purchase_order/delivery_note/invoice/receipt_note/shipping_slip/picking_list
  company_id       text references companies(id) on delete cascade,  -- null=全社共通
  company_name     boolean not null default true,
  branch_name      boolean not null default true,
  address          boolean not null default true,
  tel              boolean not null default true,
  fax              boolean not null default true,
  email            boolean not null default false,
  invoice_number   boolean not null default true,
  manager          boolean not null default false,
  logo             boolean not null default true,
  is_default       boolean not null default false,
  is_active        boolean not null default true,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table doc_templates is '帳票テンプレート（帳票種別ごとの表示項目の組合わせ）';
create index if not exists idx_doc_templates_kind on doc_templates(doc_kind, is_default);

/* ---- 伝票ヘッダーへの発行元カラム（外部キー） ---- */
alter table orders            add column if not exists company_id text references companies(id) on delete set null;
alter table orders            add column if not exists branch1_id text references branches(id)  on delete set null;
alter table orders            add column if not exists branch2_id text references branches(id)  on delete set null;
alter table purchase_orders   add column if not exists company_id text references companies(id) on delete set null;
alter table purchase_orders   add column if not exists branch1_id text references branches(id)  on delete set null;
alter table purchase_orders   add column if not exists branch2_id text references branches(id)  on delete set null;
alter table receipts          add column if not exists company_id text references companies(id) on delete set null;
alter table receipts          add column if not exists branch1_id text references branches(id)  on delete set null;
alter table receipts          add column if not exists branch2_id text references branches(id)  on delete set null;
alter table shipments         add column if not exists company_id text references companies(id) on delete set null;
alter table shipments         add column if not exists branch1_id text references branches(id)  on delete set null;
alter table shipments         add column if not exists branch2_id text references branches(id)  on delete set null;

alter table documents         add column if not exists company_id  text references companies(id) on delete set null;
alter table documents         add column if not exists branch1_id  text references branches(id)  on delete set null;
alter table documents         add column if not exists branch2_id  text references branches(id)  on delete set null;
alter table documents         add column if not exists template_id text references doc_templates(id) on delete set null;
alter table documents         add column if not exists po_id        text;
alter table documents         add column if not exists receipt_id   text;

create index if not exists idx_documents_company on documents(company_id, issued_at desc);
create index if not exists idx_orders_company on orders(company_id);

/* ---- RLS（既存テーブルと同じ緩和方針：Anon Key 所持者に操作を許可） ---- */
alter table companies      enable row level security;
alter table branches       enable row level security;
alter table doc_templates  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['companies','branches','doc_templates'] loop
    execute format('drop policy if exists p_app_all on %I', t);
    execute format('create policy p_app_all on %I for all using (true) with check (true)', t);
  end loop;
end $$;

/* ---- Realtime 配信 ---- */
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='companies') then
      alter publication supabase_realtime add table companies;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='branches') then
      alter publication supabase_realtime add table branches;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='doc_templates') then
      alter publication supabase_realtime add table doc_templates;
    end if;
  end if;
end $$;

/* ---- 移行：既存の単一会社設定（app_settings.company）→ 会社マスタ ---- */
insert into companies (id, company_code, name, postal_code, address, tel, fax, email, invoice_number, logo_url, notes, is_active, visible_fields)
select 'co001', 'C001',
       coalesce(nullif(value->>'name',''), '自社'),
       coalesce(value->>'postal',''),
       coalesce(value->>'address',''),
       coalesce(value->>'tel',''),
       coalesce(value->>'fax',''),
       coalesce(value->>'email',''),
       coalesce(nullif(value->>'invoiceNo',''), value->>'invoiceNumber', ''),
       coalesce(value->>'logoUrl',''),
       '旧「自社情報」から自動移行',
       true,
       '{"address":true,"tel":true,"fax":true,"email":false,"invoiceNumber":true,"logo":true}'::jsonb
  from app_settings
 where key = 'company'
   and not exists (select 1 from companies);

-- 既存伝票は company_id が NULL のまま（旧データを保持）。帳票出力時は既定会社（先頭の有効会社）で印字されます。
