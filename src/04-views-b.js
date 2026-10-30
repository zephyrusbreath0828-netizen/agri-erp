/* ==========================================================================
   アグリERP — ビュー B：受注／得意先／発注／入荷／仕入先／出荷／帳票／ユーザー／設定
   ========================================================================== */

/* ============================== 受注管理 ============================== */
let ordTab = 'list', ordQ = '', ordStat = 'all';
Views.orders = () => {
  const all = Store.db.orders.slice().sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.orderNo.localeCompare(a.orderNo));
  const backlog = Store.orderBacklog();
  const overdue = backlog.filter(r => r.overdue);
  const tabList = ordTab === 'backlog' ? all.filter(o => Store.orderRemaining(o) > 0) : all;
  const list = tabList
    .filter(o => ordStat === 'all' || o.status === ordStat)
    .filter(o => !ordQ || (o.orderNo + o.customerName).toLowerCase().includes(ordQ.toLowerCase()));

  const rows = list.map(o => {
    const rem = Store.orderRemaining(o);
    const late = o.dueDate < TODAY && rem > 0;
    return `<tr class="${late ? 'row-danger' : ''}">
      <td class="mono">${esc(o.orderNo)}<div class="tiny muted">${dJP(o.orderDate)}</div></td>
      <td class="strong">${esc(o.customerName)}</td>
      <td class="nowrap">${dJP(o.dueDate)}${late ? ' <span class="badge rose">超過</span>' : rem > 0 ? `<div class="tiny muted">${relDay(o.dueDate)}</div>` : ''}</td>
      <td class="num">${money(o.total)}</td>
      <td class="num">${rem > 0 ? `<span style="color:var(--rose-600);font-weight:700">${dec(rem)}</span>` : '<span class="badge green">完納</span>'}</td>
      <td>${badge(o.status)}</td>
      <td class="right"><div class="tb-act">
        <button class="btn xs" onclick="Actions.orderDetail('${o.id}')">詳細</button>
        ${rem > 0 && o.status !== 'cancelled' ? `<button class="btn xs primary" onclick="Actions.newShipFromOrder('${o.id}')">出荷指示</button>` : ''}
      </div></td></tr>`;
  }).join('');

  return `<div class="vstack" style="gap:16px">
    <div class="grid g4">
      ${kpiCard({ label: '受注件数', icon: 'file', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: all.length, unit: '件', foot: '全受注の登録件数' })}
      ${kpiCard({ label: '受注残', icon: 'clock', bg: 'var(--amber-100)', fg: 'var(--amber-600)', value: num(backlog.reduce((a, r) => a + r.remaining, 0)), unit: '点', tone: 'warn', foot: `${backlog.length} 明細が未出荷` })}
      ${kpiCard({ label: '納期超過', icon: 'alert', bg: 'var(--rose-100)', fg: 'var(--rose-600)', value: overdue.length, unit: '明細', tone: overdue.length ? 'alert' : '', foot: '至急の出荷対応が必要' })}
      ${kpiCard({ label: '受注金額（当月）', icon: 'yen', bg: 'var(--green-100)', fg: 'var(--green-700)', value: money(Math.round(all.filter(o => o.orderDate.slice(0, 7) === TODAY.slice(0, 7)).reduce((a, o) => a + o.total, 0))), foot: '税込・当月受注分' })}
    </div>

    <div class="card">
      <div class="card-h">
        <h2>${ico('file', 16)} 受注一覧</h2>
        <div class="sp">
          <div class="tabs">
            <button class="tab ${ordTab === 'list' ? 'on' : ''}" onclick="ordTab='list';App.repaint()">受注一覧</button>
            <button class="tab ${ordTab === 'backlog' ? 'on' : ''}" onclick="ordTab='backlog';App.repaint()">受注残管理 <span class="cnt">${all.filter(o => Store.orderRemaining(o) > 0).length}</span></button>
          </div>
        </div>
      </div>
      <div class="card-b tight">
        <div style="padding:12px 16px;border-bottom:1px solid var(--ink-100)" class="hstack">
          <div style="position:relative;flex:1;max-width:300px">
            <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--ink-400)">${ico('search', 16)}</span>
            <input class="inp" style="padding-left:34px" placeholder="受注番号・得意先" value="${esc(ordQ)}" oninput="ordQ=this.value;App.repaint()">
          </div>
          <select class="inp" style="max-width:160px" onchange="ordStat=this.value;App.repaint()">
            <option value="all"${ordStat === 'all' ? ' selected' : ''}>すべての状態</option>
            ${Object.entries(STATUS).filter(([k]) => ['received','partial','shipped','completed','cancelled'].includes(k))
              .map(([k, v]) => `<option value="${k}"${ordStat === k ? ' selected' : ''}>${v[0]}</option>`).join('')}
          </select>
          <div class="sp"><button class="btn sm primary" onclick="Actions.orderForm()">${ico('plus', 14)} 受注登録</button></div>
        </div>
        <div class="table-wrap"><table class="tb">
          <thead><tr><th>受注番号</th><th>得意先</th><th>納期</th><th class="right">金額</th><th class="right">受注残</th><th>状態</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="7">${emptyBox('受注がありません', '新規受注を登録してください')}</td></tr>`}</tbody>
        </table></div>
      </div>
    </div>

    <div class="card">
      <div class="card-h"><h2>${ico('clock', 16)} 受注残・納期管理</h2><span class="sub">納期順・超過は赤で表示</span></div>
      <div class="card-b tight">
        ${backlog.length ? `<div class="table-wrap"><table class="tb">
          <thead><tr><th>納期</th><th>受注番号</th><th>得意先</th><th>品名</th><th class="right">受注数</th><th class="right">出荷済</th><th class="right">残</th><th>状態</th></tr></thead>
          <tbody>${backlog.map(r => `<tr class="${r.overdue ? 'row-danger' : ''}">
            <td class="nowrap">${dJP(r.dueDate)} <span class="tiny muted">(${wkJP(r.dueDate)})</span>${r.overdue ? '<div><span class="badge rose">納期超過</span></div>' : `<div class="tiny muted">${relDay(r.dueDate)}</div>`}</td>
            <td class="mono">${esc(r.orderNo)}</td>
            <td class="strong">${esc(r.customerName)}</td>
            <td>${esc(r.itemName)}</td>
            <td class="num">${dec(r.quantity)}</td>
            <td class="num muted">${dec(r.shippedQty)}</td>
            <td class="num" style="color:var(--rose-600);font-weight:700">${dec(r.remaining)}</td>
            <td><div class="bar ${r.overdue ? 'danger' : 'warn'}" style="min-width:70px"><i style="width:${(r.shippedQty / r.quantity) * 100}%"></i></div></td></tr>`).join('')}</tbody>
        </table></div>` : emptyBox('受注残はありません', 'すべて出荷済みです')}
      </div>
    </div>
  </div>`;
};

/* ============================== 得意先マスタ ============================== */
Views.customers = () => {
  const list = Store.db.customers;
  return `<div class="vstack" style="gap:16px">
    <div class="grid g3">
      ${kpiCard({ label: '得意先数', icon: 'users', bg: 'var(--green-100)', fg: 'var(--green-700)', value: list.length, unit: '社', foot: '登録済みの取引先' })}
      ${kpiCard({ label: '当月受注', icon: 'file', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: money(Math.round(Store.db.orders.filter(o => o.orderDate.slice(0, 7) === TODAY.slice(0, 7)).reduce((a, o) => a + o.total, 0))), foot: '税込' })}
      ${kpiCard({ label: '受注残あり', icon: 'clock', bg: 'var(--amber-100)', fg: 'var(--amber-600)', value: new Set(Store.orderBacklog().map(r => r.customerName)).size, unit: '社', tone: 'warn', foot: '未出荷の受注がある得意先' })}
    </div>
    <div class="card">
      <div class="card-h"><h2>${ico('users', 16)} 得意先マスタ</h2>
        <div class="sp"><button class="btn sm primary" onclick="Actions.customerForm()">${ico('plus', 14)} 新規登録</button></div></div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>コード</th><th>得意先名</th><th>電話番号</th><th>住所</th><th>営業担当者</th><th class="right">締め日</th><th>支払条件</th><th class="right">受注件数</th><th></th></tr></thead>
        <tbody>${list.map(c => `<tr>
          <td class="mono">${esc(c.code)}</td>
          <td><span class="strong">${esc(c.name)}</span><div class="tiny muted">${esc(c.kana || '')}</div></td>
          <td class="sm">${esc(c.tel || '—')}</td>
          <td class="tiny muted">${esc(c.address || '—')}</td>
          <td class="sm">${esc(Store.salesRepName(c.salesRepId) || '—')}</td>
          <td class="num">${c.closingDay === 31 ? '末日' : c.closingDay + '日'}</td>
          <td class="sm">${esc(c.paymentTerms || '—')}</td>
          <td class="num">${Store.db.orders.filter(o => o.customerId === c.id).length}</td>
          <td class="right"><div class="tb-act">
            <button class="btn xs" onclick="Actions.customerForm('${c.id}')">編集</button>
            <button class="btn xs danger" onclick="Actions.deleteCustomer('${c.id}')">削除</button></div></td></tr>`).join('')}</tbody>
      </table></div></div>
    </div>
  </div>`;
};

/* ============================== 発注管理 ============================== */
let poTab = 'list', poQ = '';
Views.purchase = () => {
  const all = Store.db.purchaseOrders.slice().sort((a, b) => b.orderDate.localeCompare(a.orderDate));
  const backlog = Store.poBacklog();
  const overdue = backlog.filter(r => r.overdue);
  const list = (poTab === 'backlog' ? all.filter(p => Store.poRemaining(p) > 0) : all)
    .filter(p => !poQ || (p.poNo + p.supplierName).toLowerCase().includes(poQ.toLowerCase()));

  return `<div class="vstack" style="gap:16px">
    <div class="grid g4">
      ${kpiCard({ label: '発注件数', icon: 'cart', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: all.length, unit: '件', foot: '登録済みの発注' })}
      ${kpiCard({ label: '発注残', icon: 'clock', bg: 'var(--amber-100)', fg: 'var(--amber-600)', value: num(backlog.reduce((a, r) => a + r.remaining, 0)), unit: '点', tone: 'warn', foot: `${backlog.length} 明細が未入荷` })}
      ${kpiCard({ label: '入荷遅延', icon: 'alert', bg: 'var(--rose-100)', fg: 'var(--rose-600)', value: overdue.length, unit: '明細', tone: overdue.length ? 'alert' : '', foot: '入荷予定日を過ぎています' })}
      ${kpiCard({ label: '発注金額（当月）', icon: 'yen', bg: 'var(--green-100)', fg: 'var(--green-700)', value: money(Math.round(all.filter(p => p.orderDate.slice(0, 7) === TODAY.slice(0, 7)).reduce((a, p) => a + p.total, 0))), foot: '税込・当月発注分' })}
    </div>

    <div class="card">
      <div class="card-h"><h2>${ico('cart', 16)} 発注一覧</h2>
        <div class="sp"><div class="tabs">
          <button class="tab ${poTab === 'list' ? 'on' : ''}" onclick="poTab='list';App.repaint()">発注一覧</button>
          <button class="tab ${poTab === 'backlog' ? 'on' : ''}" onclick="poTab='backlog';App.repaint()">発注残管理 <span class="cnt">${all.filter(p => Store.poRemaining(p) > 0).length}</span></button>
        </div></div>
      </div>
      <div class="card-b tight">
        <div style="padding:12px 16px;border-bottom:1px solid var(--ink-100)" class="hstack">
          <div style="position:relative;flex:1;max-width:300px">
            <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--ink-400)">${ico('search', 16)}</span>
            <input class="inp" style="padding-left:34px" placeholder="発注番号・仕入先" value="${esc(poQ)}" oninput="poQ=this.value;App.repaint()">
          </div>
          <div class="sp"><button class="btn sm primary" onclick="Actions.newPOFor('')">${ico('plus', 14)} 発注登録</button></div>
        </div>
        <div class="table-wrap"><table class="tb">
          <thead><tr><th>発注番号</th><th>仕入先</th><th>発注日</th><th>入荷予定</th><th class="right">金額</th><th class="right">発注残</th><th>状態</th><th></th></tr></thead>
          <tbody>${list.length ? list.map(p => {
            const rem = Store.poRemaining(p);
            const late = p.expectedDate < TODAY && rem > 0;
            return `<tr class="${late ? 'row-warn' : ''}">
              <td class="mono">${esc(p.poNo)}</td>
              <td class="strong">${esc(p.supplierName)}</td>
              <td class="sm">${dJP(p.orderDate)}</td>
              <td class="nowrap">${dJP(p.expectedDate)}${late ? '<div><span class="badge amber">入荷遅延</span></div>' : rem > 0 ? `<div class="tiny muted">${relDay(p.expectedDate)}</div>` : ''}</td>
              <td class="num">${money(p.total)}</td>
              <td class="num">${rem > 0 ? dec(rem) : '<span class="badge green">完納</span>'}</td>
              <td>${badge(p.status)}</td>
              <td class="right"><div class="tb-act">
                <button class="btn xs" onclick="Actions.poDetail('${p.id}')">詳細</button>
                ${rem > 0 ? `<button class="btn xs primary" onclick="Actions.receiveForm('${p.id}')">入荷</button>` : ''}
              </div></td></tr>`;
          }).join('') : `<tr><td colspan="8">${emptyBox('発注がありません', '発注点割れの品目から発注できます')}</td></tr>`}</tbody>
        </table></div>
      </div>
    </div>

    <div class="card">
      <div class="card-h"><h2>${ico('clock', 16)} 発注残管理</h2><span class="sub">入荷予定日順</span></div>
      <div class="card-b tight">
        ${backlog.length ? `<div class="table-wrap"><table class="tb">
          <thead><tr><th>入荷予定</th><th>発注番号</th><th>仕入先</th><th>品名</th><th class="right">発注数</th><th class="right">入荷済</th><th class="right">残</th><th></th></tr></thead>
          <tbody>${backlog.map(r => `<tr class="${r.overdue ? 'row-warn' : ''}">
            <td class="nowrap">${dJP(r.expectedDate)}${r.overdue ? ' <span class="badge amber">遅延</span>' : `<div class="tiny muted">${relDay(r.expectedDate)}</div>`}</td>
            <td class="mono">${esc(r.poNo)}</td>
            <td class="strong">${esc(r.supplierName)}</td>
            <td>${esc(r.itemName)}</td>
            <td class="num">${dec(r.quantity)}</td>
            <td class="num muted">${dec(r.receivedQty)}</td>
            <td class="num" style="font-weight:700">${dec(r.remaining)}</td>
            <td class="right"><button class="btn xs primary" onclick="Actions.receiveForm('${r.poId}')">入荷処理</button></td></tr>`).join('')}</tbody>
        </table></div>` : emptyBox('発注残はありません', 'すべて入荷済みです')}
      </div>
    </div>
  </div>`;
};

/* ============================== 入荷処理 ============================== */
Views.receipts = () => {
  const list = Store.db.receipts.slice().sort((a, b) => b.receiptDate.localeCompare(a.receiptDate));
  const todayIn = list.filter(r => r.receiptDate === TODAY);
  const monthQty = Store.db.movements.filter(m => m.moveType === 'receipt' && m.moveDate.slice(0, 7) === TODAY.slice(0, 7))
    .reduce((a, m) => a + m.quantity, 0);
  return `<div class="vstack" style="gap:16px">
    <div class="grid g4">
      ${kpiCard({ label: '本日の入荷', icon: 'truckIn', bg: 'var(--green-100)', fg: 'var(--green-700)', value: todayIn.length, unit: '件', foot: '入荷確定で在庫に自動加算' })}
      ${kpiCard({ label: '当月入荷数量', icon: 'inbox', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: num(Math.round(monthQty)), unit: '点', foot: '当月の入荷合計' })}
      ${kpiCard({ label: '入荷待ち', icon: 'clock', bg: 'var(--amber-100)', fg: 'var(--amber-600)', value: Store.poBacklog().length, unit: '明細', tone: 'warn', foot: '発注残の明細数' })}
      ${kpiCard({ label: '入荷履歴', icon: 'history', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: list.length, unit: '件', foot: '確定済みの入荷実績' })}
    </div>
    <div class="note green">${ico('check', 15)} <b>入荷処理</b>を確定すると、対象商品・資材の現在庫に自動で加算され、入出庫履歴に記録されます。</div>
    <div class="card">
      <div class="card-h"><h2>${ico('inbox', 16)} 入荷履歴</h2>
        <div class="sp"><button class="btn sm primary" onclick="Actions.receiveForm('')">${ico('plus', 14)} 入荷登録</button></div></div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>入荷番号</th><th>入荷日</th><th>仕入先</th><th>発注番号</th><th class="right">明細</th><th class="right">金額</th><th>状態</th><th></th></tr></thead>
        <tbody>${list.length ? list.map(r => `<tr>
          <td class="mono">${esc(r.receiptNo)}</td>
          <td class="sm">${dJP(r.receiptDate)}</td>
          <td class="strong">${esc(r.supplierName)}</td>
          <td class="mono">${esc((Store.db.purchaseOrders.find(p => p.id === r.poId) || {}).poNo || '直接入荷')}</td>
          <td class="num">${Store.receiptLines(r.id).length}</td>
          <td class="num">${money(r.total)}</td>
          <td><span class="badge green">入荷確定</span></td>
          <td class="right"><button class="btn xs" onclick="Actions.receiptDetail('${r.id}')">明細</button></td></tr>`).join('')
          : `<tr><td colspan="8">${emptyBox('入荷履歴がありません', '発注一覧から入荷処理を実行できます')}</td></tr>`}</tbody>
      </table></div></div>
    </div>
  </div>`;
};

/* ============================== 仕入先マスタ ============================== */
Views.suppliers = () => {
  const list = Store.db.suppliers;
  return `<div class="vstack" style="gap:16px">
    <div class="grid g3">
      ${kpiCard({ label: '仕入先数', icon: 'factory', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: list.length, unit: '社', foot: '登録済みの仕入先' })}
      ${kpiCard({ label: '発注残', icon: 'clock', bg: 'var(--amber-100)', fg: 'var(--amber-600)', value: Store.poBacklog().length, unit: '明細', tone: 'warn', foot: '未入荷の明細' })}
      ${kpiCard({ label: '平均リードタイム', icon: 'trend', bg: 'var(--green-100)', fg: 'var(--green-700)', value: (list.reduce((a, s) => a + s.leadTime, 0) / Math.max(list.length, 1)).toFixed(1), unit: '日', foot: '発注から入荷までの標準日数' })}
    </div>
    <div class="card">
      <div class="card-h"><h2>${ico('factory', 16)} 仕入先マスタ</h2>
        <div class="sp"><button class="btn sm primary" onclick="Actions.supplierForm()">${ico('plus', 14)} 新規登録</button></div></div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>コード</th><th>仕入先名</th><th>電話番号</th><th class="right">締め日</th><th>支払条件</th><th class="right">リードタイム</th><th class="right">発注件数</th><th></th></tr></thead>
        <tbody>${list.map(s => `<tr>
          <td class="mono">${esc(s.code)}</td>
          <td><span class="strong">${esc(s.name)}</span><div class="tiny muted">${esc(s.kana || '')}</div></td>
          <td class="sm">${esc(s.tel || '—')}</td>
          <td class="num">${s.closingDay === 31 ? '末日' : s.closingDay + '日'}</td>
          <td class="sm">${esc(s.paymentTerms || '—')}</td>
          <td class="num">${s.leadTime} 日</td>
          <td class="num">${Store.db.purchaseOrders.filter(p => p.supplierId === s.id).length}</td>
          <td class="right"><div class="tb-act">
            <button class="btn xs" onclick="Actions.supplierForm('${s.id}')">編集</button>
            <button class="btn xs danger" onclick="Actions.deleteSupplier('${s.id}')">削除</button></div></td></tr>`).join('')}</tbody>
      </table></div></div>
    </div>
  </div>`;
};

/* ============================== 出荷指示 ============================== */
Views.shipping = () => {
  const pend = Store.db.shipments.filter(s => s.status === 'instructed').sort((a, b) => a.shipDate.localeCompare(b.shipDate));
  const today = pend.filter(s => s.shipDate === TODAY);
  const late = pend.filter(s => s.shipDate < TODAY);
  const mk = s => {
    const lines = Store.shipLines(s.id);
    const qty = lines.reduce((a, l) => a + l.quantity, 0);
    const short = lines.filter(l => { const it = Store.item(l.itemId); return it && it.stock < l.quantity; });
    return `<div class="card" style="margin-bottom:12px;border-color:${s.shipDate < TODAY ? 'var(--rose-200)' : 'var(--ink-200)'}">
      <div class="card-h" style="background:${s.shipDate < TODAY ? 'var(--rose-50)' : 'var(--ink-50)'}">
        <h2>${ico('truck', 16)} ${esc(s.shipmentNo)}</h2>
        <span class="badge ${s.shipDate < TODAY ? 'rose' : s.shipDate === TODAY ? 'amber' : 'sky'}">${s.shipDate < TODAY ? '期日超過' : s.shipDate === TODAY ? '本日' : relDay(s.shipDate)}</span>
        <div class="sp hstack">
          <span class="sub">${dJP(s.shipDate)} ／ ${esc(s.carrier || '—')}</span>
          <button class="btn sm" onclick="Actions.openShipment('${s.id}')">明細・編集</button>
          <button class="btn sm" onclick="Print.picking('${s.id}')">${ico('print', 14)} ピッキング</button>
          <button class="btn sm primary" onclick="Actions.confirmShipment('${s.id}')">${ico('check', 14)} 出荷確定</button>
        </div>
      </div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>得意先</th><th>受注番号</th><th>品名</th><th class="right">出荷数</th><th class="right">現在庫</th><th>引当</th></tr></thead>
        <tbody>${lines.map(l => { const it = Store.item(l.itemId); const ok = it && it.stock >= l.quantity;
          return `<tr class="${ok ? '' : 'row-danger'}">
            <td class="strong">${esc(s.customerName)}</td>
            <td class="mono">${esc(s.orderNo || '—')}</td>
            <td>${esc(l.itemName)}<div class="tiny muted">${esc(it ? it.location : '')}</div></td>
            <td class="num">${dec(l.quantity)} <span class="tiny muted">${esc(it ? it.unit : '')}</span></td>
            <td class="num">${dec(it ? it.stock : 0)}</td>
            <td>${ok ? '<span class="badge green">引当可</span>' : '<span class="badge rose">在庫不足</span>'}</td></tr>`; }).join('')}
        </tbody></table></div>
        <div style="padding:10px 16px;border-top:1px solid var(--ink-100)" class="hstack">
          <span class="sm muted">合計 <b>${num(qty)}</b> 点</span>
          ${short.length ? `<span class="badge rose">在庫不足 ${short.length} 明細</span>` : '<span class="badge green">すべて引当可能</span>'}
        </div>
      </div></div>`;
  };
  return `<div class="vstack" style="gap:16px">
    <div class="grid g4">
      ${kpiCard({ label: '出荷指示待ち', icon: 'truck', bg: 'var(--amber-100)', fg: 'var(--amber-600)', value: pend.length, unit: '件', tone: pend.length ? 'warn' : '', foot: '確定待ちの出荷' })}
      ${kpiCard({ label: '本日出荷', icon: 'clock', bg: 'var(--green-100)', fg: 'var(--green-700)', value: today.length, unit: '件', foot: `${num(today.reduce((a, s) => a + Store.shipLines(s.id).reduce((x, l) => x + l.quantity, 0), 0))} 点` })}
      ${kpiCard({ label: '期日超過', icon: 'alert', bg: 'var(--rose-100)', fg: 'var(--rose-600)', value: late.length, unit: '件', tone: late.length ? 'alert' : '', foot: '出荷日を過ぎています' })}
      ${kpiCard({ label: '確定済み', icon: 'check', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: Store.db.shipments.filter(s => s.status === 'confirmed').length, unit: '件', foot: '出荷確定で在庫から減算済み' })}
    </div>
    <div class="note amber">${ico('alert', 15)} <b>出荷確定</b>すると、明細の数量が在庫から自動で減算され、受注残が更新されます。確定後に納品書・出荷伝票を発行できます。</div>
    <div class="card">
      <div class="card-h"><h2>${ico('truck', 16)} 出荷指示一覧</h2><span class="sub">出荷日順</span>
        <div class="sp"><button class="btn sm primary" onclick="Actions.shipFromOrderPick()">${ico('plus', 14)} 受注から出荷指示</button></div></div>
      <div class="card-b">${pend.length ? pend.map(mk).join('') : emptyBox('出荷指示はありません', '受注一覧から出荷指示を作成してください')}</div>
    </div>
  </div>`;
};

/* ============================== 出荷検索・履歴 ==============================
   検索条件: 期間（from〜to）／得意先／営業担当者／出荷状態
   - 条件は画面上部の検索エリアで指定し、変更即時に再検索する
   - 「クイック期間」で 本日／今月／先月／直近7日／全期間 を切替
   - 検索結果は CSV（Excel）へ書き出せる
   ========================================================================== */
const SHIP_STATE = {
  instructed: ['出荷指示済', 'amber'],
  confirmed:  ['出荷確定', 'green'],
  cancelled:  ['取消', 'gray']
};
const SHIP_STATE_ALL = 'all';

let shF = null;                       /* 検索条件（未指定なら既定値） */
const shipFilterDefault = () => {
  const d = new Date();
  return {
    from: todayStr(new Date(d.getFullYear(), d.getMonth(), 1)),  /* 月初 */
    to: TODAY,
    customerId: '',
    salesRepId: '',
    status: SHIP_STATE_ALL,
    q: ''
  };
};
const shipFilters = () => (shF = shF || shipFilterDefault());
const shipSet = (k, v) => { shipFilters()[k] = v; App.repaint(); };
const shipReset = () => { shF = shipFilterDefault(); App.repaint(); };
const shipQuick = p => {
  const d = new Date(), y = d.getFullYear(), m = d.getMonth();
  const f = shipFilters();
  if (p === 'today') { f.from = TODAY; f.to = TODAY; }
  else if (p === 'month') { f.from = todayStr(new Date(y, m, 1)); f.to = TODAY; }
  else if (p === 'lastMonth') { f.from = todayStr(new Date(y, m - 1, 1)); f.to = todayStr(new Date(y, m, 0)); }
  else if (p === 'week') { f.from = todayStr(addDays(new Date(), -6)); f.to = TODAY; }
  else if (p === 'all') { f.from = ''; f.to = ''; }
  App.repaint();
};

/* 検索条件で絞り込んだ出荷一覧（新しい順） */
const shipFiltered = () => {
  const f = shipFilters();
  const q = (f.q || '').toLowerCase();
  return Store.db.shipments.filter(s => {
    if (f.from && s.shipDate < f.from) return false;
    if (f.to && s.shipDate > f.to) return false;
    if (f.customerId && s.customerId !== f.customerId) return false;
    if (f.salesRepId && Store.shipmentRepId(s) !== f.salesRepId) return false;
    if (f.status !== SHIP_STATE_ALL && s.status !== f.status) return false;
    if (q && !(String(s.shipmentNo || '') + String(s.customerName || '') + String(s.orderNo || '')).toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => String(b.shipDate).localeCompare(String(a.shipDate)) || String(b.shipmentNo).localeCompare(String(a.shipmentNo)));
};

/* CSV出力（検索結果をそのまま出力） */
const shipExportCsv = () => {
  const list = shipFiltered();
  if (!list.length) return UI.toast('出力できる出荷データがありません', 'warn');
  const head = ['出荷日', '出荷番号', '得意先', '営業担当者', '受注番号', '数量', '金額(税抜)', '運送会社', '追跡番号', '出荷状態'];
  const rows = list.map(s => [
    s.shipDate, s.shipmentNo, s.customerName, Store.salesRepName(Store.shipmentRepId(s)) || '—', s.orderNo || '',
    Store.shipLines(s.id).reduce((a, l) => a + l.quantity, 0), Math.round(Store.shipmentAmount(s)),
    s.carrier || '', s.trackingNo || '', (SHIP_STATE[s.status] || [s.status, ''])[0]
  ]);
  const csv = '\uFEFF' + [head, ...rows].map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `agri-erp-shipments-${TODAY}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
  UI.toast(`検索結果 ${list.length} 件をCSVに書き出しました`, 'ok');
};

