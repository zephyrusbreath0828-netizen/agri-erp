-- ============================================================================
--  アグリERP — 追加SQL: 監査ログ（操作ログ）テーブル
--  ※ 既存テーブル・既存RPC（app_verify_login / app_set_password）・接続設定は
--    一切変更しない追加スクリプトです。
--     管理者によるパスワードリセット等の操作記録
--     （実行者 / 対象ユーザー / 実行日時 / IPアドレス）を保存する。
--     仮パスワード自体は保存しない。
--     既存環境では、このSQLのみを追加実行してください。
--     （未実行でもアプリは動作します。監査ログのDB保存のみ無効化されます）
-- ============================================================================

create table if not exists audit_logs (
  id              text primary key,
  action          text not null,
  actor_login_id  text,
  actor_name      text,
  target_login_id text,
  target_name     text,
  ip_address      text,
  user_agent      text,
  created_at      timestamptz not null default now()
);
comment on table audit_logs is '監査ログ（操作ログ）。パスワードリセット等の操作記録。仮パスワード自体は保存しない';
create index if not exists idx_audit_logs_created on audit_logs(created_at desc);

-- ============================================================================
-- RLS（行レベルセキュリティ）
--   ※ 既存テーブルと同じ緩和設定（アプリ独自認証のため Anon Key 所持者に許可）。
--     本格運用では Supabase Auth 移行 + ロール別RLS への強化を推奨（README参照）。
-- ============================================================================
alter table audit_logs enable row level security;
drop policy if exists p_app_all on audit_logs;
create policy p_app_all on audit_logs for all using (true) with check (true);

-- ============================================================================
-- 動作確認（任意）
-- ============================================================================
-- select * from audit_logs order by created_at desc limit 5;
