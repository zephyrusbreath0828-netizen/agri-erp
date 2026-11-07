-- ============================================================================
--  アグリERP（Supabase版） ver 3.5  権限管理（ロール）マイグレーション
--  system_admin / org_admin / manager / user の4ロールを導入し、
--  画面のアクセス制御と RLS（organization_id + ロール）を整合させる
--  実行順: sql/08_multi_tenant.sql の後に Supabase SQL Editor で1回実行（冪等）
-- ============================================================================
begin;

-- ----------------------------------------------------------------------------
-- 1. users.role の値域を新ロールへ移行
--    旧: admin / office / shipping  →  新: system_admin / org_admin / manager / user
-- ----------------------------------------------------------------------------
alter table users add column if not exists is_system_admin boolean not null default false;

-- 旧 admin は「システム管理者フラグあり → system_admin、なし → org_admin」
update users
   set role = case
                when role = 'admin' and (is_system_admin = true or login_id = 'admin') then 'system_admin'
                when role = 'admin' then 'org_admin'
                when role in ('office', 'shipping') then 'user'
                else role
              end
 where role in ('admin', 'office', 'shipping');

-- ロールと is_system_admin を同期（system_admin のみ true）
update users set is_system_admin = (role = 'system_admin');

-- 未知の値は user に寄せる
update users set role = 'user' where role is null or role not in ('system_admin', 'org_admin', 'manager', 'user');

-- システム管理者が不在なら先頭の有効ユーザーを昇格（管理不能を防ぐ）
do $$
begin
  if not exists (select 1 from users where role = 'system_admin') then
    update users set role = 'system_admin', is_system_admin = true
     where id = (select id from users where enabled is not false order by created_at limit 1);
  end if;
end $$;

-- 値域制約
alter table users drop constraint if exists users_role_chk;
alter table users add constraint users_role_chk
  check (role in ('system_admin', 'org_admin', 'manager', 'user'));

create index if not exists idx_users_org_role on users(organization_id, role);

-- ----------------------------------------------------------------------------
-- 2. ロール解決ヘルパー
-- ----------------------------------------------------------------------------
create or replace function public.current_role() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select u.role
      from public.users u
     where u.id = public.current_user_id()
        or u.id = nullif(current_setting('request.jwt.claims', true)::jsonb #>> '{app_metadata,user_id}', '')
     limit 1
  ), 'user');
$$;

-- システム管理者判定（ロール or フラグ）。RLS の全組織閲覧に使用
create or replace function public.is_system_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select (u.role = 'system_admin' or u.is_system_admin = true)
      from public.users u
     where u.id = public.current_user_id()
        or u.id = nullif(current_setting('request.jwt.claims', true)::jsonb #>> '{app_metadata,user_id}', '')
     limit 1
  ), false);
$$;

-- 組織管理者以上（自組織のマスタ・ユーザー管理が可能）
create or replace function public.is_org_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_role() in ('system_admin', 'org_admin');
$$;

-- ----------------------------------------------------------------------------
-- 3. RLS: organization_id による隔離（system_admin のみ全組織を閲覧可能）
--    ・一般/管理/組織管理者: organization_id = current_org_id()
--    ・system_admin       : 全組織（組織マスタ・全組織閲覧・全ユーザー閲覧）
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'users','companies','branches','doc_templates','customers','suppliers','items',
    'orders','order_lines','purchase_orders','purchase_order_lines',
    'receipts','receipt_lines','shipments','shipment_lines',
    'stock_movements','documents','number_sequences','audit_logs'
  ];
begin
  foreach t in array tables loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I for all to anon, authenticated ' ||
      'using (public.is_system_admin() or organization_id = public.current_org_id()) ' ||
      'with check (public.is_system_admin() or organization_id = public.current_org_id())', t);
  end loop;
end $$;

-- 組織マスタ: 参照は自組織（system_admin は全組織）、変更は system_admin のみ
alter table organizations enable row level security;
drop policy if exists organizations_read on organizations;
create policy organizations_read on organizations for select to anon, authenticated
  using (id = public.current_org_id() or public.is_system_admin());