Views.shipHistory = () => {
  const f = shipFilters();
  const list = shipFiltered();
  const qty = list.reduce((a, s) => a + Store.shipLines(s.id).reduce((x, l) => x + l.quantity, 0), 0);
  const amt = list.reduce((a, s) => a + Store.shipmentAmount(s), 0);
  const confirmed = list.filter(s => s.status === 'confirmed');
  const pending = list.filter(s => s.status === 'instructed');
  const reps = Store.salesReps();
  const cs = Store.db.customers.slice().sort((a, b) => String(a.code).localeCompare(String(b.code)));

  const chip = (on, label, fn) => `<button class="chip ${on ? 'on' : ''}" onclick="${fn}">${esc(label)}</button>`;
  const condChip = (label, value, clear) => value
    ? `<span class="cond">${esc(label)}：<b>${esc(value)}</b><button class="cx" title="条件を解除" onclick="${clear}">${ico('x', 12, 2.6)}</button></span>` : '';
  const repSel = reps.some(r => r.id === f.salesRepId) ? f.salesRepId : '';
  const custSel = cs.some(c => c.id === f.customerId) ? f.customerId : '';

  return `<div class="vstack" style="gap:16px">
    <div class="grid g4">
      ${kpiCard({ label: '検索結果', icon: 'filter', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: list.length, unit: '件', foot: `${dJP(f.from || '')} 〜 ${dJP(f.to || '')}` })}
      ${kpiCard({ label: '出荷確定', icon: 'check', bg: 'var(--green-100)', fg: 'var(--green-700)', value: confirmed.length, unit: '件', foot: `指示済 ${pending.length} 件` })}
      ${kpiCard({ label: '合計数量', icon: 'truck', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: num(qty), unit: '点', foot: '検索結果の数量合計' })}
      ${kpiCard({ label: '合計金額（税抜）', icon: 'yen', bg: 'var(--green-50)', fg: 'var(--green-700)', value: money(Math.round(amt)), foot: '受注単価 × 出荷数量' })}
    </div>

    <div class="card">
      <div class="card-h"><h2>${ico('filter', 16)} 検索条件</h2><span class="sub">期間・得意先・営業担当者・出荷状態で絞り込みます</span>
        <div class="sp hstack">
          <button class="btn sm" onclick="shipReset()">${ico('refresh', 14)} 条件クリア</button>
          <button class="btn sm primary" onclick="shipExportCsv()">${ico('excel', 14)} CSV出力</button>
        </div>
      </div>
      <div class="card-b">
        <div class="filter-grid">
          <div class="field"><label>期間（出荷日）</label>
            <div class="hstack" style="gap:6px;flex-wrap:nowrap">
              <input class="inp" type="date" value="${esc(f.from)}" onchange="shipSet('from', this.value)">
              <span class="muted sm">〜</span>
              <input class="inp" type="date" value="${esc(f.to)}" onchange="shipSet('to', this.value)">
            </div>
          </div>
          <div class="field"><label>得意先</label>
            <select class="inp" onchange="shipSet('customerId', this.value)">
              <option value="">すべての得意先</option>
              ${cs.map(c => `<option value="${esc(c.id)}"${custSel === c.id ? ' selected' : ''}>${esc(c.code)} ${esc(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>営業担当者</label>
            <select class="inp" onchange="shipSet('salesRepId', this.value)">
              <option value="">すべての担当者</option>
              ${reps.map(u => `<option value="${esc(u.id)}"${repSel === u.id ? ' selected' : ''}>${esc(u.name)}${u.role === 'admin' ? '（管理者）' : ''}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>出荷状態</label>
            <select class="inp" onchange="shipSet('status', this.value)">
              <option value="${SHIP_STATE_ALL}"${f.status === SHIP_STATE_ALL ? ' selected' : ''}>すべての状態</option>
              ${Object.entries(SHIP_STATE).map(([k, v]) => `<option value="${k}"${f.status === k ? ' selected' : ''}>${v[0]}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="hstack mt12" style="gap:7px">
          <span class="tiny muted">クイック期間</span>
          ${chip(f.from === TODAY && f.to === TODAY, '本日', "shipQuick('today')")}
          ${chip(false, '直近7日', "shipQuick('week')")}
          ${chip(false, '今月', "shipQuick('month')")}
          ${chip(false, '先月', "shipQuick('lastMonth')")}
          ${chip(!f.from && !f.to, '全期間', "shipQuick('all')")}
          <div class="sp" style="position:relative;min-width:200px">
            <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--ink-400)">${ico('search', 16)}</span>
            <input class="inp" style="padding-left:34px" placeholder="出荷番号・得意先・受注番号" value="${esc(f.q)}" oninput="shipSet('q', this.value)">
          </div>
        </div>
        <div class="cond-row mt12">
          ${condChip('期間', f.from || f.to ? `${f.from || '指定なし'} 〜 ${f.to || '指定なし'}` : '', "shipSet('from','');shipSet('to','')")}
          ${condChip('得意先', (cs.find(c => c.id === custSel) || {}).name || '', "shipSet('customerId','')")}
          ${condChip('営業担当者', Store.salesRepName(repSel), "shipSet('salesRepId','')")}
          ${condChip('出荷状態', f.status === SHIP_STATE_ALL ? '' : (SHIP_STATE[f.status] || [f.status])[0], `shipSet('status','${SHIP_STATE_ALL}')`)}
          ${condChip('キーワード', f.q, "shipSet('q','')")}
          <span class="sp tiny muted">該当 <b>${num(list.length)}</b> 件</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-h"><h2>${ico('history', 16)} 出荷検索結果</h2><span class="sub">出荷日の新しい順</span>
        <div class="sp"><span class="badge gray">${num(list.length)} 件</span></div></div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>出荷日</th><th>出荷番号</th><th>得意先</th><th>営業担当者</th><th>受注番号</th><th class="right">数量</th><th class="right">金額(税抜)</th><th>運送会社</th><th>出荷状態</th><th></th></tr></thead>
        <tbody>${list.length ? list.map(s => {
          const st = SHIP_STATE[s.status] || [s.status, 'gray'];
          const rep = Store.salesRepName(Store.shipmentRepId(s));
          return `<tr>
            <td class="sm nowrap">${dJP(s.shipDate)}</td>
            <td class="mono">${esc(s.shipmentNo)}</td>
            <td class="strong">${esc(s.customerName)}</td>
            <td class="sm">${rep ? esc(rep) : '<span class="muted">—</span>'}</td>
            <td class="mono">${esc(s.orderNo || '—')}</td>
            <td class="num">${num(Store.shipLines(s.id).reduce((a, l) => a + l.quantity, 0))}</td>
            <td class="num">${money(Math.round(Store.shipmentAmount(s)))}</td>
            <td class="sm">${esc(s.carrier || '—')}</td>
            <td><span class="badge ${st[1]}">${esc(st[0])}</span></td>
            <td class="right"><div class="tb-act">
              <button class="btn xs" onclick="Actions.openShipment('${s.id}')">詳細</button>
              ${s.status === 'confirmed'
                ? `<button class="btn xs primary" onclick="Actions.docPick('${s.id}')">帳票</button>`
                : s.status === 'instructed' ? `<button class="btn xs primary" onclick="Actions.confirmShipment('${s.id}')">確定</button>` : ''}
            </div></td></tr>`;
        }).join('')
          : `<tr><td colspan="10">${emptyBox('条件に一致する出荷がありません', '期間・得意先・営業担当者・出荷状態を変更してください')}</td></tr>`}</tbody>
        ${list.length ? `<tfoot><tr>
          <td colspan="5" class="right strong">合計</td>
          <td class="num strong">${num(qty)}</td>
          <td class="num strong">${money(Math.round(amt))}</td>
          <td colspan="3"></td></tr></tfoot>` : ''}
      </table></div></div>
    </div>
  </div>`;
};

/* ============================== 帳票発行 ============================== */
/* ============================== ユーザー管理 ============================== */
Views.users = () => {
  const list = Store.db.users;
  const cnt = r => list.filter(u => u.role === r).length;
  const enabledCnt = r => list.filter(u => u.role === r && u.enabled).length;
  const isLocked = u => {
    const s = (Store.db.loginSecurity || {})[String(u.loginId).toLowerCase()];
    return !!(s && s.lockedUntil && new Date(s.lockedUntil) > new Date());
  };
  return `<div class="vstack" style="gap:16px">
    <div class="grid g3">
      ${Object.entries(ROLES).map(([k, r]) => kpiCard({
        label: r.label, icon: r.icon, bg: `var(--${r.color === 'green' ? 'green-100' : r.color === 'sky' ? 'sky-100' : 'amber-100'})`,
        fg: `var(--${r.color === 'green' ? 'green-700' : r.color === 'sky' ? 'sky-600' : 'amber-600'})`,
        value: cnt(k), unit: '名', foot: `有効 ${enabledCnt(k)} 名／${r.desc}`
      })).join('')}
    </div>
    <div class="card">
      <div class="card-h"><h2>${ico('user', 16)} ユーザー管理</h2><span class="sub">ユーザーID・パスワード認証のアカウント</span>
        <div class="sp"><button class="btn sm primary" onclick="Actions.userForm()">${ico('plus', 14)} ユーザー登録</button></div></div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>ユーザーID</th><th>組織</th><th>氏名</th><th>メールアドレス</th><th>電話番号</th><th>ロール</th><th>利用可能機能</th><th>最終ログイン日時</th><th>パスワード変更要求</th><th>状態</th><th></th></tr></thead>
        <tbody>${list.map(u => {
          const funcs = MENU.flatMap(g => g.items).filter(i => i.roles.includes(u.role)).length;
          return `<tr>
            <td class="mono">${esc(u.loginId)}</td>
            <td class="sm">${esc(Tenant.name(u.organizationId))}</td>
            <td><div class="hstack" style="gap:9px"><span class="av" style="width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:12px;background:${ROLES[u.role].av}">${esc(u.name.charAt(0))}</span><span class="strong">${esc(u.name)}</span></div></td>
            <td class="mono">${esc(u.email)}</td>
            <td class="sm">${esc(u.tel || '—')}</td>
            <td><span class="badge ${ROLES[u.role].color}">${esc((ROLES[u.role] || {}).label || u.role)}</span></td>
            <td class="sm muted">${funcs} 機能</td>
            <td class="sm nowrap mono">${u.lastLoginAt ? dtJP(u.lastLoginAt) : '—'}</td>
            <td class="nowrap">${u.forcePasswordChange ? '<span class="badge amber">要求中</span>' : '<span class="muted">—</span>'}</td>
            <td class="nowrap">${u.enabled ? '<span class="badge green">有効</span>' : '<span class="badge gray">無効</span>'}${isLocked(u) ? ' <span class="badge rose">ロック中</span>' : ''}${u.forcePasswordChange ? ' <span class="badge amber">初回パスワード</span>' : ''}</td>
            <td class="right"><div class="tb-act">
              <button class="btn xs" onclick="Actions.userForm('${u.id}')">編集</button>
              <button class="btn xs" onclick="Actions.userPasswordForm('${u.id}')">パスワード</button>
              <button class="btn xs" onclick="Actions.reissueUserPassword('${u.id}')">初期化</button>
              <button class="btn xs primary" onclick="Actions.resetUserPassword('${u.id}')">パスワードリセット</button>
              <button class="btn xs" onclick="Actions.toggleUserEnabled('${u.id}')">${u.enabled ? '無効化' : '有効化'}</button>
              <button class="btn xs danger" onclick="Actions.deleteUser('${u.id}')">削除</button></div></td></tr>`;
        }).join('')}</tbody>
      </table></div></div>
    </div>
    <div class="card">
      <div class="card-h"><h2>${ico('shield', 16)} 権限マトリクス</h2><span class="sub">各ロールで利用できる機能</span></div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>機能</th>${Object.values(ROLES).map(r => `<th class="center">${r.label}</th>`).join('')}</tr></thead>
        <tbody>${MENU.flatMap(g => g.items).map(i => `<tr>
          <td class="strong">${esc(i.label)}<div class="tiny muted">${esc(i.sub)}</div></td>
          ${Object.keys(ROLES).map(r => `<td class="center">${i.roles.includes(r) ? `<span style="color:var(--green-600)">${ico('check', 17, 3)}</span>` : '<span class="muted">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div></div>
    </div>
    <div class="card">
      <div class="card-h"><h2>${ico('history', 16)} 操作ログ（監査ログ）</h2><span class="sub">パスワードリセットなどの記録（直近20件）</span></div>
      <div class="card-b tight">${(() => {
        const logs = (Store.db.auditLogs || []).slice()
          .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 20);
        return logs.length ? `<div class="table-wrap"><table class="tb">
        <thead><tr><th>実行日時</th><th>実行者</th><th>操作</th><th>対象ユーザー</th><th>IPアドレス</th></tr></thead>
        <tbody>${logs.map(l => `<tr>
          <td class="sm nowrap mono">${dtJP(l.createdAt)}</td>
          <td class="sm">${esc(l.actorName || '—')}<div class="tiny muted mono">${esc(l.actorLoginId || '')}</div></td>
          <td class="sm">${esc(AUDIT_LABEL[l.action] || l.action || '—')}</td>
          <td class="sm">${esc(l.targetName || '—')}<div class="tiny muted mono">${esc(l.targetLoginId || '')}</div></td>
          <td class="sm mono">${esc(l.ipAddress || '—')}</td></tr>`).join('')}</tbody>
      </table></div>` : emptyBox('操作ログはまだありません', 'パスワードリセットを実行すると記録されます');
      })()}</div>
    </div>
  </div>`;
};

/* ============================== 設定・将来拡張 ============================== */
/* ==========================================================================
   組織マスタ（システム管理者のみ）— テナントの追加・編集・停止
   ========================================================================== */
Views.organizations = () => {
  if (!Tenant.isSystemAdmin()) return `<div class="card"><div class="card-b">${emptyBox('権限がありません', '組織マスタはシステム管理者のみ利用できます')}</div></div>`;
  const list = Tenant.all().slice().sort((a, b) => Number(a.id) - Number(b.id));
  const cur = Tenant.id();
  const countOf = (tbl, id) => ((Store.db[tbl] || []).filter(r => Number(r.organizationId) === Number(id))).length;
  const rows = list.map(o => {
    const users = countOf('users', o.id);
    const companies = countOf('companies', o.id);
    return `<tr>
      <td class="mono">${esc(o.id)}</td>
      <td class="mono">${esc(o.organizationCode)}</td>
      <td class="strong">${esc(o.organizationName)}${Number(o.id) === cur ? ' <span class="badge green">ログイン中</span>' : ''}</td>
      <td class="num">${companies}</td>
      <td class="num">${users}</td>
      <td>${o.isActive === false ? '<span class="badge gray">停止</span>' : '<span class="badge green">有効</span>'}</td>
      <td class="tiny muted nowrap">${o.createdAt ? dtJP(o.createdAt) : '—'}</td>
      <td class="right"><div class="tb-act">
        <button class="btn xs" onclick="Actions.organizationForm('${o.id}')">編集</button>
        <button class="btn xs ${o.isActive === false ? '' : 'danger'}" onclick="Actions.toggleOrganization('${o.id}')">${o.isActive === false ? '有効化' : '停止'}</button>
      </div></td></tr>`;
  }).join('');
  return `<div class="vstack" style="gap:16px">
    <div class="grid g3">
      ${kpiCard({ label: '組織数', icon: 'layers', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: list.length, unit: '組織', foot: `有効 ${list.filter(o => o.isActive !== false).length} 組織` })}
      ${kpiCard({ label: '現在の組織', icon: 'shield', bg: 'var(--green-100)', fg: 'var(--green-700)', value: Tenant.code(), unit: '', foot: Tenant.name() })}
      ${kpiCard({ label: '所属ユーザー', icon: 'user', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: countOf('users', cur), unit: '名', foot: 'この組織のアカウント数' })}
    </div>
    <div class="note green">${ico('layers', 15)} 組織マスタは <b>システム管理者のみ</b> が操作できます。組織を「停止」してもデータは削除されません（所属ユーザーのログインと参照ができなくなります）。</div>
    <div class="card">
      <div class="card-h"><h2>${ico('layers', 16)} 組織マスタ</h2><span class="sub">組織 → 会社 → 拠点 の階層でデータを隔離します</span>
        <div class="sp"><button class="btn sm primary" onclick="Actions.organizationForm('')">${ico('plus', 14)} 組織を登録</button></div></div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>ID</th><th>組織コード</th><th>組織名</th><th class="num">会社</th><th class="num">ユーザー</th><th>状態</th><th>登録日</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div></div>
    </div>
    <div class="card">
      <div class="card-h"><h2>${ico('shield', 16)} データ隔離の仕組み</h2></div>
      <div class="card-b">
        <div class="vstack" style="gap:8px">
          <div class="hstack" style="gap:9px"><span class="badge green">1</span><span class="sm">ログイン時に <b>users.organization_id</b> をセッションへ保持し、画面・帳票はすべてこの組織で絞り込みます。</span></div>
          <div class="hstack" style="gap:9px"><span class="badge green">2</span><span class="sm">新規登録時は <b>organization_id を自動セット</b>します（入力不要）。</span></div>
          <div class="hstack" style="gap:9px"><span class="badge green">3</span><span class="sm">Supabase 側は <b>RLS（Row Level Security）</b>で全テーブルを組織単位に隔離します（<code>sql/08_multi_tenant.sql</code>）。</span></div>
        </div>
      </div>
    </div>
  </div>`;
};

Views.settings = () => {
  const s = Store.db.settings;
  const ext = [
    ['barcode', 'バーコード対応', 'JAN・自社バーコードの読み取り／印字。商品マスタにコード項目を用意済み', 'barcode', true],
    ['qr', 'QRコード対応', '商品・伝票にQRを印字してスマホでスキャン。ピッキングリストに印字領域あり', 'qr', true],
    ['excel', 'Excel出力', '在庫・受注・出荷一覧を .xlsx で書き出し（帳票スナップショットを利用）', 'excel', false],
    ['m365', 'Microsoft 365連携', 'OneDrive／SharePoint へ帳票PDFを自動保存、Excelで共同編集', 'cloud', false],
    ['line', 'LINE通知', '在庫不足・納期超過をLINE WORKS／Messaging API でプッシュ通知', 'line', false]
  ];
  return `<div class="vstack" style="gap:16px">
    <div class="note">${ico('layers', 15)} ログイン中の組織：<b>${esc(Tenant.label())}</b>${Tenant.isSystemAdmin() ? ` <button class="btn xs" style="margin-left:6px" onclick="App.go('organizations')">組織マスタ</button>` : ''}</div>
    <div class="grid g2">
      <div class="card">
        <div class="card-h"><h2>${ico('factory', 16)} 発行元（会社・拠点）</h2><span class="sub">帳票に印字される会社・拠点情報</span></div>
        <div class="card-b">
          <div class="vstack" style="gap:8px">
            ${Issuer.companies(false).slice(0, 5).map(c => `<div class="hstack" style="justify-content:space-between;padding:9px 12px;border:1px solid var(--ink-200);border-radius:11px;background:#fff">
              <div style="min-width:0"><b class="sm">${esc(c.name)}</b><div class="tiny muted">${esc(c.companyCode)} ／ 拠点 ${Issuer.branches(c.id, false).length} 件 ／ ${esc(c.tel || '—')}</div></div>
              ${c.isActive === false ? '<span class="badge gray">無効</span>' : '<span class="badge green">有効</span>'}</div>`).join('') || '<p class="sm muted">会社が登録されていません</p>'}
          </div>
          <div class="hstack mt16"><button class="btn primary" onclick="App.go('companies')">${ico('factory', 15)} 会社・拠点マスタ</button>
            <button class="btn" onclick="App.go('docTemplates')">${ico('printer', 15)} 帳票テンプレート</button>
            <span class="tiny muted">伝票ごとに発行会社・拠点①②を選択できます</span></div>
        </div>
      </div>
      <div class="card">
        <div class="card-h"><h2>${ico('shield', 16)} 緊急管理者ログイン</h2><span class="sub">ログイン障害時の非常用アクセス</span></div>
        <div class="card-b">
          <label class="chk" style="width:100%;justify-content:flex-start;padding:11px 13px">
            <input type="checkbox" id="emgEnabled" ${EMERGENCY.enabled() ? 'checked' : ''} onchange="Actions.saveEmergencyAdmin()">
            <span>緊急管理者ログインを有効化</span>
          </label>
          <div class="vstack mt12" style="gap:7px">
            <div class="hstack" style="justify-content:space-between"><span class="sm muted">緊急管理者ユーザーID</span><span class="badge gray mono">${esc(EMERGENCY.LOGIN_ID)}</span></div>
            <div class="hstack" style="justify-content:space-between"><span class="sm muted">権限</span><span class="badge green">管理者（admin）</span></div>
            <div class="hstack" style="justify-content:space-between"><span class="sm muted">現在の状態</span>${EMERGENCY.enabled() ? '<span class="badge green">有効</span>' : '<span class="badge gray">無効</span>'}</div>
          </div>
          <div class="note amber mt12">${ico('alert', 15)} 緊急管理者は <b>通常のユーザー認証より先に判定</b>され、Supabase接続やデータ初期化の状態に依らずログインできます。ログインは監査ログに「緊急管理者ログイン」として記録されます（パスワードは記録しません）。<br>運用が安定したら<b>無効化</b>してください。</div>
          <div class="note mt12">${ico('shield', 15)} 本アプリは静的配布（単一HTML）のため、認証情報は配布物に含まれます。配布範囲の管理、またはシークレット化（サーバー側プロキシ等）を併用してください。</div>
        </div>
      </div>
      <div class="card">
        <div class="card-h"><h2>${ico('settings', 16)} データ管理</h2></div>
        <div class="card-b vstack">
          <div class="note">${ico('cloud', 15)} データは Supabase（PostgreSQL）に保存され、全ユーザーでリアルタイム共有されています。接続状態: <b id="sbConnState">${(typeof SB !== 'undefined' && SB.ready) ? (SB.transport === 'realtime' ? 'リアルタイム接続' : SB.transport === 'polling' ? 'ポーリング接続' : '接続済み') : '未接続'}</b></div>
          <div class="hstack"><button class="btn" onclick="Actions.exportJSON()">${ico('download', 15)} データを書き出す（JSON）</button></div>
          <div class="hstack"><button class="btn" onclick="Actions.exportCSV()">${ico('excel', 15)} 在庫CSVを書き出す</button></div>
          <div class="hstack"><button class="btn danger" onclick="Actions.resetData()">${ico('refresh', 15)} デモデータを初期化</button></div>
          <div class="hr"></div>
          <div class="vstack" style="gap:7px">
            <div class="hstack" style="justify-content:space-between"><span class="sm muted">登録商品</span><span class="badge green">${Store.db.items.length} 品目</span></div>
            <div class="hstack" style="justify-content:space-between"><span class="sm muted">受注／発注</span><span class="badge sky">${Store.db.orders.length} ／ ${Store.db.purchaseOrders.length} 件</span></div>
            <div class="hstack" style="justify-content:space-between"><span class="sm muted">出荷／帳票</span><span class="badge violet">${Store.db.shipments.length} ／ ${Store.db.documents.length} 件</span></div>
            <div class="hstack" style="justify-content:space-between"><span class="sm muted">在庫トランザクション</span><span class="badge amber">${Store.db.movements.length} 件</span></div>
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-h"><h2>${ico('trend', 16)} 将来拡張</h2><span class="sub">スキーマ・画面に受け口を用意済み</span></div>
      <div class="card-b"><div class="grid g3">
        ${ext.map(([k, title, desc, icon, ready]) => `<div style="border:1px solid var(--ink-200);border-radius:14px;padding:15px;background:#fff">
          <div class="hstack"><span style="width:36px;height:36px;border-radius:11px;background:var(--green-50);color:var(--green-700);display:grid;place-items:center">${ico(icon, 18, 2.1)}</span>
            <div style="flex:1;min-width:0"><b style="font-size:13.5px">${title}</b></div>
            ${ready ? '<span class="badge green">準備済</span>' : '<span class="badge gray">拡張枠</span>'}</div>
          <p class="tiny muted mt8" style="line-height:1.7">${desc}</p></div>`).join('')}
      </div></div>
    </div>
  </div>`;
};
