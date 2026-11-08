/* 取扱説明書用スクリーンショット生成: 実アプリのビューを jsdom で描画し、
   番号付き吹き出し（.co）を実要素へ重ねた静的HTMLを書き出す。
   その後 gsk screenshot で PNG 化する（shots/*.png）。 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const BUILT = path.join(ROOT, 'build', 'agri-erp.html');
const OUT = path.join(ROOT, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const built = fs.readFileSync(BUILT, 'utf8');
const bundle = built.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];

const CSS = `
html,body{background:#eef2f6;margin:0;padding:0}
body{width:1440px;overflow:hidden}
#toast,#sbWarn,#offBar,#emgBar,.sysbar{display:none!important}
#appShell{height:960px;overflow:hidden;background:#f6f8f9}
.multiline{white-space:pre-line}
.main{margin-left:var(--sb-w)}
.content{overflow:hidden!important;max-height:900px}
.content>div{will-change:transform}
.co-host{position:relative!important}
.co{position:absolute;top:-11px;left:-11px;width:24px;height:24px;border-radius:50%;background:#e11d48;color:#fff;
    font:800 13px/24px "Noto Sans CJK JP",system-ui,sans-serif;text-align:center;letter-spacing:0;
    box-shadow:0 0 0 3px #fff,0 3px 8px rgba(15,23,42,.35);z-index:9999;pointer-events:none}
.co.sm{width:20px;height:20px;font-size:11px;line-height:20px;top:-8px;left:-8px}
.sheet-holder{background:#e2e8f0;padding:26px;display:flex;justify-content:center}
`;

const CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

/* ---------- 描画ヘルパ ---------- */
function boot(opts) {
  const dom = new JSDOM(built, { runScripts: 'outside-only', url: 'https://agri.example/' });
  const w = dom.window, d = w.document;
  w.print = () => {};
  w.fetch = () => Promise.reject(new Error('offline'));
  w.setTimeout = (fn) => 0;             /* boot の遅延処理を止める */
  try { Object.defineProperty(w, 'crypto', { value: require('node:crypto').webcrypto, configurable: true }); } catch (e) {}
  w.eval(bundle + '\n;window.__M={Store,Views,Auth,App,Tenant,Role,Issuer,Print,TplEditor,Actions,buildSeed,Security,EMERGENCY,UI};');
  const M = w.__M;
  M.Store.db = M.buildSeed();
  M.Store.migrateTenant();
  M.Store.migrateIssuerMasters();
  const users = M.Store.db.users;
  const user = users.find(u => u.loginId === (opts.login || 'admin')) || users[0];
  M.Auth.user = user;
  M.Tenant.enter(user);
  d.getElementById('loginScreen').style.display = 'none';
  d.getElementById('appShell').style.display = 'none';
  return { w, d, M, user };
}

function showScreen(ctx, page, scroll) {
  const { d, M } = ctx;
  d.getElementById('loginScreen').style.display = 'none';
  d.getElementById('appShell').style.display = 'block';
  M.App.page = page;
  M.App.renderNav();
  M.App.repaint();
  /* タイトル・サブタイトル（MENU 定義から） */
  const it = (ctx.menuItems || []).find(i => i.id === page) || { label: page, sub: '' };
  d.getElementById('pgTitle').textContent = it.label;
  d.getElementById('pgSub').textContent = it.sub;
  d.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('on', el.dataset.nav === page));
  if (scroll) {
    const v = d.getElementById('view');
    v.style.transform = 'translateY(-' + scroll + 'px)';
  }
}

function showLogin(ctx) {
  const { d } = ctx;
  d.getElementById('loginScreen').style.display = 'flex';
  d.getElementById('appShell').style.display = 'none';
}

const norm = t => String(t || '').replace(/\s+/g, '');

/* 吹き出しの対象要素を解決する。
   1) 明示要素  2) 指定セレクタ（文字列一致があれば優先）  3) 画面内の類似要素を文字列で探索
   → 一致した候補のうち「最も小さい（＝より具体的な）」要素を採用する */
