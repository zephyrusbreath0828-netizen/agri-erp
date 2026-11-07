#!/usr/bin/env node
/* アグリERP: 分割ソースを単一HTMLへ結合する Node 版（Vercel ビルド用）
   build/assemble.py と同一の出力になるよう実装（scripts/build_parity.js で検証）
   接続情報は環境変数 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY があれば
   window.__AGRI_ENV__ として焼き込み、無ければ実行時解決に任せる。 */
const fs = require('fs');
const path = require('path');

const BASE = path.dirname(__dirname);
const SRC = path.join(BASE, 'src');
const OUT = path.join(BASE, 'build');
const FILES = ['00-supabase.js', '01-store.js', '02-core.js', '03-views-a.js', '04-views-b.js', '07-issuer.js', '05-print.js', '08-tpl-editor.js', '06-app.js'];

const envUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
const envKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
const prelude = (envUrl && envKey)
  ? 'window.__AGRI_ENV__=' + JSON.stringify({ NEXT_PUBLIC_SUPABASE_URL: envUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: envKey }) + ';\n'
  : '';

const shell = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');
const parts = FILES.map(f => '/* ===== ' + f + ' ===== */\n' + fs.readFileSync(path.join(SRC, f), 'utf8'));
const bundle = parts.join('\n\n');
if (/<\/script/i.test(bundle)) throw new Error('bundle contains a closing script tag');

/* 置換文字列に $ を含むと $$ などが特殊解釈されるため、関数置換を使う */
let out = shell.replace('<!--#B#-->', () => '<script>\n' + prelude + bundle + '\n</script>');
for (const f of FILES) out = out.split('<script src="src/' + f + '"></script>\n').join('');
if (out.indexOf('<script>') < 0) throw new Error('bundle placeholder not replaced');
if (out.indexOf('src="src/') >= 0) throw new Error('individual script tags remain');
if (out.indexOf('supabase-js') < 0) throw new Error('supabase-js CDN tag missing');
if (/localStorage\.|localStorage\[/.test(out)) throw new Error('localStorage must be abolished');

fs.mkdirSync(OUT, { recursive: true });
const single = path.join(OUT, 'agri-erp.html');
fs.writeFileSync(single, out);
fs.writeFileSync(path.join(OUT, 'bundle.check.js'), bundle);   /* 検査用（接続情報は含めない） */
console.log('single-file:', single, Buffer.byteLength(out), 'bytes');
console.log('env injection:', prelude ? 'yes (NEXT_PUBLIC_SUPABASE_*)' : 'no (resolved at runtime)');

if (process.argv.includes('--dist')) {
  const dist = path.join(BASE, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), out);
  const cfg = path.join(BASE, 'supabase.config.json');
  if (fs.existsSync(cfg)) fs.copyFileSync(cfg, path.join(dist, 'supabase.config.json'));
  console.log('dist:', path.join(dist, 'index.html'));
}
