/* ==========================================================================
   アグリERP — 担当者管理（ver 3.7）
   受注・発注・入荷・出荷の「誰が担当したか」を users.id で保持する。
   - 氏名の自由入力は禁止。必ずユーザーマスタ（users）から選択する
   - 画面表示時のみ users.name を解決して表示する
   - 担当者候補はログインユーザーと同一 organization_id のユーザーに限定
   - 新規作成時の初期値はログインユーザー（変更可能）
   - 担当者の変更は audit_logs へ記録する（変更前 → 変更後）
   ========================================================================== */

/* 伝票種別 → 担当者列（DB は *_user_id / アプリは camelCase） */
const OWNER_KIND = {
  orders:         { key: 'salesUserId',    label: '担当営業', short: '営業', legacy: 'salesRepId',  noKey: 'orderNo' },
  purchaseOrders: { key: 'purchaseUserId', label: '発注担当', short: '発注', legacy: null,          noKey: 'poNo' },
  receipts:       { key: 'receiptUserId',  label: '受入担当', short: '受入', legacy: 'receivedBy',  noKey: 'receiptNo' },
  shipments:      { key: 'shipmentUserId', label: '出荷担当', short: '出荷', legacy: null,          noKey: 'shipmentNo' }
};
/* 帳票種別 → 担当者を引く伝票種別 */
const OWNER_DOC = {
  quote: 'orders', invoice: 'orders', purchase_order: 'purchaseOrders',
  receipt_note: 'receipts', delivery_note: 'shipments', shipping_slip: 'shipments', picking_list: 'shipments'
};