function locate(d, c) {
  if (!c) return null;
  if (c.el) return c.el;
  const text = c.text ? norm(c.text) : '';
  const pools = [c.sel, '.btn', 'button', '.tab', '.card-h h2', 'h2', 'th', 'label', '.tb tbody tr', '.grid > div', '.card', '.filter-grid > div']
    .filter(Boolean);
  for (const sel of pools) {
    let list = [];
    try { list = Array.from(d.querySelectorAll(sel)); } catch (e) { continue; }
    if (!list.length) continue;
    if (text) {
      const hits = list.filter(el => norm(el.textContent).includes(text));
      if (hits.length) { hits.sort((a, b) => norm(a.textContent).length - norm(b.textContent).length); return hits[0]; }
    } else {
      const pick = c.idx != null ? list[c.idx] : list[0];
      if (pick) return pick;
    }
  }
  return null;
}

function callouts(d, spec) {
  const used = [];
  spec.forEach((c, i) => {
    const el = locate(d, c);
    if (!el) { used.push(null); return; }
    el.classList.add('co-host');
    const mark = d.createElement('i');
    mark.className = 'co' + (c && c.sm ? ' sm' : '');
    mark.textContent = CIRC[i];
    el.appendChild(mark);
    used.push(i + 1);
  });
  return used;
}

function write(name, ctx, opts) {
  const { d, w } = ctx;
  const style = d.createElement('style');
  style.textContent = CSS;
  d.head.appendChild(style);
  const html = '<!DOCTYPE html>\n' + d.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/g, '');
  fs.writeFileSync(path.join(OUT, name + '.html'), html);
  const nums = (opts && opts.nums) || [];
  const missing = nums.map((n, i) => (n ? null : i + 1)).filter(Boolean);
  console.log((missing.length ? 'WARN ' : 'OK   ') + name + (missing.length ? ' missing callout ' + missing.join(',') : ''));
}

/* ---------- 各ショット ---------- */
const SHOTS = [];
function shot(name, fn) { SHOTS.push({ name, fn }); }

/* 1. ログイン */
shot('01_login', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [];
  showLogin(ctx);
  ctx.d.getElementById('loginId').value = 'admin';
  ctx.d.getElementById('loginPw').value = '••••••••';
  const nums = callouts(ctx.d, [
    { el: ctx.d.querySelector('.login-hero') },
    { sel: '#loginId' },
    { sel: '#loginPw' },
    { sel: 'button', text: 'ログイン' },
    { sel: '.login-foot, .login-card p', text: '初期' }
  ]);
  write('01_login', ctx, { nums });
});

/* 2. ダッシュボード（system_admin） */
shot('02_dashboard', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'dashboard', label: 'ダッシュボード', sub: '本日の状況サマリー' }];
  showScreen(ctx, 'dashboard');
  const d = ctx.d;
  const nums = callouts(d, [
    { el: d.querySelector('.sb-brand') },
    { el: d.querySelector('#nav .nav-item') },
    { sel: '.topbar' },
    { sel: '.topbar .btn', text: 'クイック印刷' },
    { el: d.querySelector('.grid .card') },
    { sel: '.card-h h2', text: '本日の' }
  ]);
  write('02_dashboard', ctx, { nums });
});

/* 3. 通知一覧 */
shot('03_alerts', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'alerts', label: '警告一覧', sub: '在庫不足・納期遅延' }];
  showScreen(ctx, 'alerts');
  const d = ctx.d;
  const nums = callouts(d, [
    { el: d.querySelector('#nav .nav-item[data-nav="alerts"]') },
    { el: d.querySelector('.grid .card') },
    { sel: '.tabs .tab', idx: 0 },
    { sel: '.tb' },
    { sel: '.tb .btn', idx: 0 }
  ]);
  write('03_alerts', ctx, { nums });
});

/* 4. 在庫一覧 */
shot('04_inventory', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'inventory', label: '在庫一覧', sub: '現在庫・発注点管理' }];
  showScreen(ctx, 'inventory');
  const d = ctx.d;
  const nums = callouts(d, [
    { sel: '.grid .card', idx: 0 },
    { sel: 'input.inp', text: '' },
    { sel: '.tabs .tab', idx: 1 },
    { sel: '.tb thead' },
    { sel: '.tb tbody tr', idx: 0 },
    { sel: '.tb .btn', idx: 0 }
  ]);
  write('04_inventory', ctx, { nums });
});

/* 5. 入出庫履歴 */
shot('05_movements', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'movements', label: '入出庫履歴', sub: '在庫増減の全記録' }];
  showScreen(ctx, 'movements');
  const d = ctx.d;
  const nums = callouts(d, [
    { sel: '.grid .card', idx: 0 },
    { sel: '.tabs .tab', idx: 1 },
    { sel: '.tb thead' },
    { sel: '.tb tbody tr', idx: 0 }
  ]);
  write('05_movements', ctx, { nums });
});

