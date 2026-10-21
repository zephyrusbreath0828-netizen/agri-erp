/* ==========================================================================
   アグリERP — ビュー A：ダッシュボード／警告／在庫／入出庫履歴／マスタ
   ========================================================================== */
const Views = {};

const kpiCard = o => `<div class="kpi ${o.tone || ''}">
  <div class="k-top"><span class="k-ico" style="background:${o.bg};color:${o.fg}">${ico(o.icon, 18, 2.1)}</span><span class="k-lb">${esc(o.label)}</span></div>
  <div class="k-v">${o.value}${o.unit ? `<small>${esc(o.unit)}</small>` : ''}</div>
  <div class="k-f">${o.foot || ''}</div>
</div>`;

const emptyBox = (title, msg) => `<div class="empty">${ico('inbox', 40, 1.6)}<b>${esc(title)}</b><p>${esc(msg)}</p></div>`;

/* ============================== ダッシュボード ============================== */
Views.dashboard = () => {
  const alerts = Store.alerts();
  const stockAlerts = Store.stockAlerts();
  const todayShip = Store.todayShipments();
  const orderBacklog = Store.orderBacklog();
  const poBacklog = Store.poBacklog();
  const pending = todayShip.filter(s => s.status === 'instructed');

  const todayQty = todayShip.reduce((a, s) => a + s.qty, 0);
  const overdueOrders = orderBacklog.filter(r => r.overdue);
  const overduePO = poBacklog.filter(r => r.overdue);

  /* 直近7日の出荷量 */
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = todayStr(addDays(new Date(), -i));
    const q = Store.db.movements.filter(m => m.moveType === 'shipment' && m.moveDate === d)
      .reduce((a, m) => a + Math.abs(m.quantity), 0);
    days.push({ d, q });
  }
  const maxQ = Math.max(...days.map(x => x.q), 1);
  const chart = `<div class="mini-chart">${days.map(x => `
    <div class="col" title="${dJP(x.d)}：${num(x.q)}">
      <i style="height:${Math.max(4, (x.q / maxQ) * 100)}%"></i>
      <span>${new Date(x.d).getMonth() + 1}/${new Date(x.d).getDate()}</span>
    </div>`).join('')}</div>`;

  const totalStockValue = Store.db.items.reduce((a, i) => a + i.stock * i.costPrice, 0);
  const monthShip = Store.db.shipments.filter(s => s.status === 'confirmed').length;

  return `
  <div class="vstack" style="gap:16px">
    <div class="card" style="background:linear-gradient(135deg,#064e3b,#047857 55%,#0f766e);border:none;color:#fff;overflow:hidden;position:relative">
      <div style="position:absolute;right:-40px;top:-60px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(163,230,53,.30),transparent 65%)"></div>
      <div style="padding:20px 22px;position:relative;z-index:2;display:flex;flex-wrap:wrap;gap:16px;align-items:center">
        <div style="flex:1;min-width:230px">
          <div style="font-size:11px;letter-spacing:.14em;color:#8fe0bd">DASHBOARD</div>
          <h2 style="font-size:20px;font-weight:800;margin-top:5px">${dJPfull(TODAY)}（${wkJP(TODAY)}）</h2>
          <p style="font-size:12.5px;color:#b6f0d8;margin-top:5px">
            ${Auth.user ? Auth.user.name : ''} さん、おはようございます。本日は出荷予定 <b style="color:#fff">${todayShip.length}</b> 件、
            うち未確定 <b style="color:#fde68a">${pending.length}</b> 件です。
          </p>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${alerts.length ? `<div style="background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);border-radius:14px;padding:11px 16px;min-width:110px">
            <div style="font-size:10.5px;color:#ffe4e6">要対応</div>
            <div style="font-size:24px;font-weight:800">${alerts.length}<span style="font-size:12px">件</span></div></div>` : ''}
          <div style="background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);border-radius:14px;padding:11px 16px;min-width:110px">
            <div style="font-size:10.5px;color:#b6f0d8">本日出荷数量</div>
            <div style="font-size:24px;font-weight:800">${num(todayQty)}<span style="font-size:12px">点</span></div></div>
        </div>
      </div>
    </div>

    <div class="grid g5">
      ${kpiCard({ label: '在庫不足アラート', icon: 'alert', bg: 'var(--rose-100)', fg: 'var(--rose-600)', value: stockAlerts.length, unit: '件', tone: stockAlerts.length ? 'alert' : '', foot: `<span class="dot" style="background:${stockAlerts.length ? 'var(--rose-500)' : 'var(--green-500)'}"></span>${stockAlerts.length ? '発注点を下回っています' : 'すべて適正在庫です'}` })}
      ${kpiCard({ label: '本日出荷予定', icon: 'truck', bg: 'var(--green-100)', fg: 'var(--green-700)', value: todayShip.length, unit: '件', foot: `<span class="dot" style="background:var(--amber-500)"></span>未確定 ${pending.length} 件` })}
      ${kpiCard({ label: '受注残', icon: 'file', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: num(orderBacklog.reduce((a, r) => a + r.remaining, 0)), unit: '点', foot: `<span class="dot" style="background:${overdueOrders.length ? 'var(--rose-500)' : 'var(--green-500)'}"></span>納期超過 ${overdueOrders.length} 明細` })}
      ${kpiCard({ label: '発注残', icon: 'cart', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: num(poBacklog.reduce((a, r) => a + r.remaining, 0)), unit: '点', foot: `<span class="dot" style="background:${overduePO.length ? 'var(--amber-500)' : 'var(--green-500)'}"></span>入荷遅延 ${overduePO.length} 明細` })}
      ${kpiCard({ label: '在庫評価額', icon: 'yen', bg: 'var(--green-50)', fg: 'var(--green-700)', value: money(Math.round(totalStockValue)), foot: `<span class="dot" style="background:var(--green-500)"></span>累計出荷 ${monthShip} 件` })}
    </div>

    <div class="grid g-3-2">
      <div class="card">
        <div class="card-h">
          <h2>${ico('alert', 16)} 在庫不足アラート</h2>
          <span class="sub">発注点を下回った商品・資材</span>
          <div class="sp"><button class="btn sm ghost" onclick="App.go('alerts')">すべて見る ${ico('check', 14)}</button></div>
        </div>
        <div class="card-b tight">
          ${stockAlerts.length ? `<div class="table-wrap"><table class="tb">
            <thead><tr><th>品名</th><th>区分</th><th class="right">現在庫</th><th class="right">発注点</th><th>在庫水準</th><th></th></tr></thead>
            <tbody>${stockAlerts.slice(0, 6).map(i => {
              const lv = Store.alertLevel(i);
              const pct = Math.min(100, (i.stock / Math.max(i.reorderPoint * 1.5, 1)) * 100);
              return `<tr class="${lv === 'danger' ? 'row-danger' : 'row-warn'}">
                <td class="strong">${esc(i.name)}<div class="tiny muted">${esc(i.code)} ／ ${esc(i.location)}</div></td>
                <td><span class="badge ${i.kind === 'product' ? 'green' : 'sky'}">${i.kind === 'product' ? '商品' : '資材'}</span></td>
                <td class="num">${dec(i.stock)} <span class="tiny muted">${esc(i.unit)}</span></td>
                <td class="num muted">${dec(i.reorderPoint)}</td>
                <td><div class="bar ${lv === 'danger' ? 'danger' : 'warn'}"><i style="width:${pct}%"></i></div></td>
                <td class="right"><button class="btn xs primary" onclick="Actions.newPOFor('${i.id}')">発注</button></td></tr>`;
            }).join('')}</tbody></table></div>` : emptyBox('在庫は適正です', '発注点を下回っている商品・資材はありません')}
        </div>
      </div>

      <div class="card">
        <div class="card-h"><h2>${ico('trend', 16)} 直近7日の出荷量</h2><div class="sp"><span class="sub">単位：数量合計</span></div></div>
        <div class="card-b">
          ${chart}
          <div class="legend mt12"><span><i style="background:var(--green-500)"></i>出荷確定数量</span></div>
          <div class="hr"></div>
          <div class="vstack" style="gap:9px">
            ${[['確定済み出荷', Store.db.shipments.filter(s => s.status === 'confirmed').length + ' 件', 'green'],
               ['出荷指示待ち', Store.db.shipments.filter(s => s.status === 'instructed').length + ' 件', 'amber'],
               ['登録商品数', Store.db.items.filter(i => i.kind === 'product').length + ' 品目', 'sky'],
               ['登録資材数', Store.db.items.filter(i => i.kind === 'material').length + ' 品目', 'violet']]
              .map(([k, v, c]) => `<div class="hstack" style="justify-content:space-between">
                <span class="sm muted">${k}</span><span class="badge ${c}">${v}</span></div>`).join('')}
          </div>
        </div>
      </div>
    </div>

    <div class="grid g2">
      <div class="card">
        <div class="card-h"><h2>${ico('truck', 16)} 本日出荷予定</h2>
          <span class="sub">${dJP(TODAY)}</span>
          <div class="sp"><button class="btn sm" onclick="App.go('shipping')">出荷指示へ</button></div></div>
        <div class="card-b tight">
          ${todayShip.length ? `<div class="table-wrap"><table class="tb">
            <thead><tr><th>出荷番号</th><th>得意先</th><th class="right">数量</th><th>運送</th><th>状態</th><th></th></tr></thead>
            <tbody>${todayShip.map(s => `<tr>
              <td class="mono">${esc(s.shipmentNo)}</td>
              <td class="strong">${esc(s.customerName)}</td>
              <td class="num">${num(s.qty)}</td>
              <td class="sm muted">${esc(s.carrier || '—')}</td>
              <td>${s.status === 'confirmed' ? '<span class="badge green">確定済</span>' : '<span class="badge amber">未確定</span>'}</td>
              <td class="right"><button class="btn xs" onclick="Actions.openShipment('${s.id}')">詳細</button></td></tr>`).join('')}</tbody></table></div>`
            : emptyBox('本日の出荷予定はありません', '受注一覧から出荷指示を作成できます')}
        </div>
      </div>

      <div class="card">
        <div class="card-h"><h2>${ico('file', 16)} 受注残・納期管理</h2><div class="sp"><button class="btn sm" onclick="App.go('orders')">受注一覧へ</button></div></div>
        <div class="card-b tight">
          ${orderBacklog.length ? `<div class="table-wrap"><table class="tb">
            <thead><tr><th>受注番号</th><th>得意先／品名</th><th class="right">残</th><th>納期</th></tr></thead>
            <tbody>${orderBacklog.slice(0, 6).map(r => `<tr class="${r.overdue ? 'row-danger' : ''}">
              <td class="mono">${esc(r.orderNo)}</td>
              <td><span class="strong">${esc(r.customerName)}</span><div class="tiny muted">${esc(r.itemName)}</div></td>
              <td class="num">${dec(r.remaining)}</td>
              <td class="nowrap">${dJP(r.dueDate)}${r.overdue ? ' <span class="badge rose">超過</span>' : `<div class="tiny muted">${relDay(r.dueDate)}</div>`}</td></tr>`).join('')}</tbody></table></div>`
            : emptyBox('受注残はありません', 'すべての受注が出荷済みです')}
        </div>
      </div>
    </div>
  </div>`;
};

