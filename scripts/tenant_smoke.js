/* マルチテナント（組織隔離 / 自動 organization_id / RLS定義）スモークテスト */
const fs = require('fs'), path = require('path'), { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'build', 'agri-erp.html'), 'utf8');
const bundle = html.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/' });
const w = dom.window, d = w.document;
w.print = () => {}; w.fetch = () => Promise.reject(new Error('no network'));
try { Object.defineProperty(w, 'crypto', { value: require('node:crypto').webcrypto, configurable: true }); } catch (e) {}
w.eval(bundle + '\n;window.__T={Store,Views,Auth,App,Issuer,Print,Tenant,Actions,buildSeed,TENANT_TABLES,MENU};');
const T = w.__T, Store = T.Store, Tenant = T.Tenant, Auth = T.Auth;

let fails = 0;
const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };

Store.db = T.buildSeed(); Store.migrateTenant(); Store.migrateIssuerMasters();
const admin = Store.db.users.find(u => u.loginId === 'admin');
const office = Store.db.users.find(u => u.loginId === 'office');
const afarm = Store.db.users.find(u => u.loginId === 'afarm');
Auth.user = admin; Tenant.enter(admin);

/* ---- 1. 組織マスタ ---- */
const orgs = Store.db.organizations;
ok('organizations が3件', orgs.length === 3);
ok('既定組織は SETOLAS(id=1)', orgs.find(o => Number(o.id) === 1).organizationCode === 'SETOLAS');
ok('サンプル組織 A-FARM / B-FARM', orgs.some(o => o.organizationCode === 'A-FARM') && orgs.some(o => o.organizationCode === 'B-FARM'));
ok('組織コードは必須項目', orgs.every(o => !!o.organizationCode && !!o.organizationName));

/* ---- 2. ユーザーの所属組織 ---- */
ok('admin は SETOLAS（id=1）に所属', Number(admin.organizationId) === 1);
ok('admin はシステム管理者', admin.isSystemAdmin === true);
ok('全ユーザーが組織に所属', Store.db.users.length > 0 && Store.db.users.every(u => u.organizationId != null));

/* ---- 3. 既存データの移行（Default Organization へ自動割当） ---- */
ok('既存の得意先はすべて org=1', Store.db.customers.every(c => Number(c.organizationId) === 1));
ok('既存の受注・出荷はすべて org=1', Store.db.orders.every(o => Number(o.organizationId) === 1) && Store.db.shipments.every(s => Number(s.organizationId) === 1));
ok('null の organizationId は移行で 1 になる', (() => { const c = Store.db.customers[0]; c.organizationId = null; Store.migrateTenant(); return Number(c.organizationId) === 1; })());

/* ---- 4. 画面・帳票の自動フィルタ（org=1 のユーザー） ---- */
ok('他組織の得意先が見えない', !Store.db.customers.some(c => c.name.indexOf('Ａファーム') >= 0));
ok('他組織の会社が見えない', !Store.db.companies.some(c => c.id === 'co010'));
ok('他組織の出荷が見えない', !Store.db.shipments.some(s => s.id === 'shp010'));
ok('会社マスタは自組織のみ', T.Issuer.companies(false).every(c => Number(c.organizationId) === Tenant.id()));
ok('帳票プレビューに他組織の会社名が出ない', T.Print.build('quote', {}).indexOf('Ａファーム') < 0);
ok('帳票プレビューに自組織の会社名が出る', T.Print.build('quote', {}).indexOf('みどりファーム') >= 0);
ok('他組織の会社は解決できない', T.Issuer.company('co010') === null);

/* ---- 5. 登録時の organization_id 自動付与 ---- */
const nc = { id: 'nw_cust', code: 'NW1', name: '新規得意先テスト', active: true };
Store.db.customers.push(nc);
Store.save();
ok('新規得意先に organization_id が自動セット', Number(nc.organizationId) === 1);
const no = { id: 'nw_ord', orderNo: 'NW-1', orderDate: '2026-10-30', status: 'received', total: 0, customerId: 'nw_cust', customerName: '新規得意先テスト' };
Store.db.orders.push(no); Store.save();
ok('新規受注に organization_id が自動セット', Number(no.organizationId) === 1);
ok('採番キーは組織別', (() => { Store._dryRun = false; const n = Store.nextNo('TST', '2026-10-30'); return n.indexOf('o1:') === 0 && /TST-20261030-0001$/.test(n); })());