/* 6. 商品マスタ */
shot('06_products', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'products', label: '商品マスタ', sub: '販売商品の登録' }];
  showScreen(ctx, 'products');
  const d = ctx.d;
  const nums = callouts(d, [
    { sel: '.card-h h2', text: '商品マスタ' },
    { sel: '.card-h .btn', text: '商品を登録' },
    { sel: '.tb thead' },
    { sel: '.tb tbody tr', idx: 0 },
    { sel: '.tb .btn', text: '編集' }
  ]);
  write('06_products', ctx, { nums });
});

/* 7. 資材マスタ */
shot('07_materials', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'materials', label: '資材マスタ', sub: '梱包・消耗資材の登録' }];
  showScreen(ctx, 'materials');
  const d = ctx.d;
  const nums = callouts(d, [
    { sel: '.card-h .btn' },
    { sel: '.tb' },
    { sel: '.tb tbody tr', idx: 0 }
  ]);
  write('07_materials', ctx, { nums });
});

/* 8. 得意先マスタ */
shot('08_customers', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'customers', label: '得意先マスタ', sub: '取引先の登録' }];
  showScreen(ctx, 'customers');
  const d = ctx.d;
  const nums = callouts(d, [
    { sel: '.card-h h2' },
    { sel: '.card-h .btn' },
    { sel: '.tb thead th', text: '営業担当者' },
    { sel: '.tb tbody tr', idx: 0 },
    { sel: '.tb .btn', text: '編集' }
  ]);
  write('08_customers', ctx, { nums });
});

/* 9. 得意先 登録フォーム（モーダル） */
shot('09_customer_form', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'customers', label: '得意先マスタ', sub: '取引先の登録' }];
  showScreen(ctx, 'customers');
  const d = ctx.d;
  ctx.M.Actions.customerForm('');
  d.getElementById('c_code').value = 'C-206';
  d.getElementById('c_name').value = '株式会社 四国青果';
  d.getElementById('c_kana').value = 'シコクセイカ';
  d.getElementById('c_tel').value = '087-800-1234';
  d.getElementById('c_addr').value = '香川県高松市番町1-1-1';
  const nums = callouts(d, [
    { el: d.querySelector('.modal-h') },
    { sel: '.modal-b .field label' },
    { sel: '#c_code' },
    { sel: '#c_name' },
    { sel: '#c_rep' },
    { sel: '.modal-f .btn.primary' }
  ]);
  write('09_customer_form', ctx, { nums });
});

/* 10. 仕入先マスタ */
shot('10_suppliers', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'suppliers', label: '仕入先マスタ', sub: '仕入先の登録' }];
  showScreen(ctx, 'suppliers');
  const d = ctx.d;
  const nums = callouts(d, [
    { sel: '.card-h .btn' },
    { sel: '.tb' },
    { sel: '.tb tbody tr', idx: 0 }
  ]);
  write('10_suppliers', ctx, { nums });
});

/* 11. 受注一覧 */
shot('11_orders', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'orders', label: '受注一覧', sub: '受注残・納期管理' }];
  showScreen(ctx, 'orders');
  const d = ctx.d;
  const nums = callouts(d, [
    { sel: '.grid .card', idx: 0 },
    { sel: '.tabs .tab', idx: 0 },
    { sel: '.card-h .btn', text: '受注を登録' },
    { sel: '.tb thead' },
    { sel: '.tb tbody .btn', idx: 0 }
  ]);
  write('11_orders', ctx, { nums });
});

/* 12. 受注登録フォーム */
shot('12_order_form', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'orders', label: '受注一覧', sub: '受注残・納期管理' }];
  showScreen(ctx, 'orders');
  const d = ctx.d;
  ctx.M.Actions.orderForm();
  const nums = callouts(d, [
    { el: d.querySelector('.modal-h') },
    { sel: '#o_cust' },
    { sel: '#o_rep' },
    { sel: '#o_date' },
    { sel: '#o_item' },
    { sel: '.modal-b table' },
    { sel: '.modal-f .btn.primary' }
  ]);
  write('12_order_form', ctx, { nums });
});

