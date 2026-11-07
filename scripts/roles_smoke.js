/* 権限管理（system_admin / org_admin / manager / user）スモークテスト */
const fs = require('fs'), path = require('path'), { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'build', 'agri-erp.html'), 'utf8');
const bundle = html.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/' });
const w = dom.window, d = w.document;
w.print = () => {}; w.fetch = () => Promise.reject(new Error('no network'));
try { Object.defineProperty(w, 'crypto', { value: require('node:crypto').webcrypto, configurable: true }); } catch (e) {}
w.eval(bundle + '\n;window.__T={Store,Views,Auth,App,Issuer,IssuerAdmin,Print,Tenant,Role,ROLES,ROLE_KEYS,MENU,Actions,buildSeed};');
const T = w.__T, Store = T.Store, Auth = T.Auth, Tenant = T.Tenant, Role = T.Role;

let fails = 0;
const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };

Store.db = T.buildSeed(); Store.migrateTenant(); Store.migrateIssuerMasters();
const U = id => Tenant.raw('users').find(u => u.loginId === id);   /* スコープ前の全行から解決 */
const as = id => { Auth.user = U(id); Tenant.enter(Auth.user); };
const sysU = U('admin'), orgU = U('afarm'), mgrU = U('office'), usrU = U('shipping');

/* ---- 1. ロール定義 ---- */
ok('4ロールが定義されている', T.ROLE_KEYS.length === 4 && T.ROLE_KEYS.join(',') === 'system_admin,org_admin,manager,user');
ok('ROLES に4ロール', Object.keys(T.ROLES).length === 4 && !!T.ROLES.system_admin && !!T.ROLES.org_admin && !!T.ROLES.manager && !!T.ROLES.user);
ok('シード: admin は system_admin', Role.of(sysU) === 'system_admin');
ok('シード: afarm は org_admin', Role.of(orgU) === 'org_admin');
ok('シード: office は manager', Role.of(mgrU) === 'manager');
ok('シード: shipping は user', Role.of(usrU) === 'user');

/* ---- 2. 旧ロールの自動移行 ---- */
ok('旧 admin（フラグ無し）→ org_admin', Role.normalize('admin', false) === 'org_admin');
ok('旧 admin（システム管理者フラグ有）→ system_admin', Role.normalize('admin', true) === 'system_admin');
ok('旧 office / shipping → user', Role.normalize('office', false) === 'user' && Role.normalize('shipping', false) === 'user');
ok('migrateRoles が既存DBを変換', (() => {
  const db = T.buildSeed();
  db.users.push({ id: 'x1', loginId: 'legacy1', name: '旧管理者', role: 'admin', enabled: true, organizationId: 1 });
  db.users.push({ id: 'x2', loginId: 'legacy2', name: '旧事務', role: 'office', enabled: true, organizationId: 1 });
  Store.db = db; Store.migrateRoles(); Store.migrateTenant();
  return db.users.find(u => u.id === 'x1').role === 'org_admin' && db.users.find(u => u.id === 'x2').role === 'user';
})());
Store.db = T.buildSeed(); Store.migrateTenant(); Store.migrateIssuerMasters();

/* ---- 3. system_admin の権限 ---- */
as('admin');
ok('system_admin: 組織マスタにアクセス可', Auth.can('organizations') === true);
ok('system_admin: システム設定にアクセス可', Auth.can('settings') === true);
ok('system_admin: ユーザー管理にアクセス可', Auth.can('users') === true);
ok('system_admin: 会社・拠点マスタにアクセス可', Auth.can('companies') === true && Auth.can('docTemplates') === true);
ok('system_admin: 全組織を閲覧可', Role.canViewAllOrgs(Auth.user) === true);
ok('system_admin: 全ユーザーを閲覧（組織横断）', (() => { const v = T.Views.users(); return v.indexOf('afarm') >= 0 && v.indexOf('SETOLAS') >= 0 && v.indexOf('A-FARM') >= 0; })());
ok('system_admin: 組織マスタに全組織の件数', (() => { const v = T.Views.organizations(); return v.indexOf('A-FARM') >= 0 && v.indexOf('Ｂ') < 0 || v.indexOf('B-FARM') >= 0; })());
ok('system_admin: 全ロールを付与可能', Role.assignable(Auth.user).length === 4);

/* ---- 4. org_admin の権限 ---- */
as('afarm');
ok('org_admin: 自組織の会社・拠点マスタ可', Auth.can('companies') === true && Auth.can('docTemplates') === true);
ok('org_admin: 自組織のユーザー管理可', Auth.can('users') === true);
ok('org_admin: 組織マスタは不可', Auth.can('organizations') === false);
ok('org_admin: システム設定は不可', Auth.can('settings') === false);
ok('org_admin: メニューに組織マスタが出ない', (() => { const nav = d.getElementById('nav'); Auth.showApp(); return nav && nav.innerHTML.indexOf('組織マスタ') < 0 && nav.innerHTML.indexOf('システム設定') < 0; })());
ok('org_admin: 組織マスタ画面は権限エラー', T.Views.organizations().indexOf('権限がありません') >= 0);
ok('org_admin: ユーザー一覧は自組織のみ', (() => { const v = T.Views.users(); return v.indexOf('afarm') >= 0 && v.indexOf('admin@agri-erp.local') < 0; })());
ok('org_admin: 他組織ユーザーは表示されない', Store.db.users.every(u => Number(u.organizationId) === 2));
ok('org_admin: system_admin は付与不可', Role.canAssign(Auth.user, 'system_admin') === false && Role.canAssign(Auth.user, 'org_admin') === false);
ok('org_admin: manager / user は付与可', Role.canAssign(Auth.user, 'manager') === true && Role.canAssign(Auth.user, 'user') === true);

