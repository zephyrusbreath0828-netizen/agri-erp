/* ==========================================================================
   アグリERP — 発行元マスタ（会社・拠点）／帳票テンプレート／発行元表示制御
   - 会社マスタ（companies）: 複数登録・グループ会社対応
   - 拠点マスタ（branches）  : 会社 1:N 拠点
   - 帳票テンプレート（doc_templates）: 帳票種別ごとの表示項目（☑会社名 ☑住所 …）
   - 伝票ヘッダーへの発行元表示は本モジュールの headerHtml() が唯一の経路。
     表示しない項目・空の項目は HTML 自体を出力しない（空行・空白領域を作らない）。
   ========================================================================== */

/* 表示可否を設定できる項目（§5 表示項目の制御） */
const ISSUER_FIELD_DEFS = [
  { key: 'companyName',  label: '会社名',   scope: 'company', fixed: true },
  { key: 'branchName',   label: '拠点名',   scope: 'branch',  fixed: true },
  { key: 'address',      label: '住所',     scope: 'both' },
  { key: 'tel',          label: 'TEL',      scope: 'both' },
  { key: 'fax',          label: 'FAX',      scope: 'both' },
  { key: 'email',        label: 'メール',   scope: 'both' },
  { key: 'invoiceNumber', label: '登録番号', scope: 'company' },
  { key: 'manager',      label: '担当者',   scope: 'branch' },
  { key: 'logo',         label: 'ロゴ',     scope: 'company' }
];

/* 帳票テンプレート編集画面で表示可否を設定する項目（指示の10項目） */
const TPL_FIELDS = [
  { key: 'companyName', label: '会社名' },
  { key: 'branch1', label: '主拠点' },
  { key: 'branch2', label: '副拠点' },
  { key: 'address', label: '住所' },
  { key: 'tel', label: 'TEL' },
  { key: 'fax', label: 'FAX' },
  { key: 'email', label: 'メール' },
  { key: 'manager', label: '担当者' },
  { key: 'invoiceNumber', label: '登録番号' },
  { key: 'logo', label: 'ロゴ' }
];

/* レイアウト既定値（旧テンプレートはこの値で補完＝既存テンプレート移行対応） */
const TPL_LAYOUT_DEFAULTS = { branchMode: 'both', paper: 'portrait', watermark: true, footer: true };

/* マスタ未設定時の既定値（会社・拠点とも「表示する」） */
const DEFAULT_COMPANY_VISIBLE = { address: true, tel: true, fax: true, email: false, invoiceNumber: true, logo: true };
const DEFAULT_BRANCH_VISIBLE  = { address: true, tel: true, fax: true, email: false, manager: true };

const DOC_KIND_LABEL = {
  quote: '見積書', purchase_order: '発注書', delivery_note: '納品書', invoice: '請求書',
  receipt_note: '入庫伝票', shipping_slip: '出庫伝票', picking_list: 'ピッキングリスト'
};
const DOC_KIND_BADGE = {
  quote: 'sky', purchase_order: 'violet', delivery_note: 'green', invoice: 'green',
  receipt_note: 'amber', shipping_slip: 'sky', picking_list: 'violet'
};