/* 13. 発注一覧 */
shot('13_purchase', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'purchase', label: '発注一覧', sub: '発注残管理' }];
  showScreen(ctx, 'purchase');
  const d = ctx.d;
  const nums = callouts(d, [
    { sel: '.tabs .tab', idx: 0 },
    { sel: '.card-h .btn', text: '発注' },
    { sel: '.tb thead' },
    { sel: '.tb tbody tr', idx: 0 },
    { sel: '.tb .btn', idx: 0 }
  ]);
  write('13_purchase', ctx, { nums });
});

/* 14. 入荷処理 */
shot('14_receipts', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'receipts', label: '入荷処理', sub: '入荷確定で在庫加算' }];
  showScreen(ctx, 'receipts');
  const d = ctx.d;
  const nums = callouts(d, [
    { sel: '.tabs .tab', idx: 0 },
    { sel: '.tb' },
    { sel: '.tb .btn', idx: 0 }
  ]);
  write('14_receipts', ctx, { nums });
});

/* 15. 出荷指示 */
shot('15_shipping', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'shipping', label: '出荷指示', sub: '出荷の指示と確定' }];
  showScreen(ctx, 'shipping');
  const d = ctx.d;
  const nums = callouts(d, [
    { sel: '.grid .card', idx: 0 },
    { sel: '.tabs .tab', idx: 0 },
    { sel: '.card-h .btn', text: '出荷' },
    { sel: '.tb thead' },
    { sel: '.tb tbody .btn', idx: 0 }
  ]);
  write('15_shipping', ctx, { nums });
});

/* 16. 出荷検索・履歴 */
shot('16_shiphistory', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'shipHistory', label: '出荷検索・履歴', sub: '期間・得意先・営業担当・状態で検索' }];
  showScreen(ctx, 'shipHistory');
  const d = ctx.d;
  const nums = callouts(d, [
    { sel: '.filter-grid .field', idx: 0 },
    { sel: '.filter-grid .field', idx: 1 },
    { sel: '.filter-grid .field', idx: 2 },
    { sel: '.filter-grid .field', idx: 3 },
    { sel: '.tabs .tab', idx: 1 },
    { sel: '.tb tfoot' },
    { sel: '.btn', text: 'CSV' }
  ]);
  write('16_shiphistory', ctx, { nums });
});

/* 17. 帳票発行 */
shot('17_docs', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'docs', label: '帳票発行', sub: '納品書・出荷伝票・ピッキング' }];
  showScreen(ctx, 'docs');
  const d = ctx.d;
  const nums = callouts(d, [
    { sel: '.tabs .tab', idx: 0 },
    { sel: '.tabs .tab', idx: 3 },
    { sel: '.tabs .tab', idx: 5 },
    { el: d.querySelectorAll('.card')[1] ? d.querySelectorAll('.card')[1].querySelector('.btn.xs.primary') : null },
    { sel: '.card-h .btn', text: 'テンプレート設定' },
    { sel: '.tb' }
  ]);
  write('17_docs', ctx, { nums });
});

/* 18. クイック印刷（トップバー） */
shot('18_quickprint', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'dashboard', label: 'ダッシュボード', sub: '本日の状況サマリー' }];
  showScreen(ctx, 'dashboard');
  const d = ctx.d;
  const nums = callouts(d, [
    { sel: '.topbar .btn', text: 'クイック印刷' },
    { sel: '.topbar .bell' },
    { el: d.querySelector('#orgBadge') },
    { sel: '.topbar .av, .topbar .user', idx: 0 }
  ]);
  write('18_quickprint', ctx, { nums });
});

/* 19. 帳票の出力例（納品書 A4） */
shot('19_print_sheet', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [];
  const d = ctx.d;
  d.getElementById('appShell').style.display = 'none';
  d.getElementById('loginScreen').style.display = 'none';
  const ship = ctx.M.Store.db.shipments.find(s => s.status === 'confirmed') || ctx.M.Store.db.shipments[0];
  const html = ctx.M.Print.build('delivery_note', {});
  const holder = d.createElement('div');
  holder.className = 'sheet-holder';
  holder.innerHTML = html;
  d.body.appendChild(holder);
  const nums = callouts(d, [
    { el: d.querySelector('.sheet-head h1') },
    { el: d.querySelector('.issuer') },
    { el: d.querySelector('.sheet-meta .box') },
    { el: d.querySelector('.sheet table thead') },
    { el: d.querySelector('.totals') },
    { el: d.querySelector('.sheet-foot') }
  ]);
  write('19_print_sheet', ctx, { nums });
});

