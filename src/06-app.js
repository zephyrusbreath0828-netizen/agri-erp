/* ==========================================================================
   アグリERP — ルーティング・画面描画・業務アクション
   ========================================================================== */
const App = {
  page: 'dashboard',
  renderNav() {
    const nav = document.getElementById('nav');
    nav.innerHTML = MENU.map(g => {
      const items = g.items.filter(i => Auth.can(i.id));
      if (!items.length) return '';
      return `<div class="nav-group"><p>${esc(g.group)}</p>${items.map(i => {
        let badgeHtml = '';
        if (i.badge === 'alerts') { const n = Store.alerts().length; if (n) badgeHtml = `<span class="cnt">${n}</span>`; }
        return `<button class="nav-item ${App.page === i.id ? 'on' : ''}" data-nav="${i.id}" onclick="App.go('${i.id}')">${ico(i.icon, 17)}<span>${esc(i.label)}</span>${badgeHtml}</button>`;
      }).join('')}</div>`;
    }).join('');
  },
  go(id) {
    if (!Auth.can(id)) { UI.toast('この機能を利用する権限がありません', 'err'); return; }
    this.page = id;
    UI.closeSidebar();
    const meta = MENU.flatMap(g => g.items).find(i => i.id === id) || { label: id, sub: '' };
    document.getElementById('pgTitle').textContent = meta.label;
    document.getElementById('pgSub').textContent = meta.sub;
    document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('on', el.dataset.nav === id));
    this.repaint();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },
  repaint() {
    const v = document.getElementById('view');
    const fn = Views[this.page];
    v.innerHTML = fn ? fn() : emptyBox('画面がありません', '');
    const n = Store.alerts().length;
    const b = document.getElementById('bellCnt');
    b.textContent = n; b.style.display = n ? 'grid' : 'none';
    const navBadge = document.querySelector('[data-nav="alerts"] .cnt');
    if (navBadge) navBadge.textContent = n;
  },
  /* トップバー：本日のピッキングリストをまとめて印刷 */
  printQuick() {
    const ships = Store.db.shipments.filter(s => s.shipDate === TODAY && s.status !== 'cancelled');
    if (!ships.length) return UI.toast('本日の出荷予定がありません', 'warn');
    const root = document.getElementById('printRoot');
    root.innerHTML = ships.map(s => {
      const lines = Store.shipLines(s.id);
      const docNo = Store.nextNo('PL');
      const ctx = Issuer.resolve(Object.assign({ docKind: 'picking_list' }, s));
      Store.db.documents.unshift({
        id: uid(), docKind: 'picking_list', docNo, shipmentId: s.id, shipmentNo: s.shipmentNo, customerName: s.customerName,
        issuedAt: new Date().toISOString(), printedCount: 1,
        companyId: (ctx.company || {}).id || null, branch1Id: (ctx.branch1 || {}).id || null,
        branch2Id: (ctx.branch2 || {}).id || null, templateId: (ctx.template || {}).id || null
      });
      return `<div class="sheet landscape">
        ${Print.head('ピッキングリスト', docNo, `出荷番号 ${s.shipmentNo} ／ 出荷日 ${dJPfull(s.shipDate)}`, Object.assign({ docKind: 'picking_list' }, s))}
        <div class="sheet-meta" style="margin-top:-4px">
          <div class="box" style="min-width:40%"><div class="t">出荷先</div><div class="v">${esc(s.customerName)} 様</div></div>
          <div class="box" style="min-width:30%"><div class="t">合計数量</div><div class="v">${dec(lines.reduce((a, l) => a + l.quantity, 0))} 点</div></div>
          <div class="box" style="min-width:26%"><div class="t">運送会社</div><div class="v" style="font-size:10pt">${esc(s.carrier || '—')}</div></div>
        </div>
        <table><thead><tr><th style="width:6%">No.</th><th style="width:9%">完了</th><th style="width:13%">保管場所</th><th>品名</th><th style="width:13%">数量</th><th style="width:9%">単位</th></tr></thead>
        <tbody>${lines.map((l, i) => { const it = Store.item(l.itemId) || {}; return `<tr><td style="text-align:center">${i + 1}</td><td style="text-align:center"><span class="pick-chk"></span></td>
          <td style="text-align:center"><b>${esc(it.location || '—')}</b></td><td>${esc(l.itemName)}</td><td class="num" style="font-size:12pt"><b>${dec(l.quantity)}</b></td><td style="text-align:center">${esc(it.unit || '')}</td></tr>`; }).join('')}</tbody></table>
        ${Print.foot(Object.assign({ docKind: 'picking_list' }, s), docNo, s.shipmentNo)}</div>`;
    }).join('');
    Store.save();
    UI.toast(`本日の出荷 ${ships.length} 件のピッキングリストを発行しました`, 'ok');
    setTimeout(() => window.print(), 200);
  }
};

/* ==========================================================================
   業務アクション（受注・発注・入荷・出荷・マスタ）
   ========================================================================== */
