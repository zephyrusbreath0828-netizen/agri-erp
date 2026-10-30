/* ログイン改修のスモークテスト（jsdom）
   検証: ①Store.db未初期化でのクラッシュ修正 ②緊急管理者ログイン ③設定ON/OFF ④既存認証の維持 */
const fs = require('fs'); const path = require('path'); const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'build', 'agri-erp.html'), 'utf8');
const bundle = html.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];

function boot() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/' });
  const w = dom.window, d = w.document;
  w.print = () => {}; w.fetch = () => Promise.reject(new Error('no network'));
  /* jsdom は WebCrypto(subtle) を実装していないため、Node の webcrypto を注入して
     ブラウザ同等の PBKDF2 照合を再現する（アプリ側の変更ではない） */
  try { Object.defineProperty(w, 'crypto', { value: require('node:crypto').webcrypto, configurable: true }); } catch (e) {}
  w.eval(bundle + '\n;window.__T={Store,Auth,Views,Actions,EMERGENCY,Audit,Security,buildSeed,UI,App};');
  return { w, d, T: w.__T };
}
let fails = 0;
const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };

(async () => {
  /* ---- ① 再現: Store.db === null のままログイン → 以前は 'loginSecurity' でクラッシュ ---- */
  let { w, d, T } = boot();
  ok('初期状態で Store.db は null（再現条件）', T.Store.db === null);
  await new Promise(res => setTimeout(res, 300));      /* boot 完了（Supabase未設定→オフライン起動） */
  ok('boot 後は Store.db が用意される（null のまま放置しない）', !!T.Store.db);
  /* 報告された不具合の再現条件を明示的に作る: Store.db === null の状態でログイン */
  T.Store.db = null;
  let r = await T.Auth.doLogin('admin', 'Temp1234!');
  ok('Store.db未初期化でも例外を投げない', !!r && r.ok === false);
  ok('未初期化時は案内メッセージ（not_ready）', r.code === 'not_ready' && r.message.indexOf('初期化') >= 0);

  /* ログイン画面の送信がクラッシュしない（エラーを表示して継続） */
  d.getElementById('loginId').value = 'admin';
  d.getElementById('loginPw').value = 'Temp1234!';
  let crashed = null;
  try { await T.Auth.onLogin(); } catch (e) { crashed = e; }
  ok('ログイン画面がクラッシュしない', crashed === null);
  ok('画面にエラーメッセージを表示', d.getElementById('loginErr').style.display === 'block' && d.getElementById('loginErr').textContent.length > 0);

  /* ---- ② 緊急管理者: データ未初期化・Supabase未接続でもログイン ---- */
  r = await T.Auth.doLogin('tom', 'zep');
  ok('緊急管理者ログイン成功（未初期化時）', r.ok === true && r.emergency === true);
  ok('権限は admin', r.user.role === 'admin');
  ok('Store.db が用意される（描画可能）', !!T.Store.db);
  ok('緊急ユーザーは users テーブルへ追加しない', !T.Store.db.users.some(u => u.loginId === 'tom'));
  ok('監査ログに emergency_login', (T.Store.db.auditLogs || []).some(a => a.action === 'emergency_login' && a.actorLoginId === 'tom'));

  /* 後始末 → 画面遷移（ダッシュボード） */
  T.Auth.showApp();
  ok('ダッシュボードへ遷移', T.App.page === 'dashboard');
  ok('appShell 表示', d.getElementById('appShell').style.display === 'block');
  ok('緊急バナー表示', d.getElementById('emgBar').style.display === 'flex');
  ok('セッションに緊急フラグ', w.sessionStorage.getItem('agri_emergency') === '1');
  T.Auth.logout();
  ok('ログアウトでバナー非表示', d.getElementById('emgBar').style.display === 'none');
  ok('ログアウトで緊急フラグ解除', w.sessionStorage.getItem('agri_emergency') === null);

  /* ---- ③ 大文字・空白でも一致（正規化） ---- */
  r = await T.Auth.doLogin('  TOM ', 'zep');
  ok('ID前後空白/大文字を正規化して緊急ログイン', r.ok === true);
  T.Auth.logout();

  /* ---- ④ 設定 OFF で無効化 ---- */
  T.Store.db.settings.emergencyAdmin = false;
  r = await T.Auth.doLogin('tom', 'zep');
  ok('設定OFFなら緊急ログイン不可', r.ok === false && r.code === 'emergency_disabled');
  r = await T.Auth.doLogin('admin', 'Temp1234!');
  ok('設定OFFでも既存ユーザー認証は維持（ローカル照合）', r.ok === true && r.user.loginId === 'admin');
  T.Auth.logout();

  /* ---- ⑤ 既存ログイン機能の維持（admin/office/shipping） ---- */
  T.Store.db.settings.emergencyAdmin = true;
  for (const lid of ['admin', 'office', 'shipping']) {
    const rr = await T.Auth.doLogin(lid, 'Temp1234!');
    ok('既存ユーザー ' + lid + ' がログイン可能', rr.ok === true && rr.user.loginId === lid);
    T.Auth.logout();
  }
  r = await T.Auth.doLogin('admin', 'wrong');
  ok('誤ったパスワードは拒否', r.ok === false && r.code === 'bad_password');
  r = await T.Auth.doLogin('nosuch', 'x');
  ok('存在しないユーザーは拒否', r.ok === false && r.code === 'no_user');
  r = await T.Auth.doLogin('', '');
  ok('空入力は案内', r.ok === false && r.code === 'empty');

  /* ---- ⑥ 設定画面トグル ---- */
  T.Auth.user = { id: 'usr001', loginId: 'admin', name: '山田 太郎', role: 'admin' };
  const vs = T.Views.settings();
  ok('設定画面に「緊急管理者ログインを有効化」', vs.indexOf('緊急管理者ログインを有効化') >= 0 && vs.indexOf('id="emgEnabled"') >= 0);
  ok('既定はチェックON', /id="emgEnabled"\s+checked/.test(vs) || vs.indexOf('id="emgEnabled" checked') >= 0);
  ok('設定画面がクラッシュしない（全カード描画）', vs.indexOf('データ管理') >= 0 && vs.indexOf('発行元（会社・拠点）') >= 0);

  /* ---- ⑦ ブート: Supabase接続失敗でも起動しログイン可能 ---- */
  ({ w, d, T } = boot());
  await new Promise(res => setTimeout(res, 300));
  ok('接続失敗でも Store.db が用意される', !!T.Store.db);
  ok('オフライン警告を表示', d.getElementById('sbWarn').style.display === 'block');
  ok('オフラインバナー表示', d.getElementById('offBar').style.display === 'flex');
  r = await T.Auth.doLogin('tom', 'zep');
  ok('接続失敗時も緊急管理者でログインできる', r.ok === true);

  console.log(fails ? ('NG: ' + fails) : 'ALL LOGIN TESTS PASSED');
  process.exit(fails ? 1 : 0);
})();
