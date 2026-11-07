/* Supabase 接続方式（環境変数・ソース非記載・オフラインfallback）スモークテスト */
const fs = require('fs'), path = require('path'), { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..');
const { execFileSync } = require('child_process');
/* 事前に接続情報なしで再生成（テストの再現性を確保） */
const CLEAN_ENV = Object.assign({}, process.env);
delete CLEAN_ENV.NEXT_PUBLIC_SUPABASE_URL; delete CLEAN_ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY;
delete CLEAN_ENV.SUPABASE_URL; delete CLEAN_ENV.SUPABASE_ANON_KEY;
execFileSync('python3', [path.join(ROOT, 'build', 'assemble.py')], { cwd: ROOT, env: CLEAN_ENV, stdio: 'pipe' });
const html0 = fs.readFileSync(path.join(ROOT, 'build', 'agri-erp.html'), 'utf8');
const bundle = html0.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];

let fails = 0;
const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };

/* 1. ソース・バンドルに接続情報が無い */
const src = fs.readdirSync(path.join(ROOT, 'src')).map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n');
ok('ソースに FIXED_URL / FIXED_KEY が無い', src.indexOf('FIXED_URL') < 0 && src.indexOf('FIXED_KEY') < 0);
ok('プレースホルダ文字列が無い', src.indexOf('SUPABASE_PROJECT_URL_HERE') < 0 && src.indexOf('SUPABASE_ANON_KEY_HERE') < 0);
ok('バンドルにも焼き込みが無い', bundle.indexOf('SUPABASE_PROJECT_URL_HERE') < 0 && bundle.indexOf('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9') < 0);
ok('環境変数名を参照している', bundle.indexOf('NEXT_PUBLIC_SUPABASE_URL') >= 0 && bundle.indexOf('NEXT_PUBLIC_SUPABASE_ANON_KEY') >= 0);
ok('Vercel用 /api/config を参照', bundle.indexOf('api/config') >= 0);
ok('meta タグで設定可能', /agri-supabase-url/.test(html0) && /agri-supabase-anon-key/.test(html0));
ok('localStorage を使用しない', !/localStorage\.|localStorage\[/.test(bundle));

function mk(winPatch) {
  const dom = new JSDOM(html0, { runScripts: 'outside-only', url: 'https://example.test/' });
  const w = dom.window, d = w.document;
  w.print = () => {};
  w.fetch = () => Promise.reject(new Error('offline'));
  try { Object.defineProperty(w, 'crypto', { value: require('node:crypto').webcrypto, configurable: true }); } catch (e) {}
  if (winPatch) winPatch(w, d);
  w.eval(bundle + '\n;window.__T={SB,Store,Auth,Tenant,Role,App,Views,Actions,buildSeed};');
  return { w, d, T: w.__T };
}
const JWT_HDR = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
const URL_MARK = 'demo1234';   /* テスト用URLの識別子（焼き込み検出用） */
const KEY = JWT_HDR + '.abcdefghijklmnopqrstuvwxyz';
const URL_OK = 'https://demo1234.supabase.co';

/* 2. 解決チェーンの優先順位 */
(async () => {
  /* ① 環境変数（ビルド時焼き込み） */
  let c = mk(w => { w.__AGRI_ENV__ = { NEXT_PUBLIC_SUPABASE_URL: URL_OK, NEXT_PUBLIC_SUPABASE_ANON_KEY: KEY }; });
  let r = await c.T.SB.discoverConfig({ skipRemote: true });
  ok('① 環境変数から解決', r && r.source === 'env' && r.url === URL_OK);

  /* ② 実行時オーバーライド（window） */
  c = mk(w => { w.__AGRI_SUPABASE__ = { url: 'https://override.supabase.co', anonKey: KEY }; });
  r = await c.T.SB.discoverConfig({ skipRemote: true });
  ok('② 実行時オーバーライド', r && r.source === 'window' && r.url === 'https://override.supabase.co');

  /* ③ meta タグ */
  c = mk((w, d) => {
    d.querySelector('meta[name="agri-supabase-url"]').setAttribute('content', 'https://meta.supabase.co');
    d.querySelector('meta[name="agri-supabase-anon-key"]').setAttribute('content', KEY);
  });
  r = await c.T.SB.discoverConfig({ skipRemote: true });
  ok('③ HTMLメタタグ', r && r.source === 'meta' && r.url === 'https://meta.supabase.co');

  /* ④ /api/config（Vercel サーバーレス関数） */
  c = mk((w) => {
    w.fetch = (u) => Promise.resolve(String(u).indexOf('api/config') >= 0
      ? { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ configured: true, supabaseUrl: 'https://api.supabase.co', supabaseAnonKey: KEY }) }
      : { ok: false, headers: { get: () => '' }, json: async () => null });
  });
  r = await c.T.SB.discoverConfig();
  ok('④ /api/config から解決（Vercel環境変数）', r && r.source === 'api' && r.url === 'https://api.supabase.co');

  /* ⑤ supabase.config.json（非Vercel） */
  c = mk((w) => {
    w.fetch = (u) => Promise.resolve(String(u).indexOf('supabase.config.json') >= 0
      ? { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ supabaseUrl: 'https://json.supabase.co', supabaseAnonKey: KEY }) }
      : { ok: false, headers: { get: () => '' }, json: async () => null });
  });
  r = await c.T.SB.discoverConfig();
  ok('⑤ supabase.config.json から解決', r && r.source === 'json' && r.url === 'https://json.supabase.co');

  /* ⑥ セッション暫定設定 */
  c = mk(w => { w.sessionStorage.setItem('agri_sb_cfg', JSON.stringify({ url: 'https://sess.supabase.co', key: KEY })); });
  r = await c.T.SB.discoverConfig({ skipRemote: true });
  ok('⑥ セッション暫定設定', r && r.source === 'session' && r.url === 'https://sess.supabase.co');

  /* プレースホルダ・短すぎるキーは無効 */
  c = mk(w => { w.__AGRI_ENV__ = { NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'SUPABASE_ANON_KEY_HERE' }; });
  r = await c.T.SB.discoverConfig({ skipRemote: true });
  ok('プレースホルダのキーは無効として扱う', r === null);

  /* 3. 未設定ならオフラインfallback */
  c = mk();
  r = await c.T.SB.discoverConfig({ skipRemote: true });
  ok('未設定は null（オフライン）', r === null);
  const initRes = await c.T.SB.init({ skipRemote: true });
  ok('init は reason=config を返す', initRes.ok === false && initRes.reason === 'config');
  ok('未設定メッセージに環境変数名を含む', initRes.message.indexOf('NEXT_PUBLIC_SUPABASE_URL') >= 0 && initRes.message.indexOf('NEXT_PUBLIC_SUPABASE_ANON_KEY') >= 0);
  ok('configInfo は未設定を返す', c.T.SB.configInfo().configured === false);
  /* オフラインでもアプリが動作（Store.load + 各画面描画） */
  c.T.Store.load({ offline: true });
  c.T.Auth.user = c.T.Store.db.users.find(u => u.loginId === 'admin');
  c.T.Tenant.enter(c.T.Auth.user);
  ok('オフラインでデータ初期化', c.T.Store.db.items.length > 0);
  ['dashboard', 'orders', 'shipping', 'docs', 'settings'].forEach(v => ok('オフラインで画面描画: ' + v, c.w.__T.Views[v]().length > 100));
  ok('設定画面に接続設定カード', c.T.Views.settings().indexOf('Supabase 接続設定') >= 0);

  /* 4. 接続テスト・再取得のAPI存在 */
  ok('接続テスト関数がある', typeof c.T.SB.testConnection === 'function');
  const tc = await c.T.SB.testConnection();
  ok('未設定時の接続テストは失敗を返す', tc.ok === false);
  const rc = await c.T.SB.reloadConfig();
  ok('未設定時の再取得は失敗メッセージ', rc.ok === false && !!rc.message);

  /* 5. assemble の再生成で接続情報が失われない（ソース非記載＝何度生成しても同一） */
  const env = CLEAN_ENV;
  execFileSync('python3', [path.join(ROOT, 'build', 'assemble.py')], { cwd: ROOT, env, stdio: 'pipe' });
  const a = fs.readFileSync(path.join(ROOT, 'build', 'agri-erp.html'), 'utf8');
  execFileSync('python3', [path.join(ROOT, 'build', 'assemble.py')], { cwd: ROOT, env, stdio: 'pipe' });
  const b = fs.readFileSync(path.join(ROOT, 'build', 'agri-erp.html'), 'utf8');
  ok('再生成しても出力が同一（接続情報が消えない）', a === b && a.indexOf('SUPABASE_PROJECT_URL_HERE') < 0);

  /* 6. 環境変数がある場合は焼き込まれる */
  const env2 = Object.assign({}, env, { NEXT_PUBLIC_SUPABASE_URL: URL_OK, NEXT_PUBLIC_SUPABASE_ANON_KEY: KEY });
  execFileSync('node', [path.join(ROOT, 'build', 'assemble.js')], { cwd: ROOT, env: env2, stdio: 'pipe' });
  const withEnv = fs.readFileSync(path.join(ROOT, 'build', 'agri-erp.html'), 'utf8');
  ok('環境変数があれば window.__AGRI_ENV__ に焼き込み', withEnv.indexOf('window.__AGRI_ENV__') >= 0 && withEnv.indexOf(URL_OK) >= 0);
  /* 検査用バンドル（lint対象）は接続情報なしで再生成してから検査する */
  execFileSync('python3', [path.join(ROOT, 'build', 'assemble.py')], { cwd: ROOT, env, stdio: 'pipe' });
  const lint = fs.readFileSync(path.join(ROOT, 'build', 'bundle.check.js'), 'utf8');
  ok('検査用バンドルには接続情報を含めない', lint.indexOf('__AGRI_ENV__={') < 0 && lint.indexOf(URL_MARK) < 0 && lint.indexOf(JWT_HDR) < 0);

  /* 7. Vercel 設定・API の存在 */
  const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  ok('vercel.json: buildCommand が assemble.js', String(vj.buildCommand).indexOf('build/assemble.js') >= 0);
  ok('vercel.json: outputDirectory=dist', vj.outputDirectory === 'dist');
  const api = fs.readFileSync(path.join(ROOT, 'api', 'config.js'), 'utf8');
  ok('api/config.js が NEXT_PUBLIC_* を返す', api.indexOf('NEXT_PUBLIC_SUPABASE_URL') >= 0 && api.indexOf('NEXT_PUBLIC_SUPABASE_ANON_KEY') >= 0);
  ok('api/config.js は Service Role Key を扱わない', api.indexOf('SERVICE_ROLE') < 0);
  ok('.env.example がある', fs.existsSync(path.join(ROOT, '.env.example')));

  console.log(fails ? ('NG: ' + fails) : 'ALL ENV TESTS PASSED');
  process.exit(fails ? 1 : 0);
})();