const Issuer = {
  _last: null,   /* 直前に使用した発行元（次の伝票作成時に引き継ぐ） */

  /* ------------------------------ マスタ参照 ------------------------------ */
  companies(onlyActive) {
    const list = (Store.db.companies || []).slice();
    return (onlyActive ? list.filter(c => c.isActive !== false) : list)
      .sort((a, b) => String(a.companyCode || '').localeCompare(String(b.companyCode || '')));
  },
  branches(companyId, onlyActive) {
    const list = (Store.db.branches || []).filter(b => !companyId || b.companyId === companyId);
    return (onlyActive ? list.filter(b => b.isActive !== false) : list)
      .sort((a, b) => String(a.branchCode || '').localeCompare(String(b.branchCode || '')));
  },
  templates(onlyActive) {
    const list = (Store.db.docTemplates || []).slice();
    return (onlyActive ? list.filter(t => t.isActive !== false) : list);
  },
  company(id) { return (Store.db.companies || []).find(c => c.id === id) || null; },
  branch(id) { return (Store.db.branches || []).find(b => b.id === id) || null; },
  template(id) { return (Store.db.docTemplates || []).find(t => t.id === id) || null; },

  companyVisible(c) { return Object.assign({}, DEFAULT_COMPANY_VISIBLE, (c && c.visibleFields) || {}); },
  branchVisible(b) { return Object.assign({}, DEFAULT_BRANCH_VISIBLE, (b && b.visibleFields) || {}); },

  /* テンプレートの既定値補完（旧テンプレート＝表示true・拠点は両方・A4縦として移行） */
  tplNorm(t) {
    const out = Object.assign({}, t || {});
    TPL_FIELDS.forEach(f => { if (out[f.key] === undefined) out[f.key] = true; });
    Object.keys(TPL_LAYOUT_DEFAULTS).forEach(k => { if (out[k] === undefined) out[k] = TPL_LAYOUT_DEFAULTS[k]; });
    return out;
  },

  /* 帳票種別・会社に適合するテンプレート（会社専用 > 共通、標準 > 先頭） */
  templateFor(docKind, companyId) {
    if (!docKind) return null;
    const list = this.templates(true).filter(t => t.docKind === docKind);
    if (!list.length) return null;
    return list.find(t => t.companyId === companyId && t.isDefault)
        || list.find(t => !t.companyId && t.isDefault)
        || list.find(t => t.companyId === companyId)
        || list[0];
  },

  /* 表示判定（テンプレート指定 && マスタの表示可否） */
  show(template, master, key) {
    if (template && template[key] === false) return false;
    if (master && master[key] === false) return false;
    return true;
  },

  /* 伝票レコードから発行元コンテキストを解決（旧データは既定会社へフォールバック） */
  resolve(src) {
    src = src || {};
    const cos = this.companies(true);
    let co = src.companyId ? this.company(src.companyId) : null;
    if (!co) co = this.company((this._last || {}).companyId) || cos[0] || null;
    let b1 = src.branch1Id ? this.branch(src.branch1Id) : null;
    let b2 = src.branch2Id ? this.branch(src.branch2Id) : null;
    if (!co) { b1 = null; b2 = null; }
    if (b1 && co && b1.companyId !== co.id) b1 = null;
    if (b2 && co && b2.companyId !== co.id) b2 = null;
    if (b2 && b1 && b2.id === b1.id) b2 = null;
    const template = src.templateId ? this.template(src.templateId) : this.templateFor(src.docKind, co && co.id);
    return { company: co, branch1: b1, branch2: b2, template };
  },

  /* テーブル表示用のラベル */
  label(rec) {
    const c = (rec.companyId && this.company(rec.companyId)) || this.company(this.resolve(rec).company && this.resolve(rec).company.id);
    if (!c) return '—';
    const b1 = rec.branch1Id ? this.branch(rec.branch1Id) : null;
    const b2 = rec.branch2Id ? this.branch(rec.branch2Id) : null;
    return esc(c.name) + (b1 ? ` <span class="tiny muted">／ ${esc(b1.name)}${b2 ? '・' + esc(b2.name) : ''}</span>` : '');
  },

  /* ------------------------------ 帳票ヘッダーHTML ------------------------------ */
  branchBlock(b, no) {
    if (!b) return '';
    const t = this._tpl;
    const v = this.branchVisible(b);
    const out = [];
    const nm = this.show(t, v, 'branchName') ? b.name : '';
    if (nm) out.push(`<b class="nm">【拠点${no === 1 ? '①' : '②'}】${esc(nm)}</b>`);
    if (this.show(t, v, 'address')) {
      const addr = [(b.postalCode || '').trim(), (b.address || '').trim()].filter(Boolean).join(' ');
      if (addr) out.push(`<span class="il">${esc(addr)}</span>`);
    }
    if (this.show(t, v, 'tel') && b.tel) out.push(`<span class="il">TEL：${esc(b.tel)}</span>`);
    if (this.show(t, v, 'fax') && b.fax) out.push(`<span class="il">FAX：${esc(b.fax)}</span>`);
    if (this.show(t, v, 'email') && b.email) out.push(`<span class="il">E-mail：${esc(b.email)}</span>`);
    if (this.show(t, v, 'manager') && b.managerName) out.push(`<span class="il">担当：${esc(b.managerName)}</span>`);
    return out.length ? `<div class="issuer-br">${out.join('')}</div>` : '';
  },

  /* ctx = { company, branch1, branch2, template } */
  headerHtml(ctx) {
    ctx = ctx || {};
    const c = ctx.company;
    if (!c) return '';
    const t = this.tplNorm(ctx.template);
    this._tpl = t;
    const v = this.companyVisible(c);
    const head = [];
    if (this.show(t, v, 'logo') && c.logoUrl) head.push(`<img class="issuer-logo" src="${esc(c.logoUrl)}" alt="">`);
    if (this.show(t, v, 'companyName') && c.name) head.push(`<b>${esc(c.name)}</b>`);
    const lines = [];
    if (this.show(t, v, 'address')) {
      const addr = [(c.postalCode || '').trim(), (c.address || '').trim()].filter(Boolean).join(' ');
      if (addr) lines.push(`<span class="il">${esc(addr)}</span>`);
    }
    if (this.show(t, v, 'tel') && c.tel) lines.push(`<span class="il">TEL：${esc(c.tel)}</span>`);
    if (this.show(t, v, 'fax') && c.fax) lines.push(`<span class="il">FAX：${esc(c.fax)}</span>`);
    if (this.show(t, v, 'email') && c.email) lines.push(`<span class="il">E-mail：${esc(c.email)}</span>`);
    if (this.show(t, v, 'invoiceNumber') && c.invoiceNumber) lines.push(`<span class="il">登録番号：${esc(c.invoiceNumber)}</span>`);
    const mode = t.branchMode || 'both';
    const b1 = t.branch1 !== false ? this.branchBlock(ctx.branch1, 1) : '';
    const b2 = (mode !== 'main' && t.branch2 !== false) ? this.branchBlock(ctx.branch2, 2) : '';
    const bCls = mode === 'two_col' ? ' two-col' : '';
    const any = head.length || lines.length || b1 || b2;
    if (!any) return '';
    return `<div class="issuer">
      ${head.length ? `<div class="issuer-head">${head.join('')}</div>` : ''}
      ${lines.length ? `<div class="issuer-lines">${lines.join('')}</div>` : ''}
      ${(b1 || b2) ? `<div class="issuer-branches${bCls}">${b1}${b2}</div>` : ''}
    </div>`;
  },

  /* サンプル表示（会社・拠点マスタ画面／フォームのプレビュー） */
  previewHtml(companyId, branch1Id, branch2Id) {
    const html = this.headerHtml(this.resolve({ companyId, branch1Id, branch2Id, docKind: this._previewKind || null }));
    return html || '<div class="tiny muted">発行元の表示項目がありません（会社名など表示可否を確認してください）</div>';
  },

  /* ------------------------------ 選択UI（画面） ------------------------------ */
  companyOptions(sel, onlyActive = true) {
    return this.companies(onlyActive).map(c => `<option value="${esc(c.id)}"${sel === c.id ? ' selected' : ''}>${esc(c.companyCode)} ${esc(c.name)}</option>`).join('');
  },
  branchOptions(companyId, sel, allowEmpty, excludeId) {
    const list = this.branches(companyId, true).filter(b => b.id !== excludeId);
    return (allowEmpty ? `<option value="">（指定しない）</option>` : '')
      + list.map(b => `<option value="${esc(b.id)}"${sel === b.id ? ' selected' : ''}>${esc(b.branchCode)} ${esc(b.name)}</option>`).join('');
  },
  defaultSel() {
    const cos = this.companies(true);
    const last = this._last && cos.find(c => c.id === this._last.companyId) ? this._last : null;
    const co = last ? last.companyId : (cos[0] || {}).id || '';
    const bs = this.branches(co, true);
    const b1 = last ? (bs.find(b => b.id === last.branch1Id) ? last.branch1Id : (bs[0] || {}).id || '') : (bs[0] || {}).id || '';
    return { companyId: co, branch1Id: b1, branch2Id: '' };
  },

  /* 伝票作成フォームへ埋め込む発行元セレクタ（会社→拠点①→拠点②のカスケード） */
  pickerHtml(prefix, sel, opt) {
    opt = opt || {};
    const d = Object.assign({}, this.defaultSel(), sel || {});
    if (sel && sel.companyId) d.companyId = sel.companyId;
    if (sel && 'branch1Id' in sel) d.branch1Id = sel.branch1Id || '';
    if (sel && 'branch2Id' in sel) d.branch2Id = sel.branch2Id || '';
    const cosAll = this.companies(true);
    if (!d.companyId || !cosAll.some(c => c.id === d.companyId)) d.companyId = (cosAll[0] || {}).id || '';
    if (d.branch1Id && !this.branches(d.companyId, true).some(b => b.id === d.branch1Id)) d.branch1Id = '';
    if (d.branch2Id && (!this.branches(d.companyId, true).some(b => b.id === d.branch2Id) || d.branch2Id === d.branch1Id)) d.branch2Id = '';
    const cos = this.companies(true);
    if (!cos.length) return `<div class="note amber">会社マスタが未登録です。システム → 会社・拠点マスタ から登録してください。</div>`;
    this._previewKind = opt.docKind || null;
    return `<div class="issuer-picker">
      <div class="field"><label>発行会社 *</label><select class="inp" id="${prefix}_co" onchange="Issuer.onCompanyChange('${prefix}', this.value)">${this.companyOptions(d.companyId)}</select></div>
      <div class="field"><label>発行拠点①</label><select class="inp" id="${prefix}_b1" onchange="Issuer.onBranch1Change('${prefix}', this.value)">${this.branchOptions(d.companyId, d.branch1Id, true)}</select></div>
      <div class="field"><label>発行拠点②（任意）</label><select class="inp" id="${prefix}_b2" onchange="Issuer.onPickChange('${prefix}')">${this.branchOptions(d.companyId, d.branch2Id, true, d.branch1Id)}</select></div>
    </div>
    <div class="issuer-preview" id="${prefix}_prev">${this.previewHtml(d.companyId, d.branch1Id, d.branch2Id)}</div>`;
  },

  _el(id) { return document.getElementById(id); },
  onCompanyChange(prefix, companyId) {
    const b1 = this._el(prefix + '_b1'), b2 = this._el(prefix + '_b2');
    const first = (this.branches(companyId, true)[0] || {}).id || '';
    if (b1) b1.innerHTML = this.branchOptions(companyId, first, true);
    if (b2) b2.innerHTML = this.branchOptions(companyId, '', true, first);
    this.onPickChange(prefix);
  },
  onBranch1Change(prefix, branch1Id) {
    const b2 = this._el(prefix + '_b2');
    const co = this._el(prefix + '_co');
    if (b2) {
      const keep = (this.branches(co ? co.value : '', true).some(b => b.id === b2.value) && b2.value !== branch1Id) ? b2.value : '';
      b2.innerHTML = this.branchOptions(co ? co.value : '', keep, true, branch1Id);
    }
    this.onPickChange(prefix);
  },
  onPickChange(prefix) {
    const co = this._el(prefix + '_co'), b1 = this._el(prefix + '_b1'), b2 = this._el(prefix + '_b2');
    const prev = this._el(prefix + '_prev');
    if (prev) prev.innerHTML = this.previewHtml(co ? co.value : '', b1 ? b1.value : '', b2 ? b2.value : '');
  },

  read(prefix) {
    const co = this._el(prefix + '_co'), b1 = this._el(prefix + '_b1'), b2 = this._el(prefix + '_b2');
    if (!co) return { companyId: null, branch1Id: null, branch2Id: null };
    const out = {
      companyId: co.value || null,
      branch1Id: (b1 && b1.value) || null,
      branch2Id: (b2 && b2.value) || null
    };
    if (out.branch2Id && out.branch1Id === out.branch2Id) out.branch2Id = null;
    this._last = { companyId: out.companyId, branch1Id: out.branch1Id };
    return out;
  },

  /* 入力検証（発行会社必須・拠点は会社配下のみ・①と②の重複禁止） */
  validate(prefix) {
    const s = this.read(prefix);
    if (!s.companyId) return '発行会社は必須です';
    const co = this.company(s.companyId);
    if (!co || co.isActive === false) return '選択した発行会社は無効です';
    if (s.branch1Id && (!this.branch(s.branch1Id) || this.branch(s.branch1Id).companyId !== co.id)) return '発行拠点①は発行会社の配下から選択してください';
    if (s.branch2Id && (!this.branch(s.branch2Id) || this.branch(s.branch2Id).companyId !== co.id)) return '発行拠点②は発行会社の配下から選択してください';
    if (s.branch1Id && s.branch2Id && s.branch1Id === s.branch2Id) return '発行拠点①と②には別の拠点を選択してください';
    return null;
  },

  /* レコードへ保存する発行元スナップショット（新規作成時に使用） */
  stamp(prefix) {
    const s = this.read(prefix);
    return { companyId: s.companyId, branch1Id: s.branch1Id, branch2Id: s.branch2Id };
  }
};

