/* スモークテスト: Supabase(PostgREST) モックサーバーに対して SB アダプタと Store の差分同期を検証する */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

/* ---------------- PostgREST モック ---------------- */
const tables = {};                     // { t: { id: row } }
const pwStore = { admin: 'Temp1234!', office: 'Temp1234!', shipping: 'Temp1234!' };
let tSeq = 0;
function col(rows, pk) { return pk; }
function upsert(t, rows) {
  const pk = t === 'number_sequences' ? 'seq_key' : (t === 'app_settings' ? 'key' : 'id');
  tables[t] = tables[t] || {};
  for (const r of rows) tables[t][r[pk]] = Object.assign({}, tables[t][r[pk]] || {}, r);
  return null;
}
function mockFetch(url, opt) {
  opt = opt || {};
  /* Supabase実機と同じ検査: GETを含む全リクエストに apikey/Authorization が必須 */
  const hd = opt.headers || {};
  if (!hd.apikey || !hd.Authorization || hd.Authorization !== 'Bearer ' + hd.apikey || hd.apikey !== 'MOCKKEY') {
    return jres({ message: 'No API key found in request' }, 401);
  }
  const u = new URL(url);
  const t = u.pathname.replace(/^\/rest\/v1\//, '');
  const method = opt.method || 'GET';
  if (method === 'POST' && t.startsWith('rpc/')) {
    const fn = t.slice(4);
    const body = JSON.parse(opt.body || '{}');
    if (fn === 'app_verify_login') {
      const lid = String(body.p_login_id || '').trim().toLowerCase();
      if (!pwStore[lid]) return jres({ ok: false, code: 'no_user' });
      if (pwStore[lid] !== body.p_password) return jres({ ok: false, code: 'bad_password' });
      const user = Object.values(tables.users || {}).find(x => x.login_id === lid);
      if (!user) return jres({ ok: false, code: 'no_user' });
      const copy = Object.assign({}, user); delete copy.password_hash;
      return jres({ ok: true, user: copy });
    }
    if (fn === 'app_set_password') {
      const lid = String(body.p_login_id || '').trim().toLowerCase();
      if (!Object.values(tables.users || {}).some(x => x.login_id === lid)) return jres(false);
      pwStore[lid] = body.p_new;
      Object.values(tables.users).forEach(x => { if (x.login_id === lid) x.force_password_change = !!body.p_force_change; });
      return jres(true);
    }
    throw new Error('unknown rpc ' + fn);
  }
  if (method === 'GET') {
    if (t.startsWith('rpc/')) {
      const fn = t.slice(4);
      const body = JSON.parse(opt.body || '{}');
      if (fn === 'app_verify_login') {
        const lid = String(body.p_login_id || '').trim().toLowerCase();
        if (!pwStore[lid]) return jres({ ok: false, code: 'no_user' });
        if (pwStore[lid] !== body.p_password) return jres({ ok: false, code: 'bad_password' });
        const user = Object.values(tables.users || {}).find(x => x.login_id === lid);
        if (!user) return jres({ ok: false, code: 'no_user' });
        const copy = Object.assign({}, user); delete copy.password_hash;
        return jres({ ok: true, user: copy });
      }
      if (fn === 'app_set_password') {
        const lid = String(body.p_login_id || '').trim().toLowerCase();
        if (!Object.values(tables.users || {}).some(x => x.login_id === lid)) return jres(false);
        pwStore[lid] = body.p_new;
        Object.values(tables.users).forEach(x => { if (x.login_id === lid) x.force_password_change = !!body.p_force_change; });
        return jres(true);
      }
      throw new Error('unknown rpc ' + fn);
    }
    const name = t.split('?')[0];
    return jres(Object.values(tables[name] || {}));
  }
  if (method === 'POST') {
    const name = t.split('?')[0];
    if (name.startsWith('rpc/')) throw new Error('unreachable');
    upsert(name, JSON.parse(opt.body));
    return jres(null, 201);
  }
  if (method === 'DELETE') {
    const name = t.split('?')[0];
    const q = u.searchParams.get('id') || '';
    tables[name] = tables[name] || {};
    const m = q.match(/^in\.\((.*)\)$/);
    if (m) {
      const ids = m[1].split(',').map(s => s.replace(/^"|"$/g, ''));
      ids.forEach(id => delete tables[name][id]);
    } else if (q === 'not.is.null') {
      tables[name] = {};
    }
    return jres(null);
  }
  throw new Error('unsupported ' + method);
}
function jres(body, status) {
  return { ok: (status || 200) < 400, status: status || 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body), json: async () => body };
}

/* ---------------- サンドボックス ---------------- */
function makeSession() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
const session = makeSession();
session.setItem('agri_sb_cfg', JSON.stringify({ url: 'https://mock.supabase.co', key: 'MOCKKEY' }));
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: (u, o) => Promise.resolve(mockFetch(u, o)),
  URLSearchParams, URL, sessionStorage: session,
  location: { search: '', reload: () => { throw new Error('reload called'); } },
  window: {},
  document: { getElementById: () => null },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
