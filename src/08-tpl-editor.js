/* ==========================================================================
   アグリERP — 帳票テンプレート編集（PDFプレビュー付き 2カラムエディタ）
   - 左：テンプレート設定／表示項目設定／レイアウト設定
   - 右：帳票プレビュー（見積書・発注書・納品書・請求書・入庫伝票・出庫伝票）
   - 設定変更はプレビューへ即時反映。PDF出力はプレビューと同一HTMLを印刷（PDF保存）
   - 既存テンプレートは Issuer.tplNorm() で不足項目を補完（移行対応）
   ========================================================================== */

/* プレビュー対象の帳票（ピッキングリストは対象外） */
const TPL_PREVIEW_KINDS = ['quote', 'purchase_order', 'delivery_note', 'invoice', 'receipt_note', 'shipping_slip'];

const TplEditor = {
  state: { open: false, id: null, draft: null, previewKind: null, zoom: 0 },

  /* ------------------------------ 開く／戻る ------------------------------ */
  open(id) {
    const t = id ? Issuer.template(id) : null;
    const kind = (t && t.docKind) || 'quote';
    this.state = {
      open: true, id: id || null, zoom: 0, previewKind: TPL_PREVIEW_KINDS.indexOf(kind) >= 0 ? kind : 'quote',
      draft: Object.assign(Issuer.tplNorm(t || {}), {
        templateCode: (t && t.templateCode) || this.nextCode(kind),
        name: (t && t.name) || (DOC_KIND_LABEL[kind] || '帳票') + 'テンプレート',
        docKind: kind,
        companyId: (t && t.companyId) || null,
        isDefault: !!(t && t.isDefault),
        isActive: !t || t.isActive !== false,
        notes: (t && t.notes) || ''
      })
    };
    App.page = 'docTemplates';
    App.repaint();
    document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('on', el.dataset.nav === 'docTemplates'));
    setTimeout(() => this.fit(), 40);
  },
  close() {
    this.state = { open: false, id: null, draft: null, previewKind: null, zoom: 0 };
    App.repaint();
  },
  nextCode(kind) {
    const p = { quote: 'Q', purchase_order: 'PO', delivery_note: 'DN', invoice: 'IV', receipt_note: 'RN', shipping_slip: 'SL', picking_list: 'PL' }[kind] || 'TP';
    const used = (Store.db.docTemplates || []).map(t => String(t.templateCode || ''));
    for (let i = 1; i < 100; i++) {
      const c = p + '-T' + String(i).padStart(2, '0');
      if (used.indexOf(c) < 0) return c;
    }
    return p + '-T' + Date.now();
  },

  /* ------------------------------ プレビュー生成 ------------------------------ */
  sel() {
    const d = this.state.draft || {};
    let co = (d.companyId && Issuer.company(d.companyId)) || null;
    if (!co) {
      const cos = Issuer.companies(true);
      /* 全社共通テンプレートは「主拠点＋副拠点」が確認できる会社を優先 */
      co = cos.filter(c => Issuer.branches(c.id, true).length >= 2)[0] || cos[0] || null;
    }
    const bs = co ? Issuer.branches(co.id, true) : [];
    return { companyId: co ? co.id : null, branch1Id: (bs[0] || {}).id || null, branch2Id: (bs[1] || {}).id || null };
  },
  previewHtml() {
    const d = this.state.draft;
    if (!d) return '';
    const kind = this.state.previewKind || d.docKind;
    const sel = this.sel();
    return Print.build(kind, Object.assign({}, sel, {
      template: Issuer.tplNorm(d),
      paper: d.paper || 'portrait',
      watermark: d.watermark !== false,
      footer: d.footer !== false
    }));
  },
  refresh() {
    const d = this.state.draft; if (!d || !this.state.open) return;
    const body = document.getElementById('tplPrevBody');
    if (body) body.innerHTML = this.previewHtml();
    this.refreshInfo();
    this.fit();
  },
  refreshInfo() {
    const d = this.state.draft; if (!d) return;
    const el = document.getElementById('tplPrevInfo');
    if (!el) return;
    const kind = this.state.previewKind || d.docKind;
    const on = TPL_FIELDS.filter(f => d[f.key] !== false).length;
    el.innerHTML = `${esc(DOC_KIND_LABEL[kind] || kind)} ／ 表示項目 ${on}/${TPL_FIELDS.length} ／ ${{ main: '主拠点のみ', both: '主拠点＋副拠点', two_col: '2カラム表示' }[d.branchMode || 'both']} ／ ${d.paper === 'landscape' ? 'A4横' : 'A4縦'}`;
  },
  fit() {
    const wrap = document.getElementById('tplPrevWrap'), holder = document.getElementById('tplPrevHolder'), body = document.getElementById('tplPrevBody');
    if (!wrap || !holder || !body) return;
    const sheet = body.querySelector('.sheet');
    if (!sheet) return;
    const w = sheet.offsetWidth || 794;
    const avail = Math.max(240, wrap.clientWidth - 24);
    let s = this.state.zoom > 0 ? this.state.zoom : Math.min(1, avail / w);
    s = Math.min(1.6, Math.max(0.28, s));
    body.style.transform = 'scale(' + s.toFixed(3) + ')';
    body.style.width = w + 'px';
    holder.style.width = (w * s) + 'px';
    holder.style.height = (sheet.offsetHeight * s) + 'px';
    const lbl = document.getElementById('tplZoomLbl');
    if (lbl) lbl.textContent = Math.round(s * 100) + '%';
  },
  zoomBy(delta) {
    const wrap = document.getElementById('tplPrevWrap'), body = document.getElementById('tplPrevBody');
    if (!wrap || !body) return;
    const sheet = body.querySelector('.sheet');
    const w = (sheet && sheet.offsetWidth) || 794;
    const cur = this.state.zoom > 0 ? this.state.zoom : Math.min(1, (wrap.clientWidth - 24) / w);
    this.state.zoom = Math.min(1.6, Math.max(0.28, cur + delta));
    this.fit();
  },
  zoomFit() { this.state.zoom = 0; this.fit(); },

  /* ------------------------------ 入力ハンドラ ------------------------------ */
  set(k, v) {
    const d = this.state.draft; if (!d) return;
    d[k] = v;
    if (k === 'paper') this.refresh();
    else this.refreshInfo();
  },
  setKind(k) {
    const d = this.state.draft; if (!d) return;
    d.docKind = k;
    if (TPL_PREVIEW_KINDS.indexOf(k) >= 0) this.state.previewKind = k;
    this.refresh();
  },
  setCompany(id) {
    const d = this.state.draft; if (!d) return;
    d.companyId = id || null;
    this.refresh();
  },
  previewKind(k) {
    this.state.previewKind = k;
    document.querySelectorAll('[data-pk]').forEach(b => b.classList.toggle('on', b.dataset.pk === k));
    this.refresh();
  },
  /* 表示項目のオン／オフ（即時反映） */
  toggle(k) {
    const d = this.state.draft; if (!d) return;
    d[k] = d[k] === false;
    const el = document.getElementById('te_f_' + k);
    if (el) { el.classList.toggle('on', d[k] !== false); const bx = el.querySelector('.bx'); if (bx) bx.textContent = d[k] !== false ? '✓' : ''; }
    this.refresh();
  },
  /* レイアウト設定（セグメント） */
  seg(k, v) {
    const d = this.state.draft; if (!d) return;
    d[k] = v;
    document.querySelectorAll('[data-seg="' + k + '"]').forEach(b => b.classList.toggle('on', b.dataset.val === String(v)));
    this.refresh();
  },

  /* ------------------------------ 保存・PDF ------------------------------ */
  save() {
    const d = this.state.draft; if (!d) return;
    const code = String(d.templateCode || '').trim(), name = String(d.name || '').trim();
    if (!code || !name) return UI.toast('テンプレートコードと名称は必須です', 'err');
    if ((Store.db.docTemplates || []).some(t => t.templateCode === code && t.id !== this.state.id)) return UI.toast('同じテンプレートコードが既に登録されています', 'err');
    const now = new Date().toISOString();
    const body = {
      templateCode: code, name, docKind: d.docKind, companyId: d.companyId || null,
      isDefault: !!d.isDefault, isActive: d.isActive !== false, notes: d.notes || '',
      branchMode: d.branchMode || 'both', paper: d.paper || 'portrait',
      watermark: d.watermark !== false, footer: d.footer !== false, updatedAt: now
    };
    TPL_FIELDS.forEach(f => { body[f.key] = d[f.key] !== false; });
    if (body.isDefault) {
      (Store.db.docTemplates || []).forEach(t => {
        if (t.id !== this.state.id && t.docKind === body.docKind && (t.companyId || null) === (body.companyId || null)) t.isDefault = false;
      });
    }
    if (this.state.id) Object.assign(Issuer.template(this.state.id), body);
    else Store.db.docTemplates.push(Object.assign({ id: uid(), createdAt: now }, body));
    Store.save();
    UI.toast('テンプレート「' + name + '」を保存しました', 'ok');
    this.close();
  },
  pdf() {
    const html = this.previewHtml();
    if (!html) return UI.toast('プレビューを生成できませんでした', 'err');
    Print.exportPdf(html, { paper: (this.state.draft || {}).paper });
    UI.toast('プレビューと同じ内容を印刷ダイアログに出力しました（「PDFに保存」を選択してください）', 'ok');
  },

  /* ------------------------------ 画面 ------------------------------ */
  toggleBtn(f) {
    const on = this.state.draft[f.key] !== false;
    return `<button class="tgl${on ? ' on' : ''}" id="te_f_${f.key}" onclick="TplEditor.toggle('${f.key}')" aria-pressed="${on}">
      <span class="bx">${on ? '✓' : ''}</span><span>${esc(f.label)}</span></button>`;
  },
  segBtn(k, v, label) {
    const on = String(this.state.draft[k]) === String(v);
    return `<button class="seg-i${on ? ' on' : ''}" data-seg="${k}" data-val="${v}" onclick="TplEditor.seg('${k}','${v}')">${esc(label)}</button>`;
  },

  html() {
    const d = this.state.draft;
    const pk = this.state.previewKind || d.docKind;
    const cos = Issuer.companies(false);
    const left = `
      <div class="card">
        <div class="card-h"><h2>${ico('file', 15)} テンプレート設定</h2></div>
        <div class="card-b">
          <div class="form-grid c2" style="gap:11px">
            <div class="field"><label>テンプレートコード *</label><input class="inp" id="te_code" value="${esc(d.templateCode || '')}" oninput="TplEditor.set('templateCode', this.value)"></div>
            <div class="field"><label>帳票種別 *</label><select class="inp" id="te_kind" onchange="TplEditor.setKind(this.value)">
              ${Object.keys(DOC_KIND_LABEL).map(k => `<option value="${k}"${d.docKind === k ? ' selected' : ''}>${esc(DOC_KIND_LABEL[k])}</option>`).join('')}</select></div>
            <div class="field span2"><label>テンプレート名 *</label><input class="inp" id="te_name" value="${esc(d.name || '')}" oninput="TplEditor.set('name', this.value)"></div>
            <div class="field span2"><label>対象会社</label><select class="inp" id="te_co" onchange="TplEditor.setCompany(this.value)">
              <option value=""${!d.companyId ? ' selected' : ''}>全社共通</option>
              ${cos.map(c => `<option value="${esc(c.id)}"${d.companyId === c.id ? ' selected' : ''}>${esc(c.name)} 専用</option>`).join('')}</select></div>
            <div class="field"><label>標準テンプレート</label><select class="inp" onchange="TplEditor.set('isDefault', this.value === '1')">
              <option value="0"${!d.isDefault ? ' selected' : ''}>使用しない</option>
              <option value="1"${d.isDefault ? ' selected' : ''}>標準として使用</option></select></div>
            <div class="field"><label>有効／無効</label><select class="inp" onchange="TplEditor.set('isActive', this.value === '1')">
              <option value="1"${d.isActive !== false ? ' selected' : ''}>有効</option>
              <option value="0"${d.isActive === false ? ' selected' : ''}>無効</option></select></div>
            <div class="field span2"><label>備考</label><input class="inp" value="${esc(d.notes || '')}" oninput="TplEditor.set('notes', this.value)"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-h"><h2>${ico('check', 15)} 表示項目設定</h2><span class="sub">チェックした項目だけを帳票に印字します</span>
          <div class="sp"><button class="btn xs" onclick="TPL_FIELDS.forEach(f=>{if(TplEditor.state.draft[f.key]===false)TplEditor.toggle(f.key)})">すべて表示</button></div></div>
        <div class="card-b"><div class="tgl-grid">${TPL_FIELDS.map(f => this.toggleBtn(f)).join('')}</div>
          <div class="tiny muted mt8">主拠点・副拠点は「レイアウト設定」の拠点表示方法と組み合わせて制御されます。</div></div>
      </div>

      <div class="card">
        <div class="card-h"><h2>${ico('settings', 15)} レイアウト設定</h2></div>
        <div class="card-b vstack" style="gap:13px">
          <div>
            <label class="lbl">拠点表示</label>
            <div class="seg">${this.segBtn('branchMode', 'main', '主拠点のみ')}${this.segBtn('branchMode', 'both', '主拠点＋副拠点')}${this.segBtn('branchMode', 'two_col', '2カラム表示')}</div>
          </div>
          <div>
            <label class="lbl">用紙</label>
            <div class="seg">${this.segBtn('paper', 'portrait', 'A4 縦')}${this.segBtn('paper', 'landscape', 'A4 横')}</div>
          </div>
          <div>
            <label class="lbl">印字オプション</label>
            <div class="seg">${this.segBtn('watermark', true, '透かし文字')}${this.segBtn('watermark', false, '透かしなし')}</div>
            <div class="seg mt8">${this.segBtn('footer', true, 'フッター表示')}${this.segBtn('footer', false, 'フッターなし')}</div>
          </div>
        </div>
      </div>`;

    const right = `
      <div class="card">
        <div class="card-h"><h2>${ico('eye', 15)} 帳票プレビュー</h2><span class="sub" id="tplPrevInfo"></span>
          <div class="sp hstack" style="gap:6px">
            <button class="btn xs" onclick="TplEditor.zoomBy(-0.1)" title="縮小">－</button>
            <span class="tiny muted" id="tplZoomLbl" style="min-width:38px;text-align:center">100%</span>
            <button class="btn xs" onclick="TplEditor.zoomBy(0.1)" title="拡大">＋</button>
            <button class="btn xs" onclick="TplEditor.zoomFit()">全体</button>
          </div></div>
        <div style="padding:10px 16px;border-bottom:1px solid var(--ink-100)">
          <div class="tabs" style="flex-wrap:wrap">${TPL_PREVIEW_KINDS.map(k => `<button class="tab${pk === k ? ' on' : ''}" data-pk="${k}" onclick="TplEditor.previewKind('${k}')">${esc(DOC_KIND_LABEL[k])}</button>`).join('')}</div>
        </div>
        <div class="card-b tpl-prev-b">
          <div class="tpl-prev-wrap" id="tplPrevWrap">
            <div class="tpl-prev-holder" id="tplPrevHolder">
              <div class="tpl-scale" id="tplPrevBody">${this.previewHtml()}</div>
            </div>
          </div>
          <div class="tiny muted mt8">プレビューは実際の帳票レイアウトに現在の設定を適用したイメージです。PDF出力はこの内容をそのままA4で生成します。</div>
        </div>
      </div>`;

    return `<div class="vstack" style="gap:14px">
      <div class="hstack" style="gap:9px;flex-wrap:wrap">
        <button class="btn sm" onclick="TplEditor.close()">← テンプレート一覧へ</button>
        <div class="sp hstack" style="gap:8px">
          <span class="badge gray">${this.state.id ? '編集中' : '新規作成'}</span>
          <button class="btn sm" onclick="TplEditor.close()">キャンセル</button>
          <button class="btn sm" onclick="TplEditor.pdf()">${ico('printer', 14)} PDF出力</button>
          <button class="btn sm primary" onclick="TplEditor.save()">${ico('check', 14)} 保存</button>
        </div>
      </div>
      <div class="tpl-editor">
        <div class="tpl-left">${left}</div>
        <div class="tpl-right">${right}</div>
      </div>
    </div>`;
  }
};