/* ==========================================================================
   会社・拠点マスタ 画面
   ========================================================================== */
let coQ = '';

Views.companies = () => {
  const all = Issuer.companies(false);
  const active = all.filter(c => c.isActive !== false);
  const branchAll = Issuer.branches('', false);
  const tplAll = Issuer.templates(false);
  const q = coQ.toLowerCase();
  const cos = all.filter(c => !q || (c.companyCode + c.name + (c.address || '') + (c.tel || '')).toLowerCase().includes(q));

  const rows = cos.map(c => {
    const bs = Issuer.branches(c.id, false);
    return `<tr>
      <td class="mono">${esc(c.companyCode)}</td>
      <td><span class="strong">${esc(c.name)}</span>${c.notes ? `<div class="tiny muted">${esc(c.notes)}</div>` : ''}</td>
      <td class="tiny">${esc(c.postalCode || '')} ${esc(c.address || '—')}</td>
      <td class="sm">${esc(c.tel || '—')}${c.fax ? `<div class="tiny muted">FAX ${esc(c.fax)}</div>` : ''}</td>
      <td class="mono tiny">${esc(c.invoiceNumber || '—')}</td>
      <td class="num">${bs.length}</td>
      <td>${c.isActive === false ? '<span class="badge gray">無効</span>' : '<span class="badge green">有効</span>'}</td>
      <td class="right"><div class="tb-act">
        <button class="btn xs" onclick="IssuerAdmin.branchForm('','${c.id}')">拠点追加</button>
        <button class="btn xs" onclick="IssuerAdmin.companyForm('${c.id}')">編集</button>
        <button class="btn xs" onclick="IssuerAdmin.toggleCompany('${c.id}')">${c.isActive === false ? '有効化' : '無効化'}</button>
      </div></td></tr>`;
  }).join('');

  const branchRows = branchAll.map(b => {
    const co = Issuer.company(b.companyId) || {};
    return `<tr>
      <td class="mono">${esc((co.companyCode || '') + ' / ' + (b.branchCode || ''))}</td>
      <td class="strong">${esc(b.name)}<div class="tiny muted">${esc(co.name || '—')}</div></td>
      <td class="tiny">${esc(b.postalCode || '')} ${esc(b.address || '—')}</td>
      <td class="sm">${esc(b.tel || '—')}${b.fax ? `<div class="tiny muted">FAX ${esc(b.fax)}</div>` : ''}</td>
      <td class="sm">${esc(b.managerName || '—')}</td>
      <td>${b.isActive === false ? '<span class="badge gray">無効</span>' : '<span class="badge green">有効</span>'}</td>
      <td class="right"><div class="tb-act">
        <button class="btn xs" onclick="IssuerAdmin.branchForm('${b.id}','${b.companyId}')">編集</button>
        <button class="btn xs" onclick="IssuerAdmin.toggleBranch('${b.id}')">${b.isActive === false ? '有効化' : '無効化'}</button>
        <button class="btn xs danger" onclick="IssuerAdmin.deleteBranch('${b.id}')">削除</button>
      </div></td></tr>`;
  }).join('');

  const samples = active.slice(0, 3).map(c => {
    const bs = Issuer.branches(c.id, true);
    return `<div class="issuer-sample">
      <div class="tiny muted mb8">${esc(c.name)} の発行元表示プレビュー（${bs.length ? esc(bs.slice(0, 2).map(b => b.name).join('・')) : '拠点なし'}）</div>
      ${Issuer.headerHtml(Issuer.resolve({ companyId: c.id, branch1Id: (bs[0] || {}).id, branch2Id: (bs[1] || {}).id }))}
    </div>`;
  }).join('');

  return `<div class="vstack" style="gap:16px">
    <div class="grid g4">
      ${kpiCard({ label: '会社マスタ', icon: 'factory', bg: 'var(--green-100)', fg: 'var(--green-700)', value: all.length, unit: '社', foot: `有効 ${active.length} 社` })}
      ${kpiCard({ label: '拠点マスタ', icon: 'users', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: branchAll.length, unit: '拠点', foot: `有効 ${branchAll.filter(b => b.isActive !== false).length} 拠点` })}
      ${kpiCard({ label: '帳票テンプレート', icon: 'printer', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: tplAll.length, unit: '件', foot: `標準 ${tplAll.filter(t => t.isDefault).length} 件` })}
      ${kpiCard({ label: 'グループ会社', icon: 'layers', bg: 'var(--amber-100)', fg: 'var(--amber-600)', value: active.length, unit: '社', foot: '伝票発行時に選択できます' })}
    </div>

    <div class="note green">${ico('factory', 15)} 伝票（見積書・発注書・納品書・請求書・入庫伝票・出庫伝票など）の上部には、選択した<b>発行会社</b>と<b>発行拠点（最大2件）</b>が印字されます。表示する項目は会社・拠点ごと、および帳票テンプレートで制御できます。</div>

    <div class="card">
      <div class="card-h"><h2>${ico('factory', 16)} 会社マスタ</h2><span class="sub">複数のグループ会社・法人を登録できます</span>
        <div class="sp hstack">
          <div style="position:relative;min-width:200px">
            <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--ink-400)">${ico('search', 16)}</span>
            <input class="inp" style="padding-left:34px" placeholder="会社コード・会社名・住所" value="${esc(coQ)}" oninput="coQ=this.value;App.repaint()">
          </div>
          <button class="btn sm primary" onclick="IssuerAdmin.companyForm('')">${ico('plus', 14)} 会社を登録</button>
        </div>
      </div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>コード</th><th>会社名</th><th>所在地</th><th>連絡先</th><th>登録番号</th><th class="right">拠点</th><th>状態</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8">${emptyBox('会社が登録されていません', '「会社を登録」から追加してください')}</td></tr>`}</tbody>
      </table></div></div>
    </div>

    <div class="card">
      <div class="card-h"><h2>${ico('users', 16)} 拠点マスタ</h2><span class="sub">会社 1 : N 拠点（伝票には最大2拠点を印字）</span>
        <div class="sp"><button class="btn sm primary" onclick="IssuerAdmin.branchForm('','${(active[0] || {}).id || ''}')">${ico('plus', 14)} 拠点を登録</button></div></div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>会社／拠点コード</th><th>拠点名</th><th>所在地</th><th>連絡先</th><th>担当者</th><th>状態</th><th></th></tr></thead>
        <tbody>${branchRows || `<tr><td colspan="7">${emptyBox('拠点が登録されていません', '会社を登録したうえで拠点を追加してください')}</td></tr>`}</tbody>
      </table></div></div>
    </div>

    <div class="card">
      <div class="card-h"><h2>${ico('eye', 16)} 発行元表示プレビュー</h2><span class="sub">帳票に印字される内容（非表示・空の項目は出力されません）</span></div>
      <div class="card-b"><div class="grid g3">${samples || emptyBox('プレビューがありません', '会社を登録してください')}</div></div>
    </div>
  </div>`;
};

/* ==========================================================================
   帳票テンプレート 画面
   ========================================================================== */
Views.docTemplates = () => {
  if (typeof TplEditor !== 'undefined' && TplEditor.state.open) return TplEditor.html();
  const list = Issuer.templates(false);
  const kinds = Object.keys(DOC_KIND_LABEL);
  const rows = list.map(t => {
    const co = t.companyId ? Issuer.company(t.companyId) : null;
    const on = ISSUER_FIELD_DEFS.filter(f => t[f.key] !== false).map(f => f.label);
    const off = ISSUER_FIELD_DEFS.filter(f => t[f.key] === false).map(f => f.label);
    return `<tr>
      <td class="mono">${esc(t.templateCode || '')}</td>
      <td class="strong">${esc(t.name)}${t.notes ? `<div class="tiny muted">${esc(t.notes)}</div>` : ''}</td>
      <td><span class="badge ${DOC_KIND_BADGE[t.docKind] || 'gray'}">${esc(DOC_KIND_LABEL[t.docKind] || t.docKind)}</span></td>
      <td class="sm">${co ? esc(co.name) : '<span class="badge gray">全社共通</span>'}</td>
      <td class="tiny">${on.map(x => `<span class="badge green">${esc(x)}</span>`).join(' ')}${off.length ? ' ' + off.map(x => `<span class="badge gray">${esc(x)}</span>`).join(' ') : ''}</td>
      <td>${t.isDefault ? '<span class="badge amber">標準</span>' : '<span class="muted">—</span>'}</td>
      <td>${t.isActive === false ? '<span class="badge gray">無効</span>' : '<span class="badge green">有効</span>'}</td>
      <td class="right"><div class="tb-act">
        <button class="btn xs" onclick="IssuerAdmin.templateForm('${t.id}')">編集</button>
        <button class="btn xs" onclick="IssuerAdmin.duplicateTemplate('${t.id}')">複製</button>
        <button class="btn xs danger" onclick="IssuerAdmin.deleteTemplate('${t.id}')">削除</button>
      </div></td></tr>`;
  }).join('');

  return `<div class="vstack" style="gap:16px">
    <div class="grid g3">
      ${kpiCard({ label: 'テンプレート数', icon: 'printer', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: list.length, unit: '件', foot: '帳票種別ごとに複数登録できます' })}
      ${kpiCard({ label: '帳票種別', icon: 'file', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: kinds.filter(k => list.some(t => t.docKind === k)).length, unit: '種', foot: '見積書・発注書・納品書・請求書・入庫・出庫' })}
      ${kpiCard({ label: '標準テンプレート', icon: 'check', bg: 'var(--green-100)', fg: 'var(--green-700)', value: list.filter(t => t.isDefault).length, unit: '件', foot: '帳票発行時に自動適用' })}
    </div>
    <div class="note">${ico('printer', 15)} テンプレートごとに <b>☑会社名 ☑拠点名 ☑住所 ☑TEL ☑FAX ☑登録番号 ☐メール ☑ロゴ</b> の表示可否を設定できます。同じ帳票種別で「標準」に設定されたテンプレートが発行時に使われます（会社専用テンプレートが優先）。</div>
    <div class="card">
      <div class="card-h"><h2>${ico('printer', 16)} 帳票テンプレート</h2><span class="sub">表示項目の組み合わせを定義</span>
        <div class="sp"><button class="btn sm primary" onclick="IssuerAdmin.templateForm('')">${ico('plus', 14)} テンプレートを登録</button></div></div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>コード</th><th>テンプレート名</th><th>帳票種別</th><th>対象会社</th><th>表示項目</th><th>標準</th><th>状態</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8">${emptyBox('テンプレートがありません', '標準テンプレートを自動生成するには再読み込みしてください')}</td></tr>`}</tbody>
      </table></div></div>
    </div>
  </div>`;
};

/* ==========================================================================
   マスタ管理アクション
   ========================================================================== */
const chkBox = (id, label, on) => `<label class="chk"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><span>${esc(label)}</span></label>`;

const IssuerAdmin = {
  /* ------------------------- 会社 ------------------------- */
  companyForm(id) {
    const c = id ? Issuer.company(id) : null;
    const v = Issuer.companyVisible(c);
    UI.modal(c ? '会社を編集' : '会社を登録', c ? c.name : 'グループ会社・自社を登録します（複数登録可）', `
      <div class="form-grid">
        <div class="field"><label>会社コード *</label><input class="inp" id="co_code" value="${esc(c ? c.companyCode : '')}" placeholder="C001"></div>
        <div class="field span2"><label>会社名 *</label><input class="inp" id="co_name" value="${esc(c ? c.name : '')}" placeholder="例：セトラスホールディングス株式会社"></div>
        <div class="field"><label>郵便番号</label><input class="inp" id="co_postal" value="${esc(c ? c.postalCode : '')}" placeholder="〒761-0000"></div>
        <div class="field span2"><label>住所</label><input class="inp" id="co_addr" value="${esc(c ? c.address : '')}" placeholder="香川県高松市○○町1-2-3"></div>
        <div class="field"><label>電話番号</label><input class="inp" id="co_tel" value="${esc(c ? c.tel : '')}" placeholder="087-000-0000"></div>
        <div class="field"><label>FAX番号</label><input class="inp" id="co_fax" value="${esc(c ? c.fax : '')}" placeholder="087-000-0001"></div>
        <div class="field"><label>メールアドレス</label><input class="inp" id="co_mail" value="${esc(c ? c.email : '')}"></div>
        <div class="field"><label>適格請求書登録番号</label><input class="inp" id="co_inv" value="${esc(c ? c.invoiceNumber : '')}" placeholder="T1234567890123"></div>
        <div class="field"><label>ロゴ画像URL</label><input class="inp" id="co_logo" value="${esc(c ? c.logoUrl : '')}" placeholder="https://…/logo.png"></div>
        <div class="field"><label>有効／無効</label><select class="inp" id="co_active">
          <option value="1"${!c || c.isActive !== false ? ' selected' : ''}>有効</option>
          <option value="0"${c && c.isActive === false ? ' selected' : ''}>無効</option></select></div>
        <div class="field span3"><label>備考</label><input class="inp" id="co_notes" value="${esc(c ? c.notes : '')}"></div>
      </div>
      <div class="hr"></div>
      <b class="sm">帳票への表示項目</b><span class="tiny muted">（チェックを外した項目は帳票に出力されません）</span>
      <div class="chk-row mt8">${ISSUER_FIELD_DEFS.filter(f => f.scope !== 'branch').map(f => chkBox('co_v_' + f.key, f.label, v[f.key] !== false)).join('')}</div>
      <div class="note mt12">住所を非表示にすると郵便番号も出力されません。ロゴはURLを登録した場合のみ印字されます。</div>`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="IssuerAdmin.saveCompany('${id || ''}')">${ico('check', 15)} 保存</button>`);
  },
  saveCompany(id) {
    const g = n => (document.getElementById(n) || {}).value || '';
    const code = g('co_code').trim(), name = g('co_name').trim();
    if (!code || !name) return UI.toast('会社コードと会社名は必須です', 'err');
    if ((Store.db.companies || []).some(c => c.companyCode === code && c.id !== id)) return UI.toast('同じ会社コードが既に登録されています', 'err');
    const visibleFields = {};
    ISSUER_FIELD_DEFS.filter(f => f.scope !== 'branch').forEach(f => { visibleFields[f.key] = !!document.getElementById('co_v_' + f.key)?.checked; });
    const now = new Date().toISOString();
    const body = { companyCode: code, name, postalCode: g('co_postal'), address: g('co_addr'), tel: g('co_tel'), fax: g('co_fax'),
      email: g('co_mail'), invoiceNumber: g('co_inv'), logoUrl: g('co_logo'), notes: g('co_notes'),
      isActive: g('co_active') !== '0', visibleFields, updatedAt: now };
    if (id) Object.assign(Issuer.company(id), body);
    else Store.db.companies.push(Object.assign({ id: uid(), createdAt: now }, body));
    Store.save(); UI.closeModal(); App.repaint();
    UI.toast(`会社「${name}」を${id ? '更新' : '登録'}しました`, 'ok');
  },
  toggleCompany(id) {
    const c = Issuer.company(id); if (!c) return;
    if (c.isActive !== false && Issuer.companies(true).length <= 1) return UI.toast('有効な会社が1社のみのため無効化できません', 'err');
    c.isActive = c.isActive === false; c.updatedAt = new Date().toISOString();
    Store.save(); App.repaint(); UI.toast(`会社「${c.name}」を${c.isActive ? '有効化' : '無効化'}しました`, 'ok');
  },

  /* ------------------------- 拠点 ------------------------- */
  branchForm(id, companyId) {
    const b = id ? Issuer.branch(id) : null;
    const coId = (b && b.companyId) || companyId || (Issuer.companies(true)[0] || {}).id || '';
    if (!coId) return UI.toast('先に会社マスタを登録してください', 'err');
    const v = Issuer.branchVisible(b);
    UI.modal(b ? '拠点を編集' : '拠点を登録', b ? b.name : '会社配下に拠点を登録します（1社に複数可）', `
      <div class="form-grid">
        <div class="field span2"><label>会社 *</label><select class="inp" id="br_co">${Issuer.companies(false).map(c => `<option value="${esc(c.id)}"${coId === c.id ? ' selected' : ''}>${esc(c.companyCode)} ${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>拠点コード *</label><input class="inp" id="br_code" value="${esc(b ? b.branchCode : '')}" placeholder="H001"></div>
        <div class="field span3"><label>拠点名 *</label><input class="inp" id="br_name" value="${esc(b ? b.name : '')}" placeholder="例：高松事業所／神山農場"></div>
        <div class="field"><label>郵便番号</label><input class="inp" id="br_postal" value="${esc(b ? b.postalCode : '')}" placeholder="〒761-0000"></div>
        <div class="field span2"><label>住所</label><input class="inp" id="br_addr" value="${esc(b ? b.address : '')}"></div>
        <div class="field"><label>電話番号</label><input class="inp" id="br_tel" value="${esc(b ? b.tel : '')}"></div>
        <div class="field"><label>FAX番号</label><input class="inp" id="br_fax" value="${esc(b ? b.fax : '')}"></div>
        <div class="field"><label>メールアドレス</label><input class="inp" id="br_mail" value="${esc(b ? b.email : '')}"></div>
        <div class="field"><label>担当者名</label><input class="inp" id="br_mgr" value="${esc(b ? b.managerName : '')}"></div>
        <div class="field"><label>有効／無効</label><select class="inp" id="br_active">
          <option value="1"${!b || b.isActive !== false ? ' selected' : ''}>有効</option>
          <option value="0"${b && b.isActive === false ? ' selected' : ''}>無効</option></select></div>
        <div class="field span3"><label>備考</label><input class="inp" id="br_notes" value="${esc(b ? b.notes : '')}"></div>
      </div>
      <div class="hr"></div>
      <b class="sm">帳票への表示項目</b><span class="tiny muted">（拠点ごとに出力可否を設定）</span>
      <div class="chk-row mt8">${ISSUER_FIELD_DEFS.filter(f => f.scope !== 'company').map(f => chkBox('br_v_' + f.key, f.label, v[f.key] !== false)).join('')}</div>`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="IssuerAdmin.saveBranch('${id || ''}')">${ico('check', 15)} 保存</button>`);
  },
  saveBranch(id) {
    const g = n => (document.getElementById(n) || {}).value || '';
    const code = g('br_code').trim(), name = g('br_name').trim(), companyId = g('br_co');
    if (!code || !name) return UI.toast('拠点コードと拠点名は必須です', 'err');
    if (!companyId) return UI.toast('会社を選択してください', 'err');
    if ((Store.db.branches || []).some(b => b.companyId === companyId && b.branchCode === code && b.id !== id)) return UI.toast('同じ会社に同じ拠点コードが既に登録されています', 'err');
    const visibleFields = {};
    ISSUER_FIELD_DEFS.filter(f => f.scope !== 'company').forEach(f => { visibleFields[f.key] = !!document.getElementById('br_v_' + f.key)?.checked; });
    const now = new Date().toISOString();
    const body = { companyId, branchCode: code, name, postalCode: g('br_postal'), address: g('br_addr'), tel: g('br_tel'), fax: g('br_fax'),
      email: g('br_mail'), managerName: g('br_mgr'), notes: g('br_notes'), isActive: g('br_active') !== '0', visibleFields, updatedAt: now };
    if (id) Object.assign(Issuer.branch(id), body);
    else Store.db.branches.push(Object.assign({ id: uid(), createdAt: now }, body));
    Store.save(); UI.closeModal(); App.repaint();
    UI.toast(`拠点「${name}」を${id ? '更新' : '登録'}しました`, 'ok');
  },
  toggleBranch(id) {
    const b = Issuer.branch(id); if (!b) return;
    b.isActive = b.isActive === false; b.updatedAt = new Date().toISOString();
    Store.save(); App.repaint(); UI.toast(`拠点「${b.name}」を${b.isActive ? '有効化' : '無効化'}しました`, 'ok');
  },
  deleteBranch(id) {
    const b = Issuer.branch(id); if (!b) return;
    const used = ['orders', 'purchaseOrders', 'receipts', 'shipments', 'documents'].some(k =>
      (Store.db[k] || []).some(r => r.branch1Id === id || r.branch2Id === id));
    if (used) { this.toggleBranch(id); return UI.toast('使用中の拠点のため無効化しました', 'warn'); }
    UI.confirm('拠点の削除', `${b.name} を削除します。よろしいですか？`, () => {
      Store.db.branches = Store.db.branches.filter(x => x.id !== id);
      Store.save(); App.repaint(); UI.toast('削除しました', 'ok');
    }, '削除する', 'danger');
  },

  /* ------------------------- 帳票テンプレート ------------------------- */
  templateForm(id) {
    if (typeof TplEditor !== 'undefined') return TplEditor.open(id);
    const t = id ? Issuer.template(id) : null;
    UI.modal(t ? 'テンプレートを編集' : 'テンプレートを登録', t ? t.name : '帳票種別ごとの表示項目を定義します', `
      <div class="form-grid">
        <div class="field"><label>テンプレートコード *</label><input class="inp" id="tp_code" value="${esc(t ? t.templateCode : '')}" placeholder="Q-STD"></div>
        <div class="field span2"><label>テンプレート名 *</label><input class="inp" id="tp_name" value="${esc(t ? t.name : '')}" placeholder="標準見積書"></div>
        <div class="field"><label>帳票種別 *</label><select class="inp" id="tp_kind">
          ${Object.entries(DOC_KIND_LABEL).map(([k, l]) => `<option value="${k}"${t && t.docKind === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div class="field span2"><label>対象会社</label><select class="inp" id="tp_co">
          <option value=""${!t || !t.companyId ? ' selected' : ''}>全社共通</option>
          ${Issuer.companies(false).map(c => `<option value="${esc(c.id)}"${t && t.companyId === c.id ? ' selected' : ''}>${esc(c.name)} 専用</option>`).join('')}</select></div>
        <div class="field"><label>標準テンプレート</label><select class="inp" id="tp_def">
          <option value="0"${!t || !t.isDefault ? ' selected' : ''}>使用しない</option>
          <option value="1"${t && t.isDefault ? ' selected' : ''}>標準として使用</option></select></div>
        <div class="field"><label>有効／無効</label><select class="inp" id="tp_active">
          <option value="1"${!t || t.isActive !== false ? ' selected' : ''}>有効</option>
          <option value="0"${t && t.isActive === false ? ' selected' : ''}>無効</option></select></div>
      </div>
      <div class="hr"></div>
      <b class="sm">帳票に表示する項目</b><span class="tiny muted">（チェックした項目だけを印字します）</span>
      <div class="chk-row mt8">${ISSUER_FIELD_DEFS.map(f => chkBox('tp_v_' + f.key, f.label, !t || t[f.key] !== false)).join('')}</div>
      <div class="field mt12"><label>備考</label><input class="inp" id="tp_notes" value="${esc(t ? t.notes : '')}"></div>`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="IssuerAdmin.saveTemplate('${id || ''}')">${ico('check', 15)} 保存</button>`);
  },
  saveTemplate(id) {
    const g = n => (document.getElementById(n) || {}).value || '';
    const code = g('tp_code').trim(), name = g('tp_name').trim();
    if (!code || !name) return UI.toast('テンプレートコードと名称は必須です', 'err');
    if ((Store.db.docTemplates || []).some(t => t.templateCode === code && t.id !== id)) return UI.toast('同じコードが既に登録されています', 'err');
    const body = { templateCode: code, name, docKind: g('tp_kind'), companyId: g('tp_co') || null,
      isDefault: g('tp_def') === '1', isActive: g('tp_active') !== '0', notes: g('tp_notes'), updatedAt: new Date().toISOString() };
    ISSUER_FIELD_DEFS.forEach(f => { body[f.key] = !!document.getElementById('tp_v_' + f.key)?.checked; });
    if (body.isDefault) {
      (Store.db.docTemplates || []).forEach(t => {
        if (t.id !== id && t.docKind === body.docKind && (t.companyId || null) === (body.companyId || null)) t.isDefault = false;
      });
    }
    if (id) Object.assign(Issuer.template(id), body);
    else Store.db.docTemplates.push(Object.assign({ id: uid(), createdAt: new Date().toISOString() }, body));
    Store.save(); UI.closeModal(); App.repaint();
    UI.toast(`テンプレート「${name}」を${id ? '更新' : '登録'}しました`, 'ok');
  },
  duplicateTemplate(id) {
    const t = Issuer.template(id); if (!t) return;
    const copy = Object.assign({}, t, { id: uid(), templateCode: (t.templateCode || 'TP') + '-C', name: t.name + '（複製）',
      isDefault: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    Store.db.docTemplates.push(copy); Store.save(); App.repaint();
    UI.toast('テンプレートを複製しました', 'ok');
  },
  deleteTemplate(id) {
    const t = Issuer.template(id); if (!t) return;
    UI.confirm('テンプレートの削除', `${t.name} を削除します。よろしいですか？`, () => {
      Store.db.docTemplates = Store.db.docTemplates.filter(x => x.id !== id);
      Store.save(); App.repaint(); UI.toast('削除しました', 'ok');
    }, '削除する', 'danger');
  }
};


/* ==========================================================================
   帳票発行 画面（v3 仕様：見積書・発注書・納品書・請求書・入庫伝票・出庫伝票・ピッキング）
   ※ 04-views-b.js の Views.docs を上書きする（発行元・テンプレート対応）
   ========================================================================== */
let docTab = 'delivery_note';

Views.docs = () => {
  const confirmed = Store.db.shipments.filter(s => s.status === 'confirmed').slice().sort((a, b) => b.shipDate.localeCompare(a.shipDate));
  const orders = Store.db.orders.filter(o => o.status !== 'cancelled').slice().sort((a, b) => b.orderDate.localeCompare(a.orderDate));
  const pos = Store.db.purchaseOrders.slice().sort((a, b) => b.orderDate.localeCompare(a.orderDate));
  const receipts = Store.db.receipts.slice().sort((a, b) => b.receiptDate.localeCompare(a.receiptDate));
  const docs = Store.db.documents.slice().sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || ''))).slice(0, 80);
  const tabs = [
    ['delivery_note', '納品書'], ['shipping_slip', '出庫伝票'], ['picking_list', 'ピッキング'],
    ['quote', '見積書'], ['invoice', '請求書'], ['purchase_order', '発注書'], ['receipt_note', '入庫伝票']
  ];
  const callFor = { delivery_note: 'delivery', shipping_slip: 'slip', picking_list: 'picking', quote: 'quote', invoice: 'invoice', purchase_order: 'purchaseOrder', receipt_note: 'receiptNote' };
  const issuerCell = rec => {
    const c = rec && rec.companyId ? Issuer.company(rec.companyId) : null;
    if (!c) return '<span class="tiny muted">既定会社</span>';
    const b1 = rec.branch1Id ? Issuer.branch(rec.branch1Id) : null;
    const b2 = rec.branch2Id ? Issuer.branch(rec.branch2Id) : null;
    const bs = [b1 && b1.name, b2 && b2.name].filter(Boolean).join('・');
    return `<b class="sm">${esc(c.name)}</b><div class="tiny muted">${esc(bs || '拠点指定なし')}</div>`;
  };
  let rows = [];
  if (docTab === 'delivery_note' || docTab === 'shipping_slip' || docTab === 'picking_list') {
    rows = confirmed.map(s => ({ id: s.id, no: s.shipmentNo, sub: `${s.customerName} ／ ${dJP(s.shipDate)} ／ ${num(Store.shipLines(s.id).reduce((a, l) => a + l.quantity, 0))} 点`, src: s }));
  } else if (docTab === 'quote' || docTab === 'invoice') {
    rows = orders.map(o => ({ id: o.id, no: o.orderNo, sub: `${o.customerName} ／ ${dJP(o.orderDate)} ／ ${money(o.total)}`, src: o }));
  } else if (docTab === 'purchase_order') {
    rows = pos.map(p => ({ id: p.id, no: p.poNo, sub: `${p.supplierName} ／ ${dJP(p.orderDate)} ／ ${money(p.total)}`, src: p }));
  } else {
    rows = receipts.map(r => ({ id: r.id, no: r.receiptNo, sub: `${r.supplierName} ／ ${dJP(r.receiptDate)} ／ ${money(r.total)}`, src: r }));
  }
  const tpl = Issuer.templateFor(docTab, null);
  return `<div class="vstack" style="gap:16px">
    <div class="grid g4">
      ${kpiCard({ label: '発行可能な出荷', icon: 'truck', bg: 'var(--green-100)', fg: 'var(--green-700)', value: confirmed.length, unit: '件', foot: '出荷確定済み' })}
      ${kpiCard({ label: '見積書', icon: 'file', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: Store.db.documents.filter(d => d.docKind === 'quote').length, unit: '枚', foot: 'QT-YYYYMMDD-0001' })}
      ${kpiCard({ label: '請求書', icon: 'yen', bg: 'var(--green-50)', fg: 'var(--green-700)', value: Store.db.documents.filter(d => d.docKind === 'invoice').length, unit: '枚', foot: 'IV-YYYYMMDD-0001' })}
      ${kpiCard({ label: '発行済み帳票', icon: 'printer', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: Store.db.documents.length, unit: '枚', foot: '全帳票の累計' })}
    </div>
    <div class="note">${ico('printer', 15)} 帳票上部には<b>発行会社・発行拠点（最大2件）</b>が印字されます。表示項目はテンプレート「${tpl ? esc(tpl.name) : '組み込みレイアウト'}」と会社・拠点マスタの表示設定に従い、非表示・未入力の項目は出力されません（空行を作りません）。</div>
    <div class="card">
      <div class="card-h"><h2>${ico('printer', 16)} 伝票を発行する</h2><span class="sub">帳票種別を選択してください</span>
        <div class="sp"><button class="btn sm" onclick="App.go('docTemplates')">${ico('settings', 14)} テンプレート設定</button></div></div>
      <div class="card-b tight">
        <div style="padding:12px 16px;border-bottom:1px solid var(--ink-100)">
          <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${docTab === k ? 'on' : ''}" onclick="docTab='${k}';App.repaint()">${l} <span class="cnt">${k === 'delivery_note' || k === 'shipping_slip' || k === 'picking_list' ? confirmed.length : k === 'quote' || k === 'invoice' ? orders.length : k === 'purchase_order' ? pos.length : receipts.length}</span></button>`).join('')}</div>
        </div>
        <div class="card-b" style="padding:14px 16px">
          ${rows.length ? `<div class="vstack">${rows.slice(0, 60).map(r => `<div class="hstack" style="padding:11px 13px;border:1px solid var(--ink-200);border-radius:12px;background:#fff">
            <div style="flex:1;min-width:0"><b class="sm">${esc(r.no)}</b><div class="tiny muted">${esc(r.sub)}</div></div>
            <div style="min-width:160px">${issuerCell(r.src)}</div>
            <div class="tb-act"><button class="btn xs primary" onclick="Print.${callFor[docTab]}('${r.id}')">${ico('print', 13)} 発行</button></div>
          </div>`).join('')}</div>` : emptyBox('発行できる伝票がありません', '帳票種別を切り替えるか、先に出荷確定・受注登録を行ってください')}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-h"><h2>${ico('history', 16)} 帳票発行履歴</h2><span class="badge gray">${Store.db.documents.length}</span></div>
      <div class="card-b tight">${docs.length ? `<div class="table-wrap"><table class="tb">
        <thead><tr><th>帳票番号</th><th>種別</th><th>発行元（会社／拠点）</th><th>宛先</th><th>テンプレート</th><th>発行日時</th><th></th></tr></thead>
        <tbody>${docs.map(d => {
          const t = d.templateId ? Issuer.template(d.templateId) : null;
          return `<tr>
            <td class="mono">${esc(d.docNo)}</td>
            <td><span class="badge ${DOC_KIND_BADGE[d.docKind] || 'gray'}">${esc(DOC_KIND_LABEL[d.docKind] || d.docKind)}</span></td>
            <td>${issuerCell(d)}</td>
            <td class="sm">${esc(d.customerName || '—')}</td>
            <td class="tiny muted">${t ? esc(t.name) : '—'}</td>
            <td class="tiny muted nowrap">${dtJP(d.issuedAt)}</td>
            <td class="right"><button class="btn xs" onclick="Print.reissue('${d.id}')">再発行</button></td></tr>`;
        }).join('')}</tbody>
      </table></div>` : emptyBox('帳票履歴がありません', '帳票を発行すると履歴が残ります')}</div>
    </div>
  </div>`;
};
