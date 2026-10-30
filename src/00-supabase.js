/* ==========================================================================
   アグリERP — Supabase (PostgreSQL) アダプタ
   データ保存はすべて Supabase（PostgreSQL / PostgREST）。localStorage は不使用。
   - Store.save() → 0.8秒デバウンス → 差分アップサート/削除（親→子の順で反映）
   - 他ユーザーの変更は Realtime（postgres_changes）で即時取り込み。
     supabase-js が読み込めない環境では45秒ポーリングにフォールバック。
   - 認証は Postgres 関数 app_verify_login（pgcrypto bcrypt）でサーバー側照合。
     パスワードハッシュはクライアントに送らない。
   - 接続設定（Project URL / Anon Key）は下記 FIXED_URL / FIXED_KEY に**アプリ内部で固定**。
     利用者による入力フォーム・URLパラメータ指定は廃止（配布先PCでも初期設定不要）。
   ========================================================================== */
'use strict';
const SB = (() => {
  /* ---------- 接続設定（アプリ内部に固定・ソース焼き込み） ----------
     この2つの定数に本番の Supabase プロジェクト情報を記入して再ビルドする
     （python3 build/assemble.py）。利用者はログインIDとパスワードのみで利用できる。 */
  const FIXED_URL = 'SUPABASE_PROJECT_URL_HERE';   // ← 例: https://xxxxxxxx.supabase.co（未設定なら空文字）
  const FIXED_KEY = 'SUPABASE_ANON_KEY_HERE';      // ← 例: eyJhbGciOi...（Anon Key / Publishable Key どちらも可）
  const cfg = { url: FIXED_URL, key: FIXED_KEY, realtime: true, pollSec: 45 };
  const api = {
    cfg, ready: false, transport: '', lastSyncAt: null, lastError: null,
    TABLES: null, verifyLogin: null, setPassword: null, init: null,
    requestSync: null, reseedAll: null
  };

  /* ---------- テーブル対応表（arr=Store.dbの配列名 / t=Postgresのテーブル名） ----------
     cols は DB 側カラム（この列だけ送受信する＝アプリの余分なフィールドは破棄）。
     alias は toCamel で復元できない列名の対応（例: tax_amount → tax）。 */
  const TABLES = [
    { arr: 'users',          t: 'users',                pk: 'id', cols: ['id','login_id','name','email','tel','role','password_hash','force_password_change','enabled','last_login_at','created_at','updated_at'] },
    /* 発行元マスタ（会社 1:N 拠点）— 親→子の順で同期するため users の直後に配置 */
    { arr: 'companies',      t: 'companies',            pk: 'id', cols: ['id','company_code','name','postal_code','address','tel','fax','email','invoice_number','logo_url','notes','is_active','visible_fields','created_at','updated_at'] },
    { arr: 'branches',       t: 'branches',             pk: 'id', cols: ['id','company_id','branch_code','name','postal_code','address','tel','fax','email','manager_name','notes','is_active','visible_fields','created_at','updated_at'] },
    { arr: 'docTemplates',   t: 'doc_templates',        pk: 'id', cols: ['id','template_code','name','doc_kind','company_id','company_name','branch_name','branch1','branch2','address','tel','fax','email','invoice_number','manager','logo','is_default','is_active','notes','branch_mode','paper','watermark','footer','created_at','updated_at'], alias: { company_name: 'companyName' } },
    { arr: 'suppliers',      t: 'suppliers',            pk: 'id', cols: ['id','code','name','kana','tel','address','closing_day','payment_terms','lead_time','email','contact','active','notes','created_at','updated_at'] },
    { arr: 'customers',      t: 'customers',            pk: 'id', cols: ['id','code','name','kana','tel','address','closing_day','payment_terms','email','contact','sales_rep_id','active','notes','created_at','updated_at'] },
    { arr: 'items',          t: 'items',                pk: 'id', cols: ['id','kind','code','name','kana','category','unit','spec','sale_price','cost_price','tax_rate','reorder_point','reorder_qty','safety_stock','stock','location','jan_code','barcode','supplier_id','active','notes','created_at','updated_at'] },
    { arr: 'orders',         t: 'orders',               pk: 'id', cols: ['id','order_no','customer_id','customer_name','order_date','due_date','ship_date','status','subtotal','tax_amount','total_amount','remarks','company_id','branch1_id','branch2_id','sales_rep_id','created_by','created_at','updated_at'], alias: { tax_amount: 'tax', total_amount: 'total' } },
    { arr: 'orderLines',     t: 'order_lines',          pk: 'id', cols: ['id','order_id','line_no','item_id','item_name','unit','quantity','unit_price','tax_rate','amount','shipped_qty','due_date','notes'] },
    { arr: 'purchaseOrders', t: 'purchase_orders',      pk: 'id', cols: ['id','po_no','supplier_id','supplier_name','order_date','expected_date','status','subtotal','tax_amount','total_amount','remarks','company_id','branch1_id','branch2_id','created_by','created_at','updated_at'], alias: { tax_amount: 'tax', total_amount: 'total' } },
    { arr: 'poLines',        t: 'purchase_order_lines', pk: 'id', cols: ['id','po_id','line_no','item_id','item_name','unit','quantity','unit_price','tax_rate','amount','received_qty','expected_date','notes'] },
    { arr: 'receipts',       t: 'receipts',             pk: 'id', cols: ['id','receipt_no','po_id','supplier_id','supplier_name','receipt_date','status','subtotal','tax_amount','total_amount','remarks','received_by','created_at'], alias: { tax_amount: 'tax', total_amount: 'total' } },
    { arr: 'receiptLines',   t: 'receipt_lines',        pk: 'id', cols: ['id','receipt_id','po_line_id','item_id','item_name','quantity','unit_cost','amount','lot_no','expiry','notes'] },
    { arr: 'shipments',      t: 'shipments',            pk: 'id', cols: ['id','shipment_no','order_id','order_no','customer_id','customer_name','ship_date','status','carrier','tracking_no','ship_to_name','ship_to_addr','remarks','confirmed_at','created_by','created_at','updated_at'] },
    { arr: 'shipmentLines',  t: 'shipment_lines',       pk: 'id', cols: ['id','shipment_id','order_line_id','item_id','item_name','unit','quantity','lot_no','notes'] },
    { arr: 'movements',      t: 'stock_movements',      pk: 'id', cols: ['id','moved_at','move_date','move_type','item_id','item_name','quantity','balance_after','ref_table','ref_id','ref_no','operator_id','notes','created_at'] },
    { arr: 'sequences',      t: 'number_sequences',     pk: 'seq_key', cols: ['seq_key','prefix','seq_date','last_number','updated_at'], alias: { seq_key: 'key', seq_date: 'date', last_number: 'last' } },
    { arr: 'documents',      t: 'documents',            pk: 'id', cols: ['id','doc_kind','doc_no','shipment_id','shipment_no','order_id','po_id','receipt_id','customer_id','customer_name','issued_at','issued_by','printed_count','company_id','branch1_id','branch2_id','template_id','payload'] }
  ];

  /* ---------- 監査ログ（操作ログ） ----------
     既存テーブル群の差分同期には含めない専用テーブル（sql/03_add_audit_logs.sql で新設）。
     テーブル未作成の環境でも他の同期・起動へ影響しないよう、読み書きは個別に try/catch で保護する。 */
  const AUDIT_TB = { arr: 'auditLogs', t: 'audit_logs', pk: 'id', cols: ['id','action','actor_login_id','actor_name','target_login_id','target_name','ip_address','user_agent','created_at'] };

  const toSnake = s => String(s).replace(/([A-Z])/g, '_$1').toLowerCase();
  const toCamel = s => String(s).replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

  /* アプリ行 → DB行（cols に無いフィールドは破棄 / アプリに無い列は送らない） */
  function rowToDb(row, tb) {
    const out = {};
    for (const c of tb.cols) {
      /* users.password_hash は絶対に送信しない。
          旧実装は自動初期化時にクライアント製のPBKDF2形式ハッシュをDBへ送り、
          app_verify_login の crypt()（bcrypt）照合が必ず失敗して初期ログインできなかった。
          パスワード設定は必ずサーバー側RPC app_set_password 経由で行う */
      if (tb.t === 'users' && c === 'password_hash') continue;
      const ak = (tb.alias && tb.alias[c]) || toCamel(c);
      if (row[ak] !== undefined) out[c] = row[ak];
    }
    return out;
  }
  /* DB行 → アプリ行 */
  function rowFromDb(dbRow, tb) {
    const out = {};
    for (const c of tb.cols) {
      const ak = (tb.alias && tb.alias[c]) || toCamel(c);
      if (dbRow[c] !== undefined) out[ak] = dbRow[c];
    }
    return out;
  }
  const pkApp = tb => (tb.alias && tb.alias[tb.pk]) || toCamel(tb.pk);

  /* ---------- HTTP（PostgREST） ---------- */
  function headers(extra) {
    return Object.assign({
      apikey: cfg.key,
      Authorization: 'Bearer ' + cfg.key,
      'Content-Type': 'application/json'
    }, extra || {});
  }
  async function req(path, opt) {
    /* GET含む全リクエストに apikey / Authorization を必ず付与（旧版バグ: GET時にヘッダー欠落 → "No API key found in request"） */
    opt = Object.assign({}, opt || {});
    opt.headers = headers(opt.headers);
    const res = await fetch(cfg.url.replace(/\/$/, '') + path, opt);
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('Supabase REST ' + res.status + ' ' + path + ' ' + t.slice(0, 200));
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : null;
  }
  const sel = t => '/rest/v1/' + t + '?select=*';
  const upsertReq = (t, rows, pk) => req('/rest/v1/' + t + '?on_conflict=' + (pk || (TABLES.find(x => x.t === t) || {}).pk), {
    method: 'POST', headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(rows)
  });
  const delReq = (t, ids) => req('/rest/v1/' + t + '?id=in.(' + ids.map(i => '"' + i + '"').join(',') + ')', { method: 'DELETE', headers: headers() });
  const rpc = (fn, args) => req('/rest/v1/rpc/' + fn, { method: 'POST', headers: headers(), body: JSON.stringify(args) });

  /* ---------- 差分同期 ---------- */
  let snap = null;               // 最終同期済みのDB形スナップショット { table: { pk: dbRow } }
  let syncTimer = null;
  const pending = new Map();     // "table/pk" -> 同期試行時刻（Realtime取り込み時の自己反映抑止）

  function snapshot(db) {
    const s = {};
    for (const tb of TABLES) {
      const m = {};
      const pk = pkApp(tb);
      (db[tb.arr] || []).forEach(r => { if (r[pk] != null) m[r[pk]] = rowToDb(r, tb); });
      s[tb.t] = m;
    }
    /* アプリ設定（company=発行元の旧設定 / emergency=緊急管理者ログインの有効化） */
    if (db.settings) {
      s.app_settings = {};
      if (db.settings.company) s.app_settings.company = { key: 'company', value: db.settings.company };
      s.app_settings.emergency = { key: 'emergency', value: { enabled: db.settings.emergencyAdmin !== false } };
    }
    return s;
  }
  /* ローカル変更を即時に検出してキューへ（デバウンス中の未送信変更をリモート上書きから保護） */
  const queue = new Map();     // "table/pk" -> {tb, appRow} | {tb, id, del:true} | {settings}
  function collectOps(db) {
    for (const tb of TABLES) {
      const pk = pkApp(tb);
      const old = (snap && snap[tb.t]) || {};
      const cur = {};
      (db[tb.arr] || []).forEach(r => { if (r[pk] != null) cur[r[pk]] = r; });
      for (const id in cur) {
        const nowDb = rowToDb(cur[id], tb);
        if (!old[id] || JSON.stringify(old[id]) !== JSON.stringify(nowDb)) {
          queue.set(tb.t + '/' + id, { tb, pkId: id, del: false });
          pending.set(tb.t + '/' + id, Date.now());
        }
      }
      for (const id in old) if (!cur[id]) {
        queue.set(tb.t + '/' + id, { tb, pkId: id, del: true });
        pending.set(tb.t + '/' + id, Date.now());
      }
    }
    if (db.settings) {
      if (db.settings.company) {
        queue.set('app_settings/company', { settingsKey: 'company', settings: db.settings.company });
        pending.set('app_settings/company', Date.now());
      }
      queue.set('app_settings/emergency', { settingsKey: 'emergency', settings: { enabled: db.settings.emergencyAdmin !== false } });
      pending.set('app_settings/emergency', Date.now());
    }
  }
  async function flushSync() {
    const t0 = Date.now();
    const db = Store.db;
    try {
      /* 親→子の順でアップサート（送信時に最新値を再取得） */
      for (const tb of TABLES) {
        const rows = [];
        for (const op of queue.values()) {
          if (op.tb !== tb || op.del) continue;
          let fresh = null;
          (db[tb.arr] || []).forEach(r => { if (r[pkApp(tb)] === op.pkId) fresh = r; });
          if (fresh) rows.push(rowToDb(fresh, tb));
        }
        if (rows.length) await upsertReq(tb.t, rows);
      }
      /* 子→親の順で削除（FK制約のため） */
      for (const tb of [...TABLES].reverse()) {
        const ids = [];
        for (const op of queue.values()) if (op.tb === tb && op.del) ids.push(op.pkId);
        if (ids.length) await delReq(tb.t, ids);
      }
      /* 設定（JSONB行: company / emergency） */
      const rows = [];
      for (const op of queue.values()) {
        if (!op.settings) continue;
        rows.push({ key: op.settingsKey, value: op.settings });
      }
      if (rows.length) await upsertReq('app_settings', rows, 'key');
      queue.clear();
      if (db) { snap = snapshot(db); }
      /* 送信済み行のpendingを解除（以降のリモート取り込みを妨げない） */
      for (const [k, ts] of pending) if (ts <= t0) pending.delete(k);
      api.lastSyncAt = new Date().toISOString(); api.lastError = null;
    } catch (e) {
      api.lastError = String(e && e.message || e);
      warnOnce('同期に失敗しました: ' + api.lastError);
    }
  }
  async function syncNow() {
    if (!api.ready || !Store.db) return;
    clearTimeout(syncTimer); syncTimer = null;
    collectOps(Store.db);
    await flushSync();
  }
  function requestSync() {
    if (!api.ready) return;
    if (Store.db) collectOps(Store.db);
    clearTimeout(syncTimer);
    syncTimer = setTimeout(flushSync, 800);
  }

  /* ---------- 認証（サーバー側照合：ハッシュはクライアントに送らない） ---------- */
  async function verifyLogin(loginId, pw) {
    try {
      const r = await rpc('app_verify_login', { p_login_id: loginId, p_password: pw });
      if (!r || r.ok !== true) return { ok: false, code: (r && r.code) || 'bad_password', message: (r && r.message) || 'パスワードが一致しません' };
      const utb = TABLES.find(x => x.t === 'users');
      return { ok: true, user: rowFromDb(r.user, utb) };
    } catch (e) {
      return { ok: false, code: 'rpc_error', message: '認証サービスに接続できません: ' + String(e && e.message || e).slice(0, 120) };
    }
  }
  async function setPassword(loginId, newPw, forceChange) {
    try {
      const r = await rpc('app_set_password', { p_login_id: loginId, p_new: newPw, p_force_change: !!forceChange });
      return { ok: r === true, message: r === true ? '' : 'パスワードを変更できませんでした' };
    } catch (e) {
      return { ok: false, message: 'パスワード変更に失敗しました: ' + String(e && e.message || e).slice(0, 120) };
    }
  }

  /* ---------- 他ユーザー変更の取り込み ---------- */
  let repaintTimer = null;
  function repaintSoon() {
    clearTimeout(repaintTimer);
    repaintTimer = setTimeout(() => {
      try {
        const shell = document.getElementById('appShell');
        if (typeof App !== 'undefined' && Auth && Auth.user && shell && shell.style.display !== 'none') App.repaint();
      } catch (e) { /* 描画抑止は無視 */ }
    }, 300);
  }
  function isPending(t, id) {
    const ts = pending.get(t + '/' + id);
    if (!ts) return false;
    if (Date.now() - ts > 15000) { pending.delete(t + '/' + id); return false; }
    return true;
  }
  function mergeRow(tb, dbRow, isDelete) {
    const db = Store.db; if (!db) return;
    const arr = db[tb.arr] || (db[tb.arr] = []);
    const pk = tb.pk, ak = pkApp(tb);
    const id = isDelete ? (dbRow[pk] !== undefined ? dbRow[pk] : dbRow.key) : dbRow[pk];
    if (id == null) return;
    if (isDelete) {
      if (isPending(tb.t, id)) return;
      const i = arr.findIndex(x => x[ak] === id);
      if (i >= 0) arr.splice(i, 1);
      if (snap && snap[tb.t]) delete snap[tb.t][id];
      return;
    }
    if (isPending(tb.t, id)) return;
    const row = rowFromDb(dbRow, tb);
    const i = arr.findIndex(x => x[ak] === id);
    if (i >= 0) arr[i] = Object.assign({}, arr[i], row);
    else if (tb.t === 'stock_movements') arr.unshift(row);
    else arr.push(row);
    if (snap && snap[tb.t]) snap[tb.t][id] = rowToDb(Object.assign({}, i >= 0 ? arr[i] : row), tb);
    repaintSoon();
  }
  function applyRemote(tb, payload) {
    try {
      if (payload.eventType === 'DELETE') mergeRow(tb, payload.old || {}, true);
      else mergeRow(tb, payload.new || {}, false);
    } catch (e) { console.warn('applyRemote failed', e); }
  }
  async function refreshAll() {
    try {
      const results = await Promise.all(TABLES.map(tb => req(sel(tb.t)).catch(() => null)));
      TABLES.forEach((tb, i) => {
        const rows = results[i];
        if (!rows) return;
        rows.forEach(dbRow => mergeRow(tb, dbRow, false));
        /* リモートで消えた行の反映（自端末の未送信変更は保護） */
        const pk = pkApp(tb), cur = Store.db ? (Store.db[tb.arr] || []) : [];
        const remoteIds = new Set(rows.map(r => r[tb.pk]));
        cur.slice().forEach(r => { if (r[pk] != null && !remoteIds.has(r[pk]) && !isPending(tb.t, r[pk])) mergeRow(tb, { [tb.pk]: r[pk] }, true); });
      });
      const st = await req(sel('app_settings')).catch(() => null);
      if (st && Store.db) {
        let changed = false;
        Store.db.settings = Store.db.settings || {};
        const co = st.find(x => x.key === 'company');
        if (co && co.value && !isPending('app_settings', 'company')) {
          Store.db.settings.company = co.value; changed = true;
        }
        const em = st.find(x => x.key === 'emergency');
        if (em && em.value && em.value.enabled !== undefined && !isPending('app_settings', 'emergency')) {
          Store.db.settings.emergencyAdmin = em.value.enabled !== false; changed = true;
        }
        if (changed) { if (snap) snap.app_settings = null; repaintSoon(); }
      }
      /* 監査ログの取り込み（他端末の記録も反映。テーブル未作成時は無視） */
      try {
        const aud = await req(sel('audit_logs'));
        if (Store.db && Array.isArray(aud)) { Store.db.auditLogs = aud.map(r => rowFromDb(r, AUDIT_TB)); repaintSoon(); }
      } catch (e) { /* テーブル未作成・取得失敗時は無視 */ }
      api.lastError = null;
    } catch (e) {
      api.lastError = String(e && e.message || e);
      warnOnce('他端末の変更取り込みに失敗しました: ' + api.lastError);
    }
  }
  let lastWarn = 0;
  function warnOnce(msg) {
    if (Date.now() - lastWarn < 60000) return;
    lastWarn = Date.now();
    try { if (typeof UI !== 'undefined' && UI.toast) UI.toast(msg + '（編集内容は保持され、自動で再送します）', 'warn'); } catch (e) {}
  }
  function startPolling() {
    if (api.transport === 'polling') return;
    api.transport = 'polling';
    clearInterval(api._poll);
    api._poll = setInterval(refreshAll, (cfg.pollSec || 45) * 1000);
  }
  function startRealtime() {
    if (!cfg.realtime || !(window.supabase && window.supabase.createClient)) { startPolling(); return; }
    try {
      const client = window.supabase.createClient(cfg.url, cfg.key, { realtime: { params: { eventsPerSecond: 10 } } });
      const ch = client.realtime.channel('agri-erp-sync');
      TABLES.forEach(tb => ch.on('postgres_changes', { event: '*', schema: 'public', table: tb.t }, p => applyRemote(tb, p)));
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, () => refreshAll());
      ch.subscribe(status => {
        if (status === 'SUBSCRIBED') { api.transport = 'realtime'; clearInterval(api._poll); }
        else if (String(status).match(/CHANNEL_ERROR|TIMED_OUT|CLOSED/)) startPolling();
      });
    } catch (e) { console.warn('realtime init failed, fallback to polling', e); startPolling(); }
  }

  /* ---------- 読み込み / 初期化 ---------- */
  async function loadAll() {
    const results = await Promise.all(TABLES.map(tb => req(sel(tb.t))));
    const st = await req(sel('app_settings'));
    /* 監査ログ（テーブル未作成時は空扱い。失敗しても起動は妨げない） */
    const aud = await req(sel('audit_logs')).catch(() => []);
    const db = {
      version: 2, createdAt: new Date().toISOString(),
      users: [], items: [], customers: [], suppliers: [],
      orders: [], orderLines: [], purchaseOrders: [], poLines: [],
      receipts: [], receiptLines: [], shipments: [], shipmentLines: [],
      movements: [], documents: [], sequences: [], auditLogs: [], loginSecurity: {},
      settings: { emergencyAdmin: true, company: { name: '株式会社 みどりファーム', postal: '〒321-0000', address: '栃木県みどり市中央1-2-3', tel: '0123-45-6789', fax: '0123-45-6780', invoiceNo: 'T1234567890123' } }
    };
    TABLES.forEach((tb, i) => { db[tb.arr] = (results[i] || []).map(r => rowFromDb(r, tb)); });
    db.auditLogs = (aud || []).map(r => rowFromDb(r, AUDIT_TB));
    const co = (st || []).find(x => x.key === 'company');
    if (co && co.value) db.settings.company = co.value;
    const em = (st || []).find(x => x.key === 'emergency');
    if (em && em.value && em.value.enabled !== undefined) db.settings.emergencyAdmin = em.value.enabled !== false;
    return db;
  }
  function readCfg() {
    /* 接続情報はソース内固定（FIXED_URL / FIXED_KEY）。
       入力フォーム・?sb_url=&sb_key= パラメータ・sessionStorage は廃止。
       定数が未記入（プレースホルダのまま・空）の場合は未設定として扱う */
    const u = String(cfg.url || ''), k = String(cfg.key || '');
    if (!u || !k || u.includes('SUPABASE_PROJECT_URL_HERE') || k.includes('SUPABASE_ANON_KEY_HERE')) return null;
    return { url: u, key: k };
  }

  async function init() {
    const c = readCfg();
    if (!c || !c.url || !c.key) return { ok: false, reason: 'config', message: '接続設定（FIXED_URL / FIXED_KEY）が未設定です。src/00-supabase.js にSupabaseプロジェクトのURLとAnon Keyを記入して再ビルドしてください' };
    cfg.url = String(c.url).replace(/\/$/, ''); cfg.key = c.key;
    try {
      const users = await req(sel('users'));
      if (!Array.isArray(users)) throw new Error('usersテーブルの応答が不正です');
      let db;
      if (users.length === 0) {
        /* 空のデータベース → デモ初期データを生成して初回投入 */
        db = buildSeed();
        /* 初期パスワードはクライアント製ハッシュを送らず、既存RPC app_set_password で
           サーバー側bcrypt化する（login_id と画面表示の初期パスワード Temp1234! を一致させる） */
        const tempPw = (typeof Security !== 'undefined' && Security.TEMP) || 'Temp1234!';
        db.users.forEach(u => { delete u.passwordHash; });
        api.ready = true;
        Store.db = db;
        snap = null;              /* 空DBからの初回投入: 全行を差分対象にする */
        await syncNow();
        for (const su of db.users) {
          const r = await setPassword(su.loginId, tempPw, true);
          if (!r || !r.ok) warnOnce('初期ユーザー ' + su.loginId + ' のパスワード設定に失敗しました。sql/04_reset_initial_passwords.sql を実行してください');
        }
      } else {
        db = await loadAll();
        try { const ls = sessionStorage.getItem('agri_loginsec'); if (ls) db.loginSecurity = JSON.parse(ls) || {}; } catch (e) {}
        Store.db = db;
        snap = snapshot(db);
        api.ready = true;
      }
      startRealtime();
      return { ok: true };
    } catch (e) {
      api.ready = false;
      return { ok: false, reason: 'connect', message: 'Supabaseに接続できませんでした: ' + String(e && e.message || e).slice(0, 160) };
    }
  }
  /* データ初期化（全テーブル削除 → デモシードを再投入） */
  async function reseedAll() {
    if (!api.ready) return;
    try {
      for (const tb of [...TABLES].reverse()) {
        await req('/rest/v1/' + tb.t + '?id=not.is.null', { method: 'DELETE', headers: headers() });
      }
      await req('/rest/v1/app_settings?key=not.is.null', { method: 'DELETE', headers: headers() });
      snap = null;              /* 全行を差分対象にして再投入 */
      await syncNow();
      try { if (typeof UI !== 'undefined' && UI.toast) UI.toast('Supabase上のデータを初期化しました', 'ok'); } catch (e) {}
    } catch (e) {
      warnOnce('初期化に失敗しました: ' + String(e && e.message || e));
    }
  }

  /* ---------- 監査ログの書き込み（専用テーブル。失敗しても他の処理に影響させない） ---------- */
  async function pushAudit(row) {
    try {
      if (!api.ready || !row) return;
      await upsertReq('audit_logs', [rowToDb(row, AUDIT_TB)], 'id');
    } catch (e) {
      warnOnce('監査ログテーブル(audit_logs)への記録に失敗しました: ' + String(e && e.message || e).slice(0, 120));
    }
  }

  /* ---------- 接続設定フォーム（廃止） ----------
     接続情報は FIXED_URL / FIXED_KEY に固定したため、URL / API Key の入力フォーム・
     「接続して保存」ボタン・sessionStorage 保持は削除した。利用者はログインIDと
     パスワードのみで利用する。 */

  api.TABLES = TABLES;
  api.init = init;
  api.requestSync = requestSync;
  api.syncNow = syncNow;
  api.reseedAll = reseedAll;
  api.verifyLogin = verifyLogin;
  api.setPassword = setPassword;
  api.pushAudit = pushAudit;
  api.refreshAll = refreshAll;
  api.rowFromDb = rowFromDb;
  api.rowToDb = rowToDb;
  return api;
})();
