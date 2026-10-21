#!/usr/bin/env python3
"""アグリERP: 分割ソースを単一HTMLファイルに結合する"""
import os, re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, 'src')
OUT = os.path.join(BASE, 'build')
os.makedirs(OUT, exist_ok=True)

FILES = ['00-supabase.js', '01-store.js', '02-core.js', '03-views-a.js', '04-views-b.js', '05-print.js', '06-app.js']

shell = open(os.path.join(BASE, 'index.html'), encoding='utf-8').read()
parts = []
for f in FILES:
    code = open(os.path.join(SRC, f), encoding='utf-8').read()
    parts.append(f'/* ===== {f} ===== */\n' + code)

bundle = '\n\n'.join(parts)
assert '</script' not in bundle.lower(), 'bundle contains a closing script tag'

out = shell.replace('<!--#B#-->', '<script>\n' + bundle + '\n</script>')
for f in FILES:
    out = out.replace('<script src="src/%s"></script>\n' % f, '')
assert '<script>' in out
assert 'src="src/' not in out, 'individual script tags must be inlined in build'
assert 'supabase-js' in out, 'supabase-js CDN tag missing'
assert 'localStorage.' not in out and 'localStorage[' not in out, 'localStorage must be abolished'

single = os.path.join(OUT, 'agri-erp.html')
open(single, 'w', encoding='utf-8').write(out)
print('single-file:', single, len(out), 'bytes')

# 検査用に JS バンドルも書き出す（node --check 用）
open(os.path.join(OUT, 'bundle.check.js'), 'w', encoding='utf-8').write(bundle)
print('bundle written for syntax check')
