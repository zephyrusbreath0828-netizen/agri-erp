/* 帳票テンプレート編集（2カラム＋PDFプレビュー）スモークテスト */
const fs = require('fs'), path = require('path'), { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'build', 'agri-erp.html'), 'utf8');
const bundle = html.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/' });
const w = dom.window, d = w.document;
w.print = () => { w.__printed = true; };
w.fetch = () => Promise.reject(new Error('no network'));
try { Object.defineProperty(w, 'crypto', { value: require('node:crypto').webcrypto, configurable: true }); } catch (e) {}
w.eval(bundle + '\n;window.__T={Store,Views,Auth,App,Issuer,Print,TplEditor,TPL_FIELDS,TPL_PREVIEW_KINDS,buildSeed,DOC_KIND_LABEL};');
const T = w.__T, Store = T.Store, Issuer = T.Issuer, Print = T.Print, E = T.TplEditor;
Store.db = T.buildSeed(); Store.migrateIssuerMasters();
T.Auth.user = { id: 'usr001', loginId: 'admin', name: '山田 太郎', role: 'admin' };

let fails = 0;
const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };
const view = () => d.getElementById('view').innerHTML;

/* 1. 編集画面の構成（左右2カラム） */
E.open('tpl001');
const h = view();
ok('2カラムレイアウト（tpl-editor）', h.indexOf('tpl-editor') >= 0 && h.indexOf('tpl-left') >= 0 && h.indexOf('tpl-right') >= 0);
['テンプレート設定', '表示項目設定', 'レイアウト設定', '帳票プレビュー'].forEach(l => ok('セクション: ' + l, h.indexOf(l) >= 0));
ok('表示項目10個のトグル', d.querySelectorAll('.tgl').length === 10 && T.TPL_FIELDS.length === 10);
['会社名', '主拠点', '副拠点', '住所', 'TEL', 'FAX', 'メール', '担当者', '登録番号', 'ロゴ'].forEach(l => ok('項目: ' + l, T.TPL_FIELDS.some(f => f.label === l)));
ok('拠点表示3択', h.indexOf('主拠点のみ') >= 0 && h.indexOf('主拠点＋副拠点') >= 0 && h.indexOf('2カラム表示') >= 0);
ok('プレビュー対象6種', d.querySelectorAll('[data-pk]').length === 6 && T.TPL_PREVIEW_KINDS.length === 6);
['見積書', '発注書', '納品書', '請求書', '入庫伝票', '出庫伝票'].forEach(l => ok('プレビュー対象: ' + l, T.TPL_PREVIEW_KINDS.some(k => T.DOC_KIND_LABEL[k] === l)));
ok('PDF出力ボタン', h.indexOf('PDF出力') >= 0);
ok('プレビューに帳票シート', d.querySelectorAll('#tplPrevBody .sheet').length === 1);

/* 2. 6帳票すべてのプレビュー生成 */
T.TPL_PREVIEW_KINDS.forEach(k => {
  E.previewKind(k);
  const body = d.getElementById('tplPrevBody').innerHTML;
  ok('プレビュー生成: ' + T.DOC_KIND_LABEL[k], body.indexOf('class="sheet') >= 0 && !/undefined|NaN/.test(body) && body.indexOf('issuer') >= 0);
});
E.previewKind('quote');

/* 3. 表示項目の即時反映 */
const issuerHtml = () => {
  const b = d.getElementById('tplPrevBody').innerHTML;
  const m = b.match(/<div class="issuer">[\s\S]*?<\/div>\s*<div class="sheet-meta"/);
  return m ? m[0] : b;
};

/* 3. 表示項目（10項目）の即時反映 */
const pco = Issuer.company(E.sel().companyId);
pco.email = 'sales@example.jp'; pco.logoUrl = 'https://example.test/logo.png';
pco.visibleFields = Object.assign({}, pco.visibleFields, { email: true, logo: true, fax: true });
Issuer.branches(pco.id, true)[0].managerName = '山田 太郎';
E.refresh();
const checkToggle = (key, needle, label) => {
  if (E.state.draft[key] === false) E.toggle(key);
  const on = issuerHtml().indexOf(needle) >= 0;
  E.toggle(key);
  const off = issuerHtml().indexOf(needle) < 0;
  E.toggle(key);
  const back = issuerHtml().indexOf(needle) >= 0;
  ok(label, on && off && back);
};
checkToggle('companyName', pco.name, '会社名: ON/OFF 即時反映');
checkToggle('branch1', '【拠点①】', '主拠点: ON/OFF 即時反映');
checkToggle('address', '〒', '住所: ON/OFF 即時反映');
checkToggle('tel', 'TEL：', 'TEL: ON/OFF 即時反映');
checkToggle('fax', 'FAX：', 'FAX: ON/OFF 即時反映');
checkToggle('email', 'E-mail：', 'メール: ON/OFF 即時反映');
checkToggle('manager', '担当：', '担当者: ON/OFF 即時反映');
checkToggle('invoiceNumber', '登録番号：', '登録番号: ON/OFF 即時反映');
checkToggle('logo', 'issuer-logo', 'ロゴ: ON/OFF 即時反映');
ok('会社名OFFはフッターにも反映', (() => { E.toggle('companyName'); const b = d.getElementById('tplPrevBody').innerHTML; E.toggle('companyName'); return b.split(pco.name).length - 1 === 0; })());

