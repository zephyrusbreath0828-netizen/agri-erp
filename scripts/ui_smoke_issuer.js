/* UI/帳票スモークテスト（jsdom）: 会社・拠点マスタ／帳票テンプレート／発行元表示の検証
   実行: npm install jsdom && node scripts/ui_smoke_issuer.js */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'build', 'agri-erp.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.test/' });
const w = dom.window, d = w.document;
w.print = () => {};
w.fetch = () => Promise.reject(new Error('no network in test'));
if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });

const m = html.match(/<script>\n([\s\S]*?)\n<\/script>/);
if (!m) { console.error('FAIL inline bundle not found'); process.exit(1); }
w.eval(m[1] + '\n;window.__T = { Store, Views, Issuer, IssuerAdmin, Print, buildSeed, Actions, Auth, UI, DOC_KIND_LABEL };');
const T = w.__T, Store = T.Store, Views = T.Views, Issuer = T.Issuer, Print = T.Print;

Store.db = T.buildSeed();
Store.migrateIssuerMasters();
T.Auth.user = { id: 'usr001', loginId: 'admin', name: '山田 太郎', role: 'admin' };

let fails = 0;
const ok = (name, cond) => { if (cond) console.log('PASS ' + name); else { fails++; console.log('FAIL ' + name); } };
const has = (s, x) => String(s).indexOf(x) >= 0;

/* ---- マスタ ---- */
ok('会社マスタが5社', Store.db.companies.length === 5);
ok('拠点マスタが7拠点', Store.db.branches.length === 7);
ok('テンプレート9件', Store.db.docTemplates.length === 9);
ok('会社ビュー: グループ会社名', has(Views.companies(), 'セトラスホールディングス株式会社'));
ok('会社ビュー: 拠点名', has(Views.companies(), '高松事業所'));
ok('テンプレートビュー: 標準見積書', has(Views.docTemplates(), '標準見積書'));
ok('テンプレートビュー: 簡易発注書', has(Views.docTemplates(), '簡易発注書'));
ok('設定ビュー: 発行元カード', has(Views.settings(), '発行元（会社・拠点）'));
ok('設定ビュー: 旧・自社情報フォーム廃止', !has(Views.settings(), 'id="coName"'));

const docsHtml = Views.docs();
['納品書', '出庫伝票', 'ピッキング', '見積書', '請求書', '発注書', '入庫伝票'].forEach(l => ok('帳票発行タブ: ' + l, has(docsHtml, l)));
ok('帳票発行ビューに undefined が無い', !has(docsHtml, 'undefined'));

/* ---- 表示制御（テンプレート×マスタ） ---- */
const co2 = Issuer.company('co002');
const customCo = Object.assign({}, co2, { visibleFields: { address: true, tel: false, fax: true, email: true, invoiceNumber: true, logo: false } });
const h1 = Issuer.headerHtml({ company: customCo, branch1: Issuer.branch('br002'), branch2: Issuer.branch('br003'), template: null });
const h1co = Issuer.headerHtml({ company: customCo, branch1: null, branch2: null, template: null });
ok('会社TEL非表示が反映される', !has(h1co, 'TEL：'));
ok('拠点TELは独立して表示される', has(h1, 'TEL：'));
ok('メール表示が反映される', has(h1, 'E-mail：'));
ok('空のメール行を出力しない（拠点②にメール無し）', (h1.match(/E-mail：/g) || []).length === 1);
ok('空の span を出力しない', !/<span class="il"><\/span>/.test(h1));
ok('ロゴ未設定なら img を出力しない', !has(h1, '<img'));

