#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Agri-ERP 取扱説明書（Word）生成エンジン。
   content_a.py / content_b.py の BLOCKS を A4 文書へ組み立てる。
   --toc-json を渡すと目次のページ番号を実ページに差し替える（2パス目）。"""
import json
import os
import sys
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_TAB_ALIGNMENT, WD_TAB_LEADER
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHOTS = os.path.join(ROOT, 'shots')
OUT = os.path.join(ROOT, 'docs', 'Agri-ERP_取扱説明書_v1.0.docx')

GREEN = RGBColor(0x0B, 0x5E, 0x46)
GREEN_HEX = '0B5E46'
INK = RGBColor(0x1F, 0x29, 0x37)
GRAY = RGBColor(0x5B, 0x67, 0x78)
RED = RGBColor(0xBE, 0x12, 0x3C)

FONT = '游ゴシック'
FONT_EN = 'Segoe UI'


def set_run_font(run, size=10.5, bold=False, color=None):
    run.font.name = FONT_EN
    run.font.size = Pt(size)
    run.font.bold = bold
    if color is not None:
        run.font.color.rgb = color
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn('w:rFonts'))
    if rfonts is None:
        rfonts = OxmlElement('w:rFonts')
        rpr.append(rfonts)
    rfonts.set(qn('w:ascii'), FONT_EN)
    rfonts.set(qn('w:hAnsi'), FONT_EN)
    rfonts.set(qn('w:eastAsia'), FONT)


def shade(cell_or_par, hex_fill):
    el = cell_or_par._element
    pr = el.find(qn('w:tcPr')) if el.tag.endswith('tc') else el.get_or_add_pPr()
    if pr is None:
        pr = OxmlElement('w:tcPr')
        el.append(pr)
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), hex_fill)
    pr.append(shd)


def cell_text(cell, text, size=9.5, bold=False, color=INK, align=None):
    cell.text = ''
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.15
    if align:
        p.alignment = align
    r = p.add_run(str(text))
    set_run_font(r, size, bold, color)


def no_split(row):
    trPr = row._tr.get_or_add_trPr()
    el = OxmlElement('w:cantSplit')
    trPr.append(el)


def set_col_widths(table, widths_cm):
    for row in table.rows:
        for i, w in enumerate(widths_cm):
            if i < len(row.cells):
                row.cells[i].width = Cm(w)


def add_page_field(par):
    run = par.add_run()
    fld = OxmlElement('w:fldSimple')
    fld.set(qn('w:instr'), 'PAGE')
    r = OxmlElement('w:r')
    t = OxmlElement('w:t')
    t.text = '1'
    r.append(t)
    fld.append(r)
    run._element.addnext(fld)



def path_join_shot(name):
    return os.path.join(SHOTS, name)


def _trim(path):
    """下端の余白（白）を切り落とした複製を返す。失敗時は元画像。"""
    try:
        import numpy as np
        from PIL import Image
        im = Image.open(path).convert('RGB')
        w, h = im.size
        a = np.array(im.convert('L'))
        rows = np.where((a < 245).any(axis=1))[0]
        if len(rows) == 0:
            return path
        bottom = min(h, int(rows.max()) + 30)
        if bottom >= h - 40:
            return path
        outdir = os.path.join(SHOTS, '_doc')
        os.makedirs(outdir, exist_ok=True)
        out = os.path.join(outdir, os.path.basename(path))
        im.crop((0, 0, w, bottom)).save(out)
        return out
    except Exception as e:  # pragma: no cover
        print('trim skipped:', path, e)
        return path


class Manual:
    def __init__(self, toc_pages=None):
        self.doc = Document()
        self.toc_pages = toc_pages or {}
        self.headings = []          # (level, number, title)
        self.cur_chapter = ''
        self.cur_chapter_no = 0
        self._setup()

    # ---------------- 基本設定 ----------------
    def _setup(self):
        d = self.doc
        st = d.styles['Normal']
        st.font.name = FONT_EN
        st.font.size = Pt(10.5)
        st.font.color.rgb = INK
        rpr = st.element.get_or_add_rPr()
        rf = rpr.find(qn('w:rFonts'))
        if rf is None:
            rf = OxmlElement('w:rFonts')
            rpr.append(rf)
        rf.set(qn('w:ascii'), FONT_EN)
        rf.set(qn('w:hAnsi'), FONT_EN)
        rf.set(qn('w:eastAsia'), FONT)
        pf = st.paragraph_format
        pf.line_spacing = 1.45
        pf.space_after = Pt(5)
        pf.space_before = Pt(0)

        sec = d.sections[0]
        sec.page_width = Cm(21.0)
        sec.page_height = Cm(29.7)
        sec.top_margin = Cm(2.0)
        sec.bottom_margin = Cm(1.9)
        sec.left_margin = Cm(2.1)
        sec.right_margin = Cm(2.1)
        sec.header_distance = Cm(0.9)
        sec.footer_distance = Cm(0.9)

        # ヘッダー
        hp = sec.header.paragraphs[0]
        hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        r = hp.add_run('Agri-ERP 取扱説明書 ／ SETOLAS')
        set_run_font(r, 8, False, GRAY)
        # フッター
        fp = sec.footer.paragraphs[0]
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r1 = fp.add_run('— ')
        set_run_font(r1, 8.5, False, GRAY)
        add_page_field(fp)
        r2 = fp.add_run(' —')
        set_run_font(r2, 8.5, False, GRAY)

    # ---------------- 見出し ----------------
    def h1(self, title, number=None, page_break=True):
        if page_break:
            self.page_break()
        d = self.doc
        p = d.add_paragraph()
        p.paragraph_format.space_before = Pt(6)
        p.paragraph_format.space_after = Pt(10)
        r = p.add_run(title)
        set_run_font(r, 19, True, GREEN)
        # 下線（章の帯）
        pPr = p._element.get_or_add_pPr()
        bdr = OxmlElement('w:pBdr')
        bottom = OxmlElement('w:bottom')
        bottom.set(qn('w:val'), 'single')
        bottom.set(qn('w:sz'), '18')
        bottom.set(qn('w:space'), '6')
        bottom.set(qn('w:color'), GREEN_HEX)
        bdr.append(bottom)
        pPr.append(bdr)
        num = number if number else ''
        self.headings.append((1, num, title))

    def h2(self, title, num):
        p = self.doc.add_paragraph()
        p.paragraph_format.space_before = Pt(14)
        p.paragraph_format.space_after = Pt(6)
        p.paragraph_format.keep_with_next = True
        r = p.add_run(title)
        set_run_font(r, 13.5, True, GREEN)
        self.headings.append((2, num, title))
        return p

    def h3(self, title):
        p = self.doc.add_paragraph()
        p.paragraph_format.space_before = Pt(10)
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.keep_with_next = True
        r = p.add_run(title)
        set_run_font(r, 11, True, INK)
        return p

    def p(self, text, size=10.5, color=INK, space=5, indent=0.0, align=None, bold=False):
        par = self.doc.add_paragraph()
        par.paragraph_format.space_after = Pt(space)
        if indent:
            par.paragraph_format.left_indent = Cm(indent)
        if align:
            par.alignment = align
        r = par.add_run(text)
        set_run_font(r, size, bold, color)
        return par

    def bullets(self, items, size=10.5):
        for it in items:
            par = self.doc.add_paragraph(style='List Bullet')
            par.paragraph_format.space_after = Pt(3)
            par.paragraph_format.line_spacing = 1.4
            r = par.add_run(it)
            set_run_font(r, size)

    def page_break(self):
        self.doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    # ---------------- 表 ----------------
    def table(self, head, rows, widths=None, font=9.2, head_fill=GREEN_HEX, zebra=True):
        t = self.doc.add_table(rows=1, cols=len(head))
        no_split(t.rows[0])
        t.style = 'Table Grid'
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        t.autofit = False
        for i, h in enumerate(head):
            c = t.rows[0].cells[i]
            cell_text(c, h, font, True, RGBColor(0xFF, 0xFF, 0xFF), WD_ALIGN_PARAGRAPH.CENTER)
            shade(c, head_fill)
        if widths:
            set_col_widths(t, widths)
        for ri, row in enumerate(rows):
            new_row = t.add_row()
            no_split(new_row)
            cells = new_row.cells
            for i, v in enumerate(row):
                cell_text(cells[i], v, font, False, INK)
                if zebra and ri % 2 == 1:
                    shade(cells[i], 'F1F5F9')
        if widths:
            set_col_widths(t, widths)
        self.doc.add_paragraph().paragraph_format.space_after = Pt(2)
        return t

    # ---------------- 注記ボックス ----------------
    def note(self, label, text, kind='info'):
        fills = {'info': 'EEF6F3', 'warn': 'FFF7E6', 'alert': 'FDECEF'}
        colors = {'info': GREEN, 'warn': RGBColor(0x92, 0x4E, 0x0E), 'alert': RED}
        t = self.doc.add_table(rows=1, cols=1)
        t.style = 'Table Grid'
        t.autofit = False
        cell = t.rows[0].cells[0]
        cell.width = Cm(16.6)
        shade(cell, fills.get(kind, 'EEF6F3'))
        cell.text = ''
        par = cell.paragraphs[0]
        par.paragraph_format.space_before = Pt(3)
        par.paragraph_format.space_after = Pt(3)
        r = par.add_run(label + '　')
        set_run_font(r, 9.8, True, colors.get(kind, GREEN))
        r2 = par.add_run(text)
        set_run_font(r2, 9.8, False, INK)
        self.doc.add_paragraph().paragraph_format.space_after = Pt(2)

    # ---------------- 図＋番号説明 ----------------
    def figure(self, spec):
        path = _trim(path_join_shot(spec['file']))
        par = self.doc.add_paragraph()
        par.alignment = WD_ALIGN_PARAGRAPH.CENTER
        par.paragraph_format.space_before = Pt(4)
        par.paragraph_format.space_after = Pt(2)
        par.paragraph_format.keep_with_next = True
        run = par.add_run()
        width = Cm(spec.get('width', 16.4))
        run.add_picture(path, width=width)
        # 外枠
        cap = self.doc.add_paragraph()
        cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
        cap.paragraph_format.space_after = Pt(9)
        r = cap.add_run(spec['cap'])
        set_run_font(r, 8.8, True, GRAY)

        if spec.get('desc'):
            self.h3('【画面説明】')
            self.p(spec['desc'], size=10.2)

        parts = spec.get('parts') or []
        if parts:
            self.h3('【画面各部説明】')
            for mark, name, text in parts:
                par = self.doc.add_paragraph()
                par.paragraph_format.space_after = Pt(3)
                par.paragraph_format.left_indent = Cm(0.4)
                par.paragraph_format.line_spacing = 1.4
                r1 = par.add_run(mark + '　')
                set_run_font(r1, 11, True, RED)
                r2 = par.add_run(name)
                set_run_font(r2, 10.2, True, INK)
                r3 = par.add_run('　' + text)
                set_run_font(r3, 10.2, False, INK)

    # ---------------- 操作手順ブロック ----------------
    def procedure(self, spec):
        self.h3('【' + spec['title'] + '】')
        rows = []
        rows.append(('目的', spec['purpose']))
        steps = spec['steps']
        rows.append(('操作手順', '\n'.join('{} {}'.format(i + 1, s) for i, s in enumerate(steps))))
        if spec.get('input'):
            rows.append(('入力例', '\n'.join(spec['input'])))
        rows.append(('実行結果', spec['result']))
        t = self.doc.add_table(rows=0, cols=2)
        t.style = 'Table Grid'
        t.autofit = False
        for k, v in rows:
            new_row = t.add_row()
            no_split(new_row)
            cells = new_row.cells
            cell_text(cells[0], k, 9.4, True, GREEN, WD_ALIGN_PARAGRAPH.CENTER)
            shade(cells[0], 'EAF4F0')
            cell_text(cells[1], v, 9.4)
        set_col_widths(t, [2.6, 14.0])
        # 手順表はページをまたいで分割しない（行内の段落に keep_with_next）
        for row in t.rows[:-1]:
            for cell in row.cells:
                for par in cell.paragraphs:
                    par.paragraph_format.keep_with_next = True
        self.doc.add_paragraph().paragraph_format.space_after = Pt(2)

    # ---------------- 体裁 ----------------
    def hrule(self, color=GREEN_HEX, size='8'):
        p = self.doc.add_paragraph()
        pPr = p._element.get_or_add_pPr()
        bdr = OxmlElement('w:pBdr')
        bottom = OxmlElement('w:bottom')
        bottom.set(qn('w:val'), 'single')
        bottom.set(qn('w:sz'), size)
        bottom.set(qn('w:space'), '1')
        bottom.set(qn('w:color'), color)
        bdr.append(bottom)
        pPr.append(bdr)

    def save(self):
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        self.doc.save(OUT)
        return OUT