/* 20. 会社マスタ */
shot('20_companies', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'companies', label: '会社・拠点マスタ', sub: 'グループ会社と拠点の登録' }];
  showScreen(ctx, 'companies');
  const d = ctx.d;
  const nums = callouts(d, [
    { sel: '.grid .card', idx: 0 },
    { sel: '.card-h .btn', text: '会社を登録' },
    { sel: '.tb thead' },
    { sel: '.tb tbody .btn', text: '拠点追加' },
    { sel: '.tb .btn', text: '編集' }
  ]);
  write('20_companies', ctx, { nums });
});

/* 21. 拠点マスタ（同画面下部） */
shot('21_branches', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'companies', label: '会社・拠点マスタ', sub: 'グループ会社と拠点の登録' }];
  showScreen(ctx, 'companies');
  const d = ctx.d;
  const card = Array.from(d.querySelectorAll('.card')).find(c => (c.textContent || '').indexOf('拠点マスタ') >= 0);
  const h = card ? card.querySelector('.card-h') : null;
  const nums = callouts(d, [
    { el: h },
    { sel: '.tb thead th', text: '担当者' },
    { sel: '.tb tbody .btn', text: '編集' },
    { sel: '.tb .btn', text: '無効化' }
  ]);
  const v = d.getElementById('view');
  v.style.transform = 'translateY(-820px)';
  write('21_branches', ctx, { nums });
});

/* 22. 帳票テンプレート一覧 */
shot('22_doc_templates', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'docTemplates', label: '帳票テンプレート', sub: '帳票の表示項目を定義' }];
  showScreen(ctx, 'docTemplates');
  const d = ctx.d;
  const nums = callouts(d, [
    { sel: '.grid .card', idx: 0 },
    { sel: '.card-h .btn', text: 'テンプレートを登録' },
    { sel: '.tb thead' },
    { sel: '.tb tbody tr', idx: 0 },
    { sel: '.tb .btn', text: '複製' }
  ]);
  write('22_doc_templates', ctx, { nums });
});

/* 23. 帳票テンプレート編集（2カラム＋PDFプレビュー） */
shot('23_tpl_editor', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'docTemplates', label: '帳票テンプレート', sub: '帳票の表示項目を定義' }];
  showScreen(ctx, 'docTemplates');
  const d = ctx.d;
  ctx.M.TplEditor.open('tpl001');
  const nums = callouts(d, [
    { el: d.querySelector('.tpl-left .card-h') },
    { sel: '.tgl', idx: 0 },
    { sel: '[data-seg="branchMode"]' },
    { el: d.querySelector('.tpl-right .tabs') },
    { el: d.querySelector('#tplPrevWrap') },
    { sel: '.btn', text: 'PDF出力' },
    { sel: '.btn', text: '保存' }
  ]);
  write('23_tpl_editor', ctx, { nums });
});

/* 24. テンプレート編集（設定部分・スクロール） */
shot('24_tpl_editor_settings', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'docTemplates', label: '帳票テンプレート', sub: '帳票の表示項目を定義' }];
  showScreen(ctx, 'docTemplates');
  const d = ctx.d;
  ctx.M.TplEditor.open('tpl001');
  const card = Array.from(d.querySelectorAll('.tpl-left .card')).find(c => (c.textContent || '').indexOf('レイアウト設定') >= 0);
  const nums = callouts(d, [
    { el: card ? card.querySelector('.card-h') : null },
    { sel: '[data-seg="branchMode"]' },
    { sel: '[data-seg="paper"]' },
    { sel: '.seg', idx: 2 },
    { el: d.querySelector('#tplZoomLbl') }
  ]);
  const v = d.getElementById('view');
  v.style.transform = 'translateY(-340px)';
  write('24_tpl_editor_settings', ctx, { nums });
});

/* 25. ユーザー管理（system_admin） */
shot('25_users', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'users', label: 'ユーザー管理', sub: '権限の設定' }];
  showScreen(ctx, 'users');
  const d = ctx.d;
  const nums = callouts(d, [
    { sel: '.grid .card', idx: 0 },
    { sel: '.note' },
    { sel: '.card-h .btn', text: 'ユーザー登録' },
    { sel: '.tb thead' },
    { sel: '.tb tbody tr', idx: 1 },
    { sel: '.tb .btn', text: '削除' }
  ]);
  write('25_users', ctx, { nums });
});