drop policy if exists organizations_insert on organizations;
create policy organizations_insert on organizations for insert to anon, authenticated
  with check (public.is_system_admin());
drop policy if exists organizations_update on organizations;
create policy organizations_update on organizations for update to anon, authenticated
  using (public.is_system_admin()) with check (public.is_system_admin());
drop policy if exists organizations_delete on organizations;
create policy organizations_delete on organizations for delete to anon, authenticated
  using (false);

-- アプリ設定（システム設定）: 参照は自組織＋共通行 / 変更は system_admin のみ
alter table app_settings enable row level security;
drop policy if exists app_settings_tenant on app_settings;
create policy app_settings_tenant on app_settings for all to anon, authenticated
  using ((organization_id = public.current_org_id() or organization_id is null) and (public.is_org_admin() or organization_id is null))
  with check ((organization_id = public.current_org_id() or organization_id is null) and (public.is_system_admin() or organization_id = public.current_org_id()));

-- ----------------------------------------------------------------------------
-- 4. ロール昇格の禁止（org_admin が system_admin を発行できないようにする）
-- ----------------------------------------------------------------------------
create or replace function public.role_guard() returns trigger
language plpgsql as $$
declare actor text;
begin
  actor := public.current_role();
  if actor = 'system_admin' or actor is null then
    return new;
  end if;
  if new.role = 'system_admin' then
    raise exception 'システム管理者ロールを付与する権限がありません';
  end if;
  if tg_op = 'UPDATE' and old.role = 'system_admin' and new.role <> 'system_admin' then
    raise exception 'システム管理者ロールを変更する権限がありません';
  end if;
  return new;
end $$;

drop trigger if exists trg_users_role_guard on users;
create trigger trg_users_role_guard before insert or update on users
  for each row execute function public.role_guard();

-- ----------------------------------------------------------------------------
-- 5. ログイン: ロールとシステム管理者フラグを返す（画面のメニュー制御に使用）
-- ----------------------------------------------------------------------------
create or replace function public.app_login(p_login_id text, p_password text)
returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  u public.users;
  org public.organizations;
  tk text;
begin
  select * into u from public.users where lower(login_id) = lower(trim(p_login_id)) limit 1;
  if u.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_user', 'message', '存在しないユーザーIDです');
  end if;
  if u.enabled is false then
    return jsonb_build_object('ok', false, 'code', 'disabled', 'message', 'このユーザーは無効化されています。管理者に連絡してください');
  end if;
  if u.password_hash is null or crypt(p_password, u.password_hash) <> u.password_hash then
    return jsonb_build_object('ok', false, 'code', 'bad_password', 'message', 'パスワードが一致しません');
  end if;

  select * into org from public.organizations where id = coalesce(u.organization_id, 1);
  if org.id is null or org.is_active is false then
    return jsonb_build_object('ok', false, 'code', 'org_disabled', 'message', '所属組織が停止されています。システム管理者に連絡してください');
  end if;

  tk := replace(gen_random_uuid()::text, '-', '');
  insert into public.app_sessions(token, user_id, organization_id) values (tk, u.id, org.id);
  update public.users set last_login_at = now() where id = u.id;

  return jsonb_build_object(
    'ok', true,
    'token', tk,
    'organization_id', org.id,
    'role', u.role,
    'user', (to_jsonb(u) - 'password_hash') || jsonb_build_object('organization_id', org.id, 'role', u.role)
  );
end $$;

grant execute on function public.current_role() to anon, authenticated;
grant execute on function public.is_org_admin() to anon, authenticated;
grant execute on function public.app_login(text, text) to anon, authenticated;

commit;

-- ============================================================================
-- 検証用（任意）
--   select role, count(*) from users group by role order by 1;     -- system_admin が1名以上
--   select login_id, role, organization_id, is_system_admin from users order by organization_id, login_id;
--   select tablename, policyname, qual from pg_policies where schemaname='public' and policyname='tenant_isolation' limit 3;
-- ============================================================================