/* ---- 5. manager / user ---- */
as('office');
ok('manager: 業務画面は利用可', ['dashboard', 'orders', 'shipping', 'docs', 'inventory', 'shipHistory'].every(p => Auth.can(p)));
ok('manager: マスタ管理は不可', Auth.can('companies') === false && Auth.can('docTemplates') === false);
ok('manager: ユーザー管理・組織マスタ・システム設定は不可', !Auth.can('users') && !Auth.can('organizations') && !Auth.can('settings'));
as('shipping');
ok('user: 業務画面は利用可', ['dashboard', 'orders', 'shipping', 'docs'].every(p => Auth.can(p)));
ok('user: マスタ管理・ユーザー管理は不可', !Auth.can('customers') && !Auth.can('users') && !Auth.can('companies'));
ok('user: 組織マスタ・システム設定は不可', !Auth.can('organizations') && !Auth.can('settings'));

/* ---- 6. Actions のガード ---- */
as('afarm');
T.Actions.organizationForm('');
ok('org_admin: 組織登録フォームは開かない', d.getElementById('modal').innerHTML.indexOf('組織コード') < 0);
ok('org_admin: 組織マスタの保存は拒否', (() => {
  const before = Store.db.organizations.length;
  T.Actions.saveOrganization('');
  return Store.db.organizations.length === before;
})());
as('shipping');
d.getElementById('modal').innerHTML = '';
T.Actions.userForm('');
ok('user: ユーザー登録フォームは開かない', d.getElementById('modal').innerHTML.indexOf('u_login') < 0);
ok('user: マスタ管理アクションは拒否', (() => { d.getElementById('modal').innerHTML = ''; T.IssuerAdmin.companyForm(''); return d.getElementById('modal').innerHTML.indexOf('co_code') < 0; })());

/* ---- 7. ユーザー登録・変更時のロール制約 ---- */
as('afarm');
T.Actions.userForm('');
ok('org_admin: フォームのロール選択肢は manager/user のみ', (() => {
  const sel = d.getElementById('u_role');
  const vals = Array.from(sel.options).map(o => o.value);
  return vals.length === 2 && vals.indexOf('manager') >= 0 && vals.indexOf('user') >= 0;
})());
d.getElementById('u_login').value = 'afarm2'; d.getElementById('u_name').value = '新人 次郎';
d.getElementById('u_role').value = 'user';
T.Actions.saveUser('');
ok('org_admin: 自組織ユーザーを登録できる', (() => { const u = Store.db.users.find(x => x.loginId === 'afarm2'); return !!u && Number(u.organizationId) === 2; })());
ok('org_admin: system_admin へ昇格は拒否', (() => {
  const target = Store.db.users.find(x => x.loginId === 'afarm2');
  T.Actions.userForm(target.id);
  const sel = d.getElementById('u_role');
  sel.value = 'system_admin';
  T.Actions.saveUser(target.id);
  return Store.user(target.id).role !== 'system_admin';
})());
as('admin');
ok('system_admin: 任意組織のユーザーを編集できる', (() => {
  const u = Store.db.users.find(x => x.loginId === 'afarm2');
  T.Actions.userForm(u.id);
  d.getElementById('u_role').value = 'manager';
  d.getElementById('u_org').value = '2';
  T.Actions.saveUser(u.id);
  return Role.of(Store.user(u.id)) === 'manager';
})());

/* ---- 8. RLS / SQL ---- */
const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '09_roles_permissions.sql'), 'utf8');
ok('SQL: 旧ロール移行', sql.indexOf("role in ('admin', 'office', 'shipping')") >= 0);
ok('SQL: 4ロールの値域制約', sql.indexOf("check (role in ('system_admin', 'org_admin', 'manager', 'user'))") >= 0);
ok('SQL: system_admin 判定関数', sql.indexOf('function public.is_system_admin()') >= 0 && sql.indexOf("u.role = 'system_admin'") >= 0);
ok('SQL: 組織管理者判定', sql.indexOf('function public.is_org_admin()') >= 0);
ok('SQL: RLS は organization_id で制御', sql.indexOf('organization_id = public.current_org_id()') >= 0);
ok('SQL: system_admin は全組織閲覧', /is_system_admin\(\)\s*or\s*organization_id/.test(sql));
ok('SQL: with check で越境書込も拒否', sql.indexOf('with check (public.is_system_admin() or organization_id = public.current_org_id())') >= 0);
ok('SQL: 組織マスタは system_admin のみ変更', sql.indexOf('public.is_system_admin()') >= 0 && sql.indexOf('organizations_insert') >= 0);
ok('SQL: ロール昇格の禁止トリガ', sql.indexOf('function public.role_guard()') >= 0);
ok('SQL: app_login が role を返す', sql.indexOf("'role', u.role") >= 0);

/* ---- 9. 既存画面の非破壊 ---- */
as('admin');
['dashboard', 'docTemplates', 'companies', 'docs', 'shipHistory', 'inventory', 'orders', 'users', 'settings', 'organizations'].forEach(v => {
  ok('既存画面が描画: ' + v, typeof T.Views[v] === 'function' && T.Views[v]().length > 100);
});

console.log(fails ? ('NG: ' + fails) : 'ALL ROLE TESTS PASSED');
process.exit(fails ? 1 : 0);
