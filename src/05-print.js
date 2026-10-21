/* ==========================================================================
   アグリERP — 帳票出力（納品書・出荷伝票・ピッキングリスト）
   A4 印刷CSS + window.print() で「PDFに保存」に対応。日本語はブラウザ標準フォントで描画。
   ========================================================================== */
const Print = {
  co() { return Store.db.settings.company; },

  /* 帳票共通ヘッダ */
  head(title, docNo, sub) {
    const c = this.co();
    return `<div class="sheet-head">
      <div><h1>${esc(title)}</h1><div style="font-size:8.5pt;color:#64748b;margin-top:3px">${esc(sub || '')}</div></div>
      <div class="co"><b>${esc(c.name)}</b>${esc(c.postal)}<br>${esc(c.address)}<br>TEL ${esc(c.tel)} ／ FAX ${esc(c.fax)}<br>登録番号 ${esc(c.invoiceNo)}</div>
    </div>
    <div class="sheet-meta">
      <div class="box"><div class="t">帳票番号</div><div class="v">${esc(docNo)}</div></div>
      <div class="box"><div class="t">発行日</div><div class="v">${dJPfull(TODAY)}</div></div>
    </div>`;
  },

  /* 番号の自動採番＋帳票履歴登録 */
  issue(kind, shipment, extra) {
    const prefix = { delivery_note: 'DN', shipping_slip: 'SL', picking_list: 'PL' }[kind];
    const docNo = Store.nextNo(prefix);
    const rec = {
      id: uid(), docKind: kind, docNo, shipmentId: shipment.id, shipmentNo: shipment.shipmentNo,
      orderId: shipment.orderId, customerId: shipment.customerId, customerName: shipment.customerName,
      issuedAt: new Date().toISOString(), issuedBy: Auth.user ? Auth.user.id : null,
      printedCount: 1, ...(extra || {})
    };
    Store.db.documents.unshift(rec);
    Store.save();
    return rec;
  },

  render(html) {
    const root = document.getElementById('printRoot');
    root.innerHTML = html;
    setTimeout(() => window.print(), 120);
  },

  /* ------------------------- 納品書 ------------------------- */
  delivery(shipmentId) {
    const s = Store.shipment(shipmentId); if (!s) return;
    const c = Store.customer(s.customerId) || {};
    const lines = Store.shipLines(s.id);
    const doc = this.issue('delivery_note', s);
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

    this.render(`<div class="sheet">
      <div class="watermark">納品書</div>
      ${this.head('納 品 書', doc.docNo, `出荷番号 ${s.shipmentNo}${s.orderNo ? ' ／ 受注番号 ' + s.orderNo : ''}`)}
      <div class="sheet-meta" style="margin-top:-4px">
        <div class="box" style="min-width:52%">
          <div class="t">納品先</div>
          <div class="v">${esc(s.customerName || c.name || '')} 御中</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">${esc(s.shipToAddr || c.address || '')}<br>TEL ${esc(c.tel || '')}</div>
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
      <div class="sheet-foot"><span>${esc(this.co().name)}</span><span>${esc(doc.docNo)} ／ ${esc(s.shipmentNo)}</span></div>
    </div>`);
  },

  /* ------------------------- 出荷伝票 ------------------------- */
  slip(shipmentId) {
    const s = Store.shipment(shipmentId); if (!s) return;
    const c = Store.customer(s.customerId) || {};
    const lines = Store.shipLines(s.id);
    const doc = this.issue('shipping_slip', s);
    const rows = lines.map((l, i) => {
      const it = Store.item(l.itemId) || {};
      return `<tr><td style="text-align:center">${i + 1}</td><td>${esc(it.code || '')}</td><td><b>${esc(l.itemName)}</b></td>
        <td class="num">${dec(l.quantity)}</td><td style="text-align:center">${esc(it.unit || '')}</td>
        <td style="text-align:center">${esc(it.location || '—')}</td><td>${esc(l.lotNo || '')}</td><td style="text-align:center"><span class="pick-chk"></span></td></tr>`;
    }).join('');

    this.render(`<div class="sheet">
      ${this.head('出 荷 伝 票', doc.docNo, `出荷番号 ${s.shipmentNo}${s.orderNo ? ' ／ 受注番号 ' + s.orderNo : ''}`)}
      <div class="sheet-meta" style="margin-top:-4px">
        <div class="box" style="min-width:52%">
          <div class="t">出荷先</div>
          <div class="v">${esc(s.shipToName || s.customerName || '')} 様</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">${esc(s.shipToAddr || c.address || '')}<br>TEL ${esc(c.tel || '')}</div>
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
        <div class="sign" style="margin-top:0"><div class="s"><b>出荷担当</b></div><div class="s"><b>受領印</b></div></div>
      </div>
      <div class="sheet-foot"><span>${esc(this.co().name)}</span><span>${esc(doc.docNo)} ／ ${esc(s.shipmentNo)}</span></div>
    </div>`);
  },

  /* ------------------------- ピッキングリスト ------------------------- */
  picking(shipmentId) {
    const s = Store.shipment(shipmentId); if (!s) return;
    const lines = Store.shipLines(s.id).slice().sort((a, b) => {
      const ia = Store.item(a.itemId) || {}, ib = Store.item(b.itemId) || {};
      return String(ia.location || '').localeCompare(String(ib.location || ''));
    });
    const doc = this.issue('picking_list', s);
    const rows = lines.map((l, i) => {
      const it = Store.item(l.itemId) || {};
      return `<tr><td style="text-align:center">${i + 1}</td><td style="text-align:center"><span class="pick-chk"></span></td>
        <td style="text-align:center"><b>${esc(it.location || '—')}</b></td><td>${esc(it.code || '')}</td><td><b>${esc(l.itemName)}</b>${it.spec ? `<div style="font-size:8pt;color:#64748b">${esc(it.spec)}</div>` : ''}</td>
        <td class="num" style="font-size:12pt"><b>${dec(l.quantity)}</b></td><td style="text-align:center">${esc(it.unit || '')}</td>
        <td style="text-align:center">${it.stock >= l.quantity ? '○' : '△'}</td></tr>`;
    }).join('');
    const totalQty = lines.reduce((a, l) => a + l.quantity, 0);

    this.render(`<div class="sheet landscape">
      ${this.head('ピッキングリスト', doc.docNo, `出荷番号 ${s.shipmentNo} ／ 出荷日 ${dJPfull(s.shipDate)}`)}
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
      <div class="sign" style="margin-top:14px"><div class="s"><b>ピッキング担当</b></div><div class="s"><b>検品担当</b></div><div class="s"><b>出荷担当</b></div></div>
      <div class="sheet-foot"><span>${esc(this.co().name)}</span><span>${esc(doc.docNo)} ／ ${esc(s.shipmentNo)}</span></div>
    </div>`);
  },

  /* 再発行（履歴から） */
  reissue(docId) {
    const d = Store.db.documents.find(x => x.id === docId);
    if (!d) return UI.toast('帳票が見つかりません', 'err');
    d.printedCount = (d.printedCount || 0) + 1; Store.save();
    if (d.docKind === 'delivery_note') this.delivery(d.shipmentId);
    else if (d.docKind === 'shipping_slip') this.slip(d.shipmentId);
    else this.picking(d.shipmentId);
  }
};