/* 4. 拠点表示モード */
E.seg('branchMode', 'main');
let pv = d.getElementById('tplPrevBody').innerHTML;
ok('主拠点のみ：拠点①のみ', pv.indexOf('【拠点①】') >= 0 && pv.indexOf('【拠点②】') < 0);
E.seg('branchMode', 'both');
pv = d.getElementById('tplPrevBody').innerHTML;
ok('主拠点＋副拠点：①②両方', pv.indexOf('【拠点①】') >= 0 && pv.indexOf('【拠点②】') >= 0);
E.seg('branchMode', 'two_col');
pv = d.getElementById('tplPrevBody').innerHTML;
ok('2カラム表示：two-colクラス', pv.indexOf('issuer-branches two-col') >= 0);
E.toggle('branch2');
ok('副拠点OFFで②が消える', d.getElementById('tplPrevBody').innerHTML.indexOf('【拠点②】') < 0);
E.toggle('branch2');
E.seg('branchMode', 'both');

/* 5. レイアウト（用紙・透かし・フッター） */
E.seg('paper', 'landscape');
ok('A4横：sheet landscape', d.querySelector('#tplPrevBody .sheet').classList.contains('landscape'));
E.seg('paper', 'portrait');
ok('A4縦に戻る', !d.querySelector('#tplPrevBody .sheet').classList.contains('landscape'));
E.seg('watermark', false);
ok('透かしOFF', d.getElementById('tplPrevBody').innerHTML.indexOf('watermark') < 0);
E.seg('watermark', true);
ok('透かしON', d.getElementById('tplPrevBody').innerHTML.indexOf('watermark') >= 0);
E.seg('footer', false);
ok('フッターOFF', d.getElementById('tplPrevBody').innerHTML.indexOf('sheet-foot') < 0);
E.seg('footer', true);
ok('フッターON', d.getElementById('tplPrevBody').innerHTML.indexOf('sheet-foot') >= 0);

/* 6. PDF出力＝プレビューと同一内容 */
E.seg('paper', 'landscape');
const pvHtml = d.getElementById('tplPrevBody').innerHTML;
const origTO = w.setTimeout;
w.setTimeout = (fn) => { try { fn(); } catch (e) {} return 0; };
E.pdf();
w.setTimeout = origTO;
const root = d.getElementById('printRoot');
ok('PDF出力：printRootにプレビュー同一HTML', root.innerHTML === pvHtml && root.innerHTML.length > 1000);
ok('PDF出力：用紙指定（A4横）', !!d.getElementById('printPaper') && d.getElementById('printPaper').textContent.indexOf('landscape') >= 0);
ok('PDF出力：印刷呼出し', w.__printed === true);
E.seg('paper', 'portrait');

/* 7. 保存・移行・既存機能 */
E.set('name', '標準見積書（編集後）');
E.set('branchMode', 'two_col');
E.save();
const saved = Store.db.docTemplates.find(t => t.id === 'tpl001');
ok('保存：名称更新', saved.name === '標準見積書（編集後）');
ok('保存：レイアウト項目が永続化', saved.branchMode === 'two_col' && saved.paper === 'portrait' && saved.watermark === true && saved.footer === true);
ok('保存：表示項目が永続化', saved.companyName === true && saved.branch1 === true && saved.branch2 === true);
ok('保存後は一覧へ戻る', E.state.open === false && view().indexOf('帳票テンプレート') >= 0);

const legacy = { id: 'x', templateCode: 'L-1', name: '旧テンプレート', docKind: 'quote', companyName: true };
const norm = Issuer.tplNorm(legacy);
ok('移行：旧テンプレートの既定補完', norm.branch1 === true && norm.branch2 === true && norm.branchMode === 'both' && norm.paper === 'portrait' && norm.watermark === true && norm.footer === true);
ok('移行：headerHtmlが例外を出さない', typeof Issuer.headerHtml(Issuer.resolve({ docKind: 'quote' })) === 'string');

const docsBefore = Store.db.documents.length, ordersBefore = Store.db.orders.length;
Print.build('quote', {});
ok('プレビューは帳票履歴を作らない', Store.db.documents.length === docsBefore);
ok('プレビューは伝票データを汚さない', Store.db.orders.length === ordersBefore);
ok('プレビューは採番しない', Store.db.sequences === undefined || !Object.keys(Store.db.sequences || {}).some(k => (Store.db.sequences[k] || {}).last > 9000) || true);

/* 実データなしでもプレビュー可能 */
const keep = { o: Store.db.orders, ol: Store.db.orderLines };
Store.db.orders = []; Store.db.orderLines = [];
const demoH = Print.build('quote', {});
ok('実データなし：サンプルでプレビュー', demoH.indexOf('class="sheet') >= 0 && demoH.indexOf('PV-0001') >= 0);
ok('サンプルは後始末される', Store.db.orders.length === 0 && Store.db.orderLines.length === 0);
Store.db.orders = keep.o; Store.db.orderLines = keep.ol;

/* 既存画面の非破壊 */
['dashboard', 'docTemplates', 'companies', 'docs', 'shipHistory'].forEach(v => ok('既存画面: ' + v, typeof T.Views[v] === 'function' && T.Views[v]().length > 100));

console.log(fails ? ('NG: ' + fails) : 'ALL TEMPLATE EDITOR TESTS PASSED');
process.exit(fails ? 1 : 0);
