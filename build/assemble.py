#!/usr/bin/env python3
"""アグリERP: 分割ソースを単一HTMLファイルに結合する

接続情報の扱い（ver 3.6）
  - 環境変数 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY があれば
    window.__AGRI_ENV__ としてバンドル先頭に焼き込む（Vercel ビルド）
  - 無ければ何も焼き込まない（配信時に /api/config・meta・supabase.config.json から解決）
  - どちらの場合もソースコードに接続情報は残らない＝ZIP再生成で失われない

使い方:
  python3 build/assemble.py            # build/agri-erp.html
  python3 build/assemble.py --dist     # build + dist/index.html（Vercel 用）
"""
import os, re, sys, json

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, 'src')
OUT = os.path.join(BASE, 'build')
os.makedirs(OUT, exist_ok=True)

FILES = ['00-supabase.js', '01-store.js', '02-core.js', '03-views-a.js', '04-views-b.js', '07-issuer.js', '05-print.js', '08-tpl-editor.js', '06-app.js']

ENV_URL = os.environ.get('NEXT_PUBLIC_SUPABASE_URL') or os.environ.get('SUPABASE_URL') or ''
ENV_KEY = os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY') or os.environ.get('SUPABASE_ANON_KEY') or ''
ENV_PRELUDE = ''
if ENV_URL and ENV_KEY:
    ENV_PRELUDE = 'window.__AGRI_ENV__=' + json.dumps({
        'NEXT_PUBLIC_SUPABASE_URL': ENV_URL.strip(),
        'NEXT_PUBLIC_SUPABASE_ANON_KEY': ENV_KEY.strip()
    }, ensure_ascii=False) + ';\n'

shell = open(os.path.join(BASE, 'index.html'), encoding='utf-8').read()
parts = []
for f in FILES:
    code = open(os.path.join(SRC, f), encoding='utf-8').read()
    parts.append(f'/* ===== {f} ===== */\n' + code)

bundle = '\n\n'.join(parts)
assert '</script' not in bundle.lower(), 'bundle contains a closing script tag'

out = shell.replace('<!--#B#-->', '<script>\n' + ENV_PRELUDE + bundle + '\n</script>')
for f in FILES:
    out = out.replace('<script src="src/%s"></script>\n' % f, '')
assert '<script>' in out
assert 'src="src/' not in out, 'individual script tags must be inlined in build'
assert 'supabase-js' in out, 'supabase-js CDN tag missing'
assert 'localStorage.' not in out and 'localStorage[' not in out, 'localStorage must be abolished'

single = os.path.join(OUT, 'agri-erp.html')
open(single, 'w', encoding='utf-8').write(out)
print('single-file:', single, len(out), 'bytes')
print('env injection:', 'yes (NEXT_PUBLIC_SUPABASE_*)' if ENV_PRELUDE else 'no (resolved at runtime)')

if '--dist' in sys.argv:
    dist = os.path.join(BASE, 'dist')
    os.makedirs(dist, exist_ok=True)
    open(os.path.join(dist, 'index.html'), 'w', encoding='utf-8').write(out)
    # 任意の静的設定（環境変数が使えないホスティング向け・無ければ何もしない）
    cfg_src = os.path.join(BASE, 'supabase.config.json')
    if os.path.exists(cfg_src):
        open(os.path.join(dist, 'supabase.config.json'), 'w', encoding='utf-8').write(open(cfg_src, encoding='utf-8').read())
    print('dist:', os.path.join(dist, 'index.html'))

# 検査用に JS バンドルも書き出す（node --check 用）
open(os.path.join(OUT, 'bundle.check.js'), 'w', encoding='utf-8').write(bundle)
print('bundle written for syntax check')
