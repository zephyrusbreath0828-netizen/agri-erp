#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Agri-ERP 取扱説明書 ビルド（2パス目次・PDF変換・ページ番号抽出）"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from build_manual import Manual, OUT, ROOT  # noqa: E402
import content_a  # noqa: E402
import content_b  # noqa: E402

PDF = os.path.join(os.path.dirname(OUT), 'Agri-ERP_取扱説明書_v1.0.pdf')
TOC_JSON = os.path.join(os.path.dirname(OUT), 'toc_pages.json')


def build(entries, pages):
    M = Manual(toc_pages=pages)
    content_a.cover(M, None)
    content_a.revision(M, None)
    content_a.toc_page(M, entries, pages)
    content_b.part0(M)
    content_a.part1(M)
    content_b.part2(M)
    content_b.part3(M)
    content_b.part4(M)
    return M


def to_pdf(docx):
    subprocess.run(['soffice', '--headless', '--convert-to', 'pdf', '--outdir',
                    os.path.dirname(docx), docx],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not os.path.exists(PDF) or os.path.getsize(PDF) == 0:
        raise SystemExit('PDF conversion failed: ' + PDF)


def pdf_pages_text():
    out = subprocess.run(['pdftotext', '-layout', PDF, '-'], capture_output=True, check=True)
    return out.stdout.decode('utf-8', 'replace').split('\f')


def norm(s):
    return re.sub(r'\s+', '', s)


def extract_pages(pages_text, entries):
    normed = [norm(t) for t in pages_text]
    leader = [i for i, t in enumerate(normed)
              if ('-' * 8 in t) or ('.' * 8 in t)]
    start = (max(leader) + 1) if leader else 0
    result = {}
    cursor = start
    for level, num, title in entries:
        if level == 1 and not num:
            continue
        key = norm(title)
        found = None
        for i in range(cursor, len(normed)):
            if key and key in normed[i]:
                found = i
                break
        if found is not None:
            result[title] = found + 1
            if level == 1:
                cursor = found
        else:
            result[title] = ''
    return result


def main():
    # 1) 見出しの収集
    M0 = build([], {})
    entries = [(lvl, num, title) for (lvl, num, title) in M0.headings]
    print('headings:', len(entries))

    # 2) パスA（目次あり・ページ番号なし）→ PDF → ページ抽出
    M1 = build(entries, {})
    M1.save()
    to_pdf(OUT)
    pages_text = pdf_pages_text()
    pages = extract_pages(pages_text, entries)
    with open(TOC_JSON, 'w', encoding='utf-8') as f:
        json.dump(pages, f, ensure_ascii=False, indent=1)
    missing = [k for k, v in pages.items() if v == '']
    if missing:
        print('WARN unresolved headings:', len(missing))
        for m in missing[:5]:
            print('   -', m)

    # 3) パスB（ページ番号を反映）
    M2 = build(entries, pages)
    M2.save()
    to_pdf(OUT)

    total = len(pdf_pages_text())
    print('pages:', total)
    print('docx:', OUT)
    print('pdf :', PDF)
    if total < 50:
        print('NOTE: 50ページ未満です（目標 50〜100）')
    elif total > 100:
        print('NOTE: 100ページ超です（目標 50〜100）')


if __name__ == '__main__':
    main()
