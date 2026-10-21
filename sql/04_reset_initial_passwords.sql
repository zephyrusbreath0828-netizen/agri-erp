-- ============================================================================
--  アグリERP — 修復用SQL: 初期ユーザーのパスワードを画面表示どおりに戻す
--  ※ テーブル定義・構造の変更は一切行わないデータ更新スクリプトです。
--
--  【用途】
--  「admin / Temp1234! でログインできない」場合の修復。
--  旧版で初期化されたDBでは、クライアント製のPBKDF2形式ハッシュが users.password_hash
--  に保存されている（または表示と異なるパスワードで登録されている）ことがあり、
--  app_verify_login の crypt()（bcrypt）照合が失敗します。
--  本スクリプトは既存RPC app_set_password と同じbcrypt（bf・コスト10）で
--  初期パスワードを再設定します。
--
--  【実行】
--  Supabase ダッシュボード → SQL Editor で本ファイルを実行。
--  実行後、admin / office / shipping が Temp1234! でログインでき、
--  初回ログイン時にパスワード変更が必須になります。
-- ============================================================================

update users
   set password_hash = crypt('Temp1234!', gen_salt('bf', 10)),
       force_password_change = true,
       updated_at = now()
 where login_id in ('admin', 'office', 'shipping');

-- 【確認】
-- select login_id, force_password_change,
--        crypt('Temp1234!', password_hash) = password_hash as pw_matches_temp
--   from users where login_id in ('admin', 'office', 'shipping');
-- → pw_matches_temp が 3行とも true になれば正常です。
