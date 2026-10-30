/* 出荷検索（期間・得意先・営業担当者・出荷状態）のスモークテスト（jsdom） */
const fs = require('fs'); const path = require('path'); const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'build', 'agri-erp.html'), 'utf8');
const bundle = html.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/' });
const w = dom.window, d = w.document;
w.print = () => {}; w.fetch = () => Promise.reject(new Error('no network'));
try { Object.defineProperty(w, 'crypto', { value: require('node:crypto').webcrypto, configurable: true }); } catch (e) {}
w.eval(bundle + '\n;window.__T={Store,Views,Auth,App,Actions,buildSeed,shipFilters,shipSet,shipQuick,shipReset,shipFiltered,SHIP_STATE};');
const T = w.__T, Store = T.Store;
Store.db = T.buildSeed(); Store.migrateIssuerMasters();
T.Auth.user = { id: 'usr001', loginId: 'admin', name: '山田 太郎', role: 'admin' };

let fails = 0;
const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };

/* ---- 画面構成 ---- */
const h = T.Views.shipHistory();
['期間（出荷日）', '得意先', '営業担当者', '出荷状態', '出荷検索結果'].forEach(l => ok('検索条件UI: ' + l, h.indexOf(l) >= 0));
ok('状態の選択肢（指示済/確定/取消）', h.indexOf('出荷指示済') >= 0 && h.indexOf('出荷確定') >= 0 && h.indexOf('取消') >= 0);
ok('クイック期間（全期間）', h.indexOf('全期間') >= 0);

/* ---- 絞り込みロジック ---- */
const all = Store.db.shipments.length;
T.shipReset(); T.shipFilters().from = ''; T.shipFilters().to = '';
ok('全期間=すべての出荷', T.shipFiltered().length === all);

T.shipQuick('all'); T.shipSet('status', 'confirmed');
ok('出荷状態=確定で絞り込み', T.shipFiltered().every(s => s.status === 'confirmed') && T.shipFiltered().length === Store.db.shipments.filter(s => s.status === 'confirmed').length);
T.shipSet('status', 'instructed');
ok('出荷状態=指示済で絞り込み', T.shipFiltered().every(s => s.status === 'instructed') && T.shipFiltered().length > 0);
T.shipSet('status', 'cancelled');
ok('出荷状態=取消（該当なし）', T.shipFiltered().length === 0);
T.shipSet('status', 'all');

/* 期間 */
const d3 = T.Store.db.shipments[0].shipDate;
T.shipQuick('all'); T.shipSet('from', d3); T.shipSet('to', d3);
ok('期間（単日）で絞り込み', T.shipFiltered().every(s => s.shipDate === d3) && T.shipFiltered().length === Store.db.shipments.filter(s => s.shipDate === d3).length);
T.shipQuick('month');
const now = new Date();
const p2 = n => String(n).padStart(2, '0');
const todayStr2 = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
ok('今月プリセットが月初〜今日', T.shipFilters().from === `${now.getFullYear()}-${p2(now.getMonth() + 1)}-01` && T.shipFilters().to === todayStr2);
T.shipQuick('all');

/* 得意先 */
const cid = Store.db.customers[1].id;
T.shipSet('customerId', cid);
ok('得意先で絞り込み', T.shipFiltered().every(s => s.customerId === cid) && T.shipFiltered().length > 0);
T.shipSet('customerId', '');

/* 営業担当者 */
const reps = Store.salesReps();
ok('営業担当者の選択肢が存在', reps.length >= 2);
const rep = reps[0];
T.shipSet('salesRepId', rep.id);
const repList = T.shipFiltered();
ok('営業担当者で絞り込み', repList.length > 0 && repList.every(s => Store.shipmentRepId(s) === rep.id));
ok('営業担当者名が解決できる', !!Store.salesRepName(Store.shipmentRepId(repList[0])));
T.shipSet('salesRepId', '');

/* 複合条件 */
T.shipSet('customerId', cid); T.shipSet('status', 'instructed'); T.shipQuick('all');
ok('複合条件（得意先＋状態）', T.shipFiltered().every(s => s.customerId === cid && s.status === 'instructed'));
T.shipReset();
ok('条件クリアで既定（今月）に戻る', T.shipFilters().from === `${now.getFullYear()}-${p2(now.getMonth() + 1)}-01` && T.shipFilters().status === 'all');

/* 金額・件数の集計 */
T.shipQuick('all');
const sum = T.shipFiltered().reduce((a, s) => a + Store.shipmentAmount(s), 0);
ok('出荷金額が算出できる', sum > 0);
const html2 = T.Views.shipHistory();
ok('合計行と件数表示', html2.indexOf('合計') >= 0 && html2.indexOf('該当') >= 0);
ok('undefined/NaN を表示しない', !/undefined|NaN/.test(html2));

/* 得意先マスタ・受注フォーム */
const cv = T.Views.customers();
ok('得意先マスタに営業担当者列', cv.indexOf('営業担当者') >= 0 && cv.indexOf(Store.salesRepName(Store.db.customers[0].salesRepId)) >= 0);
T.Actions.customerForm(Store.db.customers[0].id);
ok('得意先フォームに営業担当者', d.getElementById('c_rep') && d.getElementById('c_rep').value === Store.db.customers[0].salesRepId);
T.Actions.orderForm();
ok('受注フォームに営業担当者（既定=得意先担当）', d.getElementById('o_rep') && d.getElementById('o_rep').value === (Store.db.customers[0].salesRepId || ''));

console.log(fails ? ('NG: ' + fails) : 'ALL SHIP SEARCH TESTS PASSED');
process.exit(fails ? 1 : 0);