/* ============================== 警告一覧 ============================== */
Views.alerts = () => {
  const a = Store.alerts();
  const g = { danger: a.filter(x => x.level === 'danger'), warning: a.filter(x => x.level === 'warning') };
  const card = x => `<div class="hstack" style="align-items:flex-start;gap:12px;padding:14px;border:1px solid ${x.level === 'danger' ? 'var(--rose-100)' : 'var(--amber-100)'};background:${x.level === 'danger' ? 'var(--rose-50)' : 'var(--amber-50)'};border-radius:14px">
    <span style="width:36px;height:36px;border-radius:11px;flex:0 0 36px;display:grid;place-items:center;background:${x.level === 'danger' ? 'var(--rose-500)' : 'var(--amber-500)'};color:#fff">${ico(x.kind === 'stock' ? 'box' : x.kind === 'order' ? 'file' : x.kind === 'po' ? 'cart' : 'truck', 18, 2.2)}</span>
    <div style="flex:1;min-width:0">
      <b style="font-size:13.5px;display:block;color:${x.level === 'danger' ? 'var(--rose-700)' : 'var(--amber-700)'}">${esc(x.title)}</b>
      <span class="tiny muted">${esc(x.detail)}</span>
    </div>
    <button class="btn sm" onclick="App.go('${x.go}')">確認</button>
  </div>`;

  return `<div class="vstack" style="gap:16px">
    <div class="grid g3">
      ${kpiCard({ label: '要対応（重大）', icon: 'alert', bg: 'var(--rose-100)', fg: 'var(--rose-600)', value: g.danger.length, unit: '件', tone: 'alert', foot: '在庫切れ・納期超過' })}
      ${kpiCard({ label: '注意', icon: 'alert', bg: 'var(--amber-100)', fg: 'var(--amber-600)', value: g.warning.length, unit: '件', tone: 'warn', foot: '発注点割れ・入荷遅延' })}
      ${kpiCard({ label: 'アラート合計', icon: 'filter', bg: 'var(--green-100)', fg: 'var(--green-700)', value: a.length, unit: '件', foot: '在庫・受注・発注・出荷の横断チェック' })}
    </div>
    ${a.length ? `<div class="grid g2">
      <div class="card"><div class="card-h"><h2>${ico('alert', 16)} 要対応</h2><span class="badge rose">${g.danger.length}</span></div>
        <div class="card-b"><div class="vstack">${g.danger.length ? g.danger.map(card).join('') : '<p class="muted sm">重大なアラートはありません</p>'}</div></div></div>
      <div class="card"><div class="card-h"><h2>${ico('clock', 16)} 注意</h2><span class="badge amber">${g.warning.length}</span></div>
        <div class="card-b"><div class="vstack">${g.warning.length ? g.warning.map(card).join('') : '<p class="muted sm">注意レベルのアラートはありません</p>'}</div></div></div>
    </div>` : `<div class="card"><div class="card-b">${emptyBox('アラートはありません', '在庫・納期ともに正常な状態です')}</div></div>`}
  </div>`;
};