/* ---- 6. 組織マスタ管理（システム管理者のみ） ---- */
ok('システム管理者は組織マスタを開ける', Auth.can('organizations') === true);
const ov = T.Views.organizations();
ok('組織マスタ画面に3組織', ov.indexOf('SETOLAS') >= 0 && ov.indexOf('A-FARM') >= 0 && ov.indexOf('B-FARM') >= 0);
T.Actions.organizationForm('');
d.getElementById('o_code').value = 'C-FARM';
d.getElementById('o_name').value = 'Ｃファーム';
T.Actions.saveOrganization('');
ok('組織の追加', Store.db.organizations.length === 4 && Store.db.organizations.some(o => o.organizationCode === 'C-FARM'));
ok('組織コードの重複は拒否', (() => { T.Actions.organizationForm(''); d.getElementById('o_code').value = 'C-FARM'; d.getElementById('o_name').value = '重複'; T.Actions.saveOrganization(''); return Store.db.organizations.filter(o => o.organizationCode === 'C-FARM').length === 1; })());
T.Actions.toggleOrganization(3);
ok('組織の停止', Store.db.organizations.find(o => Number(o.id) === 3).isActive === false);
T.Actions.toggleOrganization(1);
ok('ログイン中の組織は停止できない', Store.db.organizations.find(o => Number(o.id) === 1).isActive !== false);
T.Actions.organizationForm(4);
d.getElementById('o_name').value = 'Ｃファーム（改）';
T.Actions.saveOrganization('4');
ok('組織の編集', Store.db.organizations.find(o => Number(o.id) === 4).organizationName === 'Ｃファーム（改）');

/* ---- 7. 非システム管理者の制限 ---- */
Auth.user = office; Tenant.enter(office);
ok('一般管理者は組織マスタを開けない', Auth.can('organizations') === false);
ok('画面も権限エラー表示', T.Views.organizations().indexOf('権限がありません') >= 0);
ok('一般管理者の新規ユーザーは自組織固定', (() => {
  T.Actions.userForm('');
  d.getElementById('u_login').value = 'newbie';
  d.getElementById('u_name').value = '新人 太郎';
  T.Actions.saveUser('');
  const nu = Store.db.users.find(u => u.loginId === 'newbie');
  return !!nu && Number(nu.organizationId) === 1;
})());

/* ---- 8. 組織を切り替えると別テナントのデータだけになる ---- */
Auth.user = afarm; Tenant.enter(afarm);
ok('A-FARM ユーザーの組織は 2', Tenant.id() === 2);
ok('A-FARM の得意先だけが見える', Store.db.customers.length > 0 && Store.db.customers.every(c => Number(c.organizationId) === 2));
ok('SETOLAS の得意先が見えない', !Store.db.customers.some(c => c.name.indexOf('みどり') >= 0));
ok('会社マスタも A-FARM のみ', T.Issuer.companies(false).every(c => c.id === 'co010'));
ok('帳票に A-FARM の会社名が出る', T.Print.build('quote', {}).indexOf('Ａファーム株式会社') >= 0);
ok('帳票に SETOLAS の会社名が出ない', T.Print.build('quote', {}).indexOf('みどりファーム') < 0);
ok('出荷検索も自組織のみ', Store.db.shipments.every(s => Number(s.organizationId) === 2));

/* ---- 9. ユーザー画面・フォーム ---- */
Auth.user = admin; Tenant.enter(admin);
ok('ユーザー一覧に組織列', T.Views.users().indexOf('<th>組織</th>') >= 0 && T.Views.users().indexOf('SETOLAS') >= 0);
ok('ユーザーフォームに所属組織', T.Actions.userForm('') === undefined && (T.Actions.userForm(''), d.body.innerHTML.indexOf('所属組織') >= 0));

/* ---- 10. SQL（RLS・移行）定義 ---- */
const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '08_multi_tenant.sql'), 'utf8');
ok('organizations テーブル定義', sql.indexOf('create table if not exists organizations') >= 0);
ok('既定組織 SETOLAS=1 を投入', /\(1,\s*'SETOLAS'/.test(sql));
ok('既存データを 1 へ移行', sql.indexOf('set organization_id = 1 where organization_id is null') >= 0);
const tables = ['users','companies','branches','doc_templates','customers','suppliers','items','orders','order_lines',
  'purchase_orders','purchase_order_lines','receipts','receipt_lines','shipments','shipment_lines','stock_movements','documents','number_sequences','audit_logs'];
ok('RLS を全業務テーブルで有効化', tables.every(t => sql.indexOf("'" + t + "'") >= 0));
ok('RLS テナント分離ポリシー', sql.indexOf('create policy tenant_isolation') >= 0 && sql.indexOf('organization_id = public.current_org_id()') >= 0);
ok('with check で越境書込も遮断', sql.indexOf('with check (organization_id = public.current_org_id())') >= 0);
ok('セッショントークン認可（x-app-token）', sql.indexOf('x-app-token') >= 0 && sql.indexOf('app_sessions') >= 0);
ok('ログインRPC app_login', sql.indexOf('function public.app_login') >= 0);
ok('登録時自動付与トリガ', sql.indexOf('function public.tenant_stamp') >= 0 && sql.indexOf('trg_%s_stamp') >= 0);
ok('組織ID変更の禁止トリガ', sql.indexOf('function public.tenant_guard') >= 0);
ok('組織はシステム管理者のみ編集', sql.indexOf('public.is_system_admin()') >= 0);
ok('組織→会社→拠点の整合性トリガ', sql.indexOf('branch_same_org') >= 0);

console.log(fails ? ('NG: ' + fails) : 'ALL TENANT TESTS PASSED');
process.exit(fails ? 1 : 0);