function run(file) {
  vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8') +
    "\n;globalThis.__X = Object.assign(globalThis.__X || {}, { SB: (typeof SB !== 'undefined') ? SB : undefined, Store: (typeof Store !== 'undefined') ? Store : undefined, buildSeed: (typeof buildSeed !== 'undefined') ? buildSeed : undefined });",
    sandbox, { filename: file });
}
run('01-store.js');
run('00-supabase.js');
sandbox.SB = sandbox.__X.SB; sandbox.Store = sandbox.__X.Store; sandbox.buildSeed = sandbox.__X.buildSeed;

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const ok = (cond, name) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name); if (!cond) failed++; };

(async () => {
  /* 1. 初期化: 空DB → デモシード生成 → 初回投入 */
  const r = await sandbox.SB.init();
  ok(r.ok === true, 'init ok');
  const db = sandbox.Store.db;
  ok(tables.users && Object.keys(tables.users).length === 3, 'users seeded 3, got ' + (tables.users ? Object.keys(tables.users).length : 0));
  ok(Object.keys(tables.items || {}).length === 25, 'items seeded 25, got ' + Object.keys(tables.items || {}).length);
  ok(Object.keys(tables.customers || {}).length === 5, 'customers seeded 5');
  ok(Object.keys(tables.suppliers || {}).length === 4, 'suppliers seeded 4');
  ok(Object.keys(tables.orders || {}).length === 8, 'orders seeded 8, got ' + Object.keys(tables.orders || {}).length);
  ok(Object.keys(tables.order_lines || {}).length > 0, 'order_lines seeded');
  ok(Object.keys(tables.shipments || {}).length === 6, 'shipments seeded 6, got ' + Object.keys(tables.shipments || {}).length);
  ok(Object.keys(tables.purchase_orders || {}).length === 6, 'purchase_orders seeded 6');
  ok(Object.keys(tables.stock_movements || {}).length > 0, 'movements seeded');
  ok(db.settings.company.name === '株式会社 みどりファーム', 'settings loaded');

  /* 2. ローカル変更 → 差分同期（追加・更新・削除） */
  db.customers.push({ id: 'cus099', code: 'C099', name: 'テスト得意先', kana: '', tel: '', address: '', closingDay: 31, paymentTerms: '翌月末', email: '', contact: '', active: true, notes: '' });
  db.items[0].stock = 99.5;
  db.shipments.splice(0, 1);   // 先頭削除
  await sandbox.SB.syncNow();
  ok(tables.customers.cus099 && tables.customers.cus099.name === 'テスト得意先', 'customer inserted');
  ok(+tables.items.itm001.stock === 99.5, 'item stock updated, got ' + tables.items.itm001.stock);
  ok(!tables.shipments.shp001, 'shipment deleted');
  ok(Object.keys(tables.shipment_lines).every(id => !id.startsWith('shp001')), 'orphan shipment line removed (child-first)');

  /* 3. requestSync（デバウンス0.8秒） */
  db.customers[0].tel = '0120-999-9999';
  sandbox.Store.save();
  await sleep(1100);
  ok(tables.customers.cus001.tel === '0120-999-9999', 'debounced sync applied');

  /* 4. リモート変更の取り込み（他ユーザー） */
  upsert('items', [{ id: 'itm002', stock: 55.25 }]);
  await sandbox.SB.refreshAll();
  ok(+db.items.find(i => i.id === 'itm002').stock === 55.25, 'remote change merged into Store.db');

  /* 5. リモート削除の取り込み */
  delete tables.customers.cus099;
  await sandbox.SB.refreshAll();
  ok(!db.customers.some(c => c.id === 'cus099'), 'remote delete merged');

  /* 6. 認証（サーバー側照合・ハッシュ非送出） */
  const lg = await sandbox.SB.verifyLogin('admin', 'Temp1234!');
  ok(lg.ok === true && lg.user.loginId === 'admin' && lg.user.passwordHash === undefined, 'verifyLogin ok, hash not exposed');
  const bad = await sandbox.SB.verifyLogin('admin', 'wrong');
  ok(bad.ok === false, 'verifyLogin rejects wrong password');
  const none = await sandbox.SB.verifyLogin('ghost', 'x');
  ok(none.ok === false, 'verifyLogin rejects unknown user');

  /* 7. パスワード変更RPC → 再認証 */
  const sp = await sandbox.SB.setPassword('office', 'NewPass1!', true);
  ok(sp.ok === true, 'setPassword ok');
  const lg2 = await sandbox.SB.verifyLogin('office', 'NewPass1!');
  ok(lg2.ok === true && lg2.user.forcePasswordChange === true, 'new password works + force change flag');
  ok(!(await sandbox.SB.verifyLogin('office', 'Temp1234!')).ok, 'old password rejected');

  /* 8. 未送信変更の保護（pending中はリモート上書きしない） */
  db.items[1].stock = 777;
  sandbox.Store.save();
  upsert('items', [{ id: 'itm002', stock: 1 }]);
  await sandbox.SB.refreshAll();
  ok(+db.items.find(i => i.id === 'itm002').stock === 777, 'pending local edit protected from remote overwrite');

  /* 9. reseedAll（全消去→再投入） */
  await sandbox.SB.reseedAll();
  ok(Object.keys(tables.orders).length === 8, 'reseed restored 8 orders');
  ok(sandbox.Store.db.orders.length === 8, 'in-memory db reseeded');

  console.log(failed === 0 ? 'ALL SMOKE TESTS PASSED' : failed + ' TEST(S) FAILED');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('SMOKE ERROR', e); process.exit(2); });