/* ============================== 在庫一覧 ============================== */
let invTab = 'product', invQ = '';
Views.inventory = () => {
  const filter = i => i.active && (invTab === 'all' ? true : invTab === 'alert' ? i.stock <= i.reorderPoint : i.kind === invTab);
  const list = Store.db.items.filter(filter).filter(i => !invQ || (i.name + i.code + (i.kana || '') + (i.category || '')).toLowerCase().includes(invQ.toLowerCase()));
  const cnt = {
    product: Store.db.items.filter(i => i.kind === 'product').length,
    material: Store.db.items.filter(i => i.kind === 'material').length,
    alert: Store.stockAlerts().length
  };
  const totalVal = list.reduce((a, i) => a + i.stock * i.costPrice, 0);

  return `<div class="vstack" style="gap:16px">
    <div class="grid g4">
      ${kpiCard({ label: '商品品目数', icon: 'tag', bg: 'var(--green-100)', fg: 'var(--green-700)', value: cnt.product, unit: '品目', foot: '販売用の農産物' })}
      ${kpiCard({ label: '資材品目数', icon: 'layers', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: cnt.material, unit: '品目', foot: '梱包・消耗資材' })}
      ${kpiCard({ label: '発注点割れ', icon: 'alert', bg: 'var(--rose-100)', fg: 'var(--rose-600)', value: cnt.alert, unit: '件', tone: cnt.alert ? 'alert' : '', foot: '早めの発注をおすすめします' })}
      ${kpiCard({ label: '在庫評価額（表示中）', icon: 'yen', bg: 'var(--green-50)', fg: 'var(--green-700)', value: money(Math.round(totalVal)), foot: '現在庫 × 仕入単価' })}
    </div>

    <div class="card">
      <div class="card-h">
        <h2>${ico('box', 16)} 現在庫管理</h2>
        <div class="sp">
          <div class="tabs">
            <button class="tab ${invTab === 'product' ? 'on' : ''}" onclick="Views.setInv('product')">商品 <span class="cnt">${cnt.product}</span></button>
            <button class="tab ${invTab === 'material' ? 'on' : ''}" onclick="Views.setInv('material')">資材 <span class="cnt">${cnt.material}</span></button>
            <button class="tab ${invTab === 'alert' ? 'on' : ''}" onclick="Views.setInv('alert')">在庫不足 <span class="cnt">${cnt.alert}</span></button>
            <button class="tab ${invTab === 'all' ? 'on' : ''}" onclick="Views.setInv('all')">すべて</button>
          </div>
        </div>
      </div>
      <div class="card-b tight">
        <div style="padding:12px 16px;border-bottom:1px solid var(--ink-100)" class="hstack">
          <div style="position:relative;flex:1;max-width:340px">
            <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--ink-400)">${ico('search', 16)}</span>
            <input class="inp" style="padding-left:34px" placeholder="品名・コードで検索" value="${esc(invQ)}"
              oninput="invQ=this.value;App.repaint()">
          </div>
          <div class="sp hstack">
            <button class="btn sm" onclick="Actions.adjustStock()">${ico('refresh', 14)} 在庫調整</button>
            <button class="btn sm primary" onclick="Actions.newPOFor('')">${ico('cart', 14)} 発注登録</button>
          </div>
        </div>
        <div class="table-wrap"><table class="tb">
          <thead><tr><th>品名</th><th>区分</th><th>規格</th><th class="right">現在庫</th><th class="right">発注点</th><th>在庫水準</th><th>状態</th><th>保管場所</th><th></th></tr></thead>
          <tbody>${list.length ? list.map(i => {
            const lv = Store.alertLevel(i);
            const pct = Math.min(100, (i.stock / Math.max(i.reorderPoint * 1.5, 1)) * 100);
            return `<tr class="${lv === 'danger' ? 'row-danger' : lv === 'warning' ? 'row-warn' : ''}">
              <td><span class="strong">${esc(i.name)}</span><div class="tiny muted mono">${esc(i.code)} ／ ${esc(i.category || '—')}</div></td>
              <td><span class="badge ${i.kind === 'product' ? 'green' : 'sky'}">${i.kind === 'product' ? '商品' : '資材'}</span></td>
              <td class="tiny muted">${esc(i.spec || '—')}</td>
              <td class="num strong">${dec(i.stock)}<div class="tiny muted">${esc(i.unit)}</div></td>
              <td class="num muted">${dec(i.reorderPoint)}<div class="tiny muted">安全 ${dec(i.safetyStock)}</div></td>
              <td><div class="bar ${lv === 'danger' ? 'danger' : lv === 'warning' ? 'warn' : 'ok'}"><i style="width:${pct}%"></i></div>
                  <div class="tiny muted">${pct.toFixed(0)}%</div></td>
              <td>${lv === 'danger' ? '<span class="badge rose">在庫不足</span>' : lv === 'warning' ? '<span class="badge amber">発注点割れ</span>' : '<span class="badge green">適正</span>'}</td>
              <td class="mono">${esc(i.location || '—')}</td>
              <td class="right"><div class="tb-act">
                <button class="btn xs" onclick="Actions.stockHistory('${i.id}')">履歴</button>
                <button class="btn xs ${lv !== 'ok' ? 'primary' : ''}" onclick="Actions.newPOFor('${i.id}')">発注</button>
              </div></td></tr>`;
          }).join('') : `<tr><td colspan="9">${emptyBox('該当する品目がありません', '検索条件を変更してください')}</td></tr>`}</tbody>
        </table></div>
      </div>
    </div>
  </div>`;
};
Views.setInv = t => { invTab = t; App.repaint(); };

