/* 担当者管理（ver 3.7）スモークテスト */
const fs = require('fs'), path = require('path'), { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'build', 'agri-erp.html'), 'utf8');
const bundle = html.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/' });
const w = dom.window;
w.print = () => {}; w.fetch = () => Promise.reject(new Error('no network'));
try { Object.defineProperty(w, 'crypto', { value: require('node:crypto').webcrypto, configurable: true }); } catch (e) {}
w.eval(bundle + '\n;window.__T={Store,Views,Auth,App,Issuer,Print,Tenant,Role,MENU,Actions,Owner,OWNER_KIND,Audit,buildSeed,todayStr};');
const T = w.__T, Store = T.Store, Auth = T.Auth, Tenant = T.Tenant, Owner = T.Owner;

let fails = 0;
const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };

Store.db = T.buildSeed(); Store.migrateTenant(); Store.migrateIssuerMasters();
const U = id => Tenant.raw('users').find(u => u.loginId === id);
const as = id => { Auth.user = U(id); Tenant.enter(Auth.user); Store.db = Tenant._raw ? Store.db : Store.db; };

/* ---- 1. データモデル ---- */
as('admin');
ok('4伝票に担当者列が定義されている',
  T.OWNER_KIND.orders.key === 'salesUserId' && T.OWNER_KIND.purchaseOrders.key === 'purchaseUserId'
  && T.OWNER_KIND.receipts.key === 'receiptUserId' && T.OWNER_KIND.shipments.key === 'shipmentUserId');
ok('受注シードに salesUserId が入っている', Store.db.orders.every(o => o.salesUserId === o.salesRepId));
ok('発注シードに purchaseUserId', Store.db.purchaseOrders.some(p => !!p.purchaseUserId));
ok('入荷シードに receiptUserId', Store.db.receipts.some(r => !!r.receiptUserId));
ok('出荷シードに shipmentUserId', Store.db.shipments.some(s => !!s.shipmentUserId));
ok('担当者は users の実在IDのみ', Store.db.orders.every(o => !o.salesUserId || !!Store.user(o.salesUserId)));

/* ---- 2. 組織別フィルタ ---- */
ok('SETOLAS の候補は A-FARM ユーザーを含まない', Owner.candidates().every(u => u.id !== 'usr010'));
ok('SETOLAS の候補数は 5 名', Owner.candidates().length === 5);
ok('候補は担当者コード順', Owner.candidates().map(u => u.ownerCode).join(',') === 'S001,S002,S003,S004,S005');
as('afarm');
ok('A-FARM の候補は自組織のみ（1名）', Owner.candidates().length === 1 && Owner.candidates()[0].id === 'usr010');
ok('A-FARM から SETOLAS の担当者は選択不可', Owner.isCandidate('usr002') === false);
as('admin');
const pickHtml = Owner.pickerHtml('t', 'orders', null, { defaultCurrent: true });
ok('プルダウンは検索入力＋選択を持つ', pickHtml.includes('ows_t') && pickHtml.includes('ow_t') && pickHtml.includes('検索'));
ok('プルダウンに他組織ユーザーを出さない', !pickHtml.includes('青木 大地'));
ok('新規時の初期値はログインユーザー', Owner.defaultId() === 'usr001');

/* ---- 3. 受注一覧（列・検索・並び替え） ---- */
w.eval('ordOwner=""; ordSort="date";');
const ordAll = T.Views.orders();
ok('受注一覧に「担当営業」列がある', ordAll.includes('担当営業'));
ok('受注一覧に担当者名が出る', ordAll.includes('佐藤 花子') || ordAll.includes('田中 健二'));
const m4 = Store.db.orders.filter(o => Owner.match('orders', o, 'usr004'));
ok('担当営業で絞り込める（該当のみ・他担当は除外）', m4.length > 0 && m4.every(o => Owner.idOf('orders', o) === 'usr004'));
ok('未設定のみの絞り込みも可能', Store.db.orders.every(o => !Owner.match('orders', o, '__none') || !Owner.idOf('orders', o)));
w.eval('ordOwner=""; ordSort="owner";');
ok('担当者で並び替えできる（例外なし）', typeof T.Views.orders() === 'string');
w.eval('ordOwner=""; ordSort="date";');

/* ---- 4. 発注・入荷・出荷 ---- */
ok('発注一覧に「発注担当」列', T.Views.purchase().includes('発注担当'));
ok('入荷一覧に「受入担当」列', T.Views.receipts().includes('受入担当'));
ok('出荷検索に「出荷担当」列', T.Views.shipHistory().includes('出荷担当'));
ok('入出庫履歴に担当者検索がある', T.Views.movements().includes('mvOwner'));

