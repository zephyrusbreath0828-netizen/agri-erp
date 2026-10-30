/* SQLシード生成: アプリの buildSeed()（デモ初期データ）を SQL INSERT 文に変換する
   使い方: node scripts/gen_seed.js > sql/02_seed.sql
   - 列対応は src/00-supabase.js の SB.TABLES と同一ソース（単一の真実）
   - ユーザーの password_hash は pgcrypto bcrypt (crypt/gen_salt) で出力（初期パスワード Temp1234!）
   - 日付は生成日基準で展開される */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');

const session = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: () => Promise.reject(new Error('no network in generator')),
  URLSearchParams, URL, sessionStorage: session,
  location: { search: '' }, window: {}, document: { getElementById: () => null },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
function run(file) {
  vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8') +
    "\n;globalThis.__X = Object.assign(globalThis.__X || {}, { SB: (typeof SB !== 'undefined') ? SB : undefined, Store: (typeof Store !== 'undefined') ? Store : undefined, buildSeed: (typeof buildSeed !== 'undefined') ? buildSeed : undefined });",
    sandbox, { filename: file });
}
run('01-store.js');
run('00-supabase.js');
sandbox.SB = sandbox.__X.SB; sandbox.Store = sandbox.__X.Store; sandbox.buildSeed = sandbox.__X.buildSeed;

const db = sandbox.buildSeed();
const TABLES = sandbox.SB.TABLES;

const esc = v => String(v).replace(/'/g, "''");
const q = v => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  return `'${esc(v)}'`;
};
const order = ['organizations', 'users', 'companies', 'branches', 'doc_templates', 'suppliers', 'customers', 'items', 'orders', 'order_lines', 'purchase_orders',
  'purchase_order_lines', 'receipts', 'receipt_lines', 'shipments', 'shipment_lines',
  'stock_movements', 'number_sequences', 'documents'];
const genDate = new Date().toISOString().slice(0, 10);

const out = [];
out.push(`-- ============================================================================`);
out.push(`--  アグリERP（Supabase版） 初期データ投入スクリプト  生成日: ${genDate}`);
out.push(`--  生成元: アプリ内蔵デモシード buildSeed() と完全一致（scripts/gen_seed.js が自動生成）`);
out.push(`--  実行順: 01_create_tables.sql 実行後に本ファイルを Supabase SQL Editor で実行`);
out.push(`--  ※ 01_create_tables.sql のみ実行して本ファイルを実行しない場合、`);
out.push(`--    アプリ初回アクセス時に同等のデモデータが自動生成されます。`);
out.push(`--  初期ユーザー: admin / office / shipping（初期パスワード Temp1234!・初回ログイン時に変更必須）`);
out.push(`-- ============================================================================`);
out.push('');

for (const tname of order) {
  const tb = TABLES.find(x => x.t === tname);
  if (!tb) throw new Error('no TABLES def for ' + tname);
  let rows;
  if (tname === 'app_settings') { /* 別途 */ continue; }
  const arrName = tb.arr;
  rows = db[arrName] || [];
  if (!rows.length) continue;
  const cols = tb.cols.filter(c => c !== 'updated_at' || tname === 'number_sequences');
  const lines = [];
  for (const appRow of rows) {
    const dbRow = sandbox.SB.rowToDb(appRow, tb);
    const vals = cols.map(c => {
      if (tname === 'users' && c === 'password_hash') return `crypt('Temp1234!', gen_salt('bf', 10))`;
      if (tname === 'number_sequences' && c === 'updated_at') return `now()`;
      const v = dbRow[c];
      return v === undefined ? 'DEFAULT' : q(v);
    });
    lines.push(`  (${vals.join(', ')})`);
  }
  const usedCols = cols.map(c => c === 'updated_at' && tname !== 'number_sequences' ? null : c).filter(Boolean);
  // rows に存在しない列は DEFAULT を出すため、列リストは cols 全体を使う
  out.push(`-- ${tname}（${rows.length}件）`);
  out.push(`insert into ${tname} (${cols.join(', ')}) values`);
  out.push(lines.join(',\n'));
  out.push(`on conflict (${tb.pk}) do nothing;`);
  out.push('');
}

/* 会社設定（app_settings: jsonb） */
out.push(`-- app_settings（会社情報）`);
out.push(`insert into app_settings (key, value) values ('company', ${JSON.stringify(JSON.stringify(db.settings.company)).replace(/''/g, "'") ? `'${esc(JSON.stringify(db.settings.company))}'` : `''`}::jsonb)`);
out.push('on conflict (key) do nothing;');
out.push(`-- app_settings（緊急管理者ログインの有効化・既定 ON）`);
out.push(`insert into app_settings (key, value) values ('emergency', '${esc(JSON.stringify({ enabled: db.settings.emergencyAdmin !== false }))}'::jsonb)`);
out.push(`on conflict (key) do nothing;`);
out.push('');
out.push(`-- 完了。アプリにアクセスして admin / Temp1234! でログインしてください（初回ログイン時にパスワード変更必須）。`);

process.stdout.write(out.join('\n') + '\n');
