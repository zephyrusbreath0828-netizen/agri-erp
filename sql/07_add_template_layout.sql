-- ============================================================================
--  アグリERP ver 3.3 マイグレーション
--  帳票テンプレート：レイアウト設定（拠点表示・用紙・透かし・フッター）追加
--  Supabase SQL Editor で実行（冪等）
-- ============================================================================

alter table doc_templates add column if not exists branch1    boolean default true;
alter table doc_templates add column if not exists branch2    boolean default true;
alter table doc_templates add column if not exists branch_mode text   default 'both';
alter table doc_templates add column if not exists paper      text   default 'portrait';
alter table doc_templates add column if not exists watermark  boolean default true;
alter table doc_templates add column if not exists footer     boolean default true;

-- 既存テンプレートへ既定値を投入（未設定＝NULL の行のみ）
update doc_templates set branch1 = true where branch1 is null;
update doc_templates set branch2 = true where branch2 is null;
update doc_templates set branch_mode = 'both' where branch_mode is null or branch_mode = '';
update doc_templates set paper = 'portrait' where paper is null or paper = '';
update doc_templates set watermark = true where watermark is null;
update doc_templates set footer = true where footer is null;

-- 参照用インデックス
create index if not exists idx_doc_templates_kind on doc_templates(doc_kind) where is_active is not false;