const Actions = {

  /* ------------------------- 商品／資材マスタ ------------------------- */
  itemForm(kind, id) {
    const it = id ? Store.item(id) : null;
    const isP = kind === 'product';
    const opts = (sel, list, valKey, lblKey) => list.map(x => `<option value="${x.id}"${sel === x.id ? ' selected' : ''}>${esc(x[lblKey])}</option>`).join('');
    UI.modal(it ? `${it.name} を編集` : (isP ? '商品を新規登録' : '資材を新規登録'), isP ? '商品マスタ' : '資材マスタ', `
      <div class="form-grid">
        <div class="field"><label>コード *</label><input class="inp" id="f_code" value="${esc(it ? it.code : '')}" placeholder="${isP ? 'P016' : 'M011'}"></div>
        <div class="field"><label>品名 *</label><input class="inp" id="f_name" value="${esc(it ? it.name : '')}"></div>
        <div class="field"><label>カナ</label><input class="inp" id="f_kana" value="${esc(it ? it.kana : '')}"></div>
        <div class="field"><label>カテゴリ</label><input class="inp" id="f_cat" value="${esc(it ? it.category : '')}" placeholder="${isP ? '果菜類' : '梱包資材'}"></div>
        <div class="field"><label>単位</label><input class="inp" id="f_unit" value="${esc(it ? it.unit : 'ケース')}"></div>
        <div class="field"><label>規格</label><input class="inp" id="f_spec" value="${esc(it ? it.spec : '')}" placeholder="10kg/ケース"></div>
        ${isP ? `<div class="field"><label>販売単価</label><input class="inp" type="number" id="f_sale" value="${it ? it.salePrice : 0}"></div>` : ''}
        <div class="field"><label>仕入単価</label><input class="inp" type="number" id="f_cost" value="${it ? it.costPrice : 0}"></div>
        <div class="field"><label>発注点</label><input class="inp" type="number" id="f_rop" value="${it ? it.reorderPoint : 0}"></div>
        <div class="field"><label>発注ロット</label><input class="inp" type="number" id="f_roq" value="${it ? it.reorderQty : 0}"></div>
        <div class="field"><label>安全在庫</label><input class="inp" type="number" id="f_safe" value="${it ? it.safetyStock : 0}"></div>
        <div class="field"><label>保管場所</label><input class="inp" id="f_loc" value="${esc(it ? it.location : '')}" placeholder="A-01"></div>
        <div class="field"><label>主仕入先</label><select class="inp" id="f_sup">${opts(it ? it.supplierId : '', Store.db.suppliers, 'id', 'name')}</select></div>
        <div class="field"><label>バーコード（JAN）</label><input class="inp" id="f_jan" value="${esc(it ? it.janCode : '')}" placeholder="将来拡張"></div>
        <div class="field"><label>現在庫${it ? '' : '（初期値）'}</label><input class="inp" type="number" id="f_stock" value="${it ? it.stock : 0}" ${it ? 'readonly title="在庫は入荷・出荷でのみ変動します"' : ''}></div>
        <div class="field span3"><label>備考</label><input class="inp" id="f_notes" value="${esc(it ? it.notes : '')}"></div>
      </div>
      ${it ? '<div class="note mt12">現在庫は入荷（＋）・出荷確定（−）・在庫調整のトランザクション経由でのみ変動します。</div>' : ''}`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.saveItem('${kind}','${id || ''}')">${ico('check', 15)} 保存</button>`);
  },
  saveItem(kind, id) {
    const v = n => document.getElementById(n) ? document.getElementById(n).value : '';
    const code = v('f_code').trim(), name = v('f_name').trim();
    if (!code || !name) return UI.toast('コードと品名は必須です', 'err');
    if (Store.db.items.some(i => i.code === code && i.id !== id)) return UI.toast('同じコードが既に登録されています', 'err');
    if (id) {
      const it = Store.item(id);
      Object.assign(it, {
        code, name, kana: v('f_kana'), category: v('f_cat'), unit: v('f_unit'), spec: v('f_spec'),
        costPrice: +v('f_cost'), reorderPoint: +v('f_rop'), reorderQty: +v('f_roq'), safetyStock: +v('f_safe'),
        location: v('f_loc'), supplierId: v('f_sup'), janCode: v('f_jan'), notes: v('f_notes')
      });
      if (kind === 'product') it.salePrice = +v('f_sale');
      UI.toast(`${name} を更新しました`, 'ok');
    } else {
      const newItem = {
        id: uid(), kind, code, name, kana: v('f_kana'), category: v('f_cat'), unit: v('f_unit'), spec: v('f_spec'),
        salePrice: kind === 'product' ? +v('f_sale') : 0, costPrice: +v('f_cost'), taxRate: 8,
        reorderPoint: +v('f_rop'), reorderQty: +v('f_roq'), safetyStock: +v('f_safe'), stock: 0,
        location: v('f_loc'), supplierId: v('f_sup'), janCode: v('f_jan'), barcode: 'AG' + code, qrPayload: code,
        active: true, notes: v('f_notes')
      };
      Store.db.items.push(newItem);
      const init = +v('f_stock');
      if (init > 0) Store.applyStock(newItem.id, init, 'adjustment', { table: 'items', id: newItem.id, no: '初期在庫', notes: '新規登録時の初期在庫' });
      UI.toast(`${name} を登録しました`, 'ok');
    }
    Store.save(); UI.closeModal(); App.renderNav(); App.repaint();
  },
  deleteItem(id) {
    const it = Store.item(id);
    if (Store.db.orderLines.some(l => l.itemId === id) || Store.db.poLines.some(l => l.itemId === id)) {
      it.active = false; Store.save(); App.repaint(); return UI.toast(`${it.name} は使用中のため無効化しました`, 'warn');
    }
    UI.confirm('削除の確認', `${it.name} を削除します。よろしいですか？`, () => {
      Store.db.items = Store.db.items.filter(i => i.id !== id); Store.save(); App.repaint(); UI.toast('削除しました', 'ok');
    }, '削除する', 'danger');
  },
  stockHistory(id) {
    const it = Store.item(id);
    const mv = Store.db.movements.filter(m => m.itemId === id).slice(0, 40);
    UI.modal(`${it.name} の入出庫履歴`, `現在庫 ${dec(it.stock)} ${it.unit} ／ 発注点 ${dec(it.reorderPoint)}`, `
      <div class="grid g3 mb16">
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">現在庫</div><div class="k-v" style="font-size:21px">${dec(it.stock)}</div></div>
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">入荷累計</div><div class="k-v" style="font-size:21px">${dec(mv.filter(m => m.moveType === 'receipt').reduce((a, m) => a + m.quantity, 0))}</div></div>
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">出荷累計</div><div class="k-v" style="font-size:21px">${dec(Math.abs(mv.filter(m => m.moveType === 'shipment').reduce((a, m) => a + m.quantity, 0)))}</div></div>
      </div>
      <div class="table-wrap"><table class="tb" style="min-width:520px">
        <thead><tr><th>日時</th><th>区分</th><th class="right">増減</th><th class="right">残高</th><th>伝票</th></tr></thead>
        <tbody>${mv.map(m => `<tr><td class="sm nowrap">${dtJP(m.movedAt)}</td>
          <td><span class="badge ${moveBadge(m.moveType)}">${moveLabel(m.moveType)}</span></td>
          <td class="num" style="color:${m.quantity > 0 ? 'var(--green-700)' : 'var(--rose-600)'};font-weight:700">${m.quantity > 0 ? '+' : ''}${dec(m.quantity)}</td>
          <td class="num">${dec(m.balanceAfter)}</td><td class="mono">${esc(m.refNo || '—')}</td></tr>`).join('') || '<tr><td colspan="5" class="center muted">履歴がありません</td></tr>'}</tbody>
      </table></div>`, `<button class="btn" onclick="UI.closeModal()">閉じる</button>`, 'wide');
  },
  adjustStock() {
    UI.modal('在庫調整', '棚卸差異・ロスなどの調整（履歴に記録されます）', `
      <div class="form-grid c2">
        <div class="field span2"><label>対象品目</label><select class="inp" id="a_item">${Store.db.items.map(i => `<option value="${i.id}">${esc(i.code)} ${esc(i.name)}（現在庫 ${dec(i.stock)} ${esc(i.unit)}）</option>`).join('')}</select></div>
        <div class="field"><label>調整区分</label><select class="inp" id="a_type"><option value="adjustment">棚卸調整</option><option value="loss">ロス・廃棄</option><option value="return">返品</option><option value="receipt">入荷（直接）</option></select></div>
        <div class="field"><label>増減数量（マイナスで減算）</label><input class="inp" type="number" id="a_qty" value="0"></div>
        <div class="field span2"><label>理由・備考</label><input class="inp" id="a_notes" placeholder="例：棚卸差異、品質不良による廃棄"></div>
      </div>`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.saveAdjust()">${ico('check', 15)} 調整を実行</button>`);
  },
  saveAdjust() {
    const id = document.getElementById('a_item').value;
    const qty = +document.getElementById('a_qty').value;
    const type = document.getElementById('a_type').value;
    const notes = document.getElementById('a_notes').value;
    if (!qty) return UI.toast('数量を入力してください', 'err');
    const it = Store.item(id);
    if (it.stock + qty < 0) return UI.toast('在庫がマイナスになる調整はできません', 'err');
    Store.applyStock(id, qty, type, { table: 'items', id, no: 'ADJ-' + TODAY.replace(/-/g, ''), notes });
    Store.save(); UI.closeModal(); App.repaint();
    UI.toast(`${it.name} の在庫を ${qty > 0 ? '+' : ''}${dec(qty)} 調整しました`, 'ok');
  },

  /* ------------------------- 得意先・仕入先 ------------------------- */
  customerForm(id) {
    const c = id ? Store.customer(id) : null;
    UI.modal(c ? '得意先を編集' : '得意先を新規登録', '得意先マスタ', `
      <div class="form-grid">
        <div class="field"><label>コード *</label><input class="inp" id="c_code" value="${esc(c ? c.code : '')}" placeholder="C006"></div>
        <div class="field span2"><label>得意先名 *</label><input class="inp" id="c_name" value="${esc(c ? c.name : '')}"></div>
        <div class="field"><label>カナ</label><input class="inp" id="c_kana" value="${esc(c ? c.kana : '')}"></div>
        <div class="field"><label>電話番号</label><input class="inp" id="c_tel" value="${esc(c ? c.tel : '')}"></div>
        <div class="field"><label>担当者</label><input class="inp" id="c_contact" value="${esc(c ? c.contact : '')}"></div>
        <div class="field span3"><label>住所</label><input class="inp" id="c_addr" value="${esc(c ? c.address : '')}"></div>
        <div class="field"><label>締め日</label><input class="inp" type="number" id="c_close" value="${c ? c.closingDay : 31}"></div>
        <div class="field"><label>支払条件</label><input class="inp" id="c_pay" value="${esc(c ? c.paymentTerms : '翌月末')}"></div>
        <div class="field"><label>メール</label><input class="inp" id="c_mail" value="${esc(c ? c.email : '')}"></div>
        <div class="field"><label>営業担当者</label><select class="inp" id="c_rep">
          <option value="">（未設定）</option>
          ${Store.salesReps().map(u => `<option value="${esc(u.id)}"${c && c.salesRepId === u.id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}
        </select><span class="hint">伝票検索の「営業担当者」条件に使用します</span></div>
      </div>`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.saveCustomer('${id || ''}')">${ico('check', 15)} 保存</button>`);
  },
  saveCustomer(id) {
    const g = n => document.getElementById(n).value;
    if (!g('c_code') || !g('c_name')) return UI.toast('コードと得意先名は必須です', 'err');
    const rep = (document.getElementById('c_rep') || {}).value || null;
    if (id) { Object.assign(Store.customer(id), { code: g('c_code'), name: g('c_name'), kana: g('c_kana'), tel: g('c_tel'), contact: g('c_contact'), address: g('c_addr'), closingDay: +g('c_close'), paymentTerms: g('c_pay'), email: g('c_mail'), salesRepId: rep }); UI.toast('得意先を更新しました', 'ok'); }
    else { Store.db.customers.push({ id: uid(), code: g('c_code'), name: g('c_name'), kana: g('c_kana'), tel: g('c_tel'), contact: g('c_contact'), address: g('c_addr'), closingDay: +g('c_close'), paymentTerms: g('c_pay'), email: g('c_mail'), salesRepId: rep, active: true, notes: '' }); UI.toast('得意先を登録しました', 'ok'); }
    Store.save(); UI.closeModal(); App.repaint();
  },
  deleteCustomer(id) {
    if (Store.db.orders.some(o => o.customerId === id)) return UI.toast('受注履歴があるため削除できません', 'err');
    UI.confirm('削除の確認', `${Store.customer(id).name} を削除します。`, () => {
      Store.db.customers = Store.db.customers.filter(c => c.id !== id); Store.save(); App.repaint(); UI.toast('削除しました', 'ok');
    }, '削除する', 'danger');
  },
  supplierForm(id) {
    const s = id ? Store.supplier(id) : null;
    UI.modal(s ? '仕入先を編集' : '仕入先を新規登録', '仕入先マスタ', `
      <div class="form-grid">
        <div class="field"><label>コード *</label><input class="inp" id="s_code" value="${esc(s ? s.code : '')}" placeholder="S005"></div>
        <div class="field span2"><label>仕入先名 *</label><input class="inp" id="s_name" value="${esc(s ? s.name : '')}"></div>
        <div class="field"><label>カナ</label><input class="inp" id="s_kana" value="${esc(s ? s.kana : '')}"></div>
        <div class="field"><label>電話番号</label><input class="inp" id="s_tel" value="${esc(s ? s.tel : '')}"></div>
        <div class="field"><label>担当者</label><input class="inp" id="s_contact" value="${esc(s ? s.contact : '')}"></div>
        <div class="field span3"><label>住所</label><input class="inp" id="s_addr" value="${esc(s ? s.address : '')}"></div>
        <div class="field"><label>締め日</label><input class="inp" type="number" id="s_close" value="${s ? s.closingDay : 31}"></div>
        <div class="field"><label>支払条件</label><input class="inp" id="s_pay" value="${esc(s ? s.paymentTerms : '翌月末')}"></div>
        <div class="field"><label>リードタイム（日）</label><input class="inp" type="number" id="s_lead" value="${s ? s.leadTime : 3}"></div>
      </div>`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.saveSupplier('${id || ''}')">${ico('check', 15)} 保存</button>`);
  },
  saveSupplier(id) {
    const g = n => document.getElementById(n).value;
    if (!g('s_code') || !g('s_name')) return UI.toast('コードと仕入先名は必須です', 'err');
    if (id) { Object.assign(Store.supplier(id), { code: g('s_code'), name: g('s_name'), kana: g('s_kana'), tel: g('s_tel'), contact: g('s_contact'), address: g('s_addr'), closingDay: +g('s_close'), paymentTerms: g('s_pay'), leadTime: +g('s_lead') }); UI.toast('仕入先を更新しました', 'ok'); }
    else { Store.db.suppliers.push({ id: uid(), code: g('s_code'), name: g('s_name'), kana: g('s_kana'), tel: g('s_tel'), contact: g('s_contact'), address: g('s_addr'), closingDay: +g('s_close'), paymentTerms: g('s_pay'), leadTime: +g('s_lead'), active: true, notes: '' }); UI.toast('仕入先を登録しました', 'ok'); }
    Store.save(); UI.closeModal(); App.repaint();
  },
  deleteSupplier(id) {
    if (Store.db.purchaseOrders.some(p => p.supplierId === id)) return UI.toast('発注履歴があるため削除できません', 'err');
    UI.confirm('削除の確認', `${Store.supplier(id).name} を削除します。`, () => {
      Store.db.suppliers = Store.db.suppliers.filter(s => s.id !== id); Store.save(); App.repaint(); UI.toast('削除しました', 'ok');
    }, '削除する', 'danger');
  },

  /* ------------------------- 受注 ------------------------- */
  orderForm() {
    window.__lines = [{ itemId: Store.db.items[0].id, qty: 1, price: Store.db.items[0].salePrice }];
    const c0 = Store.db.customers[0] || {};
    window.__oCust = c0.id || '';
    window.__oRep = c0.salesRepId || ((Store.salesReps()[0] || {}).id || '');
    this._drawOrderForm();
  },
  /* 得意先の変更で営業担当者を既定担当へ追従 */
  chgOrderCust(custId) {
    const c = Store.customer(custId) || {};
    window.__oCust = custId;
    window.__oRep = c.salesRepId || window.__oRep;
    this._drawOrderForm();
  },
  _drawOrderForm() {
    const prev = document.getElementById('o_co') ? Issuer.read('o') : (window.__oIssuer || {});
    window.__oIssuer = prev;
    const body = `
      <div class="form-grid">
        <div class="field"><label>受注番号</label><input class="inp" value="${Store.nextNo('ORD')}" readonly title="保存時に確定します"></div>
        <div class="field"><label>受注日 *</label><input class="inp" type="date" id="o_date" value="${TODAY}"></div>
        <div class="field"><label>納期 *</label><input class="inp" type="date" id="o_due" value="${todayStr(addDays(new Date(), 2))}"></div>
        <div class="field span2"><label>得意先 *</label><select class="inp" id="o_cust" onchange="Actions.chgOrderCust(this.value)">${Store.db.customers.map(x => `<option value="${x.id}"${window.__oCust === x.id ? ' selected' : ''}>${esc(x.code)} ${esc(x.name)}</option>`).join('')}</select></div>
        <div class="field"><label>営業担当者</label><select class="inp" id="o_rep">${Store.salesReps().map(u => `<option value="${esc(u.id)}"${window.__oRep === u.id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>
      </div>

      <div class="hr"></div>
      <div class="hstack mb8"><b style="font-size:13px">${ico('factory', 14)} 発行元情報</b><span class="tiny muted">帳票の上部に印字されます（発行会社は必須）</span></div>
      ${Issuer.pickerHtml('o', prev, { docKind: 'quote' })}
      <div class="hr"></div>
      <div class="hstack mb12"><b style="font-size:13px">受注明細</b><div class="sp"><button class="btn sm" onclick="Actions.addOrderLine()">${ico('plus', 14)} 行を追加</button></div></div>
      <div class="table-wrap"><table class="line-tb" style="min-width:620px">
        <thead><tr><th style="width:40%">商品</th><th style="width:15%">数量</th><th style="width:18%">単価</th><th style="width:18%">金額</th><th></th></tr></thead>
        <tbody>${window.__lines.map((l, i) => `<tr>
          <td><select class="inp" onchange="Actions.updLine(${i},'itemId',this.value)">
            ${Store.db.items.filter(x => x.kind === 'product').map(x => `<option value="${x.id}"${l.itemId === x.id ? ' selected' : ''}>${esc(x.code)} ${esc(x.name)}（在庫 ${dec(x.stock)}）</option>`).join('')}
          </select></td>
          <td><input class="inp num" type="number" value="${l.qty}" oninput="Actions.updLine(${i},'qty',+this.value)"></td>
          <td><input class="inp num" type="number" value="${l.price}" oninput="Actions.updLine(${i},'price',+this.value)"></td>
          <td class="num" style="font-weight:700">${money(l.qty * l.price)}</td>
          <td class="right">${window.__lines.length > 1 ? `<button class="btn xs danger" onclick="Actions.delLine(${i})">${ico('x', 13)}</button>` : ''}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="hr"></div>
      <div class="hstack" style="justify-content:flex-end;gap:22px">
        <span class="sm muted">小計 <b>${money(window.__lines.reduce((a, l) => a + l.qty * l.price, 0))}</b></span>
        <span class="sm muted">消費税 <b>${money(Math.round(window.__lines.reduce((a, l) => a + l.qty * l.price, 0) * .08))}</b></span>
        <span style="font-size:15px;font-weight:800">合計 ${money(Math.round(window.__lines.reduce((a, l) => a + l.qty * l.price, 0) * 1.08))}</span>
      </div>
      <div class="field mt12"><label>備考</label><input class="inp" id="o_remarks" placeholder="納品時のご要望など"></div>`;
    UI.modal('受注登録', '受注番号は保存時に自動採番されます', body,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.saveOrder()">${ico('check', 15)} 受注を登録</button>`, 'wide');
  },
  addOrderLine() { window.__lines.push({ itemId: Store.db.items[0].id, qty: 1, price: Store.db.items[0].salePrice }); this._drawOrderForm(); },
  delLine(i) { window.__lines.splice(i, 1); this._drawOrderForm(); },
  updLine(i, k, v) {
    window.__lines[i][k] = v;
    if (k === 'itemId') window.__lines[i].price = Store.item(v).salePrice;
    this._drawOrderForm();
  },
  saveOrder() {
    const custId = document.getElementById('o_cust').value;
    const lines = window.__lines.filter(l => l.qty > 0);
    if (!lines.length) return UI.toast('明細を1行以上入力してください', 'err');
    const issErr = Issuer.validate('o'); if (issErr) return UI.toast(issErr, 'err');
    const issuer = Issuer.stamp('o');
    const orderNo = Store.nextNo('ORD', document.getElementById('o_date').value);
    let sub = 0;
    const oid = uid();
    const ols = lines.map((l, i) => {
      const it = Store.item(l.itemId); const amt = l.qty * l.price; sub += amt;
      return { id: uid(), orderId: oid, lineNo: i + 1, itemId: l.itemId, itemName: it.name, unit: it.unit,
        quantity: l.qty, unitPrice: l.price, taxRate: 8, amount: amt, shippedQty: 0,
        dueDate: document.getElementById('o_due').value, notes: '' };
    });
    const tax = Math.round(sub * .08);
    Store.db.orders.unshift({
      id: oid, orderNo, customerId: custId, customerName: Store.customer(custId).name,
      salesRepId: (document.getElementById('o_rep') || {}).value || null,
      orderDate: document.getElementById('o_date').value, dueDate: document.getElementById('o_due').value,
      shipDate: document.getElementById('o_due').value, status: 'received',
      companyId: issuer.companyId, branch1Id: issuer.branch1Id, branch2Id: issuer.branch2Id,
      subtotal: sub, tax, total: sub + tax, remarks: document.getElementById('o_remarks').value,
      createdBy: Auth.user ? Auth.user.id : null, createdAt: new Date().toISOString()
    });
    ols.forEach(l => Store.db.orderLines.push(l));
    Store.save(); UI.closeModal(); App.renderNav(); App.repaint();
    UI.toast(`受注 ${orderNo} を登録しました`, 'ok');
  },
  orderDetail(id) {
    const o = Store.order(id);
    const lines = Store.orderLines(o.id);
    UI.modal(`受注 ${o.orderNo}`, `${o.customerName} ／ 受注日 ${dJP(o.orderDate)}`, `
      <div class="grid g3 mb16">
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">受注金額</div><div class="k-v" style="font-size:20px">${money(o.total)}</div></div>
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">納期</div><div class="k-v" style="font-size:20px">${dJP(o.dueDate)}</div><div class="k-f">${relDay(o.dueDate)}</div></div>
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">受注残</div><div class="k-v" style="font-size:20px">${dec(Store.orderRemaining(o))}</div><div class="k-f">${badge(o.status)}</div></div>
      </div>
      <div class="table-wrap"><table class="tb" style="min-width:600px">
        <thead><tr><th>No.</th><th>品名</th><th class="right">受注数</th><th class="right">出荷済</th><th class="right">残</th><th class="right">単価</th><th class="right">金額</th></tr></thead>
        <tbody>${lines.map(l => `<tr><td>${l.lineNo}</td><td class="strong">${esc(l.itemName)}</td>
          <td class="num">${dec(l.quantity)}</td><td class="num muted">${dec(l.shippedQty)}</td>
          <td class="num" style="font-weight:700;color:${l.quantity - l.shippedQty > 0 ? 'var(--rose-600)' : 'inherit'}">${dec(l.quantity - l.shippedQty)}</td>
          <td class="num">${money(l.unitPrice)}</td><td class="num">${money(l.amount)}</td></tr>`).join('')}</tbody>
      </table></div>
      ${o.remarks ? `<div class="note mt12">備考：${esc(o.remarks)}</div>` : ''}
      ${Store.db.shipments.filter(s => s.orderId === o.id).length ? `<div class="hr"></div><b class="sm">関連する出荷</b>
        <div class="table-wrap mt8"><table class="tb" style="min-width:480px"><thead><tr><th>出荷番号</th><th>出荷日</th><th>状態</th></tr></thead>
        <tbody>${Store.db.shipments.filter(s => s.orderId === o.id).map(s => `<tr><td class="mono">${esc(s.shipmentNo)}</td><td class="sm">${dJP(s.shipDate)}</td><td>${s.status === 'confirmed' ? '<span class="badge green">確定</span>' : '<span class="badge amber">指示済</span>'}</td></tr>`).join('')}</tbody></table></div>` : ''}`,
      `<button class="btn" onclick="UI.closeModal()">閉じる</button>
       ${Store.orderRemaining(o) > 0 ? `<button class="btn primary" onclick="UI.closeModal();Actions.newShipFromOrder('${o.id}')">${ico('truck', 15)} 出荷指示を作成</button>` : ''}
       <button class="btn danger" onclick="UI.closeModal();Actions.cancelOrder('${o.id}')">取消</button>`, 'wide');
  },
  cancelOrder(id) {
    const o = Store.order(id);
    UI.confirm('受注の取消', `${o.orderNo} を取消します。よろしいですか？`, () => {
      o.status = 'cancelled'; Store.save(); App.repaint(); UI.toast('受注を取消しました', 'warn');
    }, '取消する', 'danger');
  },

  /* ------------------------- 発注 ------------------------- */
  newPOFor(itemId) {
    const it = itemId ? Store.item(itemId) : null;
    window.__poLines = [it ? { itemId: it.id, qty: it.reorderQty || 1, price: it.costPrice } : { itemId: Store.db.items[0].id, qty: 1, price: Store.db.items[0].costPrice }];
    if (it) {
      const sup = Store.supplier(it.supplierId) || Store.db.suppliers[0];
      window.__poSup = sup.id; window.__poLead = sup.leadTime;
    } else { window.__poSup = Store.db.suppliers[0].id; window.__poLead = Store.db.suppliers[0].leadTime; }
    this._drawPOForm();
  },
  _drawPOForm() {
    const prev = document.getElementById('p_co') ? Issuer.read('p') : (window.__poIssuer || {});
    window.__poIssuer = prev;
    const sup = Store.supplier(window.__poSup) || Store.db.suppliers[0];
    const exp = todayStr(addDays(new Date(), sup.leadTime));
    const body = `
      <div class="form-grid">
        <div class="field"><label>発注番号</label><input class="inp" value="${Store.nextNo('PO')}" readonly></div>
        <div class="field"><label>発注日 *</label><input class="inp" type="date" id="p_date" value="${TODAY}"></div>
        <div class="field"><label>入荷予定日 *</label><input class="inp" type="date" id="p_exp" value="${exp}"><span class="hint">リードタイム ${sup.leadTime} 日から自動計算</span></div>
        <div class="field span3"><label>仕入先 *</label><select class="inp" onchange="Actions.chgPOSup(this.value)">
          ${Store.db.suppliers.map(s => `<option value="${s.id}"${window.__poSup === s.id ? ' selected' : ''}>${esc(s.code)} ${esc(s.name)}（LT ${s.leadTime}日）</option>`).join('')}</select></div>
      </div>

      <div class="hr"></div>
      <div class="hstack mb8"><b style="font-size:13px">${ico('factory', 14)} 発行元情報</b><span class="tiny muted">帳票の上部に印字されます（発行会社は必須）</span></div>
      ${Issuer.pickerHtml('p', prev, { docKind: 'purchase_order' })}
      <div class="hr"></div>
      <div class="hstack mb12"><b style="font-size:13px">発注明細</b><div class="sp"><button class="btn sm" onclick="Actions.addPOLine()">${ico('plus', 14)} 行を追加</button></div></div>
      <div class="table-wrap"><table class="line-tb" style="min-width:620px">
        <thead><tr><th style="width:40%">品目</th><th style="width:15%">数量</th><th style="width:18%">仕入単価</th><th style="width:18%">金額</th><th></th></tr></thead>
        <tbody>${window.__poLines.map((l, i) => `<tr>
          <td><select class="inp" onchange="Actions.updPOLine(${i},'itemId',this.value)">
            ${Store.db.items.map(x => `<option value="${x.id}"${l.itemId === x.id ? ' selected' : ''}>${esc(x.code)} ${esc(x.name)}（在庫 ${dec(x.stock)}／発注点 ${dec(x.reorderPoint)}）</option>`).join('')}
          </select></td>
          <td><input class="inp num" type="number" value="${l.qty}" oninput="Actions.updPOLine(${i},'qty',+this.value)"></td>
          <td><input class="inp num" type="number" value="${l.price}" oninput="Actions.updPOLine(${i},'price',+this.value)"></td>
          <td class="num" style="font-weight:700">${money(l.qty * l.price)}</td>
          <td class="right">${window.__poLines.length > 1 ? `<button class="btn xs danger" onclick="Actions.delPOLine(${i})">${ico('x', 13)}</button>` : ''}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="hr"></div>
      <div class="hstack" style="justify-content:flex-end;gap:22px">
        <span class="sm muted">小計 <b>${money(window.__poLines.reduce((a, l) => a + l.qty * l.price, 0))}</b></span>
        <span style="font-size:15px;font-weight:800">合計（税込）${money(Math.round(window.__poLines.reduce((a, l) => a + l.qty * l.price, 0) * 1.08))}</span>
      </div>
      <div class="field mt12"><label>備考</label><input class="inp" id="p_remarks" placeholder="納品方法・時間指定など"></div>`;
    UI.modal('発注登録', '発注番号は保存時に自動採番されます', body,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.savePO()">${ico('check', 15)} 発注する</button>`, 'wide');
  },
  chgPOSup(id) { window.__poSup = id; this._drawPOForm(); },
  addPOLine() { window.__poLines.push({ itemId: Store.db.items[0].id, qty: 1, price: Store.db.items[0].costPrice }); this._drawPOForm(); },
  delPOLine(i) { window.__poLines.splice(i, 1); this._drawPOForm(); },
  updPOLine(i, k, v) { window.__poLines[i][k] = v; if (k === 'itemId') window.__poLines[i].price = Store.item(v).costPrice; this._drawPOForm(); },
  savePO() {
    const lines = window.__poLines.filter(l => l.qty > 0);
    if (!lines.length) return UI.toast('明細を1行以上入力してください', 'err');
    const supId = window.__poSup;
    const issErr = Issuer.validate('p'); if (issErr) return UI.toast(issErr, 'err');
    const issuer = Issuer.stamp('p');
    const poNo = Store.nextNo('PO', document.getElementById('p_date').value);
    const exp = document.getElementById('p_exp').value;
    let sub = 0; const pid = uid();
    const pls = lines.map((l, i) => {
      const it = Store.item(l.itemId); const amt = l.qty * l.price; sub += amt;
      return { id: uid(), poId: pid, lineNo: i + 1, itemId: l.itemId, itemName: it.name, unit: it.unit,
        quantity: l.qty, unitPrice: l.price, taxRate: 8, amount: amt, receivedQty: 0, expectedDate: exp, notes: '' };
    });
    const tax = Math.round(sub * .08);
    Store.db.purchaseOrders.unshift({
      id: pid, poNo, supplierId: supId, supplierName: Store.supplier(supId).name,
      orderDate: document.getElementById('p_date').value, expectedDate: exp, status: 'ordered',
      companyId: issuer.companyId, branch1Id: issuer.branch1Id, branch2Id: issuer.branch2Id,
      subtotal: sub, tax, total: sub + tax, remarks: document.getElementById('p_remarks').value,
      createdBy: Auth.user ? Auth.user.id : null, createdAt: new Date().toISOString()
    });
    pls.forEach(l => Store.db.poLines.push(l));
    Store.save(); UI.closeModal(); App.renderNav(); App.repaint();
    UI.toast(`発注 ${poNo} を登録しました`, 'ok');
  },
  poDetail(id) {
    const p = Store.po(id); const lines = Store.poLines(p.id);
    UI.modal(`発注 ${p.poNo}`, `${p.supplierName} ／ 発注日 ${dJP(p.orderDate)}`, `
      <div class="grid g3 mb16">
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">発注金額</div><div class="k-v" style="font-size:20px">${money(p.total)}</div></div>
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">入荷予定日</div><div class="k-v" style="font-size:20px">${dJP(p.expectedDate)}</div><div class="k-f">${relDay(p.expectedDate)}</div></div>
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">発注残</div><div class="k-v" style="font-size:20px">${dec(Store.poRemaining(p))}</div><div class="k-f">${badge(p.status)}</div></div>
      </div>
      <div class="table-wrap"><table class="tb" style="min-width:600px">
        <thead><tr><th>No.</th><th>品名</th><th class="right">発注数</th><th class="right">入荷済</th><th class="right">残</th><th class="right">単価</th><th class="right">金額</th></tr></thead>
        <tbody>${lines.map(l => `<tr><td>${l.lineNo}</td><td class="strong">${esc(l.itemName)}</td>
          <td class="num">${dec(l.quantity)}</td><td class="num muted">${dec(l.receivedQty)}</td>
          <td class="num" style="font-weight:700">${dec(l.quantity - l.receivedQty)}</td>
          <td class="num">${money(l.unitPrice)}</td><td class="num">${money(l.amount)}</td></tr>`).join('')}</tbody>
      </table></div>`,
      `<button class="btn" onclick="UI.closeModal()">閉じる</button>
       ${Store.poRemaining(p) > 0 ? `<button class="btn primary" onclick="UI.closeModal();Actions.receiveForm('${p.id}')">${ico('inbox', 15)} 入荷処理</button>` : ''}`, 'wide');
  },

  /* ------------------------- 入荷処理（在庫加算） ------------------------- */
  receiveForm(poId) {
    if (poId) {
      const p = Store.po(poId);
      window.__rcPO = poId;
      window.__rcLines = Store.poLines(p.id).filter(l => l.receivedQty < l.quantity)
        .map(l => ({ poLineId: l.id, itemId: l.itemId, qty: l.quantity - l.receivedQty, cost: l.unitPrice, lot: '' }));
    } else {
      window.__rcPO = ''; window.__rcLines = [{ poLineId: null, itemId: Store.db.items[0].id, qty: 1, cost: Store.db.items[0].costPrice, lot: '' }];
    }
    this._drawReceiveForm();
  },
  _drawReceiveForm() {
    const prev = document.getElementById('r_co') ? Issuer.read('r') : (window.__rcIssuer || {});
    window.__rcIssuer = prev;
    const p = window.__rcPO ? Store.po(window.__rcPO) : null;
    const body = `
      <div class="form-grid">
        <div class="field"><label>入荷番号</label><input class="inp" value="${Store.nextNo('RC')}" readonly></div>
        <div class="field"><label>入荷日 *</label><input class="inp" type="date" id="r_date" value="${TODAY}"></div>
        <div class="field"><label>仕入先 *</label><select class="inp" id="r_sup" ${p ? 'disabled' : ''}>
          ${Store.db.suppliers.map(s => `<option value="${s.id}"${p && p.supplierId === s.id ? ' selected' : ''}>${esc(s.code)} ${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field span3"><label>対象発注</label><select class="inp" onchange="Actions.chgRcPO(this.value)">
          <option value="">発注に紐付けない（直接入荷）</option>
          ${Store.db.purchaseOrders.filter(x => Store.poRemaining(x) > 0).map(x => `<option value="${x.id}"${window.__rcPO === x.id ? ' selected' : ''}>${esc(x.poNo)} ／ ${esc(x.supplierName)} ／ 残 ${dec(Store.poRemaining(x))}</option>`).join('')}
        </select></div>
      </div>

      <div class="hr"></div>
      <div class="hstack mb8"><b style="font-size:13px">${ico('factory', 14)} 発行元情報</b><span class="tiny muted">帳票の上部に印字されます（発行会社は必須）</span></div>
      ${Issuer.pickerHtml('r', prev, { docKind: 'receipt_note' })}
      <div class="note green mt12">${ico('check', 15)} 確定すると、下記の数量が現在庫に<b>自動加算</b>され、入出庫履歴に「入荷」として記録されます。</div>
      <div class="hr"></div>
      <div class="hstack mb12"><b style="font-size:13px">入荷明細</b><div class="sp"><button class="btn sm" onclick="Actions.addRcLine()">${ico('plus', 14)} 行を追加</button></div></div>
      <div class="table-wrap"><table class="line-tb" style="min-width:640px">
        <thead><tr><th style="width:38%">品目</th><th style="width:14%">入荷数</th><th style="width:14%">仕入単価</th><th style="width:14%">ロット</th><th style="width:14%">現在庫→</th><th></th></tr></thead>
        <tbody>${window.__rcLines.map((l, i) => { const it = Store.item(l.itemId);
          return `<tr><td><select class="inp" onchange="Actions.updRcLine(${i},'itemId',this.value)">
            ${Store.db.items.map(x => `<option value="${x.id}"${l.itemId === x.id ? ' selected' : ''}>${esc(x.code)} ${esc(x.name)}</option>`).join('')}</select></td>
          <td><input class="inp num" type="number" value="${l.qty}" oninput="Actions.updRcLine(${i},'qty',+this.value)"></td>
          <td><input class="inp num" type="number" value="${l.cost}" oninput="Actions.updRcLine(${i},'cost',+this.value)"></td>
          <td><input class="inp" value="${esc(l.lot)}" placeholder="任意" oninput="Actions.updRcLine(${i},'lot',this.value)"></td>
          <td class="num sm">${dec(it.stock)} → <b style="color:var(--green-700)">${dec(it.stock + l.qty)}</b></td>
          <td class="right">${window.__rcLines.length > 1 ? `<button class="btn xs danger" onclick="Actions.delRcLine(${i})">${ico('x', 13)}</button>` : ''}</td></tr>`; }).join('')}</tbody>
      </table></div>
      <div class="hr"></div>
      <div class="hstack" style="justify-content:flex-end;gap:22px">
        <span class="sm muted">入荷金額 <b>${money(window.__rcLines.reduce((a, l) => a + l.qty * l.cost, 0))}</b></span>
      </div>
      <div class="field mt12"><label>備考</label><input class="inp" id="r_remarks"></div>`;
    UI.modal('入荷処理', '入荷確定で在庫に自動加算', body,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.saveReceipt()">${ico('check', 15)} 入荷を確定</button>`, 'wide');
  },
  chgRcPO(id) { window.__rcPO = id; if (id) this.receiveForm(id); else { window.__rcLines = [{ poLineId: null, itemId: Store.db.items[0].id, qty: 1, cost: Store.db.items[0].costPrice, lot: '' }]; this._drawReceiveForm(); } },
  addRcLine() { window.__rcLines.push({ poLineId: null, itemId: Store.db.items[0].id, qty: 1, cost: Store.db.items[0].costPrice, lot: '' }); this._drawReceiveForm(); },
  delRcLine(i) { window.__rcLines.splice(i, 1); this._drawReceiveForm(); },
  updRcLine(i, k, v) { window.__rcLines[i][k] = v; if (k === 'itemId') window.__rcLines[i].cost = Store.item(v).costPrice; this._drawReceiveForm(); },
  saveReceipt() {
    const lines = window.__rcLines.filter(l => l.qty > 0);
    if (!lines.length) return UI.toast('入荷数量を入力してください', 'err');
    const issErr = Issuer.validate('r'); if (issErr) return UI.toast(issErr, 'err');
    const issuer = Issuer.stamp('r');
    const poId = window.__rcPO || null;
    const supId = poId ? Store.po(poId).supplierId : document.getElementById('r_sup').value;
    const receiptNo = Store.nextNo('RC');
    const rid = uid();
    let sub = 0;
    const rls = lines.map(l => {
      const it = Store.item(l.itemId); const amt = l.qty * l.cost; sub += amt;
      return { id: uid(), receiptId: rid, poLineId: l.poLineId, itemId: l.itemId, itemName: it.name, quantity: l.qty, unitCost: l.cost, amount: amt, lotNo: l.lot, expiry: '' };
    });
    const tax = Math.round(sub * .08);
    Store.db.receipts.unshift({
      id: rid, receiptNo, poId, supplierId: supId, supplierName: Store.supplier(supId).name,
      receiptDate: document.getElementById('r_date').value, status: 'confirmed',
      companyId: issuer.companyId, branch1Id: issuer.branch1Id, branch2Id: issuer.branch2Id,
      subtotal: sub, tax, total: sub + tax, remarks: document.getElementById('r_remarks').value,
      receivedBy: Auth.user ? Auth.user.id : null, createdAt: new Date().toISOString()
    });
    /* 在庫加算 + 発注残更新 */
    rls.forEach(l => {
      Store.db.receiptLines.push(l);
      Store.applyStock(l.itemId, l.quantity, 'receipt', { table: 'receipts', id: rid, no: receiptNo, notes: '入荷確定' });
      if (l.poLineId) { const pl = Store.db.poLines.find(x => x.id === l.poLineId); if (pl) pl.receivedQty += l.quantity; }
    });
    /* 発注ステータス更新 */
    if (poId) {
      const p = Store.po(poId);
      const rem = Store.poRemaining(p);
      p.status = rem <= 0 ? 'received' : 'partial';
    }
    Store.save(); UI.closeModal(); App.renderNav(); App.repaint();
    UI.toast(`入荷 ${receiptNo} を確定し、在庫に加算しました`, 'ok');
  },
  receiptDetail(id) {
    const r = Store.db.receipts.find(x => x.id === id);
    const lines = Store.receiptLines(id);
    UI.modal(`入荷 ${r.receiptNo}`, `${r.supplierName} ／ ${dJP(r.receiptDate)}`, `
      <div class="table-wrap"><table class="tb" style="min-width:520px">
        <thead><tr><th>品名</th><th class="right">入荷数</th><th class="right">単価</th><th class="right">金額</th><th>ロット</th></tr></thead>
        <tbody>${lines.map(l => `<tr><td class="strong">${esc(l.itemName)}</td><td class="num">${dec(l.quantity)}</td>
          <td class="num">${money(l.unitCost)}</td><td class="num">${money(l.amount)}</td><td class="mono">${esc(l.lotNo || '—')}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3" class="right strong">合計（税込）</td><td class="num strong">${money(r.total)}</td><td></td></tr></tfoot>
      </table></div>`, `<button class="btn" onclick="UI.closeModal()">閉じる</button>`, 'wide');
  },

  /* ------------------------- 出荷 ------------------------- */
  shipFromOrderPick() {
    const backlog = Store.orderBacklog();
    if (!backlog.length) return UI.toast('出荷可能な受注残がありません', 'warn');
    const orders = [...new Set(backlog.map(r => r.orderId))];
    UI.modal('受注から出荷指示を作成', '未出荷の受注を選択してください', `
      <div class="vstack">${orders.map(oid => {
        const o = Store.order(oid); const rem = Store.orderRemaining(o);
        return `<button class="chip" style="justify-content:space-between;width:100%" onclick="UI.closeModal();Actions.newShipFromOrder('${oid}')">
          <span><b>${esc(o.orderNo)}</b> ${esc(o.customerName)}</span>
          <span class="hstack"><span class="badge ${o.dueDate < TODAY ? 'rose' : 'sky'}">${dJP(o.dueDate)}</span><span class="badge amber">残 ${dec(rem)}</span></span></button>`;
      }).join('')}</div>`, `<button class="btn" onclick="UI.closeModal()">閉じる</button>`, 'slim');
  },
  newShipFromOrder(orderId) {
    const o = Store.order(orderId);
    window.__shOrder = orderId;
    window.__shLines = Store.orderLines(orderId).filter(l => l.shippedQty < l.quantity)
      .map(l => ({ orderLineId: l.id, itemId: l.itemId, qty: l.quantity - l.shippedQty, lot: '' }));
    this._drawShipForm();
  },
  _drawShipForm() {
    const prev = document.getElementById('sh_co') ? Issuer.read('sh') : (window.__shIssuer || {});
    window.__shIssuer = prev;
    const o = Store.order(window.__shOrder);
    const c = Store.customer(o.customerId) || {};
    const body = `
      <div class="form-grid">
        <div class="field"><label>出荷番号</label><input class="inp" value="${Store.nextNo('SH')}" readonly></div>
        <div class="field"><label>出荷日 *</label><input class="inp" type="date" id="sh_date" value="${o.dueDate || TODAY}"></div>
        <div class="field"><label>運送会社</label><select class="inp" id="sh_carrier">
          <option>ヤマト運輸</option><option>佐川急便</option><option>福山通運</option><option>西濃運輸</option><option>自社配送</option><option>その他</option></select></div>
        <div class="field span3"><label>出荷先</label><input class="inp" id="sh_to" value="${esc(c.name || '')} ${esc(c.address || '')}"></div>
      </div>

      <div class="hr"></div>
      <div class="hstack mb8"><b style="font-size:13px">${ico('factory', 14)} 発行元情報</b><span class="tiny muted">帳票の上部に印字されます（発行会社は必須）</span></div>
      ${Issuer.pickerHtml('sh', prev, { docKind: 'delivery_note' })}
      <div class="note mt12">${ico('truck', 15)} 出荷指示を作成後、「出荷確定」で在庫から<b>自動減算</b>されます。</div>
      <div class="hr"></div>
      <div class="table-wrap"><table class="line-tb" style="min-width:600px">
        <thead><tr><th style="width:44%">品名</th><th style="width:18%">出荷数</th><th style="width:18%">ロット</th><th style="width:20%">現在庫</th></tr></thead>
        <tbody>${window.__shLines.map((l, i) => { const it = Store.item(l.itemId); const ok = it.stock >= l.qty;
          return `<tr><td><b>${esc(it.name)}</b><div class="tiny muted">${esc(it.location || '')}</div></td>
          <td><input class="inp num" type="number" value="${l.qty}" oninput="Actions.updShLine(${i},'qty',+this.value)"></td>
          <td><input class="inp" value="${esc(l.lot)}" oninput="Actions.updShLine(${i},'lot',this.value)"></td>
          <td class="num" style="color:${ok ? 'inherit' : 'var(--rose-600)'};font-weight:700">${dec(it.stock)}${ok ? '' : ' ⚠不足'}</td></tr>`; }).join('')}</tbody>
      </table></div>
      <div class="field mt12"><label>備考</label><input class="inp" id="sh_remarks"></div>`;
    UI.modal('出荷指示の作成', `受注 ${o.orderNo} ／ ${o.customerName}`, body,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.saveShipment()">${ico('check', 15)} 出荷指示を作成</button>`, 'wide');
  },
  updShLine(i, k, v) { window.__shLines[i][k] = v; this._drawShipForm(); },
  saveShipment() {
    const lines = window.__shLines.filter(l => l.qty > 0);
    if (!lines.length) return UI.toast('出荷数量を入力してください', 'err');
    const o = Store.order(window.__shOrder);
    const issErr = Issuer.validate('sh'); if (issErr) return UI.toast(issErr, 'err');
    const issuer = Issuer.stamp('sh');
    const sid = uid();
    const shipNo = Store.nextNo('SH', document.getElementById('sh_date').value);
    Store.db.shipments.unshift({
      id: sid, shipmentNo: shipNo, orderId: o.id, orderNo: o.orderNo, customerId: o.customerId, customerName: o.customerName,
      shipDate: document.getElementById('sh_date').value, status: 'instructed',
      companyId: issuer.companyId, branch1Id: issuer.branch1Id, branch2Id: issuer.branch2Id,
      carrier: document.getElementById('sh_carrier').value, trackingNo: '',
      shipToName: document.getElementById('sh_to').value, shipToAddr: (Store.customer(o.customerId) || {}).address || '',
      remarks: document.getElementById('sh_remarks').value, confirmedAt: null,
      createdBy: Auth.user ? Auth.user.id : null, createdAt: new Date().toISOString()
    });
    lines.forEach(l => Store.db.shipmentLines.push({
      id: uid(), shipmentId: sid, orderLineId: l.orderLineId, itemId: l.itemId,
      itemName: Store.item(l.itemId).name, unit: Store.item(l.itemId).unit, quantity: l.qty, lotNo: l.lot, notes: ''
    }));
    if (o.status === 'received') o.status = 'instructed';
    Store.save(); UI.closeModal(); App.renderNav(); App.repaint();
    UI.toast(`出荷指示 ${shipNo} を作成しました`, 'ok');
  },
  openShipment(id) {
    const s = Store.shipment(id);
    const lines = Store.shipLines(id);
    const qty = lines.reduce((a, l) => a + l.quantity, 0);
    UI.modal(`出荷 ${s.shipmentNo}`, `${s.customerName} ／ ${dJP(s.shipDate)}`, `
      <div class="grid g3 mb16">
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">状態</div><div class="k-v" style="font-size:19px">${s.status === 'confirmed' ? '確定済' : '指示済'}</div><div class="k-f">${s.confirmedAt ? dtJP(s.confirmedAt) + ' 確定' : '未確定'}</div></div>
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">合計数量</div><div class="k-v" style="font-size:19px">${num(qty)} 点</div><div class="k-f">${lines.length} 明細</div></div>
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">運送／追跡</div><div class="k-v" style="font-size:15px">${esc(s.carrier || '—')}</div><div class="k-f">${esc(s.trackingNo || '未設定')}</div></div>
      </div>
      <div class="table-wrap"><table class="tb" style="min-width:600px">
        <thead><tr><th>品名</th><th class="right">数量</th><th>ロット</th><th class="right">現在庫</th></tr></thead>
        <tbody>${lines.map(l => { const it = Store.item(l.itemId) || {}; return `<tr><td class="strong">${esc(l.itemName)}<div class="tiny muted">${esc(it.location || '')}</div></td>
          <td class="num">${dec(l.quantity)} <span class="tiny muted">${esc(it.unit || '')}</span></td>
          <td class="mono">${esc(l.lotNo || '—')}</td><td class="num">${dec(it.stock)}</td></tr>`; }).join('')}</tbody>
      </table></div>
      <div class="hr"></div>
      <div class="hstack">
        <span class="sm muted">出荷先：${esc(s.shipToName || s.customerName)}</span>
        <span class="sp"></span>
        ${s.status === 'confirmed' ? `<button class="btn" onclick="Print.delivery('${s.id}')">${ico('print', 14)} 納品書</button>
          <button class="btn" onclick="Print.slip('${s.id}')">${ico('print', 14)} 出荷伝票</button>
          <button class="btn primary" onclick="Print.picking('${s.id}')">${ico('print', 14)} ピッキングリスト</button>` : ''}
      </div>`,
      `${s.status === 'instructed' ? `<button class="btn" onclick="UI.closeModal()">閉じる</button>
        <button class="btn primary" onclick="UI.closeModal();Actions.confirmShipment('${s.id}')">${ico('check', 15)} 出荷を確定する</button>` : `<button class="btn" onclick="UI.closeModal()">閉じる</button>`}`, 'wide');
  },
  confirmShipment(id) {
    const s = Store.shipment(id);
    if (s.status === 'confirmed') return UI.toast('この出荷はすでに確定済みです', 'warn');
    const lines = Store.shipLines(id);
    const short = lines.filter(l => { const it = Store.item(l.itemId); return it && it.stock < l.quantity; });
    const msg = `出荷 ${s.shipmentNo} を確定します。在庫から ${lines.reduce((a, l) => a + l.quantity, 0)} 点が自動減算され、受注残が更新されます。`
      + (short.length ? `\n※ 在庫不足の明細が ${short.length} 件あります（在庫がマイナスになる可能性があります）。` : '');
    UI.confirm('出荷確定', msg, () => {
      s.status = 'confirmed'; s.confirmedAt = new Date().toISOString();
      if (!s.trackingNo) s.trackingNo = 'TRK' + Math.floor(100000 + Math.random() * 899999);
      /* 在庫減算 + 受注残更新 */
      lines.forEach(l => {
        Store.applyStock(l.itemId, -l.quantity, 'shipment', { table: 'shipments', id: s.id, no: s.shipmentNo, notes: '出荷確定' });
        if (l.orderLineId) { const ol = Store.db.orderLines.find(x => x.id === l.orderLineId); if (ol) ol.shippedQty += l.quantity; }
      });
      if (s.orderId) {
        const o = Store.order(s.orderId);
        o.status = Store.orderRemaining(o) <= 0 ? 'shipped' : 'partial';
      }
      Store.save(); App.renderNav(); App.repaint();
      UI.toast(`出荷 ${s.shipmentNo} を確定し、在庫を減算しました`, 'ok');
      setTimeout(() => {
        UI.confirm('帳票を発行しますか？', '納品書・出荷伝票・ピッキングリストを発行できます。', () => {
          Print.delivery(s.id);
        }, '納品書を発行', 'primary');
      }, 400);
    }, '出荷を確定する', 'primary');
  },
  docPick(shipmentId) {
    const s = Store.shipment(shipmentId);
    UI.modal('帳票を選択', `${s.shipmentNo} ／ ${s.customerName}`, `
      <div class="vstack">
        <button class="chip" style="justify-content:flex-start;padding:14px" onclick="UI.closeModal();Print.delivery('${s.id}')">${ico('file', 18)} <span style="text-align:left"><b>納品書</b><div class="tiny muted">DN-YYYYMMDD-0001／金額入り・受領印欄あり</div></span></button>
        <button class="chip" style="justify-content:flex-start;padding:14px" onclick="UI.closeModal();Print.slip('${s.id}')">${ico('clipboard', 18)} <span style="text-align:left"><b>出荷伝票</b><div class="tiny muted">SL-YYYYMMDD-0001／バーコード・QR欄あり</div></span></button>
        <button class="chip" style="justify-content:flex-start;padding:14px" onclick="UI.closeModal();Print.picking('${s.id}')">${ico('check', 18)} <span style="text-align:left"><b>ピッキングリスト</b><div class="tiny muted">PL-YYYYMMDD-0001／保管場所順・チェック欄あり</div></span></button>
      </div>`, `<button class="btn" onclick="UI.closeModal()">閉じる</button>`, 'slim');
  },

  /* ------------------------- ユーザー管理（ID・パスワード認証） ------------------------- */
  /* ------------------------- 組織マスタ（システム管理者のみ） ------------------------- */
  organizationForm(id) {
    if (!Tenant.isSystemAdmin()) return UI.toast('組織マスタはシステム管理者のみ操作できます', 'err');
    const o = id ? Tenant.org(id) : null;
    UI.modal(o ? '組織を編集' : '組織を登録', o ? o.organizationCode : 'テナント（組織）を追加します', `
      <div class="form-grid c2">
        <div class="field"><label>組織コード *</label><input class="inp" id="o_code" value="${esc(o ? o.organizationCode : '')}" placeholder="例：C-FARM"></div>
        <div class="field"><label>組織名 *</label><input class="inp" id="o_name" value="${esc(o ? o.organizationName : '')}" placeholder="例：Ｃファーム"></div>
        <div class="field"><label>状態</label><select class="inp" id="o_active">
          <option value="1"${!o || o.isActive !== false ? ' selected' : ''}>有効</option>
          <option value="0"${o && o.isActive === false ? ' selected' : ''}>停止</option></select></div>
      </div>
      <div class="note mt12">${ico('shield', 15)} 組織を追加すると、その組織専用の会社・拠点・得意先・伝票を登録できます。他組織のデータは参照できません。</div>`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.saveOrganization('${id || ''}')">${ico('check', 15)} 保存</button>`);
  },
  saveOrganization(id) {
    if (!Tenant.isSystemAdmin()) return UI.toast('組織マスタはシステム管理者のみ操作できます', 'err');
    const g = n => (document.getElementById(n) || {}).value || '';
    const code = g('o_code').trim(), name = g('o_name').trim();
    if (!code || !name) return UI.toast('組織コードと組織名は必須です', 'err');
    if ((Store.db.organizations || []).some(o => String(o.organizationCode).toUpperCase() === code.toUpperCase() && String(o.id) !== String(id)))
      return UI.toast('同じ組織コードが既に登録されています', 'err');
    const now = new Date().toISOString();
    if (id) {
      const o = Tenant.org(id);
      Object.assign(o, { organizationCode: code, organizationName: name, isActive: g('o_active') !== '0', updatedAt: now });
      UI.toast(`組織「${name}」を更新しました`, 'ok');
    } else {
      const next = (Store.db.organizations || []).reduce((m, o) => Math.max(m, Number(o.id) || 0), 0) + 1;
      Store.db.organizations.push({ id: next, organizationCode: code, organizationName: name, isActive: g('o_active') !== '0', createdAt: now, updatedAt: now });
      UI.toast(`組織「${name}」を登録しました（ID ${next}）`, 'ok');
    }
    Store.save(); UI.closeModal(); App.repaint();
  },
  toggleOrganization(id) {
    if (!Tenant.isSystemAdmin()) return UI.toast('組織マスタはシステム管理者のみ操作できます', 'err');
    const o = Tenant.org(id); if (!o) return;
    if (Number(o.id) === Tenant.id()) return UI.toast('ログイン中の組織は停止できません', 'err');
    if (o.isActive !== false && (Store.db.organizations || []).filter(x => x.isActive !== false).length <= 1)
      return UI.toast('有効な組織が1つのため停止できません', 'err');
    o.isActive = o.isActive === false; o.updatedAt = new Date().toISOString();
    Store.save(); App.repaint();
    UI.toast(`組織「${o.organizationName}」を${o.isActive ? '有効化' : '停止'}しました`, 'ok');
  },

  userForm(id) {
    const u = id ? Store.user(id) : null;
    UI.modal(u ? 'ユーザー編集' : 'ユーザー登録', u ? `ログインID ${u.loginId}` : '初期パスワード Temp1234! で登録します（初回ログイン時に変更必須）', `
      <div class="form-grid c2">
        <div class="field"><label>ユーザーID *</label><input class="inp" id="u_login" value="${esc(u ? u.loginId : '')}" placeholder="例：shipping2"></div>
        <div class="field"><label>氏名 *</label><input class="inp" id="u_name" value="${esc(u ? u.name : '')}"></div>
        <div class="field"><label>メールアドレス</label><input class="inp" id="u_mail" value="${esc(u ? u.email : '')}"></div>
        <div class="field"><label>電話番号</label><input class="inp" id="u_tel" value="${esc(u ? u.tel || '' : '')}"></div>
        <div class="field"><label>所属組織 *</label><select class="inp" id="u_org"${Tenant.isSystemAdmin() ? '' : ' disabled'}>
          ${(Tenant.all()).map(o => `<option value="${esc(o.id)}"${Number(u ? (u.organizationId || 1) : Tenant.id()) === Number(o.id) ? ' selected' : ''}>${esc(o.organizationName)}（${esc(o.organizationCode)}）</option>`).join('')}</select></div>
        <div class="field"><label>ロール *</label><select class="inp" id="u_role">
          ${Object.entries(ROLES).map(([k, r]) => `<option value="${k}"${u && u.role === k ? ' selected' : ''}>${r.label} — ${r.desc}</option>`).join('')}</select></div>
        <div class="field"><label>有効／無効</label><select class="inp" id="u_enabled">
          <option value="1"${!u || u.enabled ? ' selected' : ''}>有効</option>
          <option value="0"${u && !u.enabled ? ' selected' : ''}>無効</option></select></div>
      </div>
      ${u ? '' : `<div class="note green mt12">${ico('check', 15)} 新規ユーザーの初期パスワードは <b>Temp1234!</b> です。初回ログイン時にパスワード変更が必須になります。</div>`}`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.saveUser('${id || ''}')">${ico('check', 15)} 保存</button>`);
  },
  saveUser(id) {
    const g = n => (document.getElementById(n) || {}).value || '';
    const loginId = g('u_login').trim(), name = g('u_name').trim(), role = g('u_role');
    if (!loginId || !name) return UI.toast('ユーザーIDと氏名は必須です', 'err');
    if (!/^[A-Za-z0-9._-]+$/.test(loginId)) return UI.toast('ユーザーIDは半角英数字と . _ - のみ使用できます', 'err');
    if (Store.db.users.some(x => String(x.loginId).toLowerCase() === loginId.toLowerCase() && x.id !== id)) return UI.toast('そのユーザーIDは既に使われています', 'err');
    const enabled = g('u_enabled') !== '0';
    /* マルチテナント: 所属組織。システム管理者以外は自組織に固定（他組織へは作成不可） */
    const orgId = Tenant.isSystemAdmin() && g('u_org') ? Number(g('u_org')) : Tenant.id();
    if (!Tenant.all().some(o => Number(o.id) === orgId)) return UI.toast('所属組織が不正です', 'err');
    if (id) {
      const u = Store.user(id);
      /* 最後の有効管理者のロール変更・無効化は不可 */
      if (u.role === 'admin' && u.enabled && (!enabled || role !== 'admin')
        && !Store.db.users.some(x => x.id !== id && x.role === 'admin' && x.enabled))
        return UI.toast('有効な管理者がいなくなるため変更できません', 'err');
      Object.assign(u, { loginId, name, email: g('u_mail'), tel: g('u_tel'), role, enabled, organizationId: orgId, updatedAt: new Date().toISOString() });
      UI.toast(`ユーザー ${loginId} を更新しました`, 'ok');
    } else {
      Store.db.users.push({
        id: uid(), loginId, name, email: g('u_mail'), tel: g('u_tel'), role, organizationId: orgId,
        forcePasswordChange: true, enabled: true,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      });
      if (typeof SB !== 'undefined' && SB.ready) {
        SB.setPassword(loginId, Security.TEMP, true);   /* サーバー側でbcrypt化・初回変更必須 */
      } else {
        Store.db.users[Store.db.users.length - 1].passwordHash = TEMP_PASSWORD_HASH;
      }
      UI.toast(`ユーザー ${loginId} を登録しました（初期パスワード Temp1234!）`, 'ok');
    }
    Store.save(); UI.closeModal(); App.renderNav(); App.repaint();
  },
  /* パスワード変更（管理者が任意のユーザーのパスワードを変更） */
  userPasswordForm(id) {
    const u = Store.user(id);
    if (!u) return;
    UI.modal('パスワード変更', `${u.name}（${u.loginId}）のパスワードを変更します`, `
      <div class="field"><label>新しいパスワード *</label><input class="inp" type="password" id="up_pw" autocomplete="new-password" oninput="Auth.updatePwMeter('up', this.value)">${Auth.pwMeterHtml('up')}</div>
      <div class="field mt12"><label>新しいパスワード（確認） *</label><input class="inp" type="password" id="up_pw2" autocomplete="new-password"></div>
      <div class="note amber mt12">強度基準：8文字以上・大文字／小文字／数字／記号をすべて含める</div>`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.saveUserPassword('${id}')">${ico('check', 15)} 変更する</button>`, 'slim');
  },
  async saveUserPassword(id) {
    const u = Store.user(id);
    if (!u) return;
    const g = n => (document.getElementById(n) || {}).value || '';
    if (g('up_pw') !== g('up_pw2')) return UI.toast('パスワードが確認入力と一致しません', 'err');
    const issues = Security.pwIssues(g('up_pw'));
    if (issues.length) return UI.toast('強度基準を満たしていません：' + issues.join('・'), 'err');
    if (typeof SB !== 'undefined' && SB.ready) {
      const r = await SB.setPassword(u.loginId, g('up_pw'), false);
      if (!r.ok) { UI.toast(r.message || 'パスワードを変更できませんでした', 'err'); return; }
    } else {
      u.passwordHash = await Security.hashPassword(g('up_pw'));
    }
    u.forcePasswordChange = false;
    u.updatedAt = new Date().toISOString();
    delete Store.db.loginSecurity[String(u.loginId).toLowerCase()];
    Store.save(); UI.closeModal(); App.repaint();
    UI.toast(`${u.name} のパスワードを変更しました`, 'ok');
  },
  /* 初期パスワード再発行（Temp1234! に戻し、初回ログイン扱いにする） */
  reissueUserPassword(id) {
    const u = Store.user(id);
    if (!u) return;
    UI.confirm('初期パスワード再発行', `${u.name}（${u.loginId}）のパスワードを初期パスワード Temp1234! に戻します。次回ログイン時にパスワード変更が必須になります。`, () => {
      if (typeof SB !== 'undefined' && SB.ready) SB.setPassword(u.loginId, Security.TEMP, true);
      else u.passwordHash = TEMP_PASSWORD_HASH;
      u.forcePasswordChange = true;
      u.updatedAt = new Date().toISOString();
      delete Store.db.loginSecurity[String(u.loginId).toLowerCase()];
      Store.save(); App.repaint();
      UI.toast(`${u.name} のパスワードを再発行しました（Temp1234!）`, 'ok');
    }, '再発行する');
  },
  /* パスワードリセット（管理者専用）：ランダムな仮パスワードを発行し、次回ログイン時に変更を必須化する */
  resetUserPassword(id) {
    if (!Auth.user || Auth.user.role !== 'admin') return UI.toast('この操作は管理者のみ利用できます', 'err');
    const u = Store.user(id);
    if (!u) return;
    UI.modal('パスワードリセット', '', `<div class="note amber" style="white-space:pre-line">ユーザー：${esc(u.name)}（${esc(u.loginId)}）
仮パスワードを発行します。
続行しますか？</div>`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.doResetUserPassword('${u.id}')">実行</button>`, 'slim');
  },
  async doResetUserPassword(id) {
    if (!Auth.user || Auth.user.role !== 'admin') return UI.toast('この操作は管理者のみ利用できます', 'err');
    const u = Store.user(id);
    if (!u) return;
    const temp = Security.genTempPassword();
    let ip = null;
    if (typeof SB !== 'undefined' && SB.ready) {
      /* 既存RPC app_set_password（p_login_id / p_new / p_force_change=true）を呼び出し、戻り値を確認 */
      const [r, gotIp] = await Promise.all([SB.setPassword(u.loginId, temp, true), Audit.fetchIp()]);
      if (!r || !r.ok) { UI.toast((r && r.message) || 'パスワードをリセットできませんでした', 'err'); return; }
      ip = gotIp;
    } else {
      /* Supabase未接続時の暫定動作（セッション内のみ） */
      ip = await Audit.fetchIp();
      u.passwordHash = await Security.hashPassword(temp);
    }
    u.forcePasswordChange = true;
    u.updatedAt = new Date().toISOString();
    delete Store.db.loginSecurity[String(u.loginId).toLowerCase()];
    Audit.add('password_reset', u, ip);   /* 監査ログ（仮パスワード自体は記録しない） */
    Store.save(); App.repaint();
    UI.modal('パスワードをリセットしました', '', `
      <div class="note green">${ico('check', 15)} パスワードをリセットしました。</div>
      <div class="field mt12"><label>ログインID</label><div class="mono strong">${esc(u.loginId)}</div></div>
      <div class="field mt12"><label>仮パスワード</label>
        <div class="hstack" style="gap:8px"><input class="inp mono" id="tmpPw" readonly value="${esc(temp)}" style="max-width:240px" onclick="this.select()"><button class="btn" onclick="Actions.copyTempPw()">${ico('clipboard', 14)} コピー</button></div></div>
      <div class="note amber mt12">次回ログイン時にパスワード変更が必要です。仮パスワードはこの画面を閉じると再表示できませんので、コピーして対象ユーザーへ安全に伝えてください。</div>`,
      `<button class="btn primary" onclick="UI.closeModal()">閉じる</button>`, 'slim');
  },
  copyTempPw() {
    const el = document.getElementById('tmpPw');
    if (!el) return;
    UI.copyText(el.value, '仮パスワードをコピーしました');
  },
  /* 有効／無効切替 */
  toggleUserEnabled(id) {
    const u = Store.user(id);
    if (!u) return;
    if (Auth.user && u.id === Auth.user.id) return UI.toast('自分のアカウントは無効化できません', 'err');
    if (u.enabled && u.role === 'admin' && !Store.db.users.some(x => x.id !== id && x.role === 'admin' && x.enabled))
      return UI.toast('有効な管理者がいなくなるため無効化できません', 'err');
    UI.confirm(u.enabled ? 'ユーザーの無効化' : 'ユーザーの有効化',
      `${u.name}（${u.loginId}）を${u.enabled ? '無効化します。無効化されたユーザーはログインできなくなります' : '有効化します'}。`, () => {
      u.enabled = !u.enabled;
      u.updatedAt = new Date().toISOString();
      if (!u.enabled) delete Store.db.loginSecurity[String(u.loginId).toLowerCase()];
      Store.save(); App.repaint();
      UI.toast(`${u.name} を${u.enabled ? '有効化' : '無効化'}しました`, u.enabled ? 'ok' : 'warn');
    });
  },
  /* ユーザー削除 */
  deleteUser(id) {
    const u = Store.user(id);
    if (!u) return;
    if (Auth.user && u.id === Auth.user.id) return UI.toast('自分のアカウントは削除できません', 'err');
    if (u.role === 'admin' && u.enabled && !Store.db.users.some(x => x.id !== id && x.role === 'admin' && x.enabled))
      return UI.toast('有効な管理者がいなくなるため削除できません', 'err');
    UI.confirm('ユーザー削除', `${u.name}（${u.loginId}）を削除します。よろしいですか？`, () => {
      Store.db.users = Store.db.users.filter(x => x.id !== id);
      Store.save(); App.repaint(); UI.toast('削除しました', 'ok');
    }, '削除する', 'danger');
  },

  /* ------------------------- 設定・エクスポート ------------------------- */
  /* 緊急管理者ログインの有効／無効（管理者のみ） */
  saveEmergencyAdmin() {
    if (!Auth.user || Auth.user.role !== 'admin') return UI.toast('この操作は管理者のみ利用できます', 'err');
    const el = document.getElementById('emgEnabled');
    const on = !!(el && el.checked);
    if (!EMERGENCY.setEnabled(on)) return UI.toast('設定を保存できませんでした（データ未初期化）', 'err');
    if (!on && Auth.isEmergency()) {
      UI.toast('緊急管理者ログインを無効化しました。次回ログインから適用されます', 'warn');
    } else {
      UI.toast(on ? '緊急管理者ログインを有効化しました' : '緊急管理者ログインを無効化しました', on ? 'ok' : 'warn');
    }
    App.repaint();
  },
  /* 単一会社設定は廃止。会社・拠点マスタ（複数会社）へ誘導する */
  saveCompany() {
    UI.toast('発行元は「会社・拠点マスタ」で管理します', 'warn');
    App.go('companies');
  },
  exportJSON() {
    const blob = new Blob([JSON.stringify(Store.db, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `agri-erp-backup-${TODAY}.json`;
    a.click(); URL.revokeObjectURL(a.href);
    UI.toast('データを書き出しました', 'ok');
  },
  exportCSV() {
    const head = ['コード', '区分', '品名', 'カテゴリ', '規格', '単位', '現在庫', '発注点', '安全在庫', '販売単価', '仕入単価', '保管場所'];
    const rows = Store.db.items.map(i => [i.code, i.kind === 'product' ? '商品' : '資材', i.name, i.category, i.spec, i.unit, i.stock, i.reorderPoint, i.safetyStock, i.salePrice, i.costPrice, i.location]);
    const csv = '\uFEFF' + [head, ...rows].map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `agri-erp-inventory-${TODAY}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
    UI.toast('在庫CSVを書き出しました（Excelで開けます）', 'ok');
  },
  exportShipCSV() { shipExportCsv(); },
  resetData() {
    UI.confirm('データの初期化', 'すべてのデータをデモ初期状態に戻します。この操作は取り消せません。', () => {
      Store.reset(); App.renderNav(); App.go('dashboard'); UI.toast('デモデータを初期化しました', 'ok');
    }, '初期化する', 'danger');
  }
};

/* ------------------------------ 起動 ------------------------------
   手順: 1) Supabase接続（失敗しても停止しない） 2) データ初期化 3) ログイン画面の初期化
   Supabase に接続できない場合は「オフラインモード」（このセッション内のみ保持）で起動し、
   ログイン画面をクラッシュさせない。緊急管理者ログインは接続状態に依らず利用できる。 */
(async function boot() {
  const $ = id => document.getElementById(id);
  const err = $('loginErr');
  const warn = $('sbWarn');
  /* 1) Supabase 接続（接続情報はアプリ内部固定・FIXED_URL / FIXED_KEY） */
  let sb = { ok: false, message: '' };
  try {
    sb = await SB.init();
  } catch (e) {
    sb = { ok: false, message: 'Supabaseに接続できませんでした：' + String((e && e.message) || e).slice(0, 160) };
  }
  /* 2) データ初期化（接続可否に関わらず必ず実行し、Store.db を null にしない） */
  try {
    Store.load({ offline: !sb.ok });
    Store.migrateIssuerMasters();
  } catch (e) {
    console.error('data init failed', e);
    if (err) { err.textContent = 'データの初期化に失敗しました：' + String((e && e.message) || e).slice(0, 160); err.style.display = 'block'; }
  }
  /* 3) 接続失敗は警告として表示（ログインは継続できる） */
  if (!sb.ok) {
    const msg = (sb.message || 'Supabaseに接続できませんでした') + '／オフラインモードで起動しています（データはこのセッション内のみ保持されます）';
    if (warn) { warn.textContent = msg; warn.style.display = 'block'; }
    const off = $('offBar');
    if (off) off.style.display = 'flex';
    console.warn('[boot]', msg);
  }
  try {
    Auth.init();
    /* セッション復元（ページ再読み込み後もログイン状態を維持） */
    const restored = Auth.restore();
    if (restored) Auth.enterApp(restored);
  } catch (e) {
    console.error('auth init failed', e);
    if (err) { err.textContent = 'ログイン画面の初期化に失敗しました：' + String((e && e.message) || e).slice(0, 160); err.style.display = 'block'; }
  }
  window.addEventListener('resize', () => { if (window.innerWidth > 1024) UI.closeSidebar(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') UI.closeModal(); });
})();