const Owner = {
  KINDS: ['orders', 'purchaseOrders', 'receipts', 'shipments'],

  /* ------------------------------ 基本 ------------------------------ */
  def(kind) { return OWNER_KIND[kind] || OWNER_KIND.orders; },
  key(kind) { return this.def(kind).key; },
  label(kind) { return this.def(kind).label; },
  user(id) {
    if (!id) return null;
    return (Store.db.users || []).find(u => u.id === id)
      || ((typeof Tenant !== 'undefined' && Tenant.raw ? Tenant.raw('users') : []) || []).find(u => u.id === id)
      || null;
  },
  name(id) { const u = this.user(id); return u ? u.name : ''; },
  code(id) { const u = this.user(id); return u ? (u.ownerCode || '') : ''; },
  dept(id) { const u = this.user(id); return u ? (u.department || '') : ''; },
  /* 表示名（未設定は「—」ではなく明示する） */
  display(id) { return this.name(id) || '未設定'; },
  /* 担当者ID（旧列がある伝票は旧列から読み替える＝既存データを失わない） */
  idOf(kind, rec) {
    if (!rec) return null;
    const d = this.def(kind);
    let v = rec[d.key];
    if (!v && d.legacy) v = rec[d.legacy];
    return v || null;
  },
  record(kind, id) {
    const arr = (Store.db[kind] || []);
    return arr.find(x => x.id === id) || null;
  },
  docNo(kind, rec) {
    if (!rec) return '';
    return rec[this.def(kind).noKey] || rec.id || '';
  },

  /* ------------------------------ 候補（組織で絞り込み） ------------------------------ */
  /* ログインユーザーの organization_id と一致する有効ユーザーのみ。
     表示順は 担当者コード → 氏名（ふりがな昇順相当）。 */
  candidates() {
    const org = (typeof Tenant !== 'undefined') ? Number(Tenant.id()) : 1;
    return (Store.db.users || [])
      .filter(u => u && u.enabled !== false && Number(u.organizationId) === org)
      .slice()
      .sort((a, b) => String(a.ownerCode || 'zzz').localeCompare(String(b.ownerCode || 'zzz'), 'ja')
        || String(a.name || '').localeCompare(String(b.name || ''), 'ja'));
  },
  isCandidate(id) { return this.candidates().some(u => u.id === id); },
  /* 新規作成時の初期値（ログインユーザーが候補内ならその人） */
  defaultId() {
    const u = (typeof Auth !== 'undefined' && Auth) ? Auth.user : null;
    if (u && this.isCandidate(u.id)) return u.id;
    const c = this.candidates()[0];
    return c ? c.id : '';
  },

  /* ------------------------------ 検索付きプルダウン ------------------------------ */
  _pool() {
    return this.candidates().map(u => ({
      id: u.id, name: u.name || '', code: u.ownerCode || '', dept: u.department || ''
    }));
  },
  _opt(u, sel) {
    const sub = [u.code ? `（${u.code}）` : '', u.dept ? ` / ${u.dept}` : ''].join('');
    return `<option value="${esc(u.id)}"${sel === u.id ? ' selected' : ''}>${esc(u.name)}${esc(sub)}</option>`;
  },
  optionsHtml(sel) {
    return `<option value="">（未設定）</option>` + this._pool().map(u => this._opt(u, sel)).join('');
  },
  /* pre: 画面内で一意な接頭辞 / kind: 伝票種別 / rec: 既存レコード（新規は null） */
  pickerHtml(pre, kind, rec, opt) {
    const o = opt || {};
    const d = this.def(kind);
    const sel = rec ? this.idOf(kind, rec) : (o.defaultCurrent ? this.defaultId() : null);
    const org = (typeof Tenant !== 'undefined') ? Tenant.org() : null;
    const n = this.candidates().length;
    return `<div class="opick">
      <input class="inp" id="ows_${esc(pre)}" placeholder="検索（氏名・担当者コード）" autocomplete="off"
        oninput="Owner.filter('${esc(pre)}', this.value)">
      <select class="inp" id="ow_${esc(pre)}" aria-label="${esc(d.label)}">${this.optionsHtml(sel)}</select>
      <div class="tiny muted">${esc(d.label)}の候補：${esc(org ? org.organizationName : '自組織')} 所属 ${n} 名（他組織のユーザーは表示されません）</div>
    </div>`;
  },
  /* 入力に合わせて候補を絞り込む（100名以上でも軽量：option の再生成のみ） */
  filter(pre, q) {
    const sel = document.getElementById('ow_' + pre);
    if (!sel) return;
    const cur = sel.value;
    const kw = String(q || '').trim().toLowerCase();
    const pool = this._pool();
    const hit = !kw ? pool : pool.filter(u => (u.name + ' ' + u.code + ' ' + u.dept).toLowerCase().includes(kw));
    const keep = pool.find(u => u.id === cur);
    sel.innerHTML = `<option value="">（未設定）</option>`
      + hit.map(u => this._opt(u, cur)).join('')
      + (keep && !hit.some(u => u.id === keep.id) ? this._opt(keep, cur) : '');
    sel.value = cur;
  },
  pick(pre) {
    const el = document.getElementById('ow_' + pre);
    return el ? (el.value || null) : null;
  },

  /* ------------------------------ 保存・監査ログ ------------------------------ */
  /* 担当者を設定する。変更があれば audit_logs に「担当者変更」を記録する */
  assign(kind, rec, nextId) {
    if (!rec) return false;
    const d = this.def(kind);
    const prev = this.idOf(kind, rec);
    const next = nextId || null;
    if ((prev || null) === next) return false;
    rec[d.key] = next;
    /* 旧列（受注の営業担当）も同期し、既存の出荷検索・得意先表示と齟齬を出さない */
    if (kind === 'orders' && 'salesRepId' in rec) rec.salesRepId = next;
    try {
      Audit.ownerChange(kind, rec, prev, next);
    } catch (e) { /* 監査ログ失敗でも業務は継続 */ }
    return true;
  },

  /* ------------------------------ 表示制御（権限） ------------------------------
     system_admin : 全組織閲覧（この画面では自組織のデータを表示）
     org_admin    : 自組織のみ
     manager      : 自組織のみ
     user         : 既定は自組織の担当案件のみ（システム設定で「自組織すべて」に変更可能）
     担当者未設定の旧データは、誰の担当でもないため全員に表示する（業務停止を避ける）。 */
  scopeMode() {
    const s = (Store.db.settings || {});
    return s.ownerScope === 'org' ? 'org' : 'mine';
  },
  scopeMine() {
    const r = (typeof Role !== 'undefined') ? Role.of(Auth.user) : 'user';
    return r === 'user' && this.scopeMode() === 'mine';
  },
  scopeLabel() {
    if (this.scopeMine()) return '自分の担当案件のみ表示';
    const r = (typeof Role !== 'undefined') ? Role.of(Auth.user) : 'user';
    return r === 'user' ? '自組織のすべての案件を表示' : '自組織のすべての案件を表示（管理者）';
  },
  setScope(mode) {
    if (!Store.db.settings) Store.db.settings = {};
    Store.db.settings.ownerScope = mode === 'org' ? 'org' : 'mine';
    Store.save();
  },
  canSee(kind, rec) {
    if (!this.scopeMine()) return true;
    const id = this.idOf(kind, rec);
    if (!id) return true;                       /* 未設定の旧データは表示 */
    return !!(Auth.user && Auth.user.id === id);
  },
  visible(kind, rows) {
    const list = rows || [];
    return this.scopeMine() ? list.filter(r => this.canSee(kind, r)) : list;
  },
  /* 絞り込み用セレクト（一覧の検索条件） */
  filterHtml(pre, kind, selected, onChange) {
    const list = this.candidates();
    const fn = onChange || `Owner.setFilter('${esc(pre)}', this.value)`;
    return `<select class="inp" style="max-width:170px" onchange="${fn}">
      <option value="">すべての${esc(this.label(kind))}</option>
      <option value="__none"${selected === '__none' ? ' selected' : ''}>（未設定）</option>
      ${list.map(u => `<option value="${esc(u.id)}"${selected === u.id ? ' selected' : ''}>${esc(u.name)}${u.ownerCode ? '（' + esc(u.ownerCode) + '）' : ''}</option>`).join('')}
    </select>`;
  },
  match(kind, rec, filterId) {
    if (!filterId) return true;
    const id = this.idOf(kind, rec);
    if (filterId === '__none') return !id;
    return id === filterId;
  },

  /* ------------------------------ 帳票 ------------------------------ */
  /* 帳票に表示する担当者名（テンプレートの「担当者表示」が OFF なら空） */
  forDoc(docKind, rec, template) {
    if (template && template.owner === false) return '';
    const kind = OWNER_DOC[docKind];
    if (!kind || !rec) return '';
    let id = this.idOf(kind, rec);
    /* 出荷系は出荷担当 → 受注の担当営業 の順で解決（旧データでも担当が分かるように） */
    if (!id && kind === 'shipments' && rec.orderId) {
      const o = Store.order(rec.orderId);
      if (o) id = this.idOf('orders', o);
    }
    return this.name(id);
  },

  /* ------------------------------ 集計 ------------------------------ */
  inRange(date, from, to) {
    const d = String(date || '').slice(0, 10);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  },
  stats(from, to) {
    const f = from || '', t = to || '';
    const map = {};
    const row = id => {
      const u = id ? this.user(id) : null;
      const key = id || '__none';
      if (!map[key]) map[key] = {
        userId: id || '', name: u ? u.name : '（未設定）', ownerCode: u ? (u.ownerCode || '') : '',
        department: u ? (u.department || '') : '', unassigned: !id,
        orderCnt: 0, orderAmt: 0, poCnt: 0, poAmt: 0,
        rcvCnt: 0, rcvQty: 0, shpCnt: 0, shpQty: 0, shpAmt: 0
      };
      return map[key];
    };
    (Store.db.orders || []).forEach(o => {
      if (!this.inRange(o.orderDate, f, t)) return;
      const r = row(this.idOf('orders', o));
      r.orderCnt += 1; r.orderAmt += Number(o.total || 0);
    });
    (Store.db.purchaseOrders || []).forEach(p => {
      if (!this.inRange(p.orderDate, f, t)) return;
      const r = row(this.idOf('purchaseOrders', p));
      r.poCnt += 1; r.poAmt += Number(p.total || 0);
    });
    (Store.db.receipts || []).forEach(x => {
      if (!this.inRange(x.receiptDate, f, t)) return;
      const r = row(this.idOf('receipts', x));
      r.rcvCnt += 1;
      r.rcvQty += (Store.receiptLines(x.id) || []).reduce((a, l) => a + Number(l.quantity || 0), 0);
    });
    (Store.db.shipments || []).forEach(s => {
      if (!this.inRange(s.shipDate, f, t)) return;
      if (s.status === 'cancelled') return;
      const r = row(this.idOf('shipments', s));
      r.shpCnt += 1;
      r.shpQty += (Store.shipLines(s.id) || []).reduce((a, l) => a + Number(l.quantity || 0), 0);
      r.shpAmt += Number(Store.shipmentAmount(s) || 0);
    });
    /* 候補ユーザーは実績ゼロでも行を出す（担当者別の比較のため） */
    this.candidates().forEach(u => { if (!map[u.id]) row(u.id); });
    return Object.values(map).sort((a, b) =>
      (a.unassigned ? 1 : 0) - (b.unassigned ? 1 : 0)
      || b.orderAmt - a.orderAmt
      || String(a.name).localeCompare(String(b.name), 'ja'));
  },
  /* 今月のランキング（受注件数／出荷件数）と未処理案件数 */
  ranking() {
    const m = TODAY.slice(0, 7);
    const g = {};
    const get = id => (g[id || '__none'] = g[id || '__none'] || { id: id || '', name: this.display(id), orderCnt: 0, shipCnt: 0, pending: 0 });
    (Store.db.orders || []).forEach(o => {
      if (String(o.orderDate || '').slice(0, 7) === m && o.status !== 'cancelled') get(this.idOf('orders', o)).orderCnt++;
    });
    (Store.db.shipments || []).forEach(s => {
      if (String(s.shipDate || '').slice(0, 7) === m && s.status !== 'cancelled') get(this.idOf('shipments', s)).shipCnt++;
    });
    /* 未処理案件数：受注残 + 発注残 + 未確定出荷 */
    (Store.db.orders || []).forEach(o => {
      if (o.status === 'cancelled') return;
      if (Store.orderRemaining(o) > 0) get(this.idOf('orders', o)).pending++;
    });
    (Store.db.purchaseOrders || []).forEach(p => {
      if (p.status === 'cancelled') return;
      if (Store.poRemaining(p) > 0) get(this.idOf('purchaseOrders', p)).pending++;
    });
    (Store.db.shipments || []).forEach(s => {
      if (s.status === 'instructed') get(this.idOf('shipments', s)).pending++;
    });
    const all = Object.values(g);
    const top = (k, n) => all.filter(r => r[k] > 0).sort((a, b) => b[k] - a[k] || String(a.name).localeCompare(String(b.name), 'ja')).slice(0, n);
    return { topOrder: top('orderCnt', 5), topShip: top('shipCnt', 5), pending: all.filter(r => r.pending > 0).sort((a, b) => b.pending - a.pending).slice(0, 5) };
  },
  /* ダッシュボードのカード（担当者別ランキング） */
  rankingHtml() {
    const r = this.ranking();
    const list = (rows, k, unit) => rows.length ? rows.map((x, i) => `<div class="rank-row">
        <span class="rank-no ${i === 0 ? 'top' : ''}">${i + 1}</span>
        <span class="rank-nm">${esc(x.name)}</span>
        <span class="rank-v">${num(x[k])}<small>${unit}</small></span>
      </div>`).join('') : `<div class="tiny muted" style="padding:8px 0">まだ実績がありません</div>`;
    return `<div class="grid g3">
      <div class="card">
        <div class="card-h"><h2>${ico('trend', 16)} 今月の受注件数 TOP5</h2><span class="sub">担当営業別</span>
          <div class="sp"><button class="btn xs" onclick="App.go('ownerReport')">実績へ</button></div></div>
        <div class="card-b">${list(r.topOrder, 'orderCnt', '件')}</div>
      </div>
      <div class="card">
        <div class="card-h"><h2>${ico('truck', 16)} 今月の出荷件数 TOP5</h2><span class="sub">出荷担当別</span></div>
        <div class="card-b">${list(r.topShip, 'shipCnt', '件')}</div>
      </div>
      <div class="card">
        <div class="card-h"><h2>${ico('clock', 16)} 未処理案件数</h2><span class="sub">受注残・発注残・未確定出荷</span></div>
        <div class="card-b">${list(r.pending, 'pending', '件')}</div>
      </div>
    </div>`;
  }
};