/* 26. ユーザー登録フォーム */
shot('26_user_form', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'users', label: 'ユーザー管理', sub: '権限の設定' }];
  showScreen(ctx, 'users');
  const d = ctx.d;
  ctx.M.Actions.userForm('');
  d.getElementById('u_login').value = 'sales3';
  d.getElementById('u_name').value = '岡田 拓也';
  d.getElementById('u_mail').value = 'sales3@agri-erp.local';
  const nums = callouts(d, [
    { sel: '#u_login' },
    { sel: '#u_org' },
    { sel: '#u_role' },
    { sel: '#u_enabled' },
    { el: d.querySelector('.modal-f .btn.primary') }
  ]);
  write('26_user_form', ctx, { nums });
});

/* 27. 組織マスタ */
shot('27_organizations', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'organizations', label: '組織マスタ', sub: 'テナントの追加・編集・停止' }];
  showScreen(ctx, 'organizations');
  const d = ctx.d;
  const nums = callouts(d, [
    { sel: '.grid .card', idx: 0 },
    { sel: '.card-h .btn', text: '組織を登録' },
    { sel: '.tb thead' },
    { sel: '.tb tbody tr', idx: 1 },
    { sel: '.tb .btn', text: '停止' }
  ]);
  write('27_organizations', ctx, { nums });
});

/* 28. システム設定（接続設定） */
shot('28_settings', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'settings', label: 'システム設定', sub: 'データ管理と将来拡張' }];
  showScreen(ctx, 'settings');
  const d = ctx.d;
  const card = Array.from(d.querySelectorAll('.card')).find(c => (c.textContent || '').indexOf('Supabase 接続設定') >= 0);
  const nums = callouts(d, [
    { el: d.querySelector('.note') },
    { el: card ? card.querySelector('.cfg-row') : null },
    { sel: '.card-h .btn, .card .btn', text: '接続テスト' },
    { sel: '.btn', text: '接続情報を再取得' },
    { sel: '.btn', text: '暫定設定' }
  ]);
  write('28_settings', ctx, { nums });
});

/* 29. システム設定（データ管理） */
shot('29_settings_data', () => {
  const ctx = boot({ login: 'admin' });
  ctx.menuItems = [{ id: 'settings', label: 'システム設定', sub: 'データ管理と将来拡張' }];
  showScreen(ctx, 'settings');
  const d = ctx.d;
  const card = Array.from(d.querySelectorAll('.card')).find(c => (c.textContent || '').indexOf('データ管理') >= 0);
  const nums = callouts(d, [
    { el: card ? card.querySelector('.card-h') : null },
    { sel: '.btn', text: '書き出す（JSON）' },
    { sel: '.btn', text: 'CSV' },
    { sel: '.btn', text: 'デモデータを初期化' }
  ]);
  const v = d.getElementById('view');
  v.style.transform = 'translateY(-330px)';
  write('29_settings_data', ctx, { nums });
});

/* 30. org_admin のメニュー（組織マスタ非表示の証跡） */
shot('30_role_orgadmin', () => {
  const ctx = boot({ login: 'afarm' });
  ctx.menuItems = [{ id: 'users', label: 'ユーザー管理', sub: '権限の設定' }];
  showScreen(ctx, 'users');
  const d = ctx.d;
  const nums = callouts(d, [
    { el: d.querySelector('#nav') },
    { el: d.querySelector('#orgBadge') },
    { sel: '.note' },
    { sel: '.tb' }
  ]);
  write('30_role_orgadmin', ctx, { nums });
});

/* 31. 権限不足の画面（user で管理画面へ） */
shot('31_no_permission', () => {
  const ctx = boot({ login: 'shipping' });
  ctx.menuItems = [{ id: 'users', label: 'ユーザー管理', sub: '権限の設定' }];
  showScreen(ctx, 'dashboard');
  const d = ctx.d;
  ctx.M.App.go('users');
  const nums = callouts(d, [
    { el: d.querySelector('#view .card, #view') },
    { el: d.querySelector('#toast') }
  ]);
  d.getElementById('toast').style.display = 'flex';
  d.getElementById('toast').textContent = 'この機能を利用する権限がありません';
  write('31_no_permission', ctx, { nums });
});

/* ---------- 実行 ---------- */
for (const s of SHOTS) {
  try { s.fn(); } catch (e) { console.log('ERROR ' + s.name + ': ' + (e && e.message)); }
}
console.log('done: ' + SHOTS.length + ' shots');
