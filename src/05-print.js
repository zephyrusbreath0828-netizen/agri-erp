/* ==========================================================================
   アグリERP — 帳票出力（見積書・発注書・納品書・請求書・入庫伝票・出庫伝票・ピッキング）
   - 帳票上部には発行元（会社マスタ＋拠点マスタ最大2件）を表示する（Issuer.headerHtml）
   - 表示可否は「帳票テンプレート（doc_templates）× マスタの表示可否」で決まり、
     非表示・未入力の項目は HTML を出力しない（空行・空白領域を作らない）
   - A4 印刷CSS + window.print() で「PDFに保存」に対応
   ========================================================================== */
const Print = {
  /* 発行元コンテキスト（会社・拠点・テンプレート）を解決 */
  ctxOf(rec, opt) {
    const src = Object.assign({}, rec || {});
    if (opt && opt.docKind) src.docKind = opt.docKind;
    if (opt && opt.template) src.templateId = opt.template.id || null;
    const ctx = Issuer.resolve(src);
    if (opt && opt.template) ctx.template = opt.template;
    if (opt && opt.companyId) { const c = Issuer.company(opt.companyId); if (c) { ctx.company = c; if (ctx.branch1 && ctx.branch1.companyId !== c.id) ctx.branch1 = null; if (ctx.branch2 && ctx.branch2.companyId !== c.id) ctx.branch2 = null; } }
    if (opt && 'branch1Id' in opt) ctx.branch1 = opt.branch1Id ? Issuer.branch(opt.branch1Id) : null;
    if (opt && 'branch2Id' in opt) ctx.branch2 = opt.branch2Id ? Issuer.branch(opt.branch2Id) : null;
    return ctx;
  },
  co() { return Issuer.companies(true)[0] || {}; },

  /* 帳票共通ヘッダ（タイトル・帳票番号・発行元） */
  head(title, docNo, sub, rec) {
    const ctx = this.ctxOf(rec, this._pv);
    return `<div class="sheet-head">
      <div><h1>${esc(title)}</h1><div style="font-size:8.5pt;color:#64748b;margin-top:3px">${esc(sub || '')}</div></div>
      ${Issuer.headerHtml(ctx)}
    </div>
    <div class="sheet-meta">
      <div class="box"><div class="t">帳票番号</div><div class="v">${esc(docNo)}</div></div>
      <div class="box"><div class="t">発行日</div><div class="v">${dJPfull(TODAY)}</div></div>
    </div>`;
  },
  foot(rec, docNo, refNo) {
    if (this._pv && this._pv.footer === false) return '';
    const ctx = this.ctxOf(rec, this._pv);
    const c = ctx.company || {};
    const showName = !ctx.template || ctx.template.companyName !== false;
    return `<div class="sheet-foot"><span>${esc(showName ? (c.name || '') : '')}</span><span>${esc(docNo)}${refNo ? ' ／ ' + esc(refNo) : ''}</span></div>`;
  },

  /* 帳票発行履歴の登録（発行会社・拠点・テンプレートをスナップショット保存） */
  record(kind, ref, extra, ctx) {
    if (this._pv && this._pv.preview) {
      return Object.assign({ id: 'preview', docKind: kind, docNo: (extra || {}).docNo || '（プレビュー）' }, ref || {});
    }
    const doc = Object.assign({
      id: uid(), docKind: kind, issuedAt: new Date().toISOString(),
      issuedBy: Auth.user ? Auth.user.id : null, printedCount: 1,
      companyId: (ctx.company || {}).id || null,
      branch1Id: (ctx.branch1 || {}).id || null,
      branch2Id: (ctx.branch2 || {}).id || null,
      templateId: (ctx.template || {}).id || null
    }, ref || {}, extra || {});
    Store.db.documents.unshift(doc);
    Store.save();
    return doc;
  },

  render(html) {
    if (this._pv && this._pv.preview) { this._out = html; return html; }
    const root = document.getElementById('printRoot');
    root.innerHTML = html;
    setTimeout(() => window.print(), 120);
  },

  /* ------------------------- 納品書 ------------------------- */
  delivery(shipmentId) {
    const s = Store.shipment(shipmentId); if (!s) return;
    const c = Store.customer(s.customerId) || {};
    const lines = Store.shipLines(s.id);
    const ctx = this.ctxOf(Object.assign({ docKind: 'delivery_note' }, s));
    const doc = this.record('delivery_note', { shipmentId: s.id, shipmentNo: s.shipmentNo, orderId: s.orderId, customerId: s.customerId, customerName: s.customerName }, { docNo: Store.nextNo('DN') }, ctx);
    let sub = 0, tax = 0;
    const rows = lines.map((l, i) => {
      const it = Store.item(l.itemId) || {};
      const price = it.salePrice || 0;
      const amt = price * l.quantity;
      sub += amt; tax += amt * ((it.taxRate || 8) / 100);
      return `<tr><td style="text-align:center">${i + 1}</td><td>${esc(it.code || '')}</td><td><b>${esc(l.itemName)}</b>${it.spec ? `<div style="font-size:8pt;color:#64748b">${esc(it.spec)}</div>` : ''}</td>
        <td class="num">${dec(l.quantity)}</td><td style="text-align:center">${esc(it.unit || '')}</td>
        <td class="num">${money(price)}</td><td class="num">${money(Math.round(amt))}</td></tr>`;
    }).join('');
    const total = Math.round(sub + tax);

    this.render(`<div class="sheet${this.paperCls()}">
      ${this.wm('納品書')}
      ${this.head('納 品 書', doc.docNo, `出荷番号 ${s.shipmentNo}${s.orderNo ? ' ／ 受注番号 ' + s.orderNo : ''}`, Object.assign({ docKind: 'delivery_note' }, s))}
      <div class="sheet-meta" style="margin-top:-4px">
        <div class="box" style="min-width:52%">
          <div class="t">納品先</div>
          <div class="v">${esc(s.customerName || c.name || '')} 御中</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">${esc(s.shipToAddr || c.address || '')}${c.tel ? `<br>TEL ${esc(c.tel)}` : ''}</div>
        </div>
        <div class="box" style="min-width:40%">
          <div class="t">納品日／出荷日</div>
          <div class="v">${dJPfull(s.shipDate)}</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">支払条件：${esc(c.paymentTerms || '翌月末')}　締日：${c.closingDay === 31 ? '末日' : (c.closingDay || '') + '日'}</div>
        </div>
      </div>
      <p style="font-size:10.5pt;margin:6px 0 10px">下記のとおり納品いたしましたので、ご査収くださいますようお願い申し上げます。</p>
      <table>
        <thead><tr><th style="width:7%">No.</th><th style="width:12%">コード</th><th>品名</th><th style="width:11%">数量</th><th style="width:9%">単位</th><th style="width:14%">単価</th><th style="width:15%">金額</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals"><table>
        <tr><td>小計（税抜）</td><td class="num">${money(Math.round(sub))}</td></tr>
        <tr><td>消費税（8%）</td><td class="num">${money(Math.round(tax))}</td></tr>
        <tr class="grand"><td>合計</td><td class="num">${money(total)}</td></tr>
      </table></div>
      <div class="sheet-note">※ 本納品書は帳票番号 ${esc(doc.docNo)} として発行されました。${s.remarks ? '　備考：' + esc(s.remarks) : ''}</div>
      <div class="sign"><div class="s"><b>納品先 受領印</b></div><div class="s"><b>担当者</b></div></div>
      ${this.foot(Object.assign({ docKind: 'delivery_note' }, s), doc.docNo, s.shipmentNo)}
    </div>`);
  },

  /* ------------------------- 出庫伝票（出荷伝票） ------------------------- */
  slip(shipmentId) {
    const s = Store.shipment(shipmentId); if (!s) return;
    const c = Store.customer(s.customerId) || {};
    const lines = Store.shipLines(s.id);
    const ctx = this.ctxOf(Object.assign({ docKind: 'shipping_slip' }, s));
    const doc = this.record('shipping_slip', { shipmentId: s.id, shipmentNo: s.shipmentNo, orderId: s.orderId, customerId: s.customerId, customerName: s.customerName }, { docNo: Store.nextNo('SL') }, ctx);
    const rows = lines.map((l, i) => {
      const it = Store.item(l.itemId) || {};
      return `<tr><td style="text-align:center">${i + 1}</td><td>${esc(it.code || '')}</td><td><b>${esc(l.itemName)}</b></td>
        <td class="num">${dec(l.quantity)}</td><td style="text-align:center">${esc(it.unit || '')}</td>
        <td style="text-align:center">${esc(it.location || '—')}</td><td>${esc(l.lotNo || '')}</td><td style="text-align:center"><span class="pick-chk"></span></td></tr>`;
    }).join('');

    this.render(`<div class="sheet${this.paperCls()}">
      ${this.head('出 庫 伝 票', doc.docNo, `出荷番号 ${s.shipmentNo}${s.orderNo ? ' ／ 受注番号 ' + s.orderNo : ''}`, Object.assign({ docKind: 'shipping_slip' }, s))}
      <div class="sheet-meta" style="margin-top:-4px">
        <div class="box" style="min-width:52%">
          <div class="t">出荷先</div>
          <div class="v">${esc(s.shipToName || s.customerName || '')} 様</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">${esc(s.shipToAddr || c.address || '')}${c.tel ? `<br>TEL ${esc(c.tel)}` : ''}</div>
        </div>
        <div class="box" style="min-width:40%">
          <div class="t">出荷日</div>
          <div class="v">${dJPfull(s.shipDate)}</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">運送会社：${esc(s.carrier || '—')}<br>追跡番号：${esc(s.trackingNo || '—')}</div>
        </div>
      </div>
      <table>
        <thead><tr><th style="width:7%">No.</th><th style="width:12%">コード</th><th>品名</th><th style="width:11%">数量</th><th style="width:9%">単位</th><th style="width:12%">保管場所</th><th style="width:14%">ロット</th><th style="width:9%">確認</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="sheet-note">※ 本伝票は帳票番号 ${esc(doc.docNo)} として発行されました。商品の受け取り時に数量をご確認ください。</div>
      <div style="margin-top:14px;display:flex;gap:14px;align-items:flex-start;justify-content:space-between">
        <div style="display:flex;gap:14px;align-items:flex-end">
          <div><div style="font-size:8pt;color:#64748b;margin-bottom:3px">出荷番号バーコード（将来拡張）</div>
            <div class="barcode">${Array.from({ length: 42 }, (_, i) => `<i style="height:${18 + ((i * 7 + 5) % 17)}px;width:${(i % 3) + 1}px"></i>`).join('')}</div>
            <div style="font-size:8pt;font-family:monospace;margin-top:2px">${esc(s.shipmentNo)}</div></div>
          <div><div style="font-size:8pt;color:#64748b;margin-bottom:3px">QR（将来拡張）</div><div class="qr"></div></div>
        </div>
        <div class="sign" style="margin-top:0"><div class="s"><b>出庫担当</b></div><div class="s"><b>受領印</b></div></div>
      </div>
      ${this.foot(Object.assign({ docKind: 'shipping_slip' }, s), doc.docNo, s.shipmentNo)}
    </div>`);
  },

  /* ------------------------- ピッキングリスト ------------------------- */
  picking(shipmentId) {
    const s = Store.shipment(shipmentId); if (!s) return;
    const lines = Store.shipLines(s.id).slice().sort((a, b) => {
      const ia = Store.item(a.itemId) || {}, ib = Store.item(b.itemId) || {};
      return String(ia.location || '').localeCompare(String(ib.location || ''));
    });
    const ctx = this.ctxOf(Object.assign({ docKind: 'picking_list' }, s));
    const doc = this.record('picking_list', { shipmentId: s.id, shipmentNo: s.shipmentNo, orderId: s.orderId, customerId: s.customerId, customerName: s.customerName }, { docNo: Store.nextNo('PL') }, ctx);
    const rows = lines.map((l, i) => {
      const it = Store.item(l.itemId) || {};
      return `<tr><td style="text-align:center">${i + 1}</td><td style="text-align:center"><span class="pick-chk"></span></td>
        <td style="text-align:center"><b>${esc(it.location || '—')}</b></td><td>${esc(it.code || '')}</td><td><b>${esc(l.itemName)}</b>${it.spec ? `<div style="font-size:8pt;color:#64748b">${esc(it.spec)}</div>` : ''}</td>
        <td class="num" style="font-size:12pt"><b>${dec(l.quantity)}</b></td><td style="text-align:center">${esc(it.unit || '')}</td>
        <td style="text-align:center">${it.stock >= l.quantity ? '○' : '△'}</td></tr>`;
    }).join('');
    const totalQty = lines.reduce((a, l) => a + l.quantity, 0);

    this.render(`<div class="sheet landscape">
      ${this.head('ピッキングリスト', doc.docNo, `出荷番号 ${s.shipmentNo} ／ 出荷日 ${dJPfull(s.shipDate)}`, Object.assign({ docKind: 'picking_list' }, s))}
      <div class="sheet-meta" style="margin-top:-4px">
        <div class="box" style="min-width:38%"><div class="t">出荷先</div><div class="v">${esc(s.customerName)} 様</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:2px">${esc(s.shipToAddr || '')}</div></div>
        <div class="box" style="min-width:26%"><div class="t">合計数量</div><div class="v">${dec(totalQty)} 点</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:2px">明細 ${lines.length} 行</div></div>
        <div class="box" style="min-width:26%"><div class="t">運送／追跡</div><div class="v" style="font-size:9.5pt">${esc(s.carrier || '—')}</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:2px">${esc(s.trackingNo || '—')}</div></div>
      </div>
      <table>
        <thead><tr><th style="width:6%">No.</th><th style="width:8%">完了</th><th style="width:12%">保管場所</th><th style="width:12%">コード</th><th>品名</th><th style="width:12%">数量</th><th style="width:8%">単位</th><th style="width:8%">在庫</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="sheet-note">※ 保管場所の順に並んでいます。ピッキング完了後、チェック欄に印を付けてください。在庫欄 ○＝引当可 ／ △＝在庫不足。</div>
      <div class="sign" style="margin-top:14px"><div class="s"><b>ピッキング担当</b></div><div class="s"><b>検品担当</b></div><div class="s"><b>出庫担当</b></div></div>
      ${this.foot(Object.assign({ docKind: 'picking_list' }, s), doc.docNo, s.shipmentNo)}
    </div>`);
  },

  /* ------------------------- 見積書（受注ベース） ------------------------- */
  quote(orderId) {
    const o = Store.order(orderId); if (!o) return;
    const c = Store.customer(o.customerId) || {};
    const lines = Store.orderLines(o.id);
    const ctx = this.ctxOf(Object.assign({ docKind: 'quote' }, o));
    const doc = this.record('quote', { orderId: o.id, customerId: o.customerId, customerName: o.customerName }, { docNo: Store.nextNo('QT') }, ctx);
    const rows = lines.map((l, i) => `<tr><td style="text-align:center">${i + 1}</td><td>${esc((Store.item(l.itemId) || {}).code || '')}</td>
      <td><b>${esc(l.itemName)}</b>${(Store.item(l.itemId) || {}).spec ? `<div style="font-size:8pt;color:#64748b">${esc((Store.item(l.itemId) || {}).spec)}</div>` : ''}</td>
      <td class="num">${dec(l.quantity)}</td><td style="text-align:center">${esc(l.unit || '')}</td>
      <td class="num">${money(l.unitPrice)}</td><td class="num">${money(Math.round(l.amount))}</td></tr>`).join('');
    const sub = lines.reduce((a, l) => a + l.amount, 0);
    const tax = Math.round(sub * 0.08);

    this.render(`<div class="sheet${this.paperCls()}">
      ${this.wm('見積書')}
      ${this.head('見 積 書', doc.docNo, `受注番号 ${o.orderNo} ／ 見積日 ${dJPfull(o.orderDate)}`, Object.assign({ docKind: 'quote' }, o))}
      <div class="sheet-meta" style="margin-top:-4px">
        <div class="box" style="min-width:52%">
          <div class="t">見積先</div>
          <div class="v">${esc(o.customerName || c.name || '')} 御中</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">${esc(c.address || '')}${c.tel ? `<br>TEL ${esc(c.tel)}` : ''}</div>
        </div>
        <div class="box" style="min-width:40%">
          <div class="t">見積金額（税込）</div>
          <div class="v">${money(Math.round(sub + tax))}</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">有効期限：${dJPfull(todayStr(addDays(new Date(), 30)))}</div>
        </div>
      </div>
      <p style="font-size:10.5pt;margin:6px 0 10px">下記のとおりお見積り申し上げます。</p>
      <table>
        <thead><tr><th style="width:7%">No.</th><th style="width:12%">コード</th><th>品名</th><th style="width:11%">数量</th><th style="width:9%">単位</th><th style="width:14%">単価</th><th style="width:15%">金額</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals"><table>
        <tr><td>小計（税抜）</td><td class="num">${money(Math.round(sub))}</td></tr>
        <tr><td>消費税（8%）</td><td class="num">${money(tax)}</td></tr>
        <tr class="grand"><td>合計</td><td class="num">${money(Math.round(sub + tax))}</td></tr>
      </table></div>
      <div class="sheet-note">※ 本見積書は帳票番号 ${esc(doc.docNo)} として発行されました。${o.remarks ? '　備考：' + esc(o.remarks) : ''}</div>
      ${this.foot(Object.assign({ docKind: 'quote' }, o), doc.docNo, o.orderNo)}
    </div>`);
  },

  /* ------------------------- 請求書（受注ベース） ------------------------- */
  invoice(orderId) {
    const o = Store.order(orderId); if (!o) return;
    const c = Store.customer(o.customerId) || {};
    const lines = Store.orderLines(o.id);
    const ctx = this.ctxOf(Object.assign({ docKind: 'invoice' }, o));
    const doc = this.record('invoice', { orderId: o.id, customerId: o.customerId, customerName: o.customerName }, { docNo: Store.nextNo('IV') }, ctx);
    const rows = lines.map((l, i) => `<tr><td style="text-align:center">${i + 1}</td><td>${esc((Store.item(l.itemId) || {}).code || '')}</td>
      <td><b>${esc(l.itemName)}</b></td><td class="num">${dec(l.quantity)}</td><td style="text-align:center">${esc(l.unit || '')}</td>
      <td class="num">${money(l.unitPrice)}</td><td class="num">${money(Math.round(l.amount))}</td></tr>`).join('');
    const sub = lines.reduce((a, l) => a + l.amount, 0);
    const tax = Math.round(sub * 0.08);

    this.render(`<div class="sheet${this.paperCls()}">
      ${this.wm('請求書')}
      ${this.head('請 求 書', doc.docNo, `受注番号 ${o.orderNo} ／ 請求日 ${dJPfull(TODAY)}`, Object.assign({ docKind: 'invoice' }, o))}
      <div class="sheet-meta" style="margin-top:-4px">
        <div class="box" style="min-width:52%">
          <div class="t">請求先</div>
          <div class="v">${esc(o.customerName || c.name || '')} 御中</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">${esc(c.address || '')}${c.tel ? `<br>TEL ${esc(c.tel)}` : ''}</div>
        </div>
        <div class="box" style="min-width:40%">
          <div class="t">ご請求金額（税込）</div>
          <div class="v">${money(Math.round(sub + tax))}</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">支払条件：${esc(c.paymentTerms || '翌月末')}　締日：${c.closingDay === 31 ? '末日' : (c.closingDay || '') + '日'}</div>
        </div>
      </div>
      <p style="font-size:10.5pt;margin:6px 0 10px">下記のとおりご請求申し上げます。</p>
      <table>
        <thead><tr><th style="width:7%">No.</th><th style="width:12%">コード</th><th>品名</th><th style="width:11%">数量</th><th style="width:9%">単位</th><th style="width:14%">単価</th><th style="width:15%">金額</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals"><table>
        <tr><td>小計（税抜）</td><td class="num">${money(Math.round(sub))}</td></tr>
        <tr><td>消費税（8%）</td><td class="num">${money(tax)}</td></tr>
        <tr class="grand"><td>合計</td><td class="num">${money(Math.round(sub + tax))}</td></tr>
      </table></div>
      <div class="sheet-note">※ 本請求書は帳票番号 ${esc(doc.docNo)} として発行されました。登録番号は発行元情報をご確認ください。${o.remarks ? '　備考：' + esc(o.remarks) : ''}</div>
      <div class="sign"><div class="s"><b>担当者</b></div><div class="s"><b>経理確認</b></div></div>
      ${this.foot(Object.assign({ docKind: 'invoice' }, o), doc.docNo, o.orderNo)}
    </div>`);
  },

  /* ------------------------- 発注書（発注ベース） ------------------------- */
  purchaseOrder(poId) {
    const p = Store.po(poId); if (!p) return;
    const lines = Store.poLines(p.id);
    const ctx = this.ctxOf(Object.assign({ docKind: 'purchase_order' }, p));
    const doc = this.record('purchase_order', { poId: p.id, customerId: p.supplierId, customerName: p.supplierName }, { docNo: p.poNo }, ctx);
    const rows = lines.map((l, i) => `<tr><td style="text-align:center">${i + 1}</td><td>${esc((Store.item(l.itemId) || {}).code || '')}</td>
      <td><b>${esc(l.itemName)}</b></td><td class="num">${dec(l.quantity)}</td><td style="text-align:center">${esc(l.unit || '')}</td>
      <td class="num">${money(l.unitPrice)}</td><td class="num">${money(Math.round(l.amount))}</td><td class="nowrap">${dJP(l.expectedDate || p.expectedDate)}</td></tr>`).join('');
    const sub = lines.reduce((a, l) => a + l.amount, 0);
    const tax = Math.round(sub * 0.08);

    this.render(`<div class="sheet${this.paperCls()}">
      ${this.wm('発注書')}
      ${this.head('発 注 書', doc.docNo, `発注日 ${dJPfull(p.orderDate)} ／ 入荷予定 ${dJPfull(p.expectedDate)}`, Object.assign({ docKind: 'purchase_order' }, p))}
      <div class="sheet-meta" style="margin-top:-4px">
        <div class="box" style="min-width:52%">
          <div class="t">発注先</div>
          <div class="v">${esc(p.supplierName)} 御中</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">${esc((Store.supplier(p.supplierId) || {}).address || '')}</div>
        </div>
        <div class="box" style="min-width:40%">
          <div class="t">発注金額（税込）</div>
          <div class="v">${money(Math.round(sub + tax))}</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">入荷予定日：${dJPfull(p.expectedDate)}</div>
        </div>
      </div>
      <p style="font-size:10.5pt;margin:6px 0 10px">下記のとおり発注いたします。</p>
      <table>
        <thead><tr><th style="width:7%">No.</th><th style="width:12%">コード</th><th>品名</th><th style="width:11%">数量</th><th style="width:9%">単位</th><th style="width:13%">単価</th><th style="width:14%">金額</th><th style="width:14%">納期</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals"><table>
        <tr><td>小計（税抜）</td><td class="num">${money(Math.round(sub))}</td></tr>
        <tr><td>消費税（8%）</td><td class="num">${money(tax)}</td></tr>
        <tr class="grand"><td>合計</td><td class="num">${money(Math.round(sub + tax))}</td></tr>
      </table></div>
      <div class="sheet-note">※ 本発注書は帳票番号 ${esc(doc.docNo)} として発行されました。${p.remarks ? '　備考：' + esc(p.remarks) : ''}</div>
      <div class="sign"><div class="s"><b>発注担当</b></div><div class="s"><b>承認</b></div></div>
      ${this.foot(Object.assign({ docKind: 'purchase_order' }, p), doc.docNo, p.poNo)}
    </div>`);
  },

  /* ------------------------- 入庫伝票（入荷ベース） ------------------------- */
  receiptNote(receiptId) {
    const r = Store.db.receipts.find(x => x.id === receiptId); if (!r) return;
    const lines = Store.receiptLines(r.id);
    const ctx = this.ctxOf(Object.assign({ docKind: 'receipt_note' }, r));
    const doc = this.record('receipt_note', { receiptId: r.id, customerId: r.supplierId, customerName: r.supplierName }, { docNo: r.receiptNo }, ctx);
    const rows = lines.map((l, i) => `<tr><td style="text-align:center">${i + 1}</td><td>${esc((Store.item(l.itemId) || {}).code || '')}</td>
      <td><b>${esc(l.itemName)}</b></td><td class="num">${dec(l.quantity)}</td><td style="text-align:center">${esc((Store.item(l.itemId) || {}).unit || '')}</td>
      <td class="num">${money(l.unitCost)}</td><td class="num">${money(Math.round(l.amount))}</td><td>${esc(l.lotNo || '')}</td></tr>`).join('');
    const sub = lines.reduce((a, l) => a + l.amount, 0);
    const tax = Math.round(sub * 0.08);

    this.render(`<div class="sheet${this.paperCls()}">
      ${this.wm('入庫伝票')}
      ${this.head('入 庫 伝 票', doc.docNo, `入荷日 ${dJPfull(r.receiptDate)}${r.poId ? ' ／ 発注番号 ' + ((Store.po(r.poId) || {}).poNo || '') : ''}`, Object.assign({ docKind: 'receipt_note' }, r))}
      <div class="sheet-meta" style="margin-top:-4px">
        <div class="box" style="min-width:52%">
          <div class="t">仕入先</div>
          <div class="v">${esc(r.supplierName)}</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">${esc((Store.supplier(r.supplierId) || {}).address || '')}</div>
        </div>
        <div class="box" style="min-width:40%">
          <div class="t">入庫金額（税込）</div>
          <div class="v">${money(Math.round(sub + tax))}</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">入荷明細 ${lines.length} 行</div>
        </div>
      </div>
      <table>
        <thead><tr><th style="width:7%">No.</th><th style="width:12%">コード</th><th>品名</th><th style="width:11%">入庫数</th><th style="width:9%">単位</th><th style="width:14%">単価</th><th style="width:15%">金額</th><th style="width:10%">ロット</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals"><table>
        <tr><td>小計（税抜）</td><td class="num">${money(Math.round(sub))}</td></tr>
        <tr><td>消費税（8%）</td><td class="num">${money(tax)}</td></tr>
        <tr class="grand"><td>合計</td><td class="num">${money(Math.round(sub + tax))}</td></tr>
      </table></div>
      <div class="sheet-note">※ 本入庫伝票は帳票番号 ${esc(doc.docNo)} として発行されました。入庫数量をご確認のうえ受領印を押印してください。${r.remarks ? '　備考：' + esc(r.remarks) : ''}</div>
      <div class="sign"><div class="s"><b>受領印</b></div><div class="s"><b>検収担当</b></div></div>
      ${this.foot(Object.assign({ docKind: 'receipt_note' }, r), doc.docNo, r.receiptNo)}
    </div>`);
  },

  /* ------------------------- プレビュー用（帳票テンプレート編集画面） ------------------------- */
  wm(text) { return (!this._pv || this._pv.watermark !== false) ? `<div class="watermark">${text}</div>` : ''; },
  paperCls() { return (this._pv && this._pv.paper === 'landscape') ? ' landscape' : ''; },

  /* HTML生成のみ（履歴登録・印刷なし）。opt = { template, companyId, branch1Id, branch2Id, paper, watermark, footer } */
  build(kind, opt) {
    const map = { quote: 'quote', invoice: 'invoice', delivery_note: 'delivery', shipping_slip: 'slip', purchase_order: 'purchaseOrder', receipt_note: 'receiptNote' };
    const fn = map[kind];
    if (!fn) return '';
    const prevPv = this._pv, prevOut = this._out, prevDry = Store._dryRun;
    this._pv = Object.assign({ preview: true }, opt || {});
    this._out = null;
    Store._dryRun = true;
    let demo = null;
    try {
      let id = this.sampleId(kind);
      if (!id) { demo = this.demo(kind); id = demo.id; }
      this[fn](id);
      return this._out || '';
    } catch (e) {
      return `<div class="note rose">プレビューを生成できませんでした（${esc(e.message)}）</div>`;
    } finally {
      if (demo) this.demoClean(demo.id);
      this._pv = prevPv; this._out = prevOut; Store._dryRun = prevDry;
    }
  },

  /* プレビューに使う実データ（最新の1件） */
  sampleId(kind) {
    const db = Store.db || {};
    const latest = arr => {
      const list = (arr || []).slice().sort((a, b) => String(b.orderDate || b.shipDate || b.receiptDate || b.issuedAt || '').localeCompare(String(a.orderDate || a.shipDate || a.receiptDate || a.issuedAt || '')));
      return (list[0] || {}).id || null;
    };
    if (kind === 'quote' || kind === 'invoice') return latest((db.orders || []).filter(o => o.status !== 'cancelled'));
    if (kind === 'purchase_order') return latest(db.purchaseOrders);
    if (kind === 'receipt_note') return latest(db.receipts);
    const conf = (db.shipments || []).filter(s => s.status === 'confirmed');
    return latest(conf.length ? conf : db.shipments);
  },

  /* 実データがない環境（初期状態）でもプレビューできるようサンプルを一時投入 */
  demo(kind) {
    const db = Store.db;
    const its = (db.items || []).slice(0, 3);
    const cust = (db.customers || [])[0] || { id: null, name: 'デモ得意先 株式会社', address: '東京都千代田区1-2-3', tel: '03-0000-0000' };
    const sup = (db.suppliers || [])[0] || { id: null, name: 'デモ仕入先 株式会社', address: '大阪府大阪市1-2-3' };
    const line = (i, extra) => {
      const it = its[i] || {};
      const qty = (i + 1) * 10, price = 1200 + i * 350;
      return Object.assign({
        id: 'pv_line_' + i, itemId: it.id || null, itemName: it.name || ('デモ品目' + (i + 1)), unit: it.unit || 'ケース',
        quantity: qty, unitPrice: price, unitCost: price - 300, amount: qty * price,
        lotNo: 'LOT-' + (1001 + i), shippedQty: 0, receivedQty: 0, expectedDate: TODAY
      }, extra || {});
    };
    if (kind === 'quote' || kind === 'invoice') {
      const id = 'pv_order';
      db.orders.unshift({ id, orderNo: 'PV-0001', orderDate: TODAY, customerId: cust.id, customerName: cust.name, salesRepId: null, status: 'received', total: 0, remarks: '（プレビュー用サンプル）' });
      for (let i = 0; i < 3; i++) db.orderLines.push(line(i, { id: 'pv_o_l' + i, orderId: id }));
      return { id };
    }
    if (kind === 'delivery_note' || kind === 'shipping_slip') {
      const id = 'pv_ship';
      db.shipments.unshift({ id, shipmentNo: 'PV-0001', shipDate: TODAY, customerId: cust.id, customerName: cust.name, shipToName: cust.name, shipToAddr: cust.address || '', status: 'confirmed', carrier: 'ヤマト運輸', trackingNo: '0000-0000-0000', remarks: '' });
      for (let i = 0; i < 3; i++) db.shipmentLines.push(line(i, { id: 'pv_s_l' + i, shipmentId: id }));
      return { id };
    }
    if (kind === 'purchase_order') {
      const id = 'pv_po';
      db.purchaseOrders.unshift({ id, poNo: 'PV-0001', orderDate: TODAY, expectedDate: TODAY, supplierId: sup.id, supplierName: sup.name, status: 'ordered', total: 0, remarks: '' });
      for (let i = 0; i < 3; i++) db.poLines.push(line(i, { id: 'pv_p_l' + i, poId: id }));
      return { id };
    }
    const id = 'pv_rec';
    db.receipts.unshift({ id, receiptNo: 'PV-0001', receiptDate: TODAY, supplierId: sup.id, supplierName: sup.name, status: 'received', total: 0, remarks: '' });
    for (let i = 0; i < 3; i++) db.receiptLines.push(line(i, { id: 'pv_r_l' + i, receiptId: id }));
    return { id };
  },
  demoClean(id) {
    const db = Store.db;
    db.orders = db.orders.filter(x => x.id !== id); db.orderLines = db.orderLines.filter(x => x.orderId !== id);
    db.shipments = db.shipments.filter(x => x.id !== id); db.shipmentLines = db.shipmentLines.filter(x => x.shipmentId !== id);
    db.purchaseOrders = db.purchaseOrders.filter(x => x.id !== id); db.poLines = db.poLines.filter(x => x.poId !== id);
    db.receipts = db.receipts.filter(x => x.id !== id); db.receiptLines = db.receiptLines.filter(x => x.receiptId !== id);
  },

  /* プレビューと同一HTMLを印刷（ブラウザの「PDFに保存」でPDF化） */
  exportPdf(html, opt) {
    opt = opt || {};
    let st = document.getElementById('printPaper');
    if (!st) { st = document.createElement('style'); st.id = 'printPaper'; document.head.appendChild(st); }
    st.textContent = '@media print{@page{size:A4' + (opt.paper === 'landscape' ? ' landscape' : '') + ';margin:0}}';
    const root = document.getElementById('printRoot');
    if (root) root.innerHTML = html;
    setTimeout(() => window.print(), 150);
  },

  /* 再発行（履歴から） */
  reissue(docId) {
    const d = Store.db.documents.find(x => x.id === docId);
    if (!d) return UI.toast('帳票が見つかりません', 'err');
    d.printedCount = (d.printedCount || 0) + 1; Store.save();
    switch (d.docKind) {
      case 'delivery_note': return this.delivery(d.shipmentId);
      case 'shipping_slip': return this.slip(d.shipmentId);
      case 'picking_list': return this.picking(d.shipmentId);
      case 'quote': return this.quote(d.orderId);
      case 'invoice': return this.invoice(d.orderId);
      case 'purchase_order': return this.purchaseOrder(d.poId);
      case 'receipt_note': return this.receiptNote(d.receiptId);
      default: return UI.toast('この帳票は再発行できません', 'warn');
    }
  }
};