const tplSimple = Issuer.template('tpl002');
const h2 = Issuer.headerHtml({ company: co2, branch1: Issuer.branch('br002'), branch2: null, template: tplSimple });
ok('簡易見積テンプレート: 会社名を表示', has(h2, 'セトラスホールディングス株式会社'));
ok('簡易見積テンプレート: 拠点名を表示', has(h2, '高松事業所'));
ok('簡易見積テンプレート: 住所を非表示', !has(h2, '香川県'));
ok('簡易見積テンプレート: 登録番号を非表示', !has(h2, '登録番号'));
ok('拠点②未選択なら【拠点②】を出さない', !has(h2, '【拠点②】'));

/* ---- カスケード（会社→拠点） ---- */
d.getElementById('modal').innerHTML = '<div>' + Issuer.pickerHtml('t', { companyId: 'co002', branch1Id: 'br002' }, { docKind: 'quote' }) + '</div>';
Issuer.onCompanyChange('t', 'co003');
const opts1 = Array.from(d.querySelectorAll('#t_b1 option')).map(o => o.value);
const opts2 = Array.from(d.querySelectorAll('#t_b2 option')).map(o => o.value);
ok('会社変更で拠点①が絞り込まれる', opts1.indexOf('br004') >= 0 && opts1.indexOf('br005') >= 0 && opts1.indexOf('br002') < 0);
ok('拠点②は拠点①を除外', opts2.indexOf('br005') >= 0 && opts2.indexOf('br004') < 0);
d.getElementById('t_co').value = 'co003';
d.getElementById('t_b1').value = 'br004';
d.getElementById('t_b2').value = '';
ok('発行会社必須の検証', Issuer.validate('t') === null);
d.getElementById('t_co').value = '';
ok('未選択ならエラー', Issuer.validate('t') !== null);

/* ---- 帳票（見積書・納品書） ---- */
const o = Store.order('ord001');
o.companyId = 'co002'; o.branch1Id = 'br002'; o.branch2Id = 'br003';
Print.quote('ord001');
let out = d.getElementById('printRoot').innerHTML;
ok('見積書: タイトル', has(out, '見 積 書'));
ok('見積書: 発行会社', has(out, 'セトラスホールディングス株式会社'));
ok('見積書: 拠点①', has(out, '【拠点①】高松事業所'));
ok('見積書: 拠点②', has(out, '【拠点②】神山農場'));
ok('見積書: 未定義値なし', !has(out, 'undefined') && !has(out, 'NaN'));
const qdoc = Store.db.documents[0];
ok('帳票履歴に発行会社を保存', qdoc.companyId === 'co002' && qdoc.branch1Id === 'br002' && qdoc.branch2Id === 'br003');
ok('帳票履歴にテンプレートを保存', !!qdoc.templateId);

const ship = Store.db.shipments.find(s => s.status === 'confirmed');
Print.delivery(ship.id);
out = d.getElementById('printRoot').innerHTML;
ok('納品書: 既定会社へフォールバック（旧データ）', has(out, '株式会社 みどりファーム'));
ok('納品書: 未定義値なし', !has(out, 'undefined') && !has(out, 'NaN'));

const po = Store.db.purchaseOrders[0];
po.companyId = 'co003'; po.branch1Id = 'br004';
Print.purchaseOrder(po.id);
out = d.getElementById('printRoot').innerHTML;
ok('発注書: 発行会社', has(out, '○○農産株式会社'));
ok('発注書: 拠点', has(out, '【拠点①】本社'));

const rcp = Store.db.receipts[0];
rcp.companyId = 'co004'; rcp.branch1Id = 'br006';
Print.receiptNote(rcp.id);
out = d.getElementById('printRoot').innerHTML;
ok('入庫伝票: 発行会社', has(out, '○○ファーム株式会社'));
ok('入庫伝票: はみ出しなし', !has(out, 'undefined'));

/* ---- 発行会社の保存（フォーム） ---- */
ok('Issuer.defaultSel が会社を返す', !!Issuer.defaultSel().companyId);

console.log(fails ? ('NG: ' + fails + ' failures') : 'ALL UI TESTS PASSED');
process.exit(fails ? 1 : 0);