/* ---- 5. 担当者別実績 ---- */
Store.db.orders.push({ id: 'u1', orderNo: 'U-1', orderDate: T.todayStr(), status: 'received', total: 1, customerName: '未設定データ' });
const st = Owner.stats('', '');
ok('実績の受注件数が全受注と一致', st.reduce((a, r) => a + r.orderCnt, 0) === Store.db.orders.length);
ok('実績の出荷件数が全出荷と一致', st.reduce((a, r) => a + r.shpCnt, 0) === Store.db.shipments.filter(s => s.status !== 'cancelled').length);
ok('実績に未設定行を含む（旧データ用）', st.some(r => r.unassigned));
Store.db.orders = Store.db.orders.filter(x => x.id !== 'u1');   /* 以降の帳票テスト用に除去 */
const rp = T.Views.ownerReport();
ok('担当者別実績の画面が描画される', rp.includes('担当者別実績') && rp.includes('受注金額') && rp.includes('出荷数量'));
const rk = Owner.ranking();
ok('ランキングは最大5件', rk.topOrder.length <= 5 && rk.topShip.length <= 5 && rk.pending.length <= 5);
ok('ダッシュボードに担当者別ランキング', T.Views.dashboard().includes('今月の受注件数 TOP5') && T.Views.dashboard().includes('未処理案件数'));
ok('メニューに担当者別実績', T.MENU.flatMap(g => g.items).some(i => i.id === 'ownerReport'));

/* ---- 6. 担当者変更と監査ログ ---- */
const o = Store.db.orders[0];
const before = o.salesUserId, logs0 = (Store.db.auditLogs || []).length;
const changed = Owner.assign('orders', o, 'usr005');
const log = (Store.db.auditLogs || [])[0];
ok('担当者を変更できる', changed && o.salesUserId === 'usr005');
ok('監査ログに担当者変更が記録される', !!log && log.action === 'owner_change' && (Store.db.auditLogs || []).length === logs0 + 1);
ok('監査ログに変更前→変更後が残る', /→/.test(log.detail) && log.detail.includes(Store.user('usr005').name));
ok('旧列（salesRepId）も同期される', o.salesRepId === 'usr005');
ok('同一担当者への変更では記録しない', Owner.assign('orders', o, 'usr005') === false);
Owner.assign('orders', o, before);

/* ---- 7. 帳票の担当者表示 ---- */
const tpl = Object.assign({}, T.Issuer.tplNorm(Store.db.docTemplates[0]), { owner: true });
const h1 = T.Print.build('quote', { template: tpl, paper: 'portrait' });
ok('帳票テンプレートに「担当者表示」項目', T.Issuer.tplNorm({}).owner === true);
ok('担当者表示 ON で帳票に担当者を印字', h1.includes('担当者') && h1.includes('担当する') === false && h1.includes('担当者</div>'));
const h2 = T.Print.build('quote', { template: Object.assign({}, tpl, { owner: false }), paper: 'portrait' });
ok('担当者表示 OFF で印字しない', !h2.includes('担当者</div>'));
ok('発注書にも担当者', T.Print.build('purchase_order', { template: tpl }).includes('担当者</div>'));
ok('入庫伝票にも担当者', T.Print.build('receipt_note', { template: tpl }).includes('担当者</div>'));
ok('納品書にも担当者', T.Print.build('delivery_note', { template: tpl }).includes('担当者</div>'));

/* ---- 8. 権限スコープ ---- */
as('shipping');   /* role=user */
ok('一般ユーザー: 既定は自分の担当のみ', Owner.scopeMine() === true);
const own = Owner.visible('orders', Store.db.orders);
ok('自分の担当＋未設定のみ表示', own.every(x => !x.salesUserId || x.salesUserId === 'usr003'));
Owner.setScope('org');
ok('設定変更で自組織すべて表示', Owner.scopeMine() === false && Owner.visible('orders', Store.db.orders).length === Store.db.orders.length);
Owner.setScope('mine');
as('office');     /* manager */
ok('管理担当は全件表示', Owner.scopeMine() === false);
as('admin');
ok('システム管理者は全件表示', Owner.scopeMine() === false);

/* ---- 9. 既存データ（担当者未設定） ---- */
Store.db.orders.push({ id: 'old1', orderNo: 'OLD-1', orderDate: T.todayStr(), status: 'received', total: 100, customerName: '旧データ' });
ok('旧データは担当者未設定として扱う', Owner.idOf('orders', Store.db.orders.find(x => x.id === 'old1')) === null);
ok('未設定でも一覧が壊れない', T.Views.orders().includes('OLD-1'));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS (owner_smoke)');
process.exit(fails ? 1 : 0);