/* ============================== 入出庫履歴 ============================== */
let mvFilter = 'all', mvQ = '';
Views.movements = () => {
  const list = Store.db.movements
    .filter(m => mvFilter === 'all' || m.moveType === mvFilter)
    .filter(m => !mvQ || (m.itemName + m.refNo).toLowerCase().includes(mvQ.toLowerCase()))
    .slice(0, 300);
  const inQ = Store.db.movements.filter(m => m.moveType === 'receipt').reduce((a, m) => a + m.quantity, 0);
  const outQ = Store.db.movements.filter(m => m.moveType === 'shipment').reduce((a, m) => a + Math.abs(m.quantity), 0);

  return `<div class="vstack" style="gap:16px">
    <div class="grid g3">
      ${kpiCard({ label: '累計入荷数量', icon: 'truckIn', bg: 'var(--green-100)', fg: 'var(--green-700)', value: num(Math.round(inQ)), unit: '点', foot: '入荷確定の合計' })}
      ${kpiCard({ label: '累計出荷数量', icon: 'truck', bg: 'var(--amber-100)', fg: 'var(--amber-600)', value: num(Math.round(outQ)), unit: '点', foot: '出荷確定の合計' })}
      ${kpiCard({ label: '在庫トランザクション', icon: 'clock', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: num(Store.db.movements.length), unit: '件', foot: '在庫増減の記録件数' })}
    </div>
    <div class="card">
      <div class="card-h"><h2>${ico('clock', 16)} 入出庫履歴</h2><span class="sub">在庫は入荷（＋）と出荷確定（−）のみで変動します</span></div>
      <div class="card-b tight">
        <div style="padding:12px 16px;border-bottom:1px solid var(--ink-100)" class="hstack">
          <div class="tabs">
            ${[['all', 'すべて'], ['receipt', '入荷'], ['shipment', '出荷'], ['adjustment', '調整'], ['loss', 'ロス']].map(([k, l]) =>
              `<button class="tab ${mvFilter === k ? 'on' : ''}" onclick="mvFilter='${k}';App.repaint()">${l}</button>`).join('')}
          </div>
          <div class="sp" style="position:relative;max-width:260px;flex:1">
            <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--ink-400)">${ico('search', 16)}</span>
            <input class="inp" style="padding-left:34px" placeholder="品名・伝票番号" value="${esc(mvQ)}" oninput="mvQ=this.value;App.repaint()">
          </div>
        </div>
        <div class="table-wrap"><table class="tb">
          <thead><tr><th>日時</th><th>区分</th><th>品名</th><th class="right">増減</th><th class="right">残高</th><th>参照伝票</th><th>担当</th></tr></thead>
          <tbody>${list.length ? list.map(m => `<tr>
            <td class="nowrap sm">${dtJP(m.movedAt)}</td>
            <td><span class="badge ${moveBadge(m.moveType)}">${moveLabel(m.moveType)}</span></td>
            <td class="strong">${esc(m.itemName)}</td>
            <td class="num ${m.quantity > 0 ? '' : ''}" style="color:${m.quantity > 0 ? 'var(--green-700)' : 'var(--rose-600)'};font-weight:700">${m.quantity > 0 ? '+' : ''}${dec(m.quantity)}</td>
            <td class="num">${dec(m.balanceAfter)}</td>
            <td class="mono">${esc(m.refNo || '—')}</td>
            <td class="sm muted">${esc((Store.db.users.find(u => u.id === m.operatorId) || {}).name || '—')}</td></tr>`).join('')
            : `<tr><td colspan="7">${emptyBox('履歴がありません', '条件を変更してください')}</td></tr>`}</tbody>
        </table></div>
      </div>
    </div>
  </div>`;
};

