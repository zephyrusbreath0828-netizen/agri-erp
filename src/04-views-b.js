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
        <thead><tr><th>コード</th><th>得意先名</th><th>電話番号</th><th>住所</th><th class="right">締め日</th><th>支払条件</th><th class="right">受注件数</th><th></th></tr></thead>
        <tbody>${list.map(c => `<tr>
          <td class="mono">${esc(c.code)}</td>
          <td><span class="strong">${esc(c.name)}</span><div class="tiny muted">${esc(c.kana || '')}</div></td>
          <td class="sm">${esc(c.tel || '—')}</td>
          <td class="tiny muted">${esc(c.address || '—')}</td>
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

/* ============================== 出荷履歴 ============================== */
let shQ = '';
Views.shipHistory = () => {
  const list = Store.db.shipments.filter(s => s.status === 'confirmed')
    .filter(s => !shQ || (s.shipmentNo + s.customerName).toLowerCase().includes(shQ.toLowerCase()))
    .sort((a, b) => b.shipDate.localeCompare(a.shipDate));
  const qty = list.reduce((a, s) => a + Store.shipLines(s.id).reduce((x, l) => x + l.quantity, 0), 0);
  return `<div class="vstack" style="gap:16px">
    <div class="grid g3">
      ${kpiCard({ label: '確定出荷件数', icon: 'history', bg: 'var(--green-100)', fg: 'var(--green-700)', value: list.length, unit: '件', foot: '出荷確定済みの実績' })}
      ${kpiCard({ label: '累計出荷数量', icon: 'truck', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: num(qty), unit: '点', foot: '確定済みの合計数量' })}
      ${kpiCard({ label: '発行済み帳票', icon: 'printer', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: Store.db.documents.length, unit: '枚', foot: '納品書・出荷伝票・ピッキング' })}
    </div>
    <div class="card">
      <div class="card-h"><h2>${ico('history', 16)} 出荷履歴</h2>
        <div class="sp" style="position:relative;min-width:220px">
          <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--ink-400)">${ico('search', 16)}</span>
          <input class="inp" style="padding-left:34px" placeholder="出荷番号・得意先" value="${esc(shQ)}" oninput="shQ=this.value;App.repaint()">
        </div>
      </div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>出荷番号</th><th>出荷日</th><th>得意先</th><th>受注番号</th><th class="right">数量</th><th>運送会社</th><th>追跡番号</th><th></th></tr></thead>
        <tbody>${list.length ? list.map(s => `<tr>
          <td class="mono">${esc(s.shipmentNo)}</td>
          <td class="sm">${dJP(s.shipDate)}</td>
          <td class="strong">${esc(s.customerName)}</td>
          <td class="mono">${esc(s.orderNo || '—')}</td>
          <td class="num">${num(Store.shipLines(s.id).reduce((a, l) => a + l.quantity, 0))}</td>
          <td class="sm">${esc(s.carrier || '—')}</td>
          <td class="mono">${esc(s.trackingNo || '—')}</td>
          <td class="right"><div class="tb-act">
            <button class="btn xs" onclick="Actions.openShipment('${s.id}')">詳細</button>
            <button class="btn xs primary" onclick="Actions.docPick('${s.id}')">帳票</button></div></td></tr>`).join('')
          : `<tr><td colspan="8">${emptyBox('出荷履歴がありません', '出荷を確定すると履歴に記録されます')}</td></tr>`}</tbody>
      </table></div></div>
    </div>
  </div>`;
};

/* ============================== 帳票発行 ============================== */
Views.docs = () => {
  const confirmed = Store.db.shipments.filter(s => s.status === 'confirmed').sort((a, b) => b.shipDate.localeCompare(a.shipDate));
  const docs = Store.db.documents.slice().sort((a, b) => (b.issuedAt || '').localeCompare(a.issuedAt || '')).slice(0, 60);
  const kindLabel = { delivery_note: '納品書', shipping_slip: '出荷伝票', picking_list: 'ピッキングリスト' };
  const kindBadge = { delivery_note: 'green', shipping_slip: 'sky', picking_list: 'violet' };
  return `<div class="vstack" style="gap:16px">
    <div class="grid g4">
      ${kpiCard({ label: '発行可能な出荷', icon: 'truck', bg: 'var(--green-100)', fg: 'var(--green-700)', value: confirmed.length, unit: '件', foot: '出荷確定済み' })}
      ${kpiCard({ label: '納品書', icon: 'file', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: Store.db.documents.filter(d => d.docKind === 'delivery_note').length, unit: '枚', foot: 'DN-YYYYMMDD-0001' })}
      ${kpiCard({ label: '出荷伝票', icon: 'clipboard', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: Store.db.documents.filter(d => d.docKind === 'shipping_slip').length, unit: '枚', foot: 'SL-YYYYMMDD-0001' })}
      ${kpiCard({ label: 'ピッキングリスト', icon: 'check', bg: 'var(--amber-100)', fg: 'var(--amber-600)', value: Store.db.documents.filter(d => d.docKind === 'picking_list').length, unit: '枚', foot: 'PL-YYYYMMDD-0001' })}
    </div>
    <div class="note">${ico('printer', 15)} 帳票番号は日付ごとの連番で<b>自動採番</b>されます（例：DN-20261005-0001）。印刷ダイアログから「PDF に保存」を選ぶと PDF として保存できます。</div>
    <div class="grid g2">
      <div class="card">
        <div class="card-h"><h2>${ico('printer', 16)} 帳票を発行する</h2><span class="sub">出荷確定済みの伝票から選択</span></div>
        <div class="card-b">
          ${confirmed.length ? `<div class="vstack">${confirmed.slice(0, 10).map(s => `<div class="hstack" style="padding:11px 13px;border:1px solid var(--ink-200);border-radius:12px;background:#fff">
            <div style="flex:1;min-width:0">
              <b class="sm">${esc(s.shipmentNo)}</b>
              <div class="tiny muted">${esc(s.customerName)} ／ ${dJP(s.shipDate)} ／ ${num(Store.shipLines(s.id).reduce((a, l) => a + l.quantity, 0))} 点</div>
            </div>
            <div class="tb-act">
              <button class="btn xs" onclick="Print.delivery('${s.id}')">納品書</button>
              <button class="btn xs" onclick="Print.slip('${s.id}')">出荷伝票</button>
              <button class="btn xs primary" onclick="Print.picking('${s.id}')">ピッキング</button>
            </div></div>`).join('')}</div>` : emptyBox('発行できる出荷がありません', '先に出荷を確定してください')}
        </div>
      </div>
      <div class="card">
        <div class="card-h"><h2>${ico('history', 16)} 帳票発行履歴</h2><span class="badge gray">${Store.db.documents.length}</span></div>
        <div class="card-b tight">${docs.length ? `<div class="table-wrap"><table class="tb">
          <thead><tr><th>帳票番号</th><th>種別</th><th>得意先</th><th>発行日時</th><th></th></tr></thead>
          <tbody>${docs.map(d => `<tr>
            <td class="mono">${esc(d.docNo)}</td>
            <td><span class="badge ${kindBadge[d.docKind]}">${kindLabel[d.docKind]}</span></td>
            <td class="sm">${esc(d.customerName || '—')}</td>
            <td class="tiny muted nowrap">${dtJP(d.issuedAt)}</td>
            <td class="right"><button class="btn xs" onclick="Print.reissue('${d.id}')">再発行</button></td></tr>`).join('')}</tbody>
        </table></div>` : emptyBox('帳票履歴がありません', '帳票を発行すると履歴が残ります')}</div>
      </div>
    </div>
  </div>`;
};

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
        <thead><tr><th>ユーザーID</th><th>氏名</th><th>メールアドレス</th><th>電話番号</th><th>ロール</th><th>利用可能機能</th><th>最終ログイン日時</th><th>パスワード変更要求</th><th>状態</th><th></th></tr></thead>
        <tbody>${list.map(u => {
          const funcs = MENU.flatMap(g => g.items).filter(i => i.roles.includes(u.role)).length;
          return `<tr>
            <td class="mono">${esc(u.loginId)}</td>
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
    <div class="grid g2">
      <div class="card">
        <div class="card-h"><h2>${ico('factory', 16)} 自社情報</h2><span class="sub">帳票に印字されます</span></div>
        <div class="card-b">
          <div class="form-grid c2">
            <div class="field span2"><label>法人名</label><input class="inp" id="coName" value="${esc(s.company.name)}"></div>
            <div class="field"><label>郵便番号</label><input class="inp" id="coPostal" value="${esc(s.company.postal)}"></div>
            <div class="field"><label>電話番号</label><input class="inp" id="coTel" value="${esc(s.company.tel)}"></div>
            <div class="field span2"><label>住所</label><input class="inp" id="coAddr" value="${esc(s.company.address)}"></div>
            <div class="field"><label>FAX</label><input class="inp" id="coFax" value="${esc(s.company.fax)}"></div>
            <div class="field"><label>登録番号（インボイス）</label><input class="inp" id="coInv" value="${esc(s.company.invoiceNo)}"></div>
          </div>
          <div class="hstack mt16"><button class="btn primary" onclick="Actions.saveCompany()">${ico('check', 15)} 保存</button>
            <span class="tiny muted">保存すると帳票のヘッダに反映されます</span></div>
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