/* ============================== 商品マスタ / 資材マスタ ============================== */
const masterTable = (kind) => {
  const list = Store.db.items.filter(i => i.kind === kind);
  const isP = kind === 'product';
  return `<div class="vstack" style="gap:16px">
    <div class="grid g4">
      ${kpiCard({ label: '登録品目数', icon: isP ? 'tag' : 'layers', bg: isP ? 'var(--green-100)' : 'var(--sky-100)', fg: isP ? 'var(--green-700)' : 'var(--sky-600)', value: list.length, unit: '品目', foot: isP ? '販売商品マスタ' : '資材マスタ' })}
      ${kpiCard({ label: '発注点割れ', icon: 'alert', bg: 'var(--rose-100)', fg: 'var(--rose-600)', value: list.filter(i => i.stock <= i.reorderPoint).length, unit: '件', tone: 'alert', foot: '要発注' })}
      ${kpiCard({ label: '在庫金額', icon: 'yen', bg: 'var(--green-50)', fg: 'var(--green-700)', value: money(Math.round(list.reduce((a, i) => a + i.stock * i.costPrice, 0))), foot: '現在庫 × 仕入単価' })}
      ${kpiCard({ label: '平均販売単価', icon: 'trend', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: money(Math.round(list.reduce((a, i) => a + i.salePrice, 0) / Math.max(list.length, 1))), foot: isP ? '1品目あたり' : '資材は仕入単価基準' })}
    </div>
    <div class="card">
      <div class="card-h">
        <h2>${ico(isP ? 'tag' : 'layers', 16)} ${isP ? '商品マスタ' : '資材マスタ'}</h2>
        <span class="sub">${isP ? '販売する農産物の登録' : '梱包・消耗資材の登録'}</span>
        <div class="sp"><button class="btn sm primary" onclick="Actions.itemForm('${kind}')">${ico('plus', 14)} 新規登録</button></div>
      </div>
      <div class="card-b tight">
        <div class="table-wrap"><table class="tb">
          <thead><tr><th>コード</th><th>品名</th><th>カテゴリ</th><th>規格</th><th class="right">${isP ? '販売単価' : '仕入単価'}</th><th class="right">現在庫</th><th class="right">発注点</th><th>状態</th><th></th></tr></thead>
          <tbody>${list.map(i => `<tr>
            <td class="mono">${esc(i.code)}</td>
            <td><span class="strong">${esc(i.name)}</span><div class="tiny muted">${esc(i.kana || '')}</div></td>
            <td><span class="badge gray">${esc(i.category || '—')}</span></td>
            <td class="tiny muted">${esc(i.spec || '—')}</td>
            <td class="num">${money(isP ? i.salePrice : i.costPrice)}</td>
            <td class="num">${dec(i.stock)} <span class="tiny muted">${esc(i.unit)}</span></td>
            <td class="num muted">${dec(i.reorderPoint)}</td>
            <td>${i.stock <= i.safetyStock ? '<span class="badge rose">不足</span>' : i.stock <= i.reorderPoint ? '<span class="badge amber">発注点</span>' : '<span class="badge green">適正</span>'}</td>
            <td class="right"><div class="tb-act">
              <button class="btn xs" onclick="Actions.itemForm('${kind}','${i.id}')">編集</button>
              <button class="btn xs danger" onclick="Actions.deleteItem('${i.id}')">削除</button></div></td></tr>`).join('')}</tbody>
        </table></div>
      </div>
    </div>
  </div>`;
};
Views.products = () => masterTable('product');
Views.materials = () => masterTable('material');
