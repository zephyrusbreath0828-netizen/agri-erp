/* ===== 00-supabase.js ===== */
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
    /* 組織（テナント）— 業務データの最上位。RLS のキーになるため先頭で同期する */
    { arr: 'organizations',  t: 'organizations',        pk: 'id', cols: ['id','organization_code','organization_name','is_active','created_at','updated_at'] },
    { arr: 'users',          t: 'users',                pk: 'id', cols: ['id','organization_id','login_id','name','email','tel','role','password_hash','force_password_change','enabled','is_system_admin','last_login_at','created_at','updated_at'] },
    /* 発行元マスタ（会社 1:N 拠点）— 親→子の順で同期するため users の直後に配置 */
    { arr: 'companies',      t: 'companies',            pk: 'id', cols: ['id','organization_id','company_code','name','postal_code','address','tel','fax','email','invoice_number','logo_url','notes','is_active','visible_fields','created_at','updated_at'] },
    { arr: 'branches',       t: 'branches',             pk: 'id', cols: ['id','organization_id','company_id','branch_code','name','postal_code','address','tel','fax','email','manager_name','notes','is_active','visible_fields','created_at','updated_at'] },
    { arr: 'docTemplates',   t: 'doc_templates',        pk: 'id', cols: ['id','organization_id','template_code','name','doc_kind','company_id','company_name','branch_name','branch1','branch2','address','tel','fax','email','invoice_number','manager','logo','is_default','is_active','notes','branch_mode','paper','watermark','footer','created_at','updated_at'], alias: { company_name: 'companyName' } },
    { arr: 'suppliers',      t: 'suppliers',            pk: 'id', cols: ['id','organization_id','code','name','kana','tel','address','closing_day','payment_terms','lead_time','email','contact','active','notes','created_at','updated_at'] },
    { arr: 'customers',      t: 'customers',            pk: 'id', cols: ['id','organization_id','code','name','kana','tel','address','closing_day','payment_terms','email','contact','sales_rep_id','active','notes','created_at','updated_at'] },
    { arr: 'items',          t: 'items',                pk: 'id', cols: ['id','organization_id','kind','code','name','kana','category','unit','spec','sale_price','cost_price','tax_rate','reorder_point','reorder_qty','safety_stock','stock','location','jan_code','barcode','supplier_id','active','notes','created_at','updated_at'] },
    { arr: 'orders',         t: 'orders',               pk: 'id', cols: ['id','organization_id','order_no','customer_id','customer_name','order_date','due_date','ship_date','status','subtotal','tax_amount','total_amount','remarks','company_id','branch1_id','branch2_id','sales_rep_id','created_by','created_at','updated_at'], alias: { tax_amount: 'tax', total_amount: 'total' } },
    { arr: 'orderLines',     t: 'order_lines',          pk: 'id', cols: ['id','organization_id','order_id','line_no','item_id','item_name','unit','quantity','unit_price','tax_rate','amount','shipped_qty','due_date','notes'] },
    { arr: 'purchaseOrders', t: 'purchase_orders',      pk: 'id', cols: ['id','organization_id','po_no','supplier_id','supplier_name','order_date','expected_date','status','subtotal','tax_amount','total_amount','remarks','company_id','branch1_id','branch2_id','created_by','created_at','updated_at'], alias: { tax_amount: 'tax', total_amount: 'total' } },
    { arr: 'poLines',        t: 'purchase_order_lines', pk: 'id', cols: ['id','organization_id','po_id','line_no','item_id','item_name','unit','quantity','unit_price','tax_rate','amount','received_qty','expected_date','notes'] },
    { arr: 'receipts',       t: 'receipts',             pk: 'id', cols: ['id','organization_id','receipt_no','po_id','supplier_id','supplier_name','receipt_date','status','subtotal','tax_amount','total_amount','remarks','received_by','created_at'], alias: { tax_amount: 'tax', total_amount: 'total' } },
    { arr: 'receiptLines',   t: 'receipt_lines',        pk: 'id', cols: ['id','organization_id','receipt_id','po_line_id','item_id','item_name','quantity','unit_cost','amount','lot_no','expiry','notes'] },
    { arr: 'shipments',      t: 'shipments',            pk: 'id', cols: ['id','organization_id','shipment_no','order_id','order_no','customer_id','customer_name','ship_date','status','carrier','tracking_no','ship_to_name','ship_to_addr','remarks','confirmed_at','created_by','created_at','updated_at'] },
    { arr: 'shipmentLines',  t: 'shipment_lines',       pk: 'id', cols: ['id','organization_id','shipment_id','order_line_id','item_id','item_name','unit','quantity','lot_no','notes'] },
    { arr: 'movements',      t: 'stock_movements',      pk: 'id', cols: ['id','organization_id','moved_at','move_date','move_type','item_id','item_name','quantity','balance_after','ref_table','ref_id','ref_no','operator_id','notes','created_at'] },
    { arr: 'sequences',      t: 'number_sequences',     pk: 'seq_key', cols: ['seq_key','organization_id','prefix','seq_date','last_number','updated_at'], alias: { seq_key: 'key', seq_date: 'date', last_number: 'last' } },
    { arr: 'documents',      t: 'documents',            pk: 'id', cols: ['id','organization_id','doc_kind','doc_no','shipment_id','shipment_no','order_id','po_id','receipt_id','customer_id','customer_name','issued_at','issued_by','printed_count','company_id','branch1_id','branch2_id','template_id','payload'] }
  ];

  /* ---------- 監査ログ（操作ログ） ----------
     既存テーブル群の差分同期には含めない専用テーブル（sql/03_add_audit_logs.sql で新設）。
     テーブル未作成の環境でも他の同期・起動へ影響しないよう、読み書きは個別に try/catch で保護する。 */
  const AUDIT_TB = { arr: 'auditLogs', t: 'audit_logs', pk: 'id', cols: ['id','organization_id','action','actor_login_id','actor_name','target_login_id','target_name','ip_address','user_agent','created_at'] };

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
    const h = { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' };
    /* マルチテナント: サーバー発行セッショントークン。RLS は x-app-token から organization_id を解決する */
    if (api.sessionToken) h['x-app-token'] = api.sessionToken;
    return Object.assign(h, extra || {});
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
    const utb = TABLES.find(x => x.t === 'users');
    /* マルチテナント: app_login がセッショントークンと所属組織を返す（RLS の認可キー）。
       旧DB（app_login 未作成）では従来の app_verify_login へフォールバックする */
    try {
      const r = await rpc('app_login', { p_login_id: loginId, p_password: pw });
      if (r && typeof r === 'object' && r.ok === true) {
        api.sessionToken = r.token || null;
        const u = rowFromDb(r.user || {}, utb);
        if (u.organizationId == null && r.organization_id != null) u.organizationId = Number(r.organization_id);
        return { ok: true, user: u };
      }
      if (r && typeof r === 'object') {
        return { ok: false, code: r.code || 'bad_password', message: r.message || 'パスワードが一致しません' };
      }
    } catch (e) {
      const msg = String(e && e.message || e);
      if (!/app_login|404|does not exist|not found/i.test(msg)) {
        return { ok: false, code: 'rpc_error', message: '認証サービスに接続できません: ' + msg.slice(0, 120) };
      }
    }
    try {
      const r = await rpc('app_verify_login', { p_login_id: loginId, p_password: pw });
      if (!r || r.ok !== true) return { ok: false, code: (r && r.code) || 'bad_password', message: (r && r.message) || 'パスワードが一致しません' };
      return { ok: true, user: rowFromDb(r.user, utb) };
    } catch (e) {
      return { ok: false, code: 'rpc_error', message: '認証サービスに接続できません: ' + String(e && e.message || e).slice(0, 120) };
    }
  }
  async function logoutSession() {
    const t = api.sessionToken;
    api.sessionToken = null;
    if (!t) return;
    try { await rpc('app_logout', { p_token: t }); } catch (e) { /* 旧DBでは無視 */ }
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
      organizations: [], users: [], items: [], customers: [], suppliers: [],
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
  api.logoutSession = logoutSession;
  api.sessionToken = null;
  api.refreshAll = refreshAll;
  api.rowFromDb = rowFromDb;
  api.rowToDb = rowToDb;
  return api;
})();


/* ===== 01-store.js ===== */
/* ==========================================================================
   アグリERP — データ層（Swappable Data Layer）
   本番: Supabase (PostgreSQL) に保存。00-supabase.js の SB アダプタが差分同期する。
   すべての在庫増減は applyStock() 経由のみ。直接代入は禁止。
   ========================================================================== */
const DB_KEY = 'agri_erp_v1';

const todayStr = (d = new Date()) => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const addDays = (base, n) => { const d = new Date(base); d.setDate(d.getDate() + n); return d; };
const TODAY = todayStr();
const uid = () => 'x' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* ------------------------------ Seed 定義 ------------------------------ */
const SEED_ITEMS = [
  ['product','P001','トマト','トマト','果菜類','ケース','10kg/ケース',3800,2400,30,50,15,42,'A-01'],
  ['product','P002','ミニトマト','ミニトマト','果菜類','ケース','5kg/ケース',4200,2700,20,40,10,18,'A-02'],
  ['product','P003','きゅうり','キュウリ','果菜類','ケース','5kg/ケース',2600,1600,25,50,10,12,'A-03'],
  ['product','P004','なす','ナス','果菜類','ケース','5kg/ケース',2400,1500,20,40,10,33,'A-04'],
  ['product','P005','ピーマン','ピーマン','果菜類','ケース','3kg/ケース',2200,1300,15,30,8,9,'A-05'],
  ['product','P006','キャベツ','キャベツ','葉菜類','ケース','10kg/ケース',1800,1000,40,80,20,66,'B-01'],
  ['product','P007','レタス','レタス','葉菜類','ケース','8kg/ケース',2100,1200,30,60,15,24,'B-02'],
  ['product','P008','ほうれん草','ホウレンソウ','葉菜類','ケース','5kg/ケース',2800,1700,20,40,10,8,'B-03'],
  ['product','P009','だいこん','ダイコン','根菜類','ケース','10kg/ケース',1600,900,35,70,20,51,'C-01'],
  ['product','P010','にんじん','ニンジン','根菜類','ケース','10kg/ケース',1900,1100,30,60,15,27,'C-02'],
  ['product','P011','たまねぎ','タマネギ','根菜類','ケース','10kg/ケース',1700,950,40,80,20,73,'C-03'],
  ['product','P012','じゃがいも','ジャガイモ','根菜類','ケース','10kg/ケース',1750,980,40,80,20,14,'C-04'],
  ['product','P013','ねぎ','ネギ','葉菜類','ケース','5kg/ケース',2300,1400,20,40,10,36,'B-04'],
  ['product','P014','ブロッコリー','ブロッコリー','花菜類','ケース','5kg/ケース',2900,1800,15,30,8,6,'B-05'],
  ['product','P015','いちご','イチゴ','果実類','パック','300g/パック',780,480,50,100,25,130,'D-01'],
  ['material','M001','段ボール箱 10kg','ダンボールバコ','梱包資材','枚','10kg用',95,62,500,1000,200,720,'E-01'],
  ['material','M002','段ボール箱 5kg','ダンボールバコ','梱包資材','枚','5kg用',78,50,500,1000,200,410,'E-02'],
  ['material','M003','発泡スチロール箱','ハッポウスチロールバコ','梱包資材','個','20L',320,210,100,200,40,88,'E-03'],
  ['material','M004','プラスチックコンテナ','プラスチックコンテナ','梱包資材','個','40L',1250,900,50,100,20,64,'E-04'],
  ['material','M005','結束バンド','ケッソクバンド','梱包資材','本','200mm',3,1.5,2000,5000,800,1450,'E-05'],
  ['material','M006','ラップフィルム','ラップフィルム','梱包資材','巻','30cm×300m',480,320,60,120,25,31,'E-06'],
  ['material','M007','梱包テープ','コンポウテープ','梱包資材','巻','50mm×50m',210,140,100,200,40,76,'E-07'],
  ['material','M008','緩衝材','カンショウザイ','梱包資材','袋','エアクッション',45,28,800,1600,300,920,'E-08'],
  ['material','M009','保冷剤','ホレイザイ','梱包資材','個','400g',65,40,300,600,100,155,'E-09'],
  ['material','M010','ラベルシール','ラベルシール','梱包資材','枚','50×30mm',5,2.5,3000,6000,1000,3800,'E-10']
];
/* 得意先マスタ（末尾は既定の営業担当者: users.id） */
const SEED_CUSTOMERS = [
  ['C001','JAみどり 農産物直売所','ジェイエイミドリ ノウサンブツチョクバイショ','0123-45-1111','〒321-0000 栃木県みどり市中央1-2-3','31','翌月末','usr002'],
  ['C002','スーパーマルヨシ 本店','スーパーマルヨシ ホンテン','0123-45-2222','〒321-0001 栃木県みどり市駅前4-5-6','20','翌月末','usr004'],
  ['C003','みどり市学校給食センター','ミドリシ ガッコウキュウショクセンター','0123-45-3333','〒321-0002 栃木県みどり市学園台7-8','31','翌月末','usr005'],
  ['C004','道の駅 みどりの里','ミチノエキ ミドリノサト','0123-45-4444','〒321-0003 栃木県みどり市山手9-10','31','翌月末','usr002'],
  ['C005','レストラン ファームキッチン','レストラン ファームキッチン','0123-45-5555','〒321-0004 栃木県みどり市大通り2-1','15','翌月末','usr004']
];
const SEED_SUPPLIERS = [
  ['S001','JAみどり資材センター','ジェイエイミドリシザイセンター','0123-45-6789','〒321-1000 栃木県みどり市資材町1-1','31','翌月末',3],
  ['S002','北関東包装資材株式会社','キタカントウホウソウシザイ','028-555-1234','〒320-0800 栃木県宇都宮市包装1-5','31','翌月末',5],
  ['S003','株式会社みらい種苗','ミライシュビョウ','03-1234-5678','〒101-0000 東京都千代田区種苗1-1','31','翌々月末',7],
  ['S004','みどり市農協 出荷部会','ミドリシ ノウキョウ シュッカブカイ','0123-45-9999','〒321-0005 栃木県みどり市農協前1','31','翌月末',2]
];
/* 初期ユーザー（loginId / passwordHash による ID・パスワード認証）
   初期パスワードは Temp1234! — PBKDF2-SHA256（100,000回・ソルト付き）でハッシュ化し、平文は保存しない */
const TEMP_PASSWORD_HASH = 'pbkdf2-sha256$100000$e5133dcf8c6234d8d2db6b16f8c0aeb1$8f4f4105f93e592d0291b07116f3d9d140ddc4def8f7e2badd54de37709e9cfa';
const TEMP_HASH_OFFICE = 'pbkdf2-sha256$100000$c340ca75dc7b3f75dde9a2df8fefe2ac$6334b1ebb4e458b6003e1ba1792063c07b4a1af6c6aef707119d781d8fc02c06';
const TEMP_HASH_SHIPPING = 'pbkdf2-sha256$100000$4e359b0d92b54a4ee4feb828ef41eacd$7026781e5b7bf5723ab166e8e25fc632ea76e4460ec5186414d5b31d508fafcf';
/* マルチテナント: テナント境界を持つテーブル（organization_id で隔離） */
const TENANT_TABLES = ['organizations','users','companies','branches','docTemplates','customers','suppliers','items',
  'orders','orderLines','purchaseOrders','poLines','receipts','receiptLines','shipments','shipmentLines','movements','documents','sequences'];
const DEFAULT_ORG_ID = 1;

/* 組織マスタ（初期データ）。既存データは id=1 SETOLAS へ移行する */
const SEED_ORGANIZATIONS = [
  [1, 'SETOLAS', 'SETOLAS'],
  [2, 'A-FARM', 'A-FARM'],
  [3, 'B-FARM', 'B-FARM']
];

const SEED_USERS = [
  ['usr001', 'admin',    '山田 太郎', 'admin@agri-erp.local',    '090-1111-2222', 'admin',    TEMP_PASSWORD_HASH, 1, true],
  ['usr002', 'office',   '佐藤 花子', 'office@agri-erp.local',   '090-3333-4444', 'office',   TEMP_HASH_OFFICE, 1, false],
  ['usr003', 'shipping', '鈴木 一郎', 'shipping@agri-erp.local', '090-5555-6666', 'shipping', TEMP_HASH_SHIPPING, 1, false],
  /* 営業担当（得意先担当）: 権限は事務担当。検索条件の「営業担当者」に使用 */
  ['usr004', 'sales1',   '田中 健二', 'sales1@agri-erp.local',   '090-7777-8888', 'office',   TEMP_HASH_OFFICE, 1, false],
  ['usr005', 'sales2',   '中村 美咲', 'sales2@agri-erp.local',   '090-9999-0000', 'office',   TEMP_HASH_OFFICE, 1, false],
  /* テナント分離サンプル: A-FARM 組織の事務担当（他組織のデータは一切見えない） */
  ['usr010', 'afarm',    '青木 大地', 'afarm@agri-erp.local',    '090-2222-3333', 'office',   TEMP_HASH_OFFICE, 2, false]
];

/* ------------------------------ 会社・拠点・帳票テンプレート（v3 で新設） ------------------------------
   会社マスタは複数登録できる（グループ会社・拠点対応）。既存の settings.company（単一会社設定）は
   Store.migrateIssuerMasters() が companies へ自動移行する。 */
const ALL_VISIBLE = { address: true, tel: true, fax: true, email: false, invoiceNumber: true, logo: true, manager: true };
const SEED_COMPANIES = [
  ['co001', 'C001', '株式会社 みどりファーム', '〒321-0000', '栃木県みどり市中央1-2-3', '0123-45-6789', '0123-45-6780', 'info@midori-farm.example', 'T1234567890123', '', '旧「自社情報」から移行した自社（グループ中核会社）'],
  ['co002', 'C002', 'セトラスホールディングス株式会社', '〒760-0023', '香川県高松市寿町1-2-3 セトラスビル5F', '087-811-0000', '087-811-0001', 'info@settras-hd.example', 'T2234567890123', '', 'グループ統括会社'],
  ['co003', 'C003', '○○農産株式会社', '〒761-0000', '香川県高松市○○町1-1', '087-000-0000', '087-000-0001', 'info@maru-nosan.example', 'T3234567890123', '', 'グループ会社（農産物の生産・出荷）'],
  ['co004', 'C004', '○○ファーム株式会社', '〒771-0000', '徳島県名西郡神山町○○字○○1', '088-000-0000', '088-000-0001', 'info@maru-farm.example', 'T4234567890123', '', 'グループ会社（神山農場の運営）']
];
const SEED_BRANCHES = [
  ['br001', 'co001', 'H001', '本社', '〒321-0000', '栃木県みどり市中央1-2-3', '0123-45-6789', '0123-45-6780', '', '山田 太郎', '本社・事務所'],
  ['br002', 'co002', 'H001', '高松事業所', '〒761-0000', '香川県高松市○○町1-2-3', '087-000-0000', '087-000-0001', 'takamatsu@settras-hd.example', '佐々木 健', '営業・物流拠点'],
  ['br003', 'co002', 'H002', '神山農場', '〒771-0000', '徳島県名西郡神山町○○字○○', '088-000-0000', '', 'kamiyama@settras-hd.example', '大西 誠', '生産拠点'],
  ['br004', 'co003', 'N001', '本社', '〒761-0000', '香川県高松市○○町1-1', '087-000-0000', '', '', '高橋 修', ''],
  ['br005', 'co003', 'N002', '綾川圃場', '〒761-0000', '香川県綾歌郡綾川町○○', '087-000-0002', '', '', '中村 恵', '選果場併設'],
  ['br006', 'co004', 'F001', '神山農場', '〒771-0000', '徳島県名西郡神山町○○字○○1', '088-000-0000', '088-000-0001', '', '大西 誠', '本場（有機JAS）']
];
/* 帳票テンプレート: 表示可否（true=表示 / false=非表示）。§6 の例に対応 */
const SEED_DOC_TEMPLATES = [
  ['tpl001', 'Q-STD', '標準見積書', 'quote', null, { companyName: true, branchName: true, address: true, tel: true, fax: true, email: false, invoiceNumber: true, manager: false, logo: true }, true, '会社名・拠点・住所・TEL/FAX・登録番号・ロゴを表示'],
  ['tpl002', 'Q-SMP', '簡易見積書', 'quote', null, { companyName: true, branchName: true, address: false, tel: false, fax: false, email: false, invoiceNumber: false, manager: false, logo: false }, false, '会社名と拠点名のみ（社内確認用）'],
  ['tpl003', 'P-STD', '標準発注書', 'purchase_order', null, { companyName: true, branchName: true, address: true, tel: true, fax: true, email: false, invoiceNumber: true, manager: false, logo: true }, true, '仕入先へ送付する標準発注書'],
  ['tpl004', 'P-SMP', '簡易発注書', 'purchase_order', null, { companyName: true, branchName: true, address: false, tel: true, fax: false, email: false, invoiceNumber: false, manager: false, logo: false }, false, '電話・FAX番号のみ表示'],
  ['tpl005', 'D-STD', '標準納品書', 'delivery_note', null, { companyName: true, branchName: true, address: true, tel: true, fax: false, email: false, invoiceNumber: true, manager: false, logo: true }, true, '納品書の標準レイアウト'],
  ['tpl006', 'I-STD', '標準請求書', 'invoice', null, { companyName: true, branchName: true, address: true, tel: true, fax: true, email: false, invoiceNumber: true, manager: false, logo: true }, true, '適格請求書（インボイス）対応'],
  ['tpl007', 'R-STD', '標準入庫伝票', 'receipt_note', null, { companyName: true, branchName: true, address: true, tel: true, fax: false, email: false, invoiceNumber: false, manager: false, logo: false }, true, '入荷（入庫）伝票'],
  ['tpl008', 'S-STD', '標準出庫伝票', 'shipping_slip', null, { companyName: true, branchName: true, address: true, tel: true, fax: false, email: false, invoiceNumber: false, manager: false, logo: false }, true, '出荷（出庫）伝票'],
  ['tpl009', 'K-STD', '標準ピッキングリスト', 'picking_list', null, { companyName: true, branchName: true, address: false, tel: false, fax: false, email: false, invoiceNumber: false, manager: false, logo: false }, true, '倉庫作業用（会社名・拠点名のみ）']
];

/* ------------------------------ 初期DB生成 ------------------------------ */
function buildSeed() {
  const db = {
    version: 3, createdAt: new Date().toISOString(),
    items: [], customers: [], suppliers: [], users: [],
    orders: [], orderLines: [], purchaseOrders: [], poLines: [],
    receipts: [], receiptLines: [], shipments: [], shipmentLines: [],
    movements: [], documents: [], sequences: [], auditLogs: [], loginSecurity: {},
    companies: [], branches: [], docTemplates: [],
    /* settings.company は旧バージョン互換（会社マスタ移行元）としてのみ保持する */
    /* emergencyAdmin: 緊急管理者ログインの有効／無効（既定 ON） */
    settings: { emergencyAdmin: true, company: { name: '株式会社 みどりファーム', postal: '〒321-0000', address: '栃木県みどり市中央1-2-3', tel: '0123-45-6789', fax: '0123-45-6780', invoiceNo: 'T1234567890123' } }
  };

  SEED_ITEMS.forEach((a, i) => db.items.push({
    id: 'itm' + String(i + 1).padStart(3, '0'), kind: a[0], code: a[1], name: a[2], kana: a[3],
    category: a[4], unit: a[5], spec: a[6], salePrice: a[7], costPrice: a[8],
    reorderPoint: a[9], reorderQty: a[10], safetyStock: a[11], stock: a[12], location: a[13],
    janCode: '49' + String(100000000 + i * 137).slice(0, 11), barcode: 'AG' + a[1],
    supplierId: a[0] === 'material' ? 'sup002' : 'sup004', active: true, notes: ''
  }));
  SEED_CUSTOMERS.forEach((a, i) => db.customers.push({
    id: 'cus' + String(i + 1).padStart(3, '0'), code: a[0], name: a[1], kana: a[2], tel: a[3], address: a[4],
    closingDay: +a[5], paymentTerms: a[6], email: '', contact: '', salesRepId: a[7] || null, active: true, notes: ''
  }));
  SEED_SUPPLIERS.forEach((a, i) => db.suppliers.push({
    id: 'sup' + String(i + 1).padStart(3, '0'), code: a[0], name: a[1], kana: a[2], tel: a[3], address: a[4],
    closingDay: +a[5], paymentTerms: a[6], leadTime: a[7], email: '', contact: '', active: true, notes: ''
  }));
  const nowIso = new Date().toISOString();
  db.organizations = db.organizations || [];
  SEED_ORGANIZATIONS.forEach(a => db.organizations.push({
    id: a[0], organizationCode: a[1], organizationName: a[2], isActive: true, createdAt: nowIso, updatedAt: nowIso
  }));
  SEED_USERS.forEach(a => db.users.push({
    id: a[0], loginId: a[1], name: a[2], email: a[3], tel: a[4], role: a[5],
    passwordHash: a[6], forcePasswordChange: true, enabled: true, createdAt: nowIso, updatedAt: nowIso,
    organizationId: a[7] || DEFAULT_ORG_ID, isSystemAdmin: !!a[8]
  }));

  /* ---- 会社マスタ・拠点マスタ・帳票テンプレート ---- */
  SEED_COMPANIES.forEach(a => db.companies.push({
    id: a[0], companyCode: a[1], name: a[2], postalCode: a[3], address: a[4], tel: a[5], fax: a[6],
    email: a[7], invoiceNumber: a[8], logoUrl: a[9], notes: a[10], isActive: true,
    visibleFields: Object.assign({}, ALL_VISIBLE), createdAt: nowIso, updatedAt: nowIso
  }));
  SEED_BRANCHES.forEach(a => db.branches.push({
    id: a[0], companyId: a[1], branchCode: a[2], name: a[3], postalCode: a[4], address: a[5],
    tel: a[6], fax: a[7], email: a[8], managerName: a[9], notes: a[10], isActive: true,
    visibleFields: Object.assign({}, ALL_VISIBLE), createdAt: nowIso, updatedAt: nowIso
  }));
  SEED_DOC_TEMPLATES.forEach(a => db.docTemplates.push({
    id: a[0], templateCode: a[1], name: a[2], docKind: a[3], companyId: a[4],
    companyName: a[5].companyName, branchName: a[5].branchName, address: a[5].address,
    tel: a[5].tel, fax: a[5].fax, email: a[5].email, invoiceNumber: a[5].invoiceNumber,
    manager: a[5].manager, logo: a[5].logo, isDefault: a[6], isActive: true, notes: a[7], branch1: true, branch2: true, branchMode: 'both', paper: 'portrait', watermark: true, footer: true,
    createdAt: nowIso, updatedAt: nowIso
  }));

  /* ---- 過去在庫トランザクション（30日分の入荷・出荷履歴を生成） ---- */
  const itemById = id => db.items.find(x => x.id === id);
  const mkMove = (itemId, qty, type, refNo, refTable, refId, dayOffset, op) => {
    const it = itemById(itemId);
    it.stock = +(it.stock + qty).toFixed(2);
    db.movements.push({
      id: uid(), movedAt: addDays(new Date(), dayOffset).toISOString(),
      moveDate: todayStr(addDays(new Date(), dayOffset)), moveType: type, itemId, itemName: it.name,
      quantity: qty, balanceAfter: it.stock, refTable, refId, refNo,
      operatorId: op || 'usr001', notes: ''
    });
  };

  /* 入荷実績（過去） */
  const histReceipts = [
    [-12, 'sup004', [['itm001', 80], ['itm003', 60], ['itm006', 120]]],
    [-9, 'sup002', [['itm016', 1000], ['itm017', 800], ['itm019', 60]]],
    [-6, 'sup004', [['itm004', 50], ['itm011', 100], ['itm009', 70]]],
    [-3, 'sup002', [['itm018', 120], ['itm020', 3000], ['itm025', 5000]]],
    [-1, 'sup004', [['itm001', 60], ['itm007', 40], ['itm013', 30]]]
  ];
  histReceipts.forEach((h, hi) => {
    const [off, supId, lines] = h;
    const rid = 'rcv' + String(hi + 1).padStart(3, '0');
    const rno = 'RC-' + todayStr(addDays(new Date(), off)).replace(/-/g, '') + '-' + String(hi + 1).padStart(4, '0');
    let sub = 0;
    const rl = lines.map(([iid, q]) => {
      const it = itemById(iid); const amt = q * it.costPrice; sub += amt;
      return { id: uid(), receiptId: rid, poLineId: null, itemId: iid, itemName: it.name, quantity: q, unitCost: it.costPrice, amount: amt, lotNo: '', expiry: '' };
    });
    db.receipts.push({
      id: rid, receiptNo: rno, poId: null, supplierId: supId, supplierName: db.suppliers.find(s => s.id === supId).name,
      receiptDate: todayStr(addDays(new Date(), off)), status: 'confirmed', subtotal: sub, tax: Math.round(sub * .08), total: sub + Math.round(sub * .08),
      remarks: '', receivedBy: 'usr002', createdAt: new Date().toISOString()
    });
    rl.forEach(l => {
      db.receiptLines.push(l);
      mkMove(l.itemId, l.quantity, 'receipt', rno, 'receipts', rid, off, 'usr002');
    });
  });

  /* ---- 受注（受注残・納期管理のデモ） ---- */
  const mkOrder = (idx, custId, orderOff, dueOff, lines, status) => {
    const oid = 'ord' + String(idx).padStart(3, '0');
    const ono = 'ORD-' + todayStr(addDays(new Date(), orderOff)).replace(/-/g, '') + '-' + String(idx).padStart(4, '0');
    let sub = 0;
    const ols = lines.map(([iid, q, shipped], li) => {
      const it = itemById(iid); const amt = q * it.salePrice; sub += amt;
      return { id: oid + 'l' + (li + 1), orderId: oid, lineNo: li + 1, itemId: iid, itemName: it.name, unit: it.unit,
        quantity: q, unitPrice: it.salePrice, taxRate: it.taxRate || 8, amount: amt, shippedQty: shipped || 0,
        dueDate: todayStr(addDays(new Date(), dueOff)), notes: '' };
    });
    const tax = Math.round(sub * .08);
    db.orders.push({
      id: oid, orderNo: ono, customerId: custId, customerName: db.customers.find(c => c.id === custId).name,
      salesRepId: (db.customers.find(c => c.id === custId) || {}).salesRepId || null,
      orderDate: todayStr(addDays(new Date(), orderOff)), dueDate: todayStr(addDays(new Date(), dueOff)),
      shipDate: todayStr(addDays(new Date(), dueOff)), status: status || 'received',
      subtotal: sub, tax, total: sub + tax, remarks: '', createdBy: 'usr002', createdAt: new Date().toISOString()
    });
    ols.forEach(l => db.orderLines.push(l));
    return oid;
  };

  mkOrder(1, 'cus002', -5, -1, [['itm001', 20], ['itm003', 15], ['itm007', 10]], 'received');       // 納期超過（アラート）
  mkOrder(2, 'cus001', -4, 0, [['itm006', 40], ['itm009', 30], ['itm011', 25]], 'received');        // 本日納期
  mkOrder(3, 'cus003', -3, 1, [['itm004', 25], ['itm010', 20], ['itm013', 15]], 'received');
  mkOrder(4, 'cus005', -2, 2, [['itm002', 12], ['itm005', 10], ['itm008', 8]], 'received');
  mkOrder(5, 'cus004', -1, 3, [['itm001', 30], ['itm015', 60]], 'received');
  mkOrder(6, 'cus002', -8, -3, [['itm012', 35], ['itm014', 12]], 'shipped', [[0, 35, 35], [1, 12, 12]]);
  mkOrder(7, 'cus001', -7, -2, [['itm006', 30], ['itm009', 20]], 'shipped', [[0, 30, 30], [1, 20, 20]]);
  mkOrder(8, 'cus003', -6, 5, [['itm003', 18], ['itm007', 12]], 'partial', [[0, 18, 8], [1, 12, 0]]);

  /* 受注番号を明示的に設定し直す（mkOrder の二重定義回避） */
  db.orders.forEach((o, i) => {
    o.orderNo = 'ORD-' + o.orderDate.replace(/-/g, '') + '-' + String(i + 1).padStart(4, '0');
  });

  /* ---- 出荷（本日出荷予定 + 履歴） ---- */
  const mkShip = (idx, orderId, shipOff, status, carrier) => {
    const o = db.orders.find(x => x.id === orderId);
    const sid = 'shp' + String(idx).padStart(3, '0');
    const sno = 'SH-' + todayStr(addDays(new Date(), shipOff)).replace(/-/g, '') + '-' + String(idx).padStart(4, '0');
    const lines = db.orderLines.filter(l => l.orderId === orderId).map(l => ({
      id: uid(), shipmentId: sid, orderLineId: l.id, itemId: l.itemId, itemName: l.itemName,
      unit: l.unit, quantity: l.shippedQty > 0 ? l.shippedQty : l.quantity, lotNo: '', notes: ''
    }));
    db.shipments.push({
      id: sid, shipmentNo: sno, orderId, orderNo: o.orderNo, customerId: o.customerId, customerName: o.customerName,
      shipDate: todayStr(addDays(new Date(), shipOff)), status, carrier,
      trackingNo: status === 'confirmed' ? 'TRK' + (100000 + idx * 37) : '',
      shipToName: o.customerName, shipToAddr: db.customers.find(c => c.id === o.customerId).address,
      remarks: '', confirmedAt: status === 'confirmed' ? addDays(new Date(), shipOff).toISOString() : null,
      createdBy: 'usr003', createdAt: new Date().toISOString()
    });
    lines.forEach(l => db.shipmentLines.push(l));
    return sid;
  };
  mkShip(1, 'ord006', -3, 'confirmed', 'ヤマト運輸');
  mkShip(2, 'ord007', -2, 'confirmed', '佐川急便');
  mkShip(3, 'ord008', 0, 'instructed', 'ヤマト運輸');   // 本日出荷指示
  mkShip(4, 'ord002', 0, 'instructed', '自社配送');      // 本日出荷指示
  mkShip(5, 'ord003', 1, 'instructed', '佐川急便');      // 明日
  mkShip(6, 'ord004', 2, 'instructed', 'ヤマト運輸');

  /* 確定済み出荷の在庫減算 */
  db.shipments.filter(s => s.status === 'confirmed').forEach(s => {
    db.shipmentLines.filter(l => l.shipmentId === s.id).forEach(l => {
      mkMove(l.itemId, -l.quantity, 'shipment', s.shipmentNo, 'shipments', s.id, 0, 'usr003');
    });
  });

  /* ---- 発注（発注残デモ） ---- */
  const mkPO = (idx, supId, orderOff, expOff, lines, status) => {
    const pid = 'po' + String(idx).padStart(3, '0');
    let sub = 0;
    const pls = lines.map(([iid, q, recv], li) => {
      const it = itemById(iid); const amt = q * it.costPrice; sub += amt;
      return { id: pid + 'l' + (li + 1), poId: pid, lineNo: li + 1, itemId: iid, itemName: it.name, unit: it.unit,
        quantity: q, unitPrice: it.costPrice, taxRate: 8, amount: amt, receivedQty: recv || 0,
        expectedDate: todayStr(addDays(new Date(), expOff)), notes: '' };
    });
    const tax = Math.round(sub * .08);
    db.purchaseOrders.push({
      id: pid, poNo: 'PO-' + todayStr(addDays(new Date(), orderOff)).replace(/-/g, '') + '-' + String(idx).padStart(4, '0'),
      supplierId: supId, supplierName: db.suppliers.find(s => s.id === supId).name,
      orderDate: todayStr(addDays(new Date(), orderOff)), expectedDate: todayStr(addDays(new Date(), expOff)),
      status: status || 'ordered', subtotal: sub, tax, total: sub + tax, remarks: '', createdBy: 'usr002',
      createdAt: new Date().toISOString()
    });
    pls.forEach(l => db.poLines.push(l));
    return pid;
  };
  mkPO(1, 'sup002', -4, -2, [['itm016', 1000], ['itm017', 800]], 'ordered');   // 入荷遅延
  mkPO(2, 'sup002', -2, 0, [['itm020', 3000], ['itm022', 200]], 'ordered');    // 本日入荷予定
  mkPO(3, 'sup004', -1, 1, [['itm001', 100], ['itm003', 80]], 'ordered');
  mkPO(4, 'sup002', -3, 2, [['itm018', 100], ['itm024', 400]], 'ordered');
  mkPO(5, 'sup004', -10, -5, [['itm011', 150]], 'received', [[0, 150, 150]]);
  mkPO(6, 'sup002', -8, -4, [['itm025', 5000]], 'received', [[0, 5000, 5000]]);

  /* 採番カウンタを実データに合わせる */
  const syncSeq = (arr, key) => arr.forEach(r => {
    const m = String(r[key]).match(/^(.*)-(\d{8})-(\d{4})$/);
    if (!m) return;
    const k = m[1] + '-' + m[2];
    const n = +m[3];
    const ex = db.sequences.find(s => s.key === k);
    if (ex) ex.last = Math.max(ex.last, n); else db.sequences.push({ key: k, prefix: m[1], date: m[2], last: n });
  });
  syncSeq(db.orders, 'orderNo'); syncSeq(db.purchaseOrders, 'poNo');
  /* ---- マルチテナント: 既存デモデータは既定組織（SETOLAS / 1）へ自動割当 ---- */
  seedAssignOrganizations(db);

  syncSeq(db.receipts, 'receiptNo'); syncSeq(db.shipments, 'shipmentNo');
  return db;
};

/* ------------------------------ Store ------------------------------ */
/* 既存デモデータを既定組織へ割当てる（データ移行の初期状態を再現）。
   併せて分離を確認できるよう A-FARM（id=2）のサンプルを1式だけ用意する。 */
function seedAssignOrganizations(db) {
  TENANT_TABLES.filter(k => k !== 'organizations').forEach(k => {
    (db[k] || []).forEach(r => { if (r.organizationId == null) r.organizationId = DEFAULT_ORG_ID; });
  });
  if ((db.companies || []).some(c => c.id === 'co010')) return db;   /* 二重投入の抑止 */
  const org2 = 2, now = new Date().toISOString();
  db.companies.push({
    id: 'co010', companyCode: 'C010', name: 'Ａファーム株式会社', postalCode: '〒771-0000',
    address: '徳島県徳島市○○町4-5-6', tel: '088-000-1000', fax: '088-000-1001', email: 'info@a-farm.local',
    invoiceNumber: 'T3234567890123', logoUrl: '', notes: 'A-FARM 組織の会社（分離確認用）', isActive: true,
    visibleFields: { address: true, tel: true, fax: true, email: false, invoiceNumber: true, logo: true }, organizationId: org2, createdAt: now, updatedAt: now
  });
  db.branches.push({
    id: 'br010', companyId: 'co010', branchCode: 'H010', name: '徳島本社', postalCode: '〒771-0000',
    address: '徳島県徳島市○○町4-5-6', tel: '088-000-1000', fax: '088-000-1001', email: 'info@a-farm.local',
    managerName: '青木 大地', notes: '', isActive: true, visibleFields: { address: true, tel: true, fax: true, email: false, manager: true },
    organizationId: org2, createdAt: now, updatedAt: now
  });
  db.customers.push({
    id: 'cus010', code: 'C-100', name: 'Ａファーム取引先商事', kana: 'エーファームトリヒキサキ',
    tel: '088-111-2222', address: '徳島県徳島市中央9-9-9', closingDay: 31, paymentTerms: '翌月末',
    email: '', contact: '', salesRepId: null, active: true, notes: 'A-FARM 組織', organizationId: org2, createdAt: now, updatedAt: now
  });
  db.suppliers.push({
    id: 'sup010', code: 'S-100', name: 'Ａファーム資材商会', kana: 'エーファームシザイ',
    tel: '088-333-4444', address: '徳島県鳴門市1-1-1', closingDay: 31, paymentTerms: '翌月末', leadTime: 3,
    email: '', contact: '', active: true, notes: 'A-FARM 組織', organizationId: org2, createdAt: now, updatedAt: now
  });
  db.items.push({
    id: 'itm010', kind: 'product', code: 'A-001', name: 'Ａファーム トマト 5kg', kana: 'トマト',
    category: '果菜類', unit: 'ケース', spec: '5kg/ケース', salePrice: 2800, costPrice: 1900, taxRate: 8,
    reorderPoint: 10, reorderQty: 20, safetyStock: 5, stock: 30, location: 'D-01', janCode: '',
    barcode: '', supplierId: null, active: true, notes: 'A-FARM 組織', organizationId: org2, createdAt: now, updatedAt: now
  });
  db.orders.push({
    id: 'ord010', orderNo: 'AF-20261030-0001', customerId: 'cus010', customerName: 'Ａファーム取引先商事',
    orderDate: TODAY, dueDate: TODAY, shipDate: TODAY, status: 'received', subtotal: 8400, tax: 672, total: 9072,
    remarks: 'A-FARM 組織のサンプル受注', companyId: 'co010', branch1Id: 'br010', branch2Id: null,
    organizationId: org2, createdBy: 'usr010', createdAt: now, updatedAt: now
  });
  db.orderLines.push({
    id: 'odl010', orderId: 'ord010', lineNo: 1, itemId: 'itm010', itemName: 'Ａファーム トマト 5kg', unit: 'ケース',
    quantity: 3, unitPrice: 2800, taxRate: 8, amount: 8400, shippedQty: 0, dueDate: TODAY, notes: '', organizationId: org2
  });
  db.shipments.push({
    id: 'shp010', shipmentNo: 'AF-20261030-S001', orderId: 'ord010', orderNo: 'AF-20261030-0001',
    customerId: 'cus010', customerName: 'Ａファーム取引先商事', shipDate: TODAY, status: 'confirmed',
    carrier: '佐川急便', trackingNo: '', shipToName: 'Ａファーム取引先商事', shipToAddr: '徳島県徳島市中央9-9-9',
    remarks: '', companyId: 'co010', branch1Id: 'br010', branch2Id: null, organizationId: org2,
    createdBy: 'usr010', createdAt: now, updatedAt: now
  });
  db.shipmentLines.push({
    id: 'shl010', shipmentId: 'shp010', orderLineId: 'odl010', itemId: 'itm010', itemName: 'Ａファーム トマト 5kg',
    unit: 'ケース', quantity: 3, lotNo: 'AF-LOT-001', notes: '', organizationId: org2
  });
  return db;
}

const Store = {
  db: null,
  /* Store.db が用意できているか（未初期化時に例外を出さないための判定） */
  isReady() { return !!(this.db && typeof this.db === 'object'); },
  /* opt.offline=true のときは Supabase へ書き戻さない（接続不可時のセッション内動作） */
  load(opt) {
    opt = opt || {};
    /* Supabase版: SB.init() が Store.db を設定済み。未設定時のみデモシードを生成 */
    if (this.db) {
      this.migrateTenant();
      this.migrateIssuerMasters();
      if (typeof Tenant !== 'undefined' && typeof Auth !== 'undefined' && Auth && Auth.user) Tenant.enter(Auth.user);
      return this.db;
    }
    this.db = buildSeed();
    this.migrateTenant();
    this.migrateIssuerMasters();
    this.offline = !!opt.offline;
    if (!opt.offline && typeof SB !== 'undefined' && SB.ready) SB.requestSync();
    return this.db;
  },
  /* 旧バージョン（単一会社設定 settings.company）→ 会社マスタ（companies）への自動移行。
     会社マスタが空のときだけ実行し、既存伝票の表示内容には影響しない。
     帳票テンプレートが未登録のときは標準テンプレートを投入する。 */
  /* マルチテナント移行: organization_id 未設定の既存行を既定組織（SETOLAS=1）へ割当 */
  migrateTenant() {
    if (!this.db) return;
    this.db.organizations = this.db.organizations || [];
    if (!this.db.organizations.length) {
      this.db.organizations = SEED_ORGANIZATIONS.map(a => ({
        id: a[0], organizationCode: a[1], organizationName: a[2], isActive: true,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      }));
    }
    TENANT_TABLES.filter(k => k !== 'organizations').forEach(k => {
      (this.db[k] || []).forEach(r => { if (r.organizationId == null) r.organizationId = DEFAULT_ORG_ID; });
    });
  },

  migrateIssuerMasters() {
    const db = this.db; if (!db) return;
    db.companies = db.companies || []; db.branches = db.branches || []; db.docTemplates = db.docTemplates || [];
  /* 既存テンプレート移行：レイアウト項目が無い場合は既定値を補完 */
  db.docTemplates.forEach(t => {
    if (t.branch1 === undefined) t.branch1 = true;
    if (t.branch2 === undefined) t.branch2 = true;
    if (!t.branchMode) t.branchMode = 'both';
    if (!t.paper) t.paper = 'portrait';
    if (t.watermark === undefined) t.watermark = true;
    if (t.footer === undefined) t.footer = true;
  });
    const now = new Date().toISOString();
    if (!db.companies.length) {
      const c = (db.settings && db.settings.company) || {};
      db.companies.push({
        id: 'co001', companyCode: 'C001', name: c.name || '自社', postalCode: c.postal || '', address: c.address || '',
        tel: c.tel || '', fax: c.fax || '', email: c.email || '', invoiceNumber: c.invoiceNo || c.invoiceNumber || '',
        logoUrl: c.logoUrl || '', notes: '旧「自社情報」から自動移行', isActive: true,
        visibleFields: Object.assign({}, ALL_VISIBLE), createdAt: now, updatedAt: now
      });
    }
    if (!db.docTemplates.length) {
      SEED_DOC_TEMPLATES.forEach(a => db.docTemplates.push({
        id: 'tpl' + String(db.docTemplates.length + 1).padStart(3, '0'), templateCode: a[1], name: a[2], docKind: a[3], companyId: a[4],
        companyName: a[5].companyName, branchName: a[5].branchName, address: a[5].address, tel: a[5].tel, fax: a[5].fax,
        email: a[5].email, invoiceNumber: a[5].invoiceNumber, manager: a[5].manager, logo: a[5].logo,
        isDefault: a[6], isActive: true, notes: a[7], branch1: true, branch2: true, branchMode: 'both', paper: 'portrait', watermark: true, footer: true, createdAt: now, updatedAt: now
      }));
    }
    db.version = 3;
  },
  /* v1（ロール選択ログイン）→ v2（ID・パスワード認証）の移行。
     既存ユーザーには初期パスワード Temp1234! を付与し、初回ログイン時に変更必須とする。 */
  migrateV1toV2() {
    const now = new Date().toISOString();
    this.db.users = (this.db.users || []).map((u, i) => Object.assign({}, u, {
      loginId: u.loginId || (String(u.email || '').split('@')[0] || 'user' + (i + 1)),
      passwordHash: u.passwordHash || TEMP_PASSWORD_HASH,
      forcePasswordChange: u.forcePasswordChange !== false,
      enabled: u.enabled != null ? !!u.enabled : (u.active !== false),
      createdAt: u.createdAt || now, updatedAt: u.updatedAt || now
    }));
    this.db.loginSecurity = this.db.loginSecurity || {};
    this.db.version = 2;
  },
  save() {
    /* 未初期化（Store.db === null）でも例外を投げない */
    if (!this.db) return;
    /* マルチテナント: 新規登録行へログインユーザーの organization_id を自動付与 */
    if (typeof Tenant !== 'undefined') { try { Tenant.stampAll(this.db); } catch (e) { /* noop */ } }
    try { sessionStorage.setItem('agri_loginsec', JSON.stringify(this.db.loginSecurity || {})); } catch (e) {}
    if (typeof SB !== 'undefined' && SB.ready) { SB.requestSync(); return; }
    /* Supabase未接続時: セッション内のみの暫定保存（localStorageは廃止） */
    try { sessionStorage.setItem('agri_erp_session', JSON.stringify(this.db)); } catch (e) { console.warn('save failed', e); }
  },
  reset() {
    this.db = buildSeed();
    this.migrateIssuerMasters();
    if (typeof SB !== 'undefined' && SB.ready) SB.reseedAll();
    else this.save();
  },

  /* ---------- 採番（帳票番号自動採番） ---------- */
  nextNo(prefix, date = TODAY) {
    if (Store._dryRun) return '（プレビュー）';
    const d = date.replace(/-/g, '');
    const key = 'o' + (typeof Tenant !== 'undefined' ? Tenant.id() : DEFAULT_ORG_ID) + ':' + prefix + '-' + d;
    let s = this.db.sequences.find(x => x.key === key);
    if (!s) { s = { key, prefix, date: d, last: 0 }; this.db.sequences.push(s); }
    s.last += 1;
    return key + '-' + String(s.last).padStart(4, '0');
  },

  /* ---------- 在庫増減（唯一の経路） ---------- */
  applyStock(itemId, qty, moveType, ref) {
    const it = this.db.items.find(x => x.id === itemId);
    if (!it) throw new Error('商品が見つかりません: ' + itemId);
    it.stock = +(it.stock + qty).toFixed(2);
    const mv = {
      id: uid(), movedAt: new Date().toISOString(), moveDate: TODAY, moveType,
      itemId, itemName: it.name, quantity: qty, balanceAfter: it.stock,
      refTable: ref.table || '', refId: ref.id || '', refNo: ref.no || '',
      operatorId: Auth.user ? Auth.user.id : 'system', notes: ref.notes || ''
    };
    this.db.movements.unshift(mv);
    return mv;
  },

  /* ---------- 検索ヘルパ ---------- */
  item: id => Store.db.items.find(x => x.id === id),
  customer: id => Store.db.customers.find(x => x.id === id),
  supplier: id => Store.db.suppliers.find(x => x.id === id),
  user: id => Store.db.users.find(x => x.id === id),
  userByLoginId: lid => Store.db.users.find(x => String(x.loginId).toLowerCase() === String(lid || '').trim().toLowerCase()),
  /* 営業担当者（得意先の既定担当 → 受注の担当 の順で解決） */
  salesRepName(id) { const u = id ? Store.user(id) : null; return u ? u.name : ''; },
  salesReps() {
    /* 営業担当として選択できるユーザー（事務担当・管理者）。既存データの担当者も含める */
    const users = Store.db.users.filter(u => u.enabled !== false && ['office', 'admin'].includes(u.role));
    const used = new Set([
      ...Store.db.customers.map(c => c.salesRepId),
      ...Store.db.orders.map(o => o.salesRepId)
    ].filter(Boolean));
    const ids = new Set(users.map(u => u.id));
    const extra = Store.db.users.filter(u => used.has(u.id) && !ids.has(u.id));
    return users.concat(extra).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ja'));
  },
  shipmentRepId(s) {
    if (!s) return '';
    const o = s.orderId ? Store.order(s.orderId) : null;
    const c = s.customerId ? Store.customer(s.customerId) : null;
    return (o && o.salesRepId) || (c && c.salesRepId) || '';
  },
  shipmentAmount(s) {
    return Store.shipLines(s.id).reduce((a, l) => {
      const ol = l.orderLineId ? Store.db.orderLines.find(x => x.id === l.orderLineId) : null;
      const it = Store.item(l.itemId) || {};
      return a + ((ol ? ol.unitPrice : (it.salePrice || 0)) * l.quantity);
    }, 0);
  },
  order: id => Store.db.orders.find(x => x.id === id),
  po: id => Store.db.purchaseOrders.find(x => x.id === id),
  shipment: id => Store.db.shipments.find(x => x.id === id),
  orderLines: id => Store.db.orderLines.filter(x => x.orderId === id),
  poLines: id => Store.db.poLines.filter(x => x.poId === id),
  shipLines: id => Store.db.shipmentLines.filter(x => x.shipmentId === id),
  receiptLines: id => Store.db.receiptLines.filter(x => x.receiptId === id),

  /* ---------- 集計 ---------- */
  orderRemaining: o => Store.orderLines(o.id).reduce((s, l) => s + (l.quantity - l.shippedQty), 0),
  poRemaining: p => Store.poLines(p.id).reduce((s, l) => s + (l.quantity - l.receivedQty), 0),
  alertLevel(it) {
    if (it.stock <= it.safetyStock) return 'danger';
    if (it.stock <= it.reorderPoint) return 'warning';
    return 'ok';
  },
  stockAlerts() { return this.db.items.filter(i => i.active && i.stock <= i.reorderPoint).sort((a, b) => (a.stock - a.reorderPoint) - (b.stock - b.reorderPoint)); },
  orderBacklog() {
    const rows = [];
    this.db.orders.filter(o => !['completed', 'cancelled'].includes(o.status)).forEach(o => {
      this.orderLines(o.id).forEach(l => {
        if (l.shippedQty < l.quantity) rows.push({
          orderId: o.id, orderNo: o.orderNo, orderDate: o.orderDate, dueDate: l.dueDate || o.dueDate,
          customerName: o.customerName, itemId: l.itemId, itemName: l.itemName, unit: l.unit,
          quantity: l.quantity, shippedQty: l.shippedQty, remaining: l.quantity - l.shippedQty,
          overdue: (l.dueDate || o.dueDate) < TODAY
        });
      });
    });
    return rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  },
  poBacklog() {
    const rows = [];
    this.db.purchaseOrders.filter(p => !['completed', 'cancelled'].includes(p.status)).forEach(p => {
      this.poLines(p.id).forEach(l => {
        if (l.receivedQty < l.quantity) rows.push({
          poId: p.id, poNo: p.poNo, orderDate: p.orderDate, expectedDate: l.expectedDate || p.expectedDate,
          supplierName: p.supplierName, itemId: l.itemId, itemName: l.itemName, unit: l.unit,
          quantity: l.quantity, receivedQty: l.receivedQty, remaining: l.quantity - l.receivedQty,
          overdue: (l.expectedDate || p.expectedDate) < TODAY
        });
      });
    });
    return rows.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  },
  todayShipments() {
    return this.db.shipments.filter(s => s.shipDate === TODAY && s.status !== 'cancelled')
      .map(s => ({ ...s, qty: this.shipLines(s.id).reduce((a, l) => a + l.quantity, 0), lines: this.shipLines(s.id).length }))
      .sort((a, b) => a.shipmentNo.localeCompare(b.shipmentNo));
  },
  alerts() {
    const out = [];
    this.stockAlerts().forEach(i => out.push({
      kind: 'stock', level: this.alertLevel(i) === 'danger' ? 'danger' : 'warning',
      title: `${i.name} の在庫が${this.alertLevel(i) === 'danger' ? '安全在庫' : '発注点'}を下回っています`,
      detail: `現在庫 ${i.stock} ${i.unit} ／ 発注点 ${i.reorderPoint} ／ 安全在庫 ${i.safetyStock}`,
      go: 'inventory', id: i.id
    }));
    this.orderBacklog().filter(r => r.overdue).forEach(r => out.push({
      kind: 'order', level: 'danger', title: `受注 ${r.orderNo} の納期が超過しています`,
      detail: `${r.customerName} ／ ${r.itemName} 残 ${r.remaining} ／ 納期 ${r.dueDate}`, go: 'orders', id: r.orderId
    }));
    this.poBacklog().filter(r => r.overdue).forEach(r => out.push({
      kind: 'po', level: 'warning', title: `発注 ${r.poNo} の入荷予定日を過ぎています`,
      detail: `${r.supplierName} ／ ${r.itemName} 残 ${r.remaining} ／ 予定 ${r.expectedDate}`, go: 'purchase', id: r.poId
    }));
    this.db.shipments.filter(s => s.status === 'instructed' && s.shipDate < TODAY).forEach(s => out.push({
      kind: 'ship', level: 'warning', title: `出荷 ${s.shipmentNo} が未確定のまま日付を過ぎています`,
      detail: `${s.customerName} ／ 出荷日 ${s.shipDate}`, go: 'shipping', id: s.id
    }));
    return out;
  }
};


/* ===== 02-core.js ===== */
/* ==========================================================================
   アグリERP — 認証・権限・UI 基盤・ルーティング
   ========================================================================== */
const ROLES = {
  admin:    { label: '管理者',   desc: 'すべての機能を利用できます', color: 'green',  icon: 'shield', av: 'linear-gradient(140deg,#34d399,#0ea5e9)' },
  office:   { label: '事務担当', desc: '受注・発注・在庫・帳票を担当', color: 'sky',    icon: 'clipboard', av: 'linear-gradient(140deg,#38bdf8,#8b5cf6)' },
  shipping: { label: '出荷担当', desc: '出荷指示・確定・帳票印刷を担当', color: 'amber',  icon: 'truck', av: 'linear-gradient(140deg,#fbbf24,#f97316)' }
};

/* ==========================================================================
   マルチテナント（組織）基盤
   - ログインユーザーの organization_id を唯一の境界として全データを絞り込む
   - Store.db はログイン時に自組織のみへスコープされる（他組織データは保持しない）
   - 登録時は organization_id を自動付与（利用者入力は不要）
   ========================================================================== */
const Tenant = {
  DEFAULT_ID: 1,
  _raw: null,     /* ログアウト時の復元用（ organización 切替はページ再読込を推奨） */

  id() {
    const u = (typeof Auth !== 'undefined' && Auth && Auth.user) || null;
    const v = u ? (u.organizationId != null ? u.organizationId : u.organization_id) : null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : this.DEFAULT_ID;
  },
  all() { return (typeof Store !== 'undefined' && Store.db && Store.db.organizations) || []; },
  org(id) {
    const t = id == null ? this.id() : Number(id);
    return this.all().find(o => Number(o.id) === t) || null;
  },
  name(id) { const o = this.org(id); return o ? o.organizationName : '—'; },
  code(id) { const o = this.org(id); return o ? o.organizationCode : '—'; },
  isActive(id) { const o = this.org(id); return !!o && o.isActive !== false; },
  isSystemAdmin() {
    const u = (typeof Auth !== 'undefined' && Auth) ? Auth.user : null;
    return !!(u && (u.isSystemAdmin || u.emergency));
  },
  owns(row) { return !!row && Number(row.organizationId) === this.id(); },
  filter(arr) { return (arr || []).filter(r => this.owns(r)); },
  stamp(row) { if (row && row.organizationId == null) row.organizationId = this.id(); return row; },
  _keyOf(k, row) { return row && (row.id != null ? row.id : row.key != null ? row.key : null); },
  stampAll(db) {
    TENANT_TABLES.filter(k => k !== 'organizations').forEach(k => {
      (db[k] || []).forEach(r => {
        this.stamp(r);
        /* 復元用スナップショットにも同時反映（新規行を失わない） */
        if (this._raw && Array.isArray(this._raw[k])) {
          const key = this._keyOf(k, r);
          const i = this._raw[k].findIndex(x => this._keyOf(k, x) === key);
          if (i >= 0) this._raw[k][i] = r; else this._raw[k].push(r);
        }
      });
    });
  },
  scope(db) {
    if (!db) return;
    if (!this._raw) {
      this._raw = {};
      TENANT_TABLES.forEach(k => { if (Array.isArray(db[k])) this._raw[k] = db[k].slice(); });
    }
    TENANT_TABLES.filter(k => k !== 'organizations').forEach(k => {
      if (!Array.isArray(db[k])) return;
      const base = this._raw[k] || db[k];
      db[k] = base.filter(r => this.owns(r));
    });
  },
  enter(user) {
    if (user && user.organizationId == null) user.organizationId = this.DEFAULT_ID;
    if (typeof Store !== 'undefined' && Store.db) this.scope(Store.db);
    return this.id();
  },
  reset(db) {
    if (db && this._raw) TENANT_TABLES.filter(k => k !== 'organizations').forEach(k => { if (this._raw[k]) db[k] = this._raw[k].slice(); });
    this._raw = null;
  },
  /* 画面表示用（現在の組織ラベル） */
  label() { const o = this.org(); return o ? `${o.organizationName}（${o.organizationCode}）` : '—'; }
};

/* メニュー定義（権限で出し分け） */
const MENU = [
  { group: 'ホーム', items: [
    { id: 'dashboard', label: 'ダッシュボード', sub: '本日の状況サマリー', icon: 'grid', roles: ['admin','office','shipping'] },
    { id: 'alerts',    label: '警告一覧',       sub: '在庫不足・納期遅延', icon: 'alert', roles: ['admin','office','shipping'], badge: 'alerts' }
  ]},
  { group: '在庫管理', items: [
    { id: 'inventory',  label: '在庫一覧',    sub: '現在庫・発注点管理',  icon: 'box',   roles: ['admin','office'] },
    { id: 'movements',  label: '入出庫履歴',  sub: '在庫増減の全記録',    icon: 'clock', roles: ['admin','office'] },
    { id: 'products',   label: '商品マスタ',  sub: '販売商品の登録',      icon: 'tag',   roles: ['admin','office'] },
    { id: 'materials',  label: '資材マスタ',  sub: '梱包・消耗資材の登録', icon: 'layers',roles: ['admin','office'] }
  ]},
  { group: '受注管理', items: [
    { id: 'orders',     label: '受注一覧',    sub: '受注残・納期管理',    icon: 'file',  roles: ['admin','office'] },
    { id: 'customers',  label: '得意先マスタ', sub: '取引先の登録',       icon: 'users', roles: ['admin','office'] }
  ]},
  { group: '発注管理', items: [
    { id: 'purchase',   label: '発注一覧',    sub: '発注残管理',          icon: 'cart',  roles: ['admin','office'] },
    { id: 'receipts',   label: '入荷処理',    sub: '入荷確定で在庫加算',   icon: 'inbox', roles: ['admin','office'] },
    { id: 'suppliers',  label: '仕入先マスタ', sub: '仕入先の登録',        icon: 'factory', roles: ['admin','office'] }
  ]},
  { group: '出荷管理', items: [
    { id: 'shipping',   label: '出荷指示',    sub: '出荷の指示と確定',     icon: 'truck', roles: ['admin','office','shipping'] },
    { id: 'shipHistory',label: '出荷検索・履歴', sub: '期間・得意先・営業担当・状態で検索', icon: 'history', roles: ['admin','office','shipping'] },
    { id: 'docs',       label: '帳票発行',    sub: '納品書・出荷伝票・ピッキング', icon: 'printer', roles: ['admin','office','shipping'] }
  ]},
  { group: 'システム', items: [
    { id: 'users',    label: 'ユーザー管理', sub: '権限の設定',           icon: 'user', roles: ['admin'] },
    { id: 'organizations', label: '組織マスタ', sub: 'テナントの追加・編集・停止', icon: 'layers', roles: ['admin'], sysOnly: true },
    { id: 'companies', label: '会社・拠点マスタ', sub: 'グループ会社と拠点の登録', icon: 'factory', roles: ['admin'] },
    { id: 'docTemplates', label: '帳票テンプレート', sub: '帳票の表示項目を定義', icon: 'printer', roles: ['admin'] },
    { id: 'settings', label: 'システム設定', sub: 'データ管理と将来拡張',   icon: 'settings', roles: ['admin'] }
  ]}
];

/* ------------------------------ アイコン ------------------------------ */
const ICONS = {
  grid:'<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
  alert:'<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  box:'<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  tag:'<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-8.2-8.2V3h9.4l8.8 8.8a2 2 0 010 2.6z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
  layers:'<path d="M12 2l9 5-9 5-9-5z"/><path d="M3 12l9 5 9-5M3 17l9 5 9-5"/>',
  file:'<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/>',
  users:'<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/>',
  cart:'<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 002 1.6h9.7a2 2 0 002-1.6L23 6H6"/>',
  inbox:'<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>',
  factory:'<path d="M2 20h20V9l-6 4V9l-6 4V4H2z"/><path d="M6 16h.01M10 16h.01M14 16h.01M18 16h.01"/>',
  truck:'<path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="18.5" cy="18.5" r="2"/>',
  history:'<path d="M3 12a9 9 0 109-9 9 9 0 00-6.36 2.64L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  printer:'<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><path d="M6 14h12v8H6z"/>',
  user:'<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9v0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
  shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  clipboard:'<path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>',
  print:'<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><path d="M6 14h12v8H6z"/>',
  check:'<path d="M20 6L9 17l-5-5"/>',
  x:'<path d="M18 6L6 18M6 6l12 12"/>',
  download:'<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
  edit:'<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/>',
  trash:'<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>',
  trend:'<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
  truckIn:'<path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="18.5" cy="18.5" r="2"/><path d="M12 20v-8M9 15l3-3 3 3"/>',
  yen:'<path d="M12 12L6 3M12 12l6-9M6 12h12M6 16h12M12 12v9"/>',
  barcode:'<path d="M3 5v14M6 5v14M9.5 5v10M13 5v14M16.5 5v10M20 5v14"/>',
  qr:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM19 19h2v2h-2z"/>',
  excel:'<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M9 12l5 6M14 12l-5 6"/>',
  cloud:'<path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>',
  line:'<path d="M21 10.5a8.4 8.4 0 01-8.5 8.4 9 9 0 01-3.7-.8L4 20l1-3.6A8.4 8.4 0 0112.5 2 8.4 8.4 0 0121 10.5z"/>',
  eye:'<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
  filter:'<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
  refresh:'<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>'
};
const ico = (n, s = 18, sw = 2) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;

/* ------------------------------ ユーティリティ ------------------------------ */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => Number(n || 0).toLocaleString('ja-JP');
const money = n => '¥' + Number(n || 0).toLocaleString('ja-JP');
const dec = n => Number(n || 0).toLocaleString('ja-JP', { maximumFractionDigits: 2 });
const dJP = s => { if (!s) return '—'; const d = new Date(s); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
const dJPfull = s => { if (!s) return '—'; const d = new Date(s); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; };
const dtJP = s => { if (!s) return '—'; const d = new Date(s); return `${dJP(s)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
const wkJP = s => ['日','月','火','水','木','金','土'][new Date(s).getDay()];
const relDay = s => {
  if (!s) return '';
  const a = Math.round((new Date(s) - new Date(TODAY)) / 86400000);
  if (a === 0) return '本日'; if (a === 1) return '明日'; if (a === -1) return '昨日';
  return a > 0 ? `${a}日後` : `${-a}日前`;
};
const STATUS = {
  received:   ['未出荷', 'sky'], instructed: ['出荷指示済', 'amber'], partial: ['一部出荷', 'violet'],
  shipped:    ['出荷済', 'green'], completed: ['完了', 'green'], cancelled: ['取消', 'gray'],
  ordered:    ['発注済', 'sky'], confirmed:   ['確定', 'green']
};
const badge = (key, txt) => { const s = STATUS[key] || ['—', 'gray']; return `<span class="badge ${s[1]}">${esc(txt || s[0])}</span>`; };
const moveLabel = t => ({ receipt: '入荷', shipment: '出荷', adjustment: '調整', return: '返品', loss: 'ロス' }[t] || t);
const moveBadge = t => ({ receipt: 'green', shipment: 'amber', adjustment: 'sky', return: 'violet', loss: 'rose' }[t] || 'gray');

/* ------------------------------ UI ------------------------------ */
const UI = {
  openSidebar() { document.getElementById('sidebar').classList.add('open'); document.getElementById('scrim').classList.add('on'); },
  closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('scrim').classList.remove('on'); },
  toast(msg, type = 'ok') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.innerHTML = ico(type === 'err' ? 'x' : type === 'warn' ? 'alert' : 'check', 17, 2.4) + '<span>' + esc(msg) + '</span>';
    document.getElementById('toast').appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(40px)'; t.style.transition = '.3s'; setTimeout(() => t.remove(), 320); }, 3200);
  },
  modal(title, sub, body, footer, cls = '') {
    const m = document.getElementById('modal');
    m.innerHTML = `<div class="modal-bg" onclick="UI.closeModal()"></div>
      <div class="modal-box ${cls}">
        <div class="modal-h">
          <div style="min-width:0"><h3>${esc(title)}</h3>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
          <button class="x" onclick="UI.closeModal()">${ico('x', 17, 2.4)}</button>
        </div>
        <div class="modal-b">${body}</div>
        ${footer ? `<div class="modal-f">${footer}</div>` : ''}
      </div>`;
    m.classList.add('on');
    document.body.style.overflow = 'hidden';
  },
  closeModal() { document.getElementById('modal').classList.remove('on'); document.body.style.overflow = ''; },
  confirm(title, msg, onOk, okLabel = '実行する', cls = 'primary') {
    window.__ok = () => { UI.closeModal(); onOk(); };
    UI.modal(title, '', `<div class="note ${cls === 'danger' ? 'rose' : 'amber'}">${esc(msg)}</div>`, 
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn ${cls}" onclick="window.__ok()">${esc(okLabel)}</button>`, 'slim');
  },
  /* テキストコピー（仮パスワード等）。クリップボードAPI不可環境はフォールバック */
  copyText(text, msg) {
    const done = () => UI.toast(msg || 'コピーしました', 'ok');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => this._copyFallback(text, done));
    else this._copyFallback(text, done);
  },
  _copyFallback(text, done) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done();
    } catch (e) { UI.toast('コピーできませんでした。手動で選択してください', 'warn'); }
  }
};

/* ------------------------------ セキュリティ（パスワードハッシュ） ------------------------------
   PBKDF2-SHA256（100,000反復・16バイトのランダムソルト付き）でハッシュ化する。
   保存形式: pbkdf2-sha256$<反復回数>$<ソルト(hex)>$<ハッシュ(hex)> — 平文は一切保存しない。
   ハッシュ化には Web Crypto（crypto.subtle）を使用する（file:// / https / localhost で利用可能）。 */
const Security = {
  ITER: 100000,
  TEMP: 'Temp1234!',
  _te: s => new TextEncoder().encode(s),
  _hex: buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''),
  _salt() { const b = new Uint8Array(16); crypto.getRandomValues(b); return this._hex(b); },
  async hashPassword(pw, salt) {
    const s = salt || this._salt();
    const key = await crypto.subtle.importKey('raw', this._te(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: this._te(s), iterations: this.ITER }, key, 256);
    return `pbkdf2-sha256$${this.ITER}$${s}$${this._hex(bits)}`;
  },
  async verifyPassword(pw, stored) {
    try {
      const [alg, iter, salt, hash] = String(stored || '').split('$');
      if (alg !== 'pbkdf2-sha256' || !salt || !hash) return false;
      const key = await crypto.subtle.importKey('raw', this._te(pw), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: this._te(salt), iterations: Math.min(+iter || this.ITER, 1000000) }, key, 256);
      const a = this._hex(bits);
      if (a.length !== hash.length) return false;
      let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ hash.charCodeAt(i);
      return d === 0;
    } catch (e) { return false; }
  },
  /* 仮パスワード生成（例: Temp1234! / AbCd5678! / XyZ98765!）
     英字（大文字・小文字混在）4文字 + 数字4文字 + 記号「!」の9文字。強度基準（8文字以上・大文字／小文字／数字／記号）を必ず満たす */
  genTempPassword() {
    const up = 'ABCDEFGHJKLMNPQRSTUVWXYZ', low = 'abcdefghijkmnpqrstuvwxyz', dg = '0123456789';
    const b = new Uint32Array(8); crypto.getRandomValues(b);
    const pick = (s, i) => s[b[i] % s.length];
    const out = pick(up, 0) + pick(low, 1) + pick(up, 2) + pick(low, 3) + pick(dg, 4) + pick(dg, 5) + pick(dg, 6) + pick(dg, 7) + '!';
    return this.pwIssues(out).length ? this.genTempPassword() : out;   /* 念のため強度基準を確認 */
  },
  /* パスワード強度チェック（8文字以上・大文字／小文字／数字／記号） */
  pwIssues(pw) {
    const p = String(pw || ''), out = [];
    if (p.length < 8) out.push('8文字以上にする');
    if (!/[a-z]/.test(p)) out.push('小文字を含める');
    if (!/[A-Z]/.test(p)) out.push('大文字を含める');
    if (!/[0-9]/.test(p)) out.push('数字を含める');
    if (!/[^A-Za-z0-9]/.test(p)) out.push('記号を含める');
    return out;
  }
};

/* ------------------------------ 監査ログ（操作ログ） ------------------------------
   Store.db.auditLogs（既存構造）へ記録する。Supabase接続時は専用テーブル audit_logs
   （sql/03_add_audit_logs.sql）にも保存する（失敗しても他の処理には影響しない）。
   仮パスワード等の機密情報は一切記録しない。 */
const AUDIT_LABEL = { password_reset: 'パスワードリセット', emergency_login: '緊急管理者ログイン' };
const Audit = {
  /* 記録項目: 実行者（actorLoginId / actorName）・対象ユーザー（targetLoginId / targetName）・実行日時（createdAt）・IPアドレス（ipAddress） */
  add(action, target, ip) {
    try {
      const a = (typeof Auth !== 'undefined' && Auth.user) || {};
      const row = {
        id: uid(), action,
        actorLoginId: a.loginId || '', actorName: a.name || '',
        targetLoginId: (target && target.loginId) || '', targetName: (target && target.name) || '',
        ipAddress: ip || null, userAgent: String(navigator.userAgent || '').slice(0, 200),
        createdAt: new Date().toISOString()
      };
      Store.db.auditLogs = Store.db.auditLogs || [];
      Store.db.auditLogs.push(row);
      if (typeof SB !== 'undefined' && SB.ready && SB.pushAudit) SB.pushAudit(row);
      return row;
    } catch (e) { console.warn('audit log failed', e); return null; }
  },
  /* グローバルIPをベストエフォートで取得（取得できない場合は null → 画面表示は「—」） */
  async fetchIp() {
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 2500);
      const r = await fetch('https://api.ipify.org?format=json', { signal: c.signal });
      clearTimeout(t);
      const j = await r.json();
      return j && j.ip ? String(j.ip) : null;
    } catch (e) { return null; }
  }
};

/* ------------------------------ 緊急管理者（ブレークグラス・アカウント） ------------------------------
   通常のユーザー認証（Supabase RPC / ローカル照合）より先に判定する非常用ログイン。
   - Supabase 接続状態・Store.db の初期化状態に依存せずログインできる
   - 設定画面「緊急管理者ログインを有効化」が ON のときのみ有効（既定 ON）
   - 既存の users テーブル / Supabase のユーザー行には一切登録しない（既存データを汚さない）
   - ログイン時は監査ログ（audit_logs）に emergency_login として記録する
   ※ 本アプリは静的配布物（単一HTML）のため、認証情報はソースに含まれる。
      配布範囲の管理と、運用開始後の無効化（設定画面）またはシークレット化を推奨。 */
const EMERGENCY = {
  LOGIN_ID: 'tom',
  PASSWORD: 'zep',
  NAME: '緊急管理者',
  USER_ID: 'usr_emergency',
  DEFAULT_ENABLED: true,
  /* セッション用の仮想ユーザー（Store.db.users には追加しない） */
  user() {
    const now = new Date().toISOString();
    return {
      id: this.USER_ID, loginId: this.LOGIN_ID, name: this.NAME, email: '', tel: '',
      role: 'admin', enabled: true, forcePasswordChange: false,
      emergency: true, organizationId: 1, isSystemAdmin: true, createdAt: now, updatedAt: now
    };
  },
  /* 有効判定。Store.db 未初期化・設定欠落時は既定（ON）へフォールバックする */
  enabled() {
    try {
      const s = (typeof Store !== 'undefined' && Store.db && Store.db.settings) ? Store.db.settings : null;
      if (!s || s.emergencyAdmin === undefined || s.emergencyAdmin === null) return this.DEFAULT_ENABLED;
      return s.emergencyAdmin !== false;
    } catch (e) { return this.DEFAULT_ENABLED; }
  },
  setEnabled(on) {
    if (typeof Store === 'undefined' || !Store.db) return false;
    Store.db.settings = Store.db.settings || {};
    Store.db.settings.emergencyAdmin = !!on;
    Store.save();
    return true;
  },
  matches(loginId, pw) {
    const lid = String(loginId == null ? '' : loginId).trim().toLowerCase();
    return lid === this.LOGIN_ID && String(pw == null ? '' : pw) === this.PASSWORD;
  }
};

/* ------------------------------ 認証（ユーザーID・パスワード） ------------------------------ */
const Auth = {
  user: null,
  pendingUser: null,          // 初回ログイン（パスワード変更必須）中のユーザー
  MAX_FAILED: 5,              // 連続失敗回数の上限
  LOCK_MINUTES: 15,           // ロック時間（分）
  init() {
    /* ログインフォームの初期化（ロール選択は廃止） */
    const id = document.getElementById('loginId');
    const pw = document.getElementById('loginPw');
    [id, pw].forEach(el => { if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') Auth.onLogin(); }); });
    if (id && id.focus) id.focus();
  },
  isEmergency() { return !!(this.user && this.user.emergency); },

  /* 認証コア（UI非依存）。失敗時は code / message を返す（例外は投げない） */
  async doLogin(loginId, pw) {
    try {
      const lid = String(loginId == null ? '' : loginId).trim().toLowerCase();
      if (!lid || !pw) return { ok: false, code: 'empty', message: 'ユーザーIDとパスワードを入力してください' };

      /* ---- 1. 緊急管理者：通常ユーザー認証より先に判定（Store.db / Supabase 非依存） ---- */
      if (EMERGENCY.matches(lid, pw)) return this._loginEmergency();

      /* ---- 2. データ未初期化ガード（Store.db が null のまま参照しない） ---- */
      if (typeof Store === 'undefined' || !Store.db) {
        return {
          ok: false, code: 'not_ready',
          message: 'データの初期化が完了していません。数秒後に再試行してください。（Supabaseに接続できない場合は管理者に連絡してください）'
        };
      }

      /* ---- 3. 通常ユーザー認証 ---- */
      const db = Store.db;
      db.loginSecurity = db.loginSecurity || {};
      const sec = db.loginSecurity[lid];
      if (sec && sec.lockedUntil && new Date(sec.lockedUntil) > new Date()) {
        const min = Math.max(1, Math.ceil((new Date(sec.lockedUntil) - Date.now()) / 60000));
        return { ok: false, code: 'locked', message: `連続${this.MAX_FAILED}回失敗したためロック中です。約${min}分後に再試行してください` };
      }
      const u = db.users ? Store.userByLoginId(lid) : null;
      if (!u) { this._fail(lid); return { ok: false, code: 'no_user', message: '存在しないユーザーIDです' }; }
      if (!u.enabled) return { ok: false, code: 'disabled', message: 'このユーザーは無効化されています。管理者に連絡してください' };
      /* Supabase版: パスワード照合はサーバー側（app_verify_login / pgcrypto bcrypt）。ハッシュはクライアントに送られない */
      if (typeof SB !== 'undefined' && SB.ready) {
        const r = await SB.verifyLogin(lid, pw);
        if (!r || !r.ok) {
          this._fail(lid);
          return { ok: false, code: (r && r.code) || 'bad_password', message: (r && r.message) || 'パスワードが一致しません' };
        }
        db.loginSecurity[lid] = { failed: 0, lockedUntil: null };
        return { ok: true, user: r.user };
      }
      if (!await Security.verifyPassword(pw, u.passwordHash)) { this._fail(lid); return { ok: false, code: 'bad_password', message: 'パスワードが一致しません' }; }
      db.loginSecurity[lid] = { failed: 0, lockedUntil: null };
      u.lastLoginAt = new Date().toISOString();   /* 最終ログイン日時（Supabase版は app_verify_login がサーバー側で記録） */
      Store.save();
      return { ok: true, user: u };
    } catch (e) {
      console.error('doLogin failed', e);
      return { ok: false, code: 'exception', message: 'ログイン処理でエラーが発生しました：' + String((e && e.message) || e).slice(0, 160) };
    }
  },

  /* 緊急管理者ログイン（例外を外へ出さない） */
  _loginEmergency() {
    try {
      if (!EMERGENCY.enabled()) {
        return { ok: false, code: 'emergency_disabled', message: '緊急管理者ログインは無効化されています。管理者に連絡してください' };
      }
      /* Store.db が未初期化でも画面を描画できるよう、最低限のデータを用意する（Supabaseへは書き戻さない） */
      if (typeof Store !== 'undefined' && !Store.db) {
        Store.load({ offline: !(typeof SB !== 'undefined' && SB.ready) });
      }
      const u = EMERGENCY.user();
      this.user = u;
      this.pendingUser = null;
      try {
        sessionStorage.setItem('agri_user', u.id);
        sessionStorage.setItem('agri_emergency', '1');
      } catch (e) { /* セッション保存不可でも続行 */ }
      /* 監査ログ（記録に失敗してもログインは継続する） */
      try { Audit.add('emergency_login', u, null); } catch (e) { /* noop */ }
      return { ok: true, user: u, emergency: true };
    } catch (e) {
      console.error('emergency login failed', e);
      return { ok: false, code: 'emergency_error', message: '緊急ログインに失敗しました：' + String((e && e.message) || e).slice(0, 160) };
    }
  },

  _fail(lid) {
    try {
      const db = Store.db;
      if (!db) return;
      db.loginSecurity = db.loginSecurity || {};
      const sec = db.loginSecurity[lid] || { failed: 0, lockedUntil: null };
      sec.failed = (sec.failed || 0) + 1;
      if (sec.failed >= this.MAX_FAILED) {
        sec.lockedUntil = new Date(Date.now() + this.LOCK_MINUTES * 60000).toISOString();
        sec.failed = 0;
      }
      db.loginSecurity[lid] = sec;
      Store.save();
    } catch (e) { /* 失敗記録に失敗しても認証処理は継続 */ }
  },

  /* ログイン画面の送信（例外を画面に出す。クラッシュさせない） */
  async onLogin() {
    const err = document.getElementById('loginErr');
    const btn = document.getElementById('loginBtn');
    if (err) { err.style.display = 'none'; err.textContent = ''; }
    if (btn) btn.disabled = true;
    try {
      const idEl = document.getElementById('loginId');
      const pwEl = document.getElementById('loginPw');
      const r = await this.doLogin(idEl ? idEl.value : '', pwEl ? pwEl.value : '');
      if (!r.ok) {
        if (err) { err.textContent = r.message || 'ログインできませんでした'; err.style.display = 'block'; }
        return;
      }
      if (pwEl) pwEl.value = '';
      this.enterApp(r.user);
    } catch (e) {
      console.error('login screen error', e);
      if (err) { err.textContent = 'ログイン処理でエラーが発生しました：' + String((e && e.message) || e).slice(0, 160); err.style.display = 'block'; }
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  /* 入室処理（初回ログイン時はパスワード変更を要求／緊急管理者はそのまま入室） */
  enterApp(u) {
    this.user = u;
    /* マルチテナント: ログイン直後に自組織データのみへスコープ */
    try { Tenant.enter(u); } catch (e) { /* noop */ }
    try {
      sessionStorage.setItem('agri_user', u.id);
      if (u.emergency) sessionStorage.setItem('agri_emergency', '1');
      else sessionStorage.removeItem('agri_emergency');
    } catch (e) { /* noop */ }
    if (u.forcePasswordChange) {
      this.pendingUser = u;
      const fcU = document.getElementById('fcUser');
      if (fcU) fcU.textContent = `${u.name}（${u.loginId}）`;
      const p1 = document.getElementById('fcPw'), p2 = document.getElementById('fcPw2'), e1 = document.getElementById('fcErr');
      if (p1) p1.value = ''; if (p2) p2.value = ''; if (e1) e1.style.display = 'none';
      const fs = document.getElementById('forceScreen'); if (fs) fs.style.display = 'flex';
      if (p1 && p1.focus) p1.focus();
      return;
    }
    this.showApp();
  },

  showApp() {
    this.pendingUser = null;
    const $ = id => document.getElementById(id);
    if ($('loginScreen')) $('loginScreen').style.display = 'none';
    if ($('forceScreen')) $('forceScreen').style.display = 'none';
    if ($('appShell')) $('appShell').style.display = 'block';
    const u = this.user || {};
    /* 所属組織バッジ（マルチテナント: 現在どの組織で操作しているかを常時表示） */
    if ($('orgBadge')) {
      const o = Tenant.org(u.organizationId != null ? u.organizationId : 1);
      $('orgBadge').textContent = o ? `${o.organizationName}（${o.organizationCode}）` : '';
      $('orgBadge').style.display = o ? 'inline-flex' : 'none';
    }
    if ($('sbName')) $('sbName').textContent = u.name || '';
    if ($('sbRole')) $('sbRole').textContent = (ROLES[u.role] || {}).label || u.role || '';
    if ($('sbAv')) {
      $('sbAv').textContent = String(u.name || '?').charAt(0);
      $('sbAv').style.background = (ROLES[u.role] || {}).av || '';
    }
    /* 緊急管理者ログイン中のバナー */
    const emg = $('emgBar');
    if (emg) emg.style.display = u.emergency ? 'flex' : 'none';
    App.renderNav();
    /* ディープリンク（#page=xxx）があればその画面へ（認証なしの自動ログインはしない） */
    const hp = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
    const pg = hp.get('page');
    const valid = pg && MENU.flatMap(g => g.items).some(i => i.id === pg);
    /* 緊急管理者は常にダッシュボードへ */
    App.go(u.emergency ? 'dashboard' : (valid ? pg : 'dashboard'));
    UI.toast(u.emergency
      ? '緊急管理者としてログインしました（管理者権限）'
      : `${u.name}（${(ROLES[u.role] || {}).label || u.role}）としてログインしました`, u.emergency ? 'warn' : 'ok');
  },

  /* セッション復元（ページ再読み込み後） */
  restore() {
    let emg = null;
    try { emg = sessionStorage.getItem('agri_emergency'); } catch (e) { /* noop */ }
    if (emg === '1') {
      if (!EMERGENCY.enabled()) {
        try { sessionStorage.removeItem('agri_emergency'); sessionStorage.removeItem('agri_user'); } catch (e) { /* noop */ }
        return null;
      }
      const u = EMERGENCY.user();
      this.user = u;
      try { Tenant.enter(u); } catch (e) { /* noop */ }
      return u;
    }
    let id = null;
    try { id = sessionStorage.getItem('agri_user'); } catch (e) { /* noop */ }
    if (!id) return null;
    const db = Store.db;
    if (!db || !db.users) return null;
    const u = db.users.find(x => x.id === id);
    if (!u || !u.enabled) { try { sessionStorage.removeItem('agri_user'); } catch (e) { /* noop */ } return null; }
    this.user = u;
    try { Tenant.enter(u); } catch (e) { /* noop */ }
    return u;
  },

  /* パスワード変更（初回ログイン時の強制変更） */
  async changeMyPassword(newPw, newPw2) {
    const u = this.pendingUser || this.user;
    if (!u) return { ok: false, message: 'ログインしてください' };
    if (u.emergency) return { ok: false, message: '緊急管理者アカウントのパスワードは変更できません' };
    if (newPw !== newPw2) return { ok: false, message: 'パスワードが確認入力と一致しません' };
    const issues = Security.pwIssues(newPw);
    if (issues.length) return { ok: false, message: 'パスワードが強度基準を満たしていません：' + issues.join('・') };
    const sameCheck = u.passwordHash ? await Security.verifyPassword(newPw, u.passwordHash) : false;
    if (sameCheck) return { ok: false, message: '現在のパスワードと同じには変更できません' };
    if (typeof SB !== 'undefined' && SB.ready) {
      const r = await SB.setPassword(u.loginId, newPw, false);
      if (!r.ok) return { ok: false, message: r.message || 'パスワードを変更できませんでした' };
    } else {
      u.passwordHash = await Security.hashPassword(newPw);
    }
    u.forcePasswordChange = false;
    u.updatedAt = new Date().toISOString();
    Store.save();
    this.showApp();
    return { ok: true };
  },
  async onChangePwSubmit() {
    const r = await this.changeMyPassword(
      (document.getElementById('fcPw') || {}).value,
      (document.getElementById('fcPw2') || {}).value
    );
    const err = document.getElementById('fcErr');
    if (!r.ok) { if (err) { err.textContent = r.message; err.style.display = 'block'; } return; }
    const p1 = document.getElementById('fcPw'), p2 = document.getElementById('fcPw2');
    if (p1) p1.value = ''; if (p2) p2.value = '';
    UI.toast('パスワードを変更しました', 'ok');
  },
  /* パスワード強度チェックリスト（ライブ表示） */
  pwMeterHtml(prefix) {
    return `<div class="pw-check" id="${prefix}Check"><span>8文字以上</span><span>小文字</span><span>大文字</span><span>数字</span><span>記号</span></div>`;
  },
  updatePwMeter(prefix, pw) {
    const box = document.getElementById(prefix + 'Check');
    if (!box || !box.querySelectorAll) return;
    const flags = [pw && pw.length >= 8, /[a-z]/.test(pw), /[A-Z]/.test(pw), /[0-9]/.test(pw), /[^A-Za-z0-9]/.test(pw)];
    box.querySelectorAll('span').forEach((el, i) => el.classList.toggle('ok', !!flags[i]));
  },
  logout() {
    this.user = null; this.pendingUser = null;
    /* マルチテナント: セッションとスコープを破棄（次のログインで再取得） */
    try { if (typeof SB !== 'undefined' && SB.logoutSession) SB.logoutSession(); } catch (e) { /* noop */ }
    try { Tenant.reset(Store.db); } catch (e) { /* noop */ }
    try { sessionStorage.removeItem('agri_user'); sessionStorage.removeItem('agri_emergency'); } catch (e) { /* noop */ }
    const $ = id => document.getElementById(id);
    if ($('appShell')) $('appShell').style.display = 'none';
    if ($('forceScreen')) $('forceScreen').style.display = 'none';
    if ($('loginScreen')) $('loginScreen').style.display = 'flex';
    if ($('sidebar')) $('sidebar').classList.remove('open');
    if ($('scrim')) $('scrim').classList.remove('on');
    if ($('loginPw')) $('loginPw').value = '';
    if ($('loginErr')) $('loginErr').style.display = 'none';
    const emg = $('emgBar'); if (emg) emg.style.display = 'none';
    const id = $('loginId'); if (id && id.focus) id.focus();
  },
  can(id) {
    if (!this.user || !ROLES[this.user.role]) return false;
    const r = this.user.role;
    for (const g of MENU) {
      const it = g.items.find(x => x.id === id);
      if (it) return it.roles.includes(r) && (!it.sysOnly || Tenant.isSystemAdmin());
    }
    return true;
  }
};


/* ===== 03-views-a.js ===== */
/* ==========================================================================
   アグリERP — ビュー A：ダッシュボード／警告／在庫／入出庫履歴／マスタ
   ========================================================================== */
const Views = {};

const kpiCard = o => `<div class="kpi ${o.tone || ''}">
  <div class="k-top"><span class="k-ico" style="background:${o.bg};color:${o.fg}">${ico(o.icon, 18, 2.1)}</span><span class="k-lb">${esc(o.label)}</span></div>
  <div class="k-v">${o.value}${o.unit ? `<small>${esc(o.unit)}</small>` : ''}</div>
  <div class="k-f">${o.foot || ''}</div>
</div>`;

const emptyBox = (title, msg) => `<div class="empty">${ico('inbox', 40, 1.6)}<b>${esc(title)}</b><p>${esc(msg)}</p></div>`;

/* ============================== ダッシュボード ============================== */
Views.dashboard = () => {
  const alerts = Store.alerts();
  const stockAlerts = Store.stockAlerts();
  const todayShip = Store.todayShipments();
  const orderBacklog = Store.orderBacklog();
  const poBacklog = Store.poBacklog();
  const pending = todayShip.filter(s => s.status === 'instructed');

  const todayQty = todayShip.reduce((a, s) => a + s.qty, 0);
  const overdueOrders = orderBacklog.filter(r => r.overdue);
  const overduePO = poBacklog.filter(r => r.overdue);

  /* 直近7日の出荷量 */
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = todayStr(addDays(new Date(), -i));
    const q = Store.db.movements.filter(m => m.moveType === 'shipment' && m.moveDate === d)
      .reduce((a, m) => a + Math.abs(m.quantity), 0);
    days.push({ d, q });
  }
  const maxQ = Math.max(...days.map(x => x.q), 1);
  const chart = `<div class="mini-chart">${days.map(x => `
    <div class="col" title="${dJP(x.d)}：${num(x.q)}">
      <i style="height:${Math.max(4, (x.q / maxQ) * 100)}%"></i>
      <span>${new Date(x.d).getMonth() + 1}/${new Date(x.d).getDate()}</span>
    </div>`).join('')}</div>`;

  const totalStockValue = Store.db.items.reduce((a, i) => a + i.stock * i.costPrice, 0);
  const monthShip = Store.db.shipments.filter(s => s.status === 'confirmed').length;

  return `
  <div class="vstack" style="gap:16px">
    <div class="card" style="background:linear-gradient(135deg,#064e3b,#047857 55%,#0f766e);border:none;color:#fff;overflow:hidden;position:relative">
      <div style="position:absolute;right:-40px;top:-60px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(163,230,53,.30),transparent 65%)"></div>
      <div style="padding:20px 22px;position:relative;z-index:2;display:flex;flex-wrap:wrap;gap:16px;align-items:center">
        <div style="flex:1;min-width:230px">
          <div style="font-size:11px;letter-spacing:.14em;color:#8fe0bd">DASHBOARD</div>
          <h2 style="font-size:20px;font-weight:800;margin-top:5px">${dJPfull(TODAY)}（${wkJP(TODAY)}）</h2>
          <p style="font-size:12.5px;color:#b6f0d8;margin-top:5px">
            ${Auth.user ? Auth.user.name : ''} さん、おはようございます。本日は出荷予定 <b style="color:#fff">${todayShip.length}</b> 件、
            うち未確定 <b style="color:#fde68a">${pending.length}</b> 件です。
          </p>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${alerts.length ? `<div style="background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);border-radius:14px;padding:11px 16px;min-width:110px">
            <div style="font-size:10.5px;color:#ffe4e6">要対応</div>
            <div style="font-size:24px;font-weight:800">${alerts.length}<span style="font-size:12px">件</span></div></div>` : ''}
          <div style="background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);border-radius:14px;padding:11px 16px;min-width:110px">
            <div style="font-size:10.5px;color:#b6f0d8">本日出荷数量</div>
            <div style="font-size:24px;font-weight:800">${num(todayQty)}<span style="font-size:12px">点</span></div></div>
        </div>
      </div>
    </div>

    <div class="grid g5">
      ${kpiCard({ label: '在庫不足アラート', icon: 'alert', bg: 'var(--rose-100)', fg: 'var(--rose-600)', value: stockAlerts.length, unit: '件', tone: stockAlerts.length ? 'alert' : '', foot: `<span class="dot" style="background:${stockAlerts.length ? 'var(--rose-500)' : 'var(--green-500)'}"></span>${stockAlerts.length ? '発注点を下回っています' : 'すべて適正在庫です'}` })}
      ${kpiCard({ label: '本日出荷予定', icon: 'truck', bg: 'var(--green-100)', fg: 'var(--green-700)', value: todayShip.length, unit: '件', foot: `<span class="dot" style="background:var(--amber-500)"></span>未確定 ${pending.length} 件` })}
      ${kpiCard({ label: '受注残', icon: 'file', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: num(orderBacklog.reduce((a, r) => a + r.remaining, 0)), unit: '点', foot: `<span class="dot" style="background:${overdueOrders.length ? 'var(--rose-500)' : 'var(--green-500)'}"></span>納期超過 ${overdueOrders.length} 明細` })}
      ${kpiCard({ label: '発注残', icon: 'cart', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: num(poBacklog.reduce((a, r) => a + r.remaining, 0)), unit: '点', foot: `<span class="dot" style="background:${overduePO.length ? 'var(--amber-500)' : 'var(--green-500)'}"></span>入荷遅延 ${overduePO.length} 明細` })}
      ${kpiCard({ label: '在庫評価額', icon: 'yen', bg: 'var(--green-50)', fg: 'var(--green-700)', value: money(Math.round(totalStockValue)), foot: `<span class="dot" style="background:var(--green-500)"></span>累計出荷 ${monthShip} 件` })}
    </div>

    <div class="grid g-3-2">
      <div class="card">
        <div class="card-h">
          <h2>${ico('alert', 16)} 在庫不足アラート</h2>
          <span class="sub">発注点を下回った商品・資材</span>
          <div class="sp"><button class="btn sm ghost" onclick="App.go('alerts')">すべて見る ${ico('check', 14)}</button></div>
        </div>
        <div class="card-b tight">
          ${stockAlerts.length ? `<div class="table-wrap"><table class="tb">
            <thead><tr><th>品名</th><th>区分</th><th class="right">現在庫</th><th class="right">発注点</th><th>在庫水準</th><th></th></tr></thead>
            <tbody>${stockAlerts.slice(0, 6).map(i => {
              const lv = Store.alertLevel(i);
              const pct = Math.min(100, (i.stock / Math.max(i.reorderPoint * 1.5, 1)) * 100);
              return `<tr class="${lv === 'danger' ? 'row-danger' : 'row-warn'}">
                <td class="strong">${esc(i.name)}<div class="tiny muted">${esc(i.code)} ／ ${esc(i.location)}</div></td>
                <td><span class="badge ${i.kind === 'product' ? 'green' : 'sky'}">${i.kind === 'product' ? '商品' : '資材'}</span></td>
                <td class="num">${dec(i.stock)} <span class="tiny muted">${esc(i.unit)}</span></td>
                <td class="num muted">${dec(i.reorderPoint)}</td>
                <td><div class="bar ${lv === 'danger' ? 'danger' : 'warn'}"><i style="width:${pct}%"></i></div></td>
                <td class="right"><button class="btn xs primary" onclick="Actions.newPOFor('${i.id}')">発注</button></td></tr>`;
            }).join('')}</tbody></table></div>` : emptyBox('在庫は適正です', '発注点を下回っている商品・資材はありません')}
        </div>
      </div>

      <div class="card">
        <div class="card-h"><h2>${ico('trend', 16)} 直近7日の出荷量</h2><div class="sp"><span class="sub">単位：数量合計</span></div></div>
        <div class="card-b">
          ${chart}
          <div class="legend mt12"><span><i style="background:var(--green-500)"></i>出荷確定数量</span></div>
          <div class="hr"></div>
          <div class="vstack" style="gap:9px">
            ${[['確定済み出荷', Store.db.shipments.filter(s => s.status === 'confirmed').length + ' 件', 'green'],
               ['出荷指示待ち', Store.db.shipments.filter(s => s.status === 'instructed').length + ' 件', 'amber'],
               ['登録商品数', Store.db.items.filter(i => i.kind === 'product').length + ' 品目', 'sky'],
               ['登録資材数', Store.db.items.filter(i => i.kind === 'material').length + ' 品目', 'violet']]
              .map(([k, v, c]) => `<div class="hstack" style="justify-content:space-between">
                <span class="sm muted">${k}</span><span class="badge ${c}">${v}</span></div>`).join('')}
          </div>
        </div>
      </div>
    </div>

    <div class="grid g2">
      <div class="card">
        <div class="card-h"><h2>${ico('truck', 16)} 本日出荷予定</h2>
          <span class="sub">${dJP(TODAY)}</span>
          <div class="sp"><button class="btn sm" onclick="App.go('shipping')">出荷指示へ</button></div></div>
        <div class="card-b tight">
          ${todayShip.length ? `<div class="table-wrap"><table class="tb">
            <thead><tr><th>出荷番号</th><th>得意先</th><th class="right">数量</th><th>運送</th><th>状態</th><th></th></tr></thead>
            <tbody>${todayShip.map(s => `<tr>
              <td class="mono">${esc(s.shipmentNo)}</td>
              <td class="strong">${esc(s.customerName)}</td>
              <td class="num">${num(s.qty)}</td>
              <td class="sm muted">${esc(s.carrier || '—')}</td>
              <td>${s.status === 'confirmed' ? '<span class="badge green">確定済</span>' : '<span class="badge amber">未確定</span>'}</td>
              <td class="right"><button class="btn xs" onclick="Actions.openShipment('${s.id}')">詳細</button></td></tr>`).join('')}</tbody></table></div>`
            : emptyBox('本日の出荷予定はありません', '受注一覧から出荷指示を作成できます')}
        </div>
      </div>

      <div class="card">
        <div class="card-h"><h2>${ico('file', 16)} 受注残・納期管理</h2><div class="sp"><button class="btn sm" onclick="App.go('orders')">受注一覧へ</button></div></div>
        <div class="card-b tight">
          ${orderBacklog.length ? `<div class="table-wrap"><table class="tb">
            <thead><tr><th>受注番号</th><th>得意先／品名</th><th class="right">残</th><th>納期</th></tr></thead>
            <tbody>${orderBacklog.slice(0, 6).map(r => `<tr class="${r.overdue ? 'row-danger' : ''}">
              <td class="mono">${esc(r.orderNo)}</td>
              <td><span class="strong">${esc(r.customerName)}</span><div class="tiny muted">${esc(r.itemName)}</div></td>
              <td class="num">${dec(r.remaining)}</td>
              <td class="nowrap">${dJP(r.dueDate)}${r.overdue ? ' <span class="badge rose">超過</span>' : `<div class="tiny muted">${relDay(r.dueDate)}</div>`}</td></tr>`).join('')}</tbody></table></div>`
            : emptyBox('受注残はありません', 'すべての受注が出荷済みです')}
        </div>
      </div>
    </div>
  </div>`;
};

/* ============================== 警告一覧 ============================== */
Views.alerts = () => {
  const a = Store.alerts();
  const g = { danger: a.filter(x => x.level === 'danger'), warning: a.filter(x => x.level === 'warning') };
  const card = x => `<div class="hstack" style="align-items:flex-start;gap:12px;padding:14px;border:1px solid ${x.level === 'danger' ? 'var(--rose-100)' : 'var(--amber-100)'};background:${x.level === 'danger' ? 'var(--rose-50)' : 'var(--amber-50)'};border-radius:14px">
    <span style="width:36px;height:36px;border-radius:11px;flex:0 0 36px;display:grid;place-items:center;background:${x.level === 'danger' ? 'var(--rose-500)' : 'var(--amber-500)'};color:#fff">${ico(x.kind === 'stock' ? 'box' : x.kind === 'order' ? 'file' : x.kind === 'po' ? 'cart' : 'truck', 18, 2.2)}</span>
    <div style="flex:1;min-width:0">
      <b style="font-size:13.5px;display:block;color:${x.level === 'danger' ? 'var(--rose-700)' : 'var(--amber-700)'}">${esc(x.title)}</b>
      <span class="tiny muted">${esc(x.detail)}</span>
    </div>
    <button class="btn sm" onclick="App.go('${x.go}')">確認</button>
  </div>`;

  return `<div class="vstack" style="gap:16px">
    <div class="grid g3">
      ${kpiCard({ label: '要対応（重大）', icon: 'alert', bg: 'var(--rose-100)', fg: 'var(--rose-600)', value: g.danger.length, unit: '件', tone: 'alert', foot: '在庫切れ・納期超過' })}
      ${kpiCard({ label: '注意', icon: 'alert', bg: 'var(--amber-100)', fg: 'var(--amber-600)', value: g.warning.length, unit: '件', tone: 'warn', foot: '発注点割れ・入荷遅延' })}
      ${kpiCard({ label: 'アラート合計', icon: 'filter', bg: 'var(--green-100)', fg: 'var(--green-700)', value: a.length, unit: '件', foot: '在庫・受注・発注・出荷の横断チェック' })}
    </div>
    ${a.length ? `<div class="grid g2">
      <div class="card"><div class="card-h"><h2>${ico('alert', 16)} 要対応</h2><span class="badge rose">${g.danger.length}</span></div>
        <div class="card-b"><div class="vstack">${g.danger.length ? g.danger.map(card).join('') : '<p class="muted sm">重大なアラートはありません</p>'}</div></div></div>
      <div class="card"><div class="card-h"><h2>${ico('clock', 16)} 注意</h2><span class="badge amber">${g.warning.length}</span></div>
        <div class="card-b"><div class="vstack">${g.warning.length ? g.warning.map(card).join('') : '<p class="muted sm">注意レベルのアラートはありません</p>'}</div></div></div>
    </div>` : `<div class="card"><div class="card-b">${emptyBox('アラートはありません', '在庫・納期ともに正常な状態です')}</div></div>`}
  </div>`;
};

/* ============================== 在庫一覧 ============================== */
let invTab = 'product', invQ = '';
Views.inventory = () => {
  const filter = i => i.active && (invTab === 'all' ? true : invTab === 'alert' ? i.stock <= i.reorderPoint : i.kind === invTab);
  const list = Store.db.items.filter(filter).filter(i => !invQ || (i.name + i.code + (i.kana || '') + (i.category || '')).toLowerCase().includes(invQ.toLowerCase()));
  const cnt = {
    product: Store.db.items.filter(i => i.kind === 'product').length,
    material: Store.db.items.filter(i => i.kind === 'material').length,
    alert: Store.stockAlerts().length
  };
  const totalVal = list.reduce((a, i) => a + i.stock * i.costPrice, 0);

  return `<div class="vstack" style="gap:16px">
    <div class="grid g4">
      ${kpiCard({ label: '商品品目数', icon: 'tag', bg: 'var(--green-100)', fg: 'var(--green-700)', value: cnt.product, unit: '品目', foot: '販売用の農産物' })}
      ${kpiCard({ label: '資材品目数', icon: 'layers', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: cnt.material, unit: '品目', foot: '梱包・消耗資材' })}
      ${kpiCard({ label: '発注点割れ', icon: 'alert', bg: 'var(--rose-100)', fg: 'var(--rose-600)', value: cnt.alert, unit: '件', tone: cnt.alert ? 'alert' : '', foot: '早めの発注をおすすめします' })}
      ${kpiCard({ label: '在庫評価額（表示中）', icon: 'yen', bg: 'var(--green-50)', fg: 'var(--green-700)', value: money(Math.round(totalVal)), foot: '現在庫 × 仕入単価' })}
    </div>

    <div class="card">
      <div class="card-h">
        <h2>${ico('box', 16)} 現在庫管理</h2>
        <div class="sp">
          <div class="tabs">
            <button class="tab ${invTab === 'product' ? 'on' : ''}" onclick="Views.setInv('product')">商品 <span class="cnt">${cnt.product}</span></button>
            <button class="tab ${invTab === 'material' ? 'on' : ''}" onclick="Views.setInv('material')">資材 <span class="cnt">${cnt.material}</span></button>
            <button class="tab ${invTab === 'alert' ? 'on' : ''}" onclick="Views.setInv('alert')">在庫不足 <span class="cnt">${cnt.alert}</span></button>
            <button class="tab ${invTab === 'all' ? 'on' : ''}" onclick="Views.setInv('all')">すべて</button>
          </div>
        </div>
      </div>
      <div class="card-b tight">
        <div style="padding:12px 16px;border-bottom:1px solid var(--ink-100)" class="hstack">
          <div style="position:relative;flex:1;max-width:340px">
            <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--ink-400)">${ico('search', 16)}</span>
            <input class="inp" style="padding-left:34px" placeholder="品名・コードで検索" value="${esc(invQ)}"
              oninput="invQ=this.value;App.repaint()">
          </div>
          <div class="sp hstack">
            <button class="btn sm" onclick="Actions.adjustStock()">${ico('refresh', 14)} 在庫調整</button>
            <button class="btn sm primary" onclick="Actions.newPOFor('')">${ico('cart', 14)} 発注登録</button>
          </div>
        </div>
        <div class="table-wrap"><table class="tb">
          <thead><tr><th>品名</th><th>区分</th><th>規格</th><th class="right">現在庫</th><th class="right">発注点</th><th>在庫水準</th><th>状態</th><th>保管場所</th><th></th></tr></thead>
          <tbody>${list.length ? list.map(i => {
            const lv = Store.alertLevel(i);
            const pct = Math.min(100, (i.stock / Math.max(i.reorderPoint * 1.5, 1)) * 100);
            return `<tr class="${lv === 'danger' ? 'row-danger' : lv === 'warning' ? 'row-warn' : ''}">
              <td><span class="strong">${esc(i.name)}</span><div class="tiny muted mono">${esc(i.code)} ／ ${esc(i.category || '—')}</div></td>
              <td><span class="badge ${i.kind === 'product' ? 'green' : 'sky'}">${i.kind === 'product' ? '商品' : '資材'}</span></td>
              <td class="tiny muted">${esc(i.spec || '—')}</td>
              <td class="num strong">${dec(i.stock)}<div class="tiny muted">${esc(i.unit)}</div></td>
              <td class="num muted">${dec(i.reorderPoint)}<div class="tiny muted">安全 ${dec(i.safetyStock)}</div></td>
              <td><div class="bar ${lv === 'danger' ? 'danger' : lv === 'warning' ? 'warn' : 'ok'}"><i style="width:${pct}%"></i></div>
                  <div class="tiny muted">${pct.toFixed(0)}%</div></td>
              <td>${lv === 'danger' ? '<span class="badge rose">在庫不足</span>' : lv === 'warning' ? '<span class="badge amber">発注点割れ</span>' : '<span class="badge green">適正</span>'}</td>
              <td class="mono">${esc(i.location || '—')}</td>
              <td class="right"><div class="tb-act">
                <button class="btn xs" onclick="Actions.stockHistory('${i.id}')">履歴</button>
                <button class="btn xs ${lv !== 'ok' ? 'primary' : ''}" onclick="Actions.newPOFor('${i.id}')">発注</button>
              </div></td></tr>`;
          }).join('') : `<tr><td colspan="9">${emptyBox('該当する品目がありません', '検索条件を変更してください')}</td></tr>`}</tbody>
        </table></div>
      </div>
    </div>
  </div>`;
};
Views.setInv = t => { invTab = t; App.repaint(); };

/* ============================== 入出庫履歴 ============================== */
let mvFilter = 'all', mvQ = '';
Views.movements = () => {
  const list = Store.db.movements
    .filter(m => mvFilter === 'all' || m.moveType === mvFilter)
    .filter(m => !mvQ || (m.itemName + m.refNo).toLowerCase().includes(mvQ.toLowerCase()))
    .slice(0, 300);
  const inQ = Store.db.movements.filter(m => m.moveType === 'receipt').reduce((a, m) => a + m.quantity, 0);
  const outQ = Store.db.movements.filter(m => m.moveType === 'shipment').reduce((a, m) => a + Math.abs(m.quantity), 0);

  return `<div class="vstack" style="gap:16px">
    <div class="grid g3">
      ${kpiCard({ label: '累計入荷数量', icon: 'truckIn', bg: 'var(--green-100)', fg: 'var(--green-700)', value: num(Math.round(inQ)), unit: '点', foot: '入荷確定の合計' })}
      ${kpiCard({ label: '累計出荷数量', icon: 'truck', bg: 'var(--amber-100)', fg: 'var(--amber-600)', value: num(Math.round(outQ)), unit: '点', foot: '出荷確定の合計' })}
      ${kpiCard({ label: '在庫トランザクション', icon: 'clock', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: num(Store.db.movements.length), unit: '件', foot: '在庫増減の記録件数' })}
    </div>
    <div class="card">
      <div class="card-h"><h2>${ico('clock', 16)} 入出庫履歴</h2><span class="sub">在庫は入荷（＋）と出荷確定（−）のみで変動します</span></div>
      <div class="card-b tight">
        <div style="padding:12px 16px;border-bottom:1px solid var(--ink-100)" class="hstack">
          <div class="tabs">
            ${[['all', 'すべて'], ['receipt', '入荷'], ['shipment', '出荷'], ['adjustment', '調整'], ['loss', 'ロス']].map(([k, l]) =>
              `<button class="tab ${mvFilter === k ? 'on' : ''}" onclick="mvFilter='${k}';App.repaint()">${l}</button>`).join('')}
          </div>
          <div class="sp" style="position:relative;max-width:260px;flex:1">
            <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--ink-400)">${ico('search', 16)}</span>
            <input class="inp" style="padding-left:34px" placeholder="品名・伝票番号" value="${esc(mvQ)}" oninput="mvQ=this.value;App.repaint()">
          </div>
        </div>
        <div class="table-wrap"><table class="tb">
          <thead><tr><th>日時</th><th>区分</th><th>品名</th><th class="right">増減</th><th class="right">残高</th><th>参照伝票</th><th>担当</th></tr></thead>
          <tbody>${list.length ? list.map(m => `<tr>
            <td class="nowrap sm">${dtJP(m.movedAt)}</td>
            <td><span class="badge ${moveBadge(m.moveType)}">${moveLabel(m.moveType)}</span></td>
            <td class="strong">${esc(m.itemName)}</td>
            <td class="num ${m.quantity > 0 ? '' : ''}" style="color:${m.quantity > 0 ? 'var(--green-700)' : 'var(--rose-600)'};font-weight:700">${m.quantity > 0 ? '+' : ''}${dec(m.quantity)}</td>
            <td class="num">${dec(m.balanceAfter)}</td>
            <td class="mono">${esc(m.refNo || '—')}</td>
            <td class="sm muted">${esc((Store.db.users.find(u => u.id === m.operatorId) || {}).name || '—')}</td></tr>`).join('')
            : `<tr><td colspan="7">${emptyBox('履歴がありません', '条件を変更してください')}</td></tr>`}</tbody>
        </table></div>
      </div>
    </div>
  </div>`;
};

/* ============================== 商品マスタ / 資材マスタ ============================== */
const masterTable = (kind) => {
  const list = Store.db.items.filter(i => i.kind === kind);
  const isP = kind === 'product';
  return `<div class="vstack" style="gap:16px">
    <div class="grid g4">
      ${kpiCard({ label: '登録品目数', icon: isP ? 'tag' : 'layers', bg: isP ? 'var(--green-100)' : 'var(--sky-100)', fg: isP ? 'var(--green-700)' : 'var(--sky-600)', value: list.length, unit: '品目', foot: isP ? '販売商品マスタ' : '資材マスタ' })}
      ${kpiCard({ label: '発注点割れ', icon: 'alert', bg: 'var(--rose-100)', fg: 'var(--rose-600)', value: list.filter(i => i.stock <= i.reorderPoint).length, unit: '件', tone: 'alert', foot: '要発注' })}
      ${kpiCard({ label: '在庫金額', icon: 'yen', bg: 'var(--green-50)', fg: 'var(--green-700)', value: money(Math.round(list.reduce((a, i) => a + i.stock * i.costPrice, 0))), foot: '現在庫 × 仕入単価' })}
      ${kpiCard({ label: '平均販売単価', icon: 'trend', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: money(Math.round(list.reduce((a, i) => a + i.salePrice, 0) / Math.max(list.length, 1))), foot: isP ? '1品目あたり' : '資材は仕入単価基準' })}
    </div>
    <div class="card">
      <div class="card-h">
        <h2>${ico(isP ? 'tag' : 'layers', 16)} ${isP ? '商品マスタ' : '資材マスタ'}</h2>
        <span class="sub">${isP ? '販売する農産物の登録' : '梱包・消耗資材の登録'}</span>
        <div class="sp"><button class="btn sm primary" onclick="Actions.itemForm('${kind}')">${ico('plus', 14)} 新規登録</button></div>
      </div>
      <div class="card-b tight">
        <div class="table-wrap"><table class="tb">
          <thead><tr><th>コード</th><th>品名</th><th>カテゴリ</th><th>規格</th><th class="right">${isP ? '販売単価' : '仕入単価'}</th><th class="right">現在庫</th><th class="right">発注点</th><th>状態</th><th></th></tr></thead>
          <tbody>${list.map(i => `<tr>
            <td class="mono">${esc(i.code)}</td>
            <td><span class="strong">${esc(i.name)}</span><div class="tiny muted">${esc(i.kana || '')}</div></td>
            <td><span class="badge gray">${esc(i.category || '—')}</span></td>
            <td class="tiny muted">${esc(i.spec || '—')}</td>
            <td class="num">${money(isP ? i.salePrice : i.costPrice)}</td>
            <td class="num">${dec(i.stock)} <span class="tiny muted">${esc(i.unit)}</span></td>
            <td class="num muted">${dec(i.reorderPoint)}</td>
            <td>${i.stock <= i.safetyStock ? '<span class="badge rose">不足</span>' : i.stock <= i.reorderPoint ? '<span class="badge amber">発注点</span>' : '<span class="badge green">適正</span>'}</td>
            <td class="right"><div class="tb-act">
              <button class="btn xs" onclick="Actions.itemForm('${kind}','${i.id}')">編集</button>
              <button class="btn xs danger" onclick="Actions.deleteItem('${i.id}')">削除</button></div></td></tr>`).join('')}</tbody>
        </table></div>
      </div>
    </div>
  </div>`;
};
Views.products = () => masterTable('product');
Views.materials = () => masterTable('material');


/* ===== 04-views-b.js ===== */
/* ==========================================================================
   アグリERP — ビュー B：受注／得意先／発注／入荷／仕入先／出荷／帳票／ユーザー／設定
   ========================================================================== */

/* ============================== 受注管理 ============================== */
let ordTab = 'list', ordQ = '', ordStat = 'all';
Views.orders = () => {
  const all = Store.db.orders.slice().sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.orderNo.localeCompare(a.orderNo));
  const backlog = Store.orderBacklog();
  const overdue = backlog.filter(r => r.overdue);
  const tabList = ordTab === 'backlog' ? all.filter(o => Store.orderRemaining(o) > 0) : all;
  const list = tabList
    .filter(o => ordStat === 'all' || o.status === ordStat)
    .filter(o => !ordQ || (o.orderNo + o.customerName).toLowerCase().includes(ordQ.toLowerCase()));

  const rows = list.map(o => {
    const rem = Store.orderRemaining(o);
    const late = o.dueDate < TODAY && rem > 0;
    return `<tr class="${late ? 'row-danger' : ''}">
      <td class="mono">${esc(o.orderNo)}<div class="tiny muted">${dJP(o.orderDate)}</div></td>
      <td class="strong">${esc(o.customerName)}</td>
      <td class="nowrap">${dJP(o.dueDate)}${late ? ' <span class="badge rose">超過</span>' : rem > 0 ? `<div class="tiny muted">${relDay(o.dueDate)}</div>` : ''}</td>
      <td class="num">${money(o.total)}</td>
      <td class="num">${rem > 0 ? `<span style="color:var(--rose-600);font-weight:700">${dec(rem)}</span>` : '<span class="badge green">完納</span>'}</td>
      <td>${badge(o.status)}</td>
      <td class="right"><div class="tb-act">
        <button class="btn xs" onclick="Actions.orderDetail('${o.id}')">詳細</button>
        ${rem > 0 && o.status !== 'cancelled' ? `<button class="btn xs primary" onclick="Actions.newShipFromOrder('${o.id}')">出荷指示</button>` : ''}
      </div></td></tr>`;
  }).join('');

  return `<div class="vstack" style="gap:16px">
    <div class="grid g4">
      ${kpiCard({ label: '受注件数', icon: 'file', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: all.length, unit: '件', foot: '全受注の登録件数' })}
      ${kpiCard({ label: '受注残', icon: 'clock', bg: 'var(--amber-100)', fg: 'var(--amber-600)', value: num(backlog.reduce((a, r) => a + r.remaining, 0)), unit: '点', tone: 'warn', foot: `${backlog.length} 明細が未出荷` })}
      ${kpiCard({ label: '納期超過', icon: 'alert', bg: 'var(--rose-100)', fg: 'var(--rose-600)', value: overdue.length, unit: '明細', tone: overdue.length ? 'alert' : '', foot: '至急の出荷対応が必要' })}
      ${kpiCard({ label: '受注金額（当月）', icon: 'yen', bg: 'var(--green-100)', fg: 'var(--green-700)', value: money(Math.round(all.filter(o => o.orderDate.slice(0, 7) === TODAY.slice(0, 7)).reduce((a, o) => a + o.total, 0))), foot: '税込・当月受注分' })}
    </div>

    <div class="card">
      <div class="card-h">
        <h2>${ico('file', 16)} 受注一覧</h2>
        <div class="sp">
          <div class="tabs">
            <button class="tab ${ordTab === 'list' ? 'on' : ''}" onclick="ordTab='list';App.repaint()">受注一覧</button>
            <button class="tab ${ordTab === 'backlog' ? 'on' : ''}" onclick="ordTab='backlog';App.repaint()">受注残管理 <span class="cnt">${all.filter(o => Store.orderRemaining(o) > 0).length}</span></button>
          </div>
        </div>
      </div>
      <div class="card-b tight">
        <div style="padding:12px 16px;border-bottom:1px solid var(--ink-100)" class="hstack">
          <div style="position:relative;flex:1;max-width:300px">
            <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--ink-400)">${ico('search', 16)}</span>
            <input class="inp" style="padding-left:34px" placeholder="受注番号・得意先" value="${esc(ordQ)}" oninput="ordQ=this.value;App.repaint()">
          </div>
          <select class="inp" style="max-width:160px" onchange="ordStat=this.value;App.repaint()">
            <option value="all"${ordStat === 'all' ? ' selected' : ''}>すべての状態</option>
            ${Object.entries(STATUS).filter(([k]) => ['received','partial','shipped','completed','cancelled'].includes(k))
              .map(([k, v]) => `<option value="${k}"${ordStat === k ? ' selected' : ''}>${v[0]}</option>`).join('')}
          </select>
          <div class="sp"><button class="btn sm primary" onclick="Actions.orderForm()">${ico('plus', 14)} 受注登録</button></div>
        </div>
        <div class="table-wrap"><table class="tb">
          <thead><tr><th>受注番号</th><th>得意先</th><th>納期</th><th class="right">金額</th><th class="right">受注残</th><th>状態</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="7">${emptyBox('受注がありません', '新規受注を登録してください')}</td></tr>`}</tbody>
        </table></div>
      </div>
    </div>

    <div class="card">
      <div class="card-h"><h2>${ico('clock', 16)} 受注残・納期管理</h2><span class="sub">納期順・超過は赤で表示</span></div>
      <div class="card-b tight">
        ${backlog.length ? `<div class="table-wrap"><table class="tb">
          <thead><tr><th>納期</th><th>受注番号</th><th>得意先</th><th>品名</th><th class="right">受注数</th><th class="right">出荷済</th><th class="right">残</th><th>状態</th></tr></thead>
          <tbody>${backlog.map(r => `<tr class="${r.overdue ? 'row-danger' : ''}">
            <td class="nowrap">${dJP(r.dueDate)} <span class="tiny muted">(${wkJP(r.dueDate)})</span>${r.overdue ? '<div><span class="badge rose">納期超過</span></div>' : `<div class="tiny muted">${relDay(r.dueDate)}</div>`}</td>
            <td class="mono">${esc(r.orderNo)}</td>
            <td class="strong">${esc(r.customerName)}</td>
            <td>${esc(r.itemName)}</td>
            <td class="num">${dec(r.quantity)}</td>
            <td class="num muted">${dec(r.shippedQty)}</td>
            <td class="num" style="color:var(--rose-600);font-weight:700">${dec(r.remaining)}</td>
            <td><div class="bar ${r.overdue ? 'danger' : 'warn'}" style="min-width:70px"><i style="width:${(r.shippedQty / r.quantity) * 100}%"></i></div></td></tr>`).join('')}</tbody>
        </table></div>` : emptyBox('受注残はありません', 'すべて出荷済みです')}
      </div>
    </div>
  </div>`;
};

/* ============================== 得意先マスタ ============================== */
Views.customers = () => {
  const list = Store.db.customers;
  return `<div class="vstack" style="gap:16px">
    <div class="grid g3">
      ${kpiCard({ label: '得意先数', icon: 'users', bg: 'var(--green-100)', fg: 'var(--green-700)', value: list.length, unit: '社', foot: '登録済みの取引先' })}
      ${kpiCard({ label: '当月受注', icon: 'file', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: money(Math.round(Store.db.orders.filter(o => o.orderDate.slice(0, 7) === TODAY.slice(0, 7)).reduce((a, o) => a + o.total, 0))), foot: '税込' })}
      ${kpiCard({ label: '受注残あり', icon: 'clock', bg: 'var(--amber-100)', fg: 'var(--amber-600)', value: new Set(Store.orderBacklog().map(r => r.customerName)).size, unit: '社', tone: 'warn', foot: '未出荷の受注がある得意先' })}
    </div>
    <div class="card">
      <div class="card-h"><h2>${ico('users', 16)} 得意先マスタ</h2>
        <div class="sp"><button class="btn sm primary" onclick="Actions.customerForm()">${ico('plus', 14)} 新規登録</button></div></div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>コード</th><th>得意先名</th><th>電話番号</th><th>住所</th><th>営業担当者</th><th class="right">締め日</th><th>支払条件</th><th class="right">受注件数</th><th></th></tr></thead>
        <tbody>${list.map(c => `<tr>
          <td class="mono">${esc(c.code)}</td>
          <td><span class="strong">${esc(c.name)}</span><div class="tiny muted">${esc(c.kana || '')}</div></td>
          <td class="sm">${esc(c.tel || '—')}</td>
          <td class="tiny muted">${esc(c.address || '—')}</td>
          <td class="sm">${esc(Store.salesRepName(c.salesRepId) || '—')}</td>
          <td class="num">${c.closingDay === 31 ? '末日' : c.closingDay + '日'}</td>
          <td class="sm">${esc(c.paymentTerms || '—')}</td>
          <td class="num">${Store.db.orders.filter(o => o.customerId === c.id).length}</td>
          <td class="right"><div class="tb-act">
            <button class="btn xs" onclick="Actions.customerForm('${c.id}')">編集</button>
            <button class="btn xs danger" onclick="Actions.deleteCustomer('${c.id}')">削除</button></div></td></tr>`).join('')}</tbody>
      </table></div></div>
    </div>
  </div>`;
};

/* ============================== 発注管理 ============================== */
let poTab = 'list', poQ = '';
Views.purchase = () => {
  const all = Store.db.purchaseOrders.slice().sort((a, b) => b.orderDate.localeCompare(a.orderDate));
  const backlog = Store.poBacklog();
  const overdue = backlog.filter(r => r.overdue);
  const list = (poTab === 'backlog' ? all.filter(p => Store.poRemaining(p) > 0) : all)
    .filter(p => !poQ || (p.poNo + p.supplierName).toLowerCase().includes(poQ.toLowerCase()));

  return `<div class="vstack" style="gap:16px">
    <div class="grid g4">
      ${kpiCard({ label: '発注件数', icon: 'cart', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: all.length, unit: '件', foot: '登録済みの発注' })}
      ${kpiCard({ label: '発注残', icon: 'clock', bg: 'var(--amber-100)', fg: 'var(--amber-600)', value: num(backlog.reduce((a, r) => a + r.remaining, 0)), unit: '点', tone: 'warn', foot: `${backlog.length} 明細が未入荷` })}
      ${kpiCard({ label: '入荷遅延', icon: 'alert', bg: 'var(--rose-100)', fg: 'var(--rose-600)', value: overdue.length, unit: '明細', tone: overdue.length ? 'alert' : '', foot: '入荷予定日を過ぎています' })}
      ${kpiCard({ label: '発注金額（当月）', icon: 'yen', bg: 'var(--green-100)', fg: 'var(--green-700)', value: money(Math.round(all.filter(p => p.orderDate.slice(0, 7) === TODAY.slice(0, 7)).reduce((a, p) => a + p.total, 0))), foot: '税込・当月発注分' })}
    </div>

    <div class="card">
      <div class="card-h"><h2>${ico('cart', 16)} 発注一覧</h2>
        <div class="sp"><div class="tabs">
          <button class="tab ${poTab === 'list' ? 'on' : ''}" onclick="poTab='list';App.repaint()">発注一覧</button>
          <button class="tab ${poTab === 'backlog' ? 'on' : ''}" onclick="poTab='backlog';App.repaint()">発注残管理 <span class="cnt">${all.filter(p => Store.poRemaining(p) > 0).length}</span></button>
        </div></div>
      </div>
      <div class="card-b tight">
        <div style="padding:12px 16px;border-bottom:1px solid var(--ink-100)" class="hstack">
          <div style="position:relative;flex:1;max-width:300px">
            <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--ink-400)">${ico('search', 16)}</span>
            <input class="inp" style="padding-left:34px" placeholder="発注番号・仕入先" value="${esc(poQ)}" oninput="poQ=this.value;App.repaint()">
          </div>
          <div class="sp"><button class="btn sm primary" onclick="Actions.newPOFor('')">${ico('plus', 14)} 発注登録</button></div>
        </div>
        <div class="table-wrap"><table class="tb">
          <thead><tr><th>発注番号</th><th>仕入先</th><th>発注日</th><th>入荷予定</th><th class="right">金額</th><th class="right">発注残</th><th>状態</th><th></th></tr></thead>
          <tbody>${list.length ? list.map(p => {
            const rem = Store.poRemaining(p);
            const late = p.expectedDate < TODAY && rem > 0;
            return `<tr class="${late ? 'row-warn' : ''}">
              <td class="mono">${esc(p.poNo)}</td>
              <td class="strong">${esc(p.supplierName)}</td>
              <td class="sm">${dJP(p.orderDate)}</td>
              <td class="nowrap">${dJP(p.expectedDate)}${late ? '<div><span class="badge amber">入荷遅延</span></div>' : rem > 0 ? `<div class="tiny muted">${relDay(p.expectedDate)}</div>` : ''}</td>
              <td class="num">${money(p.total)}</td>
              <td class="num">${rem > 0 ? dec(rem) : '<span class="badge green">完納</span>'}</td>
              <td>${badge(p.status)}</td>
              <td class="right"><div class="tb-act">
                <button class="btn xs" onclick="Actions.poDetail('${p.id}')">詳細</button>
                ${rem > 0 ? `<button class="btn xs primary" onclick="Actions.receiveForm('${p.id}')">入荷</button>` : ''}
              </div></td></tr>`;
          }).join('') : `<tr><td colspan="8">${emptyBox('発注がありません', '発注点割れの品目から発注できます')}</td></tr>`}</tbody>
        </table></div>
      </div>
    </div>

    <div class="card">
      <div class="card-h"><h2>${ico('clock', 16)} 発注残管理</h2><span class="sub">入荷予定日順</span></div>
      <div class="card-b tight">
        ${backlog.length ? `<div class="table-wrap"><table class="tb">
          <thead><tr><th>入荷予定</th><th>発注番号</th><th>仕入先</th><th>品名</th><th class="right">発注数</th><th class="right">入荷済</th><th class="right">残</th><th></th></tr></thead>
          <tbody>${backlog.map(r => `<tr class="${r.overdue ? 'row-warn' : ''}">
            <td class="nowrap">${dJP(r.expectedDate)}${r.overdue ? ' <span class="badge amber">遅延</span>' : `<div class="tiny muted">${relDay(r.expectedDate)}</div>`}</td>
            <td class="mono">${esc(r.poNo)}</td>
            <td class="strong">${esc(r.supplierName)}</td>
            <td>${esc(r.itemName)}</td>
            <td class="num">${dec(r.quantity)}</td>
            <td class="num muted">${dec(r.receivedQty)}</td>
            <td class="num" style="font-weight:700">${dec(r.remaining)}</td>
            <td class="right"><button class="btn xs primary" onclick="Actions.receiveForm('${r.poId}')">入荷処理</button></td></tr>`).join('')}</tbody>
        </table></div>` : emptyBox('発注残はありません', 'すべて入荷済みです')}
      </div>
    </div>
  </div>`;
};

/* ============================== 入荷処理 ============================== */
Views.receipts = () => {
  const list = Store.db.receipts.slice().sort((a, b) => b.receiptDate.localeCompare(a.receiptDate));
  const todayIn = list.filter(r => r.receiptDate === TODAY);
  const monthQty = Store.db.movements.filter(m => m.moveType === 'receipt' && m.moveDate.slice(0, 7) === TODAY.slice(0, 7))
    .reduce((a, m) => a + m.quantity, 0);
  return `<div class="vstack" style="gap:16px">
    <div class="grid g4">
      ${kpiCard({ label: '本日の入荷', icon: 'truckIn', bg: 'var(--green-100)', fg: 'var(--green-700)', value: todayIn.length, unit: '件', foot: '入荷確定で在庫に自動加算' })}
      ${kpiCard({ label: '当月入荷数量', icon: 'inbox', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: num(Math.round(monthQty)), unit: '点', foot: '当月の入荷合計' })}
      ${kpiCard({ label: '入荷待ち', icon: 'clock', bg: 'var(--amber-100)', fg: 'var(--amber-600)', value: Store.poBacklog().length, unit: '明細', tone: 'warn', foot: '発注残の明細数' })}
      ${kpiCard({ label: '入荷履歴', icon: 'history', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: list.length, unit: '件', foot: '確定済みの入荷実績' })}
    </div>
    <div class="note green">${ico('check', 15)} <b>入荷処理</b>を確定すると、対象商品・資材の現在庫に自動で加算され、入出庫履歴に記録されます。</div>
    <div class="card">
      <div class="card-h"><h2>${ico('inbox', 16)} 入荷履歴</h2>
        <div class="sp"><button class="btn sm primary" onclick="Actions.receiveForm('')">${ico('plus', 14)} 入荷登録</button></div></div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>入荷番号</th><th>入荷日</th><th>仕入先</th><th>発注番号</th><th class="right">明細</th><th class="right">金額</th><th>状態</th><th></th></tr></thead>
        <tbody>${list.length ? list.map(r => `<tr>
          <td class="mono">${esc(r.receiptNo)}</td>
          <td class="sm">${dJP(r.receiptDate)}</td>
          <td class="strong">${esc(r.supplierName)}</td>
          <td class="mono">${esc((Store.db.purchaseOrders.find(p => p.id === r.poId) || {}).poNo || '直接入荷')}</td>
          <td class="num">${Store.receiptLines(r.id).length}</td>
          <td class="num">${money(r.total)}</td>
          <td><span class="badge green">入荷確定</span></td>
          <td class="right"><button class="btn xs" onclick="Actions.receiptDetail('${r.id}')">明細</button></td></tr>`).join('')
          : `<tr><td colspan="8">${emptyBox('入荷履歴がありません', '発注一覧から入荷処理を実行できます')}</td></tr>`}</tbody>
      </table></div></div>
    </div>
  </div>`;
};

/* ============================== 仕入先マスタ ============================== */
Views.suppliers = () => {
  const list = Store.db.suppliers;
  return `<div class="vstack" style="gap:16px">
    <div class="grid g3">
      ${kpiCard({ label: '仕入先数', icon: 'factory', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: list.length, unit: '社', foot: '登録済みの仕入先' })}
      ${kpiCard({ label: '発注残', icon: 'clock', bg: 'var(--amber-100)', fg: 'var(--amber-600)', value: Store.poBacklog().length, unit: '明細', tone: 'warn', foot: '未入荷の明細' })}
      ${kpiCard({ label: '平均リードタイム', icon: 'trend', bg: 'var(--green-100)', fg: 'var(--green-700)', value: (list.reduce((a, s) => a + s.leadTime, 0) / Math.max(list.length, 1)).toFixed(1), unit: '日', foot: '発注から入荷までの標準日数' })}
    </div>
    <div class="card">
      <div class="card-h"><h2>${ico('factory', 16)} 仕入先マスタ</h2>
        <div class="sp"><button class="btn sm primary" onclick="Actions.supplierForm()">${ico('plus', 14)} 新規登録</button></div></div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>コード</th><th>仕入先名</th><th>電話番号</th><th class="right">締め日</th><th>支払条件</th><th class="right">リードタイム</th><th class="right">発注件数</th><th></th></tr></thead>
        <tbody>${list.map(s => `<tr>
          <td class="mono">${esc(s.code)}</td>
          <td><span class="strong">${esc(s.name)}</span><div class="tiny muted">${esc(s.kana || '')}</div></td>
          <td class="sm">${esc(s.tel || '—')}</td>
          <td class="num">${s.closingDay === 31 ? '末日' : s.closingDay + '日'}</td>
          <td class="sm">${esc(s.paymentTerms || '—')}</td>
          <td class="num">${s.leadTime} 日</td>
          <td class="num">${Store.db.purchaseOrders.filter(p => p.supplierId === s.id).length}</td>
          <td class="right"><div class="tb-act">
            <button class="btn xs" onclick="Actions.supplierForm('${s.id}')">編集</button>
            <button class="btn xs danger" onclick="Actions.deleteSupplier('${s.id}')">削除</button></div></td></tr>`).join('')}</tbody>
      </table></div></div>
    </div>
  </div>`;
};

/* ============================== 出荷指示 ============================== */
Views.shipping = () => {
  const pend = Store.db.shipments.filter(s => s.status === 'instructed').sort((a, b) => a.shipDate.localeCompare(b.shipDate));
  const today = pend.filter(s => s.shipDate === TODAY);
  const late = pend.filter(s => s.shipDate < TODAY);
  const mk = s => {
    const lines = Store.shipLines(s.id);
    const qty = lines.reduce((a, l) => a + l.quantity, 0);
    const short = lines.filter(l => { const it = Store.item(l.itemId); return it && it.stock < l.quantity; });
    return `<div class="card" style="margin-bottom:12px;border-color:${s.shipDate < TODAY ? 'var(--rose-200)' : 'var(--ink-200)'}">
      <div class="card-h" style="background:${s.shipDate < TODAY ? 'var(--rose-50)' : 'var(--ink-50)'}">
        <h2>${ico('truck', 16)} ${esc(s.shipmentNo)}</h2>
        <span class="badge ${s.shipDate < TODAY ? 'rose' : s.shipDate === TODAY ? 'amber' : 'sky'}">${s.shipDate < TODAY ? '期日超過' : s.shipDate === TODAY ? '本日' : relDay(s.shipDate)}</span>
        <div class="sp hstack">
          <span class="sub">${dJP(s.shipDate)} ／ ${esc(s.carrier || '—')}</span>
          <button class="btn sm" onclick="Actions.openShipment('${s.id}')">明細・編集</button>
          <button class="btn sm" onclick="Print.picking('${s.id}')">${ico('print', 14)} ピッキング</button>
          <button class="btn sm primary" onclick="Actions.confirmShipment('${s.id}')">${ico('check', 14)} 出荷確定</button>
        </div>
      </div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>得意先</th><th>受注番号</th><th>品名</th><th class="right">出荷数</th><th class="right">現在庫</th><th>引当</th></tr></thead>
        <tbody>${lines.map(l => { const it = Store.item(l.itemId); const ok = it && it.stock >= l.quantity;
          return `<tr class="${ok ? '' : 'row-danger'}">
            <td class="strong">${esc(s.customerName)}</td>
            <td class="mono">${esc(s.orderNo || '—')}</td>
            <td>${esc(l.itemName)}<div class="tiny muted">${esc(it ? it.location : '')}</div></td>
            <td class="num">${dec(l.quantity)} <span class="tiny muted">${esc(it ? it.unit : '')}</span></td>
            <td class="num">${dec(it ? it.stock : 0)}</td>
            <td>${ok ? '<span class="badge green">引当可</span>' : '<span class="badge rose">在庫不足</span>'}</td></tr>`; }).join('')}
        </tbody></table></div>
        <div style="padding:10px 16px;border-top:1px solid var(--ink-100)" class="hstack">
          <span class="sm muted">合計 <b>${num(qty)}</b> 点</span>
          ${short.length ? `<span class="badge rose">在庫不足 ${short.length} 明細</span>` : '<span class="badge green">すべて引当可能</span>'}
        </div>
      </div></div>`;
  };
  return `<div class="vstack" style="gap:16px">
    <div class="grid g4">
      ${kpiCard({ label: '出荷指示待ち', icon: 'truck', bg: 'var(--amber-100)', fg: 'var(--amber-600)', value: pend.length, unit: '件', tone: pend.length ? 'warn' : '', foot: '確定待ちの出荷' })}
      ${kpiCard({ label: '本日出荷', icon: 'clock', bg: 'var(--green-100)', fg: 'var(--green-700)', value: today.length, unit: '件', foot: `${num(today.reduce((a, s) => a + Store.shipLines(s.id).reduce((x, l) => x + l.quantity, 0), 0))} 点` })}
      ${kpiCard({ label: '期日超過', icon: 'alert', bg: 'var(--rose-100)', fg: 'var(--rose-600)', value: late.length, unit: '件', tone: late.length ? 'alert' : '', foot: '出荷日を過ぎています' })}
      ${kpiCard({ label: '確定済み', icon: 'check', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: Store.db.shipments.filter(s => s.status === 'confirmed').length, unit: '件', foot: '出荷確定で在庫から減算済み' })}
    </div>
    <div class="note amber">${ico('alert', 15)} <b>出荷確定</b>すると、明細の数量が在庫から自動で減算され、受注残が更新されます。確定後に納品書・出荷伝票を発行できます。</div>
    <div class="card">
      <div class="card-h"><h2>${ico('truck', 16)} 出荷指示一覧</h2><span class="sub">出荷日順</span>
        <div class="sp"><button class="btn sm primary" onclick="Actions.shipFromOrderPick()">${ico('plus', 14)} 受注から出荷指示</button></div></div>
      <div class="card-b">${pend.length ? pend.map(mk).join('') : emptyBox('出荷指示はありません', '受注一覧から出荷指示を作成してください')}</div>
    </div>
  </div>`;
};

/* ============================== 出荷検索・履歴 ==============================
   検索条件: 期間（from〜to）／得意先／営業担当者／出荷状態
   - 条件は画面上部の検索エリアで指定し、変更即時に再検索する
   - 「クイック期間」で 本日／今月／先月／直近7日／全期間 を切替
   - 検索結果は CSV（Excel）へ書き出せる
   ========================================================================== */
const SHIP_STATE = {
  instructed: ['出荷指示済', 'amber'],
  confirmed:  ['出荷確定', 'green'],
  cancelled:  ['取消', 'gray']
};
const SHIP_STATE_ALL = 'all';

let shF = null;                       /* 検索条件（未指定なら既定値） */
const shipFilterDefault = () => {
  const d = new Date();
  return {
    from: todayStr(new Date(d.getFullYear(), d.getMonth(), 1)),  /* 月初 */
    to: TODAY,
    customerId: '',
    salesRepId: '',
    status: SHIP_STATE_ALL,
    q: ''
  };
};
const shipFilters = () => (shF = shF || shipFilterDefault());
const shipSet = (k, v) => { shipFilters()[k] = v; App.repaint(); };
const shipReset = () => { shF = shipFilterDefault(); App.repaint(); };
const shipQuick = p => {
  const d = new Date(), y = d.getFullYear(), m = d.getMonth();
  const f = shipFilters();
  if (p === 'today') { f.from = TODAY; f.to = TODAY; }
  else if (p === 'month') { f.from = todayStr(new Date(y, m, 1)); f.to = TODAY; }
  else if (p === 'lastMonth') { f.from = todayStr(new Date(y, m - 1, 1)); f.to = todayStr(new Date(y, m, 0)); }
  else if (p === 'week') { f.from = todayStr(addDays(new Date(), -6)); f.to = TODAY; }
  else if (p === 'all') { f.from = ''; f.to = ''; }
  App.repaint();
};

/* 検索条件で絞り込んだ出荷一覧（新しい順） */
const shipFiltered = () => {
  const f = shipFilters();
  const q = (f.q || '').toLowerCase();
  return Store.db.shipments.filter(s => {
    if (f.from && s.shipDate < f.from) return false;
    if (f.to && s.shipDate > f.to) return false;
    if (f.customerId && s.customerId !== f.customerId) return false;
    if (f.salesRepId && Store.shipmentRepId(s) !== f.salesRepId) return false;
    if (f.status !== SHIP_STATE_ALL && s.status !== f.status) return false;
    if (q && !(String(s.shipmentNo || '') + String(s.customerName || '') + String(s.orderNo || '')).toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => String(b.shipDate).localeCompare(String(a.shipDate)) || String(b.shipmentNo).localeCompare(String(a.shipmentNo)));
};

/* CSV出力（検索結果をそのまま出力） */
const shipExportCsv = () => {
  const list = shipFiltered();
  if (!list.length) return UI.toast('出力できる出荷データがありません', 'warn');
  const head = ['出荷日', '出荷番号', '得意先', '営業担当者', '受注番号', '数量', '金額(税抜)', '運送会社', '追跡番号', '出荷状態'];
  const rows = list.map(s => [
    s.shipDate, s.shipmentNo, s.customerName, Store.salesRepName(Store.shipmentRepId(s)) || '—', s.orderNo || '',
    Store.shipLines(s.id).reduce((a, l) => a + l.quantity, 0), Math.round(Store.shipmentAmount(s)),
    s.carrier || '', s.trackingNo || '', (SHIP_STATE[s.status] || [s.status, ''])[0]
  ]);
  const csv = '\uFEFF' + [head, ...rows].map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `agri-erp-shipments-${TODAY}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
  UI.toast(`検索結果 ${list.length} 件をCSVに書き出しました`, 'ok');
};

Views.shipHistory = () => {
  const f = shipFilters();
  const list = shipFiltered();
  const qty = list.reduce((a, s) => a + Store.shipLines(s.id).reduce((x, l) => x + l.quantity, 0), 0);
  const amt = list.reduce((a, s) => a + Store.shipmentAmount(s), 0);
  const confirmed = list.filter(s => s.status === 'confirmed');
  const pending = list.filter(s => s.status === 'instructed');
  const reps = Store.salesReps();
  const cs = Store.db.customers.slice().sort((a, b) => String(a.code).localeCompare(String(b.code)));

  const chip = (on, label, fn) => `<button class="chip ${on ? 'on' : ''}" onclick="${fn}">${esc(label)}</button>`;
  const condChip = (label, value, clear) => value
    ? `<span class="cond">${esc(label)}：<b>${esc(value)}</b><button class="cx" title="条件を解除" onclick="${clear}">${ico('x', 12, 2.6)}</button></span>` : '';
  const repSel = reps.some(r => r.id === f.salesRepId) ? f.salesRepId : '';
  const custSel = cs.some(c => c.id === f.customerId) ? f.customerId : '';

  return `<div class="vstack" style="gap:16px">
    <div class="grid g4">
      ${kpiCard({ label: '検索結果', icon: 'filter', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: list.length, unit: '件', foot: `${dJP(f.from || '')} 〜 ${dJP(f.to || '')}` })}
      ${kpiCard({ label: '出荷確定', icon: 'check', bg: 'var(--green-100)', fg: 'var(--green-700)', value: confirmed.length, unit: '件', foot: `指示済 ${pending.length} 件` })}
      ${kpiCard({ label: '合計数量', icon: 'truck', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: num(qty), unit: '点', foot: '検索結果の数量合計' })}
      ${kpiCard({ label: '合計金額（税抜）', icon: 'yen', bg: 'var(--green-50)', fg: 'var(--green-700)', value: money(Math.round(amt)), foot: '受注単価 × 出荷数量' })}
    </div>

    <div class="card">
      <div class="card-h"><h2>${ico('filter', 16)} 検索条件</h2><span class="sub">期間・得意先・営業担当者・出荷状態で絞り込みます</span>
        <div class="sp hstack">
          <button class="btn sm" onclick="shipReset()">${ico('refresh', 14)} 条件クリア</button>
          <button class="btn sm primary" onclick="shipExportCsv()">${ico('excel', 14)} CSV出力</button>
        </div>
      </div>
      <div class="card-b">
        <div class="filter-grid">
          <div class="field"><label>期間（出荷日）</label>
            <div class="hstack" style="gap:6px;flex-wrap:nowrap">
              <input class="inp" type="date" value="${esc(f.from)}" onchange="shipSet('from', this.value)">
              <span class="muted sm">〜</span>
              <input class="inp" type="date" value="${esc(f.to)}" onchange="shipSet('to', this.value)">
            </div>
          </div>
          <div class="field"><label>得意先</label>
            <select class="inp" onchange="shipSet('customerId', this.value)">
              <option value="">すべての得意先</option>
              ${cs.map(c => `<option value="${esc(c.id)}"${custSel === c.id ? ' selected' : ''}>${esc(c.code)} ${esc(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>営業担当者</label>
            <select class="inp" onchange="shipSet('salesRepId', this.value)">
              <option value="">すべての担当者</option>
              ${reps.map(u => `<option value="${esc(u.id)}"${repSel === u.id ? ' selected' : ''}>${esc(u.name)}${u.role === 'admin' ? '（管理者）' : ''}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>出荷状態</label>
            <select class="inp" onchange="shipSet('status', this.value)">
              <option value="${SHIP_STATE_ALL}"${f.status === SHIP_STATE_ALL ? ' selected' : ''}>すべての状態</option>
              ${Object.entries(SHIP_STATE).map(([k, v]) => `<option value="${k}"${f.status === k ? ' selected' : ''}>${v[0]}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="hstack mt12" style="gap:7px">
          <span class="tiny muted">クイック期間</span>
          ${chip(f.from === TODAY && f.to === TODAY, '本日', "shipQuick('today')")}
          ${chip(false, '直近7日', "shipQuick('week')")}
          ${chip(false, '今月', "shipQuick('month')")}
          ${chip(false, '先月', "shipQuick('lastMonth')")}
          ${chip(!f.from && !f.to, '全期間', "shipQuick('all')")}
          <div class="sp" style="position:relative;min-width:200px">
            <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--ink-400)">${ico('search', 16)}</span>
            <input class="inp" style="padding-left:34px" placeholder="出荷番号・得意先・受注番号" value="${esc(f.q)}" oninput="shipSet('q', this.value)">
          </div>
        </div>
        <div class="cond-row mt12">
          ${condChip('期間', f.from || f.to ? `${f.from || '指定なし'} 〜 ${f.to || '指定なし'}` : '', "shipSet('from','');shipSet('to','')")}
          ${condChip('得意先', (cs.find(c => c.id === custSel) || {}).name || '', "shipSet('customerId','')")}
          ${condChip('営業担当者', Store.salesRepName(repSel), "shipSet('salesRepId','')")}
          ${condChip('出荷状態', f.status === SHIP_STATE_ALL ? '' : (SHIP_STATE[f.status] || [f.status])[0], `shipSet('status','${SHIP_STATE_ALL}')`)}
          ${condChip('キーワード', f.q, "shipSet('q','')")}
          <span class="sp tiny muted">該当 <b>${num(list.length)}</b> 件</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-h"><h2>${ico('history', 16)} 出荷検索結果</h2><span class="sub">出荷日の新しい順</span>
        <div class="sp"><span class="badge gray">${num(list.length)} 件</span></div></div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>出荷日</th><th>出荷番号</th><th>得意先</th><th>営業担当者</th><th>受注番号</th><th class="right">数量</th><th class="right">金額(税抜)</th><th>運送会社</th><th>出荷状態</th><th></th></tr></thead>
        <tbody>${list.length ? list.map(s => {
          const st = SHIP_STATE[s.status] || [s.status, 'gray'];
          const rep = Store.salesRepName(Store.shipmentRepId(s));
          return `<tr>
            <td class="sm nowrap">${dJP(s.shipDate)}</td>
            <td class="mono">${esc(s.shipmentNo)}</td>
            <td class="strong">${esc(s.customerName)}</td>
            <td class="sm">${rep ? esc(rep) : '<span class="muted">—</span>'}</td>
            <td class="mono">${esc(s.orderNo || '—')}</td>
            <td class="num">${num(Store.shipLines(s.id).reduce((a, l) => a + l.quantity, 0))}</td>
            <td class="num">${money(Math.round(Store.shipmentAmount(s)))}</td>
            <td class="sm">${esc(s.carrier || '—')}</td>
            <td><span class="badge ${st[1]}">${esc(st[0])}</span></td>
            <td class="right"><div class="tb-act">
              <button class="btn xs" onclick="Actions.openShipment('${s.id}')">詳細</button>
              ${s.status === 'confirmed'
                ? `<button class="btn xs primary" onclick="Actions.docPick('${s.id}')">帳票</button>`
                : s.status === 'instructed' ? `<button class="btn xs primary" onclick="Actions.confirmShipment('${s.id}')">確定</button>` : ''}
            </div></td></tr>`;
        }).join('')
          : `<tr><td colspan="10">${emptyBox('条件に一致する出荷がありません', '期間・得意先・営業担当者・出荷状態を変更してください')}</td></tr>`}</tbody>
        ${list.length ? `<tfoot><tr>
          <td colspan="5" class="right strong">合計</td>
          <td class="num strong">${num(qty)}</td>
          <td class="num strong">${money(Math.round(amt))}</td>
          <td colspan="3"></td></tr></tfoot>` : ''}
      </table></div></div>
    </div>
  </div>`;
};

/* ============================== 帳票発行 ============================== */
/* ============================== ユーザー管理 ============================== */
Views.users = () => {
  const list = Store.db.users;
  const cnt = r => list.filter(u => u.role === r).length;
  const enabledCnt = r => list.filter(u => u.role === r && u.enabled).length;
  const isLocked = u => {
    const s = (Store.db.loginSecurity || {})[String(u.loginId).toLowerCase()];
    return !!(s && s.lockedUntil && new Date(s.lockedUntil) > new Date());
  };
  return `<div class="vstack" style="gap:16px">
    <div class="grid g3">
      ${Object.entries(ROLES).map(([k, r]) => kpiCard({
        label: r.label, icon: r.icon, bg: `var(--${r.color === 'green' ? 'green-100' : r.color === 'sky' ? 'sky-100' : 'amber-100'})`,
        fg: `var(--${r.color === 'green' ? 'green-700' : r.color === 'sky' ? 'sky-600' : 'amber-600'})`,
        value: cnt(k), unit: '名', foot: `有効 ${enabledCnt(k)} 名／${r.desc}`
      })).join('')}
    </div>
    <div class="card">
      <div class="card-h"><h2>${ico('user', 16)} ユーザー管理</h2><span class="sub">ユーザーID・パスワード認証のアカウント</span>
        <div class="sp"><button class="btn sm primary" onclick="Actions.userForm()">${ico('plus', 14)} ユーザー登録</button></div></div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>ユーザーID</th><th>組織</th><th>氏名</th><th>メールアドレス</th><th>電話番号</th><th>ロール</th><th>利用可能機能</th><th>最終ログイン日時</th><th>パスワード変更要求</th><th>状態</th><th></th></tr></thead>
        <tbody>${list.map(u => {
          const funcs = MENU.flatMap(g => g.items).filter(i => i.roles.includes(u.role)).length;
          return `<tr>
            <td class="mono">${esc(u.loginId)}</td>
            <td class="sm">${esc(Tenant.name(u.organizationId))}</td>
            <td><div class="hstack" style="gap:9px"><span class="av" style="width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:12px;background:${ROLES[u.role].av}">${esc(u.name.charAt(0))}</span><span class="strong">${esc(u.name)}</span></div></td>
            <td class="mono">${esc(u.email)}</td>
            <td class="sm">${esc(u.tel || '—')}</td>
            <td><span class="badge ${ROLES[u.role].color}">${esc((ROLES[u.role] || {}).label || u.role)}</span></td>
            <td class="sm muted">${funcs} 機能</td>
            <td class="sm nowrap mono">${u.lastLoginAt ? dtJP(u.lastLoginAt) : '—'}</td>
            <td class="nowrap">${u.forcePasswordChange ? '<span class="badge amber">要求中</span>' : '<span class="muted">—</span>'}</td>
            <td class="nowrap">${u.enabled ? '<span class="badge green">有効</span>' : '<span class="badge gray">無効</span>'}${isLocked(u) ? ' <span class="badge rose">ロック中</span>' : ''}${u.forcePasswordChange ? ' <span class="badge amber">初回パスワード</span>' : ''}</td>
            <td class="right"><div class="tb-act">
              <button class="btn xs" onclick="Actions.userForm('${u.id}')">編集</button>
              <button class="btn xs" onclick="Actions.userPasswordForm('${u.id}')">パスワード</button>
              <button class="btn xs" onclick="Actions.reissueUserPassword('${u.id}')">初期化</button>
              <button class="btn xs primary" onclick="Actions.resetUserPassword('${u.id}')">パスワードリセット</button>
              <button class="btn xs" onclick="Actions.toggleUserEnabled('${u.id}')">${u.enabled ? '無効化' : '有効化'}</button>
              <button class="btn xs danger" onclick="Actions.deleteUser('${u.id}')">削除</button></div></td></tr>`;
        }).join('')}</tbody>
      </table></div></div>
    </div>
    <div class="card">
      <div class="card-h"><h2>${ico('shield', 16)} 権限マトリクス</h2><span class="sub">各ロールで利用できる機能</span></div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>機能</th>${Object.values(ROLES).map(r => `<th class="center">${r.label}</th>`).join('')}</tr></thead>
        <tbody>${MENU.flatMap(g => g.items).map(i => `<tr>
          <td class="strong">${esc(i.label)}<div class="tiny muted">${esc(i.sub)}</div></td>
          ${Object.keys(ROLES).map(r => `<td class="center">${i.roles.includes(r) ? `<span style="color:var(--green-600)">${ico('check', 17, 3)}</span>` : '<span class="muted">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div></div>
    </div>
    <div class="card">
      <div class="card-h"><h2>${ico('history', 16)} 操作ログ（監査ログ）</h2><span class="sub">パスワードリセットなどの記録（直近20件）</span></div>
      <div class="card-b tight">${(() => {
        const logs = (Store.db.auditLogs || []).slice()
          .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 20);
        return logs.length ? `<div class="table-wrap"><table class="tb">
        <thead><tr><th>実行日時</th><th>実行者</th><th>操作</th><th>対象ユーザー</th><th>IPアドレス</th></tr></thead>
        <tbody>${logs.map(l => `<tr>
          <td class="sm nowrap mono">${dtJP(l.createdAt)}</td>
          <td class="sm">${esc(l.actorName || '—')}<div class="tiny muted mono">${esc(l.actorLoginId || '')}</div></td>
          <td class="sm">${esc(AUDIT_LABEL[l.action] || l.action || '—')}</td>
          <td class="sm">${esc(l.targetName || '—')}<div class="tiny muted mono">${esc(l.targetLoginId || '')}</div></td>
          <td class="sm mono">${esc(l.ipAddress || '—')}</td></tr>`).join('')}</tbody>
      </table></div>` : emptyBox('操作ログはまだありません', 'パスワードリセットを実行すると記録されます');
      })()}</div>
    </div>
  </div>`;
};

/* ============================== 設定・将来拡張 ============================== */
/* ==========================================================================
   組織マスタ（システム管理者のみ）— テナントの追加・編集・停止
   ========================================================================== */
Views.organizations = () => {
  if (!Tenant.isSystemAdmin()) return `<div class="card"><div class="card-b">${emptyBox('権限がありません', '組織マスタはシステム管理者のみ利用できます')}</div></div>`;
  const list = Tenant.all().slice().sort((a, b) => Number(a.id) - Number(b.id));
  const cur = Tenant.id();
  const countOf = (tbl, id) => ((Store.db[tbl] || []).filter(r => Number(r.organizationId) === Number(id))).length;
  const rows = list.map(o => {
    const users = countOf('users', o.id);
    const companies = countOf('companies', o.id);
    return `<tr>
      <td class="mono">${esc(o.id)}</td>
      <td class="mono">${esc(o.organizationCode)}</td>
      <td class="strong">${esc(o.organizationName)}${Number(o.id) === cur ? ' <span class="badge green">ログイン中</span>' : ''}</td>
      <td class="num">${companies}</td>
      <td class="num">${users}</td>
      <td>${o.isActive === false ? '<span class="badge gray">停止</span>' : '<span class="badge green">有効</span>'}</td>
      <td class="tiny muted nowrap">${o.createdAt ? dtJP(o.createdAt) : '—'}</td>
      <td class="right"><div class="tb-act">
        <button class="btn xs" onclick="Actions.organizationForm('${o.id}')">編集</button>
        <button class="btn xs ${o.isActive === false ? '' : 'danger'}" onclick="Actions.toggleOrganization('${o.id}')">${o.isActive === false ? '有効化' : '停止'}</button>
      </div></td></tr>`;
  }).join('');
  return `<div class="vstack" style="gap:16px">
    <div class="grid g3">
      ${kpiCard({ label: '組織数', icon: 'layers', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: list.length, unit: '組織', foot: `有効 ${list.filter(o => o.isActive !== false).length} 組織` })}
      ${kpiCard({ label: '現在の組織', icon: 'shield', bg: 'var(--green-100)', fg: 'var(--green-700)', value: Tenant.code(), unit: '', foot: Tenant.name() })}
      ${kpiCard({ label: '所属ユーザー', icon: 'user', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: countOf('users', cur), unit: '名', foot: 'この組織のアカウント数' })}
    </div>
    <div class="note green">${ico('layers', 15)} 組織マスタは <b>システム管理者のみ</b> が操作できます。組織を「停止」してもデータは削除されません（所属ユーザーのログインと参照ができなくなります）。</div>
    <div class="card">
      <div class="card-h"><h2>${ico('layers', 16)} 組織マスタ</h2><span class="sub">組織 → 会社 → 拠点 の階層でデータを隔離します</span>
        <div class="sp"><button class="btn sm primary" onclick="Actions.organizationForm('')">${ico('plus', 14)} 組織を登録</button></div></div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>ID</th><th>組織コード</th><th>組織名</th><th class="num">会社</th><th class="num">ユーザー</th><th>状態</th><th>登録日</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div></div>
    </div>
    <div class="card">
      <div class="card-h"><h2>${ico('shield', 16)} データ隔離の仕組み</h2></div>
      <div class="card-b">
        <div class="vstack" style="gap:8px">
          <div class="hstack" style="gap:9px"><span class="badge green">1</span><span class="sm">ログイン時に <b>users.organization_id</b> をセッションへ保持し、画面・帳票はすべてこの組織で絞り込みます。</span></div>
          <div class="hstack" style="gap:9px"><span class="badge green">2</span><span class="sm">新規登録時は <b>organization_id を自動セット</b>します（入力不要）。</span></div>
          <div class="hstack" style="gap:9px"><span class="badge green">3</span><span class="sm">Supabase 側は <b>RLS（Row Level Security）</b>で全テーブルを組織単位に隔離します（<code>sql/08_multi_tenant.sql</code>）。</span></div>
        </div>
      </div>
    </div>
  </div>`;
};

Views.settings = () => {
  const s = Store.db.settings;
  const ext = [
    ['barcode', 'バーコード対応', 'JAN・自社バーコードの読み取り／印字。商品マスタにコード項目を用意済み', 'barcode', true],
    ['qr', 'QRコード対応', '商品・伝票にQRを印字してスマホでスキャン。ピッキングリストに印字領域あり', 'qr', true],
    ['excel', 'Excel出力', '在庫・受注・出荷一覧を .xlsx で書き出し（帳票スナップショットを利用）', 'excel', false],
    ['m365', 'Microsoft 365連携', 'OneDrive／SharePoint へ帳票PDFを自動保存、Excelで共同編集', 'cloud', false],
    ['line', 'LINE通知', '在庫不足・納期超過をLINE WORKS／Messaging API でプッシュ通知', 'line', false]
  ];
  return `<div class="vstack" style="gap:16px">
    <div class="note">${ico('layers', 15)} ログイン中の組織：<b>${esc(Tenant.label())}</b>${Tenant.isSystemAdmin() ? ` <button class="btn xs" style="margin-left:6px" onclick="App.go('organizations')">組織マスタ</button>` : ''}</div>
    <div class="grid g2">
      <div class="card">
        <div class="card-h"><h2>${ico('factory', 16)} 発行元（会社・拠点）</h2><span class="sub">帳票に印字される会社・拠点情報</span></div>
        <div class="card-b">
          <div class="vstack" style="gap:8px">
            ${Issuer.companies(false).slice(0, 5).map(c => `<div class="hstack" style="justify-content:space-between;padding:9px 12px;border:1px solid var(--ink-200);border-radius:11px;background:#fff">
              <div style="min-width:0"><b class="sm">${esc(c.name)}</b><div class="tiny muted">${esc(c.companyCode)} ／ 拠点 ${Issuer.branches(c.id, false).length} 件 ／ ${esc(c.tel || '—')}</div></div>
              ${c.isActive === false ? '<span class="badge gray">無効</span>' : '<span class="badge green">有効</span>'}</div>`).join('') || '<p class="sm muted">会社が登録されていません</p>'}
          </div>
          <div class="hstack mt16"><button class="btn primary" onclick="App.go('companies')">${ico('factory', 15)} 会社・拠点マスタ</button>
            <button class="btn" onclick="App.go('docTemplates')">${ico('printer', 15)} 帳票テンプレート</button>
            <span class="tiny muted">伝票ごとに発行会社・拠点①②を選択できます</span></div>
        </div>
      </div>
      <div class="card">
        <div class="card-h"><h2>${ico('shield', 16)} 緊急管理者ログイン</h2><span class="sub">ログイン障害時の非常用アクセス</span></div>
        <div class="card-b">
          <label class="chk" style="width:100%;justify-content:flex-start;padding:11px 13px">
            <input type="checkbox" id="emgEnabled" ${EMERGENCY.enabled() ? 'checked' : ''} onchange="Actions.saveEmergencyAdmin()">
            <span>緊急管理者ログインを有効化</span>
          </label>
          <div class="vstack mt12" style="gap:7px">
            <div class="hstack" style="justify-content:space-between"><span class="sm muted">緊急管理者ユーザーID</span><span class="badge gray mono">${esc(EMERGENCY.LOGIN_ID)}</span></div>
            <div class="hstack" style="justify-content:space-between"><span class="sm muted">権限</span><span class="badge green">管理者（admin）</span></div>
            <div class="hstack" style="justify-content:space-between"><span class="sm muted">現在の状態</span>${EMERGENCY.enabled() ? '<span class="badge green">有効</span>' : '<span class="badge gray">無効</span>'}</div>
          </div>
          <div class="note amber mt12">${ico('alert', 15)} 緊急管理者は <b>通常のユーザー認証より先に判定</b>され、Supabase接続やデータ初期化の状態に依らずログインできます。ログインは監査ログに「緊急管理者ログイン」として記録されます（パスワードは記録しません）。<br>運用が安定したら<b>無効化</b>してください。</div>
          <div class="note mt12">${ico('shield', 15)} 本アプリは静的配布（単一HTML）のため、認証情報は配布物に含まれます。配布範囲の管理、またはシークレット化（サーバー側プロキシ等）を併用してください。</div>
        </div>
      </div>
      <div class="card">
        <div class="card-h"><h2>${ico('settings', 16)} データ管理</h2></div>
        <div class="card-b vstack">
          <div class="note">${ico('cloud', 15)} データは Supabase（PostgreSQL）に保存され、全ユーザーでリアルタイム共有されています。接続状態: <b id="sbConnState">${(typeof SB !== 'undefined' && SB.ready) ? (SB.transport === 'realtime' ? 'リアルタイム接続' : SB.transport === 'polling' ? 'ポーリング接続' : '接続済み') : '未接続'}</b></div>
          <div class="hstack"><button class="btn" onclick="Actions.exportJSON()">${ico('download', 15)} データを書き出す（JSON）</button></div>
          <div class="hstack"><button class="btn" onclick="Actions.exportCSV()">${ico('excel', 15)} 在庫CSVを書き出す</button></div>
          <div class="hstack"><button class="btn danger" onclick="Actions.resetData()">${ico('refresh', 15)} デモデータを初期化</button></div>
          <div class="hr"></div>
          <div class="vstack" style="gap:7px">
            <div class="hstack" style="justify-content:space-between"><span class="sm muted">登録商品</span><span class="badge green">${Store.db.items.length} 品目</span></div>
            <div class="hstack" style="justify-content:space-between"><span class="sm muted">受注／発注</span><span class="badge sky">${Store.db.orders.length} ／ ${Store.db.purchaseOrders.length} 件</span></div>
            <div class="hstack" style="justify-content:space-between"><span class="sm muted">出荷／帳票</span><span class="badge violet">${Store.db.shipments.length} ／ ${Store.db.documents.length} 件</span></div>
            <div class="hstack" style="justify-content:space-between"><span class="sm muted">在庫トランザクション</span><span class="badge amber">${Store.db.movements.length} 件</span></div>
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-h"><h2>${ico('trend', 16)} 将来拡張</h2><span class="sub">スキーマ・画面に受け口を用意済み</span></div>
      <div class="card-b"><div class="grid g3">
        ${ext.map(([k, title, desc, icon, ready]) => `<div style="border:1px solid var(--ink-200);border-radius:14px;padding:15px;background:#fff">
          <div class="hstack"><span style="width:36px;height:36px;border-radius:11px;background:var(--green-50);color:var(--green-700);display:grid;place-items:center">${ico(icon, 18, 2.1)}</span>
            <div style="flex:1;min-width:0"><b style="font-size:13.5px">${title}</b></div>
            ${ready ? '<span class="badge green">準備済</span>' : '<span class="badge gray">拡張枠</span>'}</div>
          <p class="tiny muted mt8" style="line-height:1.7">${desc}</p></div>`).join('')}
      </div></div>
    </div>
  </div>`;
};


/* ===== 07-issuer.js ===== */
/* ==========================================================================
   アグリERP — 発行元マスタ（会社・拠点）／帳票テンプレート／発行元表示制御
   - 会社マスタ（companies）: 複数登録・グループ会社対応
   - 拠点マスタ（branches）  : 会社 1:N 拠点
   - 帳票テンプレート（doc_templates）: 帳票種別ごとの表示項目（☑会社名 ☑住所 …）
   - 伝票ヘッダーへの発行元表示は本モジュールの headerHtml() が唯一の経路。
     表示しない項目・空の項目は HTML 自体を出力しない（空行・空白領域を作らない）。
   ========================================================================== */

/* 表示可否を設定できる項目（§5 表示項目の制御） */
const ISSUER_FIELD_DEFS = [
  { key: 'companyName',  label: '会社名',   scope: 'company', fixed: true },
  { key: 'branchName',   label: '拠点名',   scope: 'branch',  fixed: true },
  { key: 'address',      label: '住所',     scope: 'both' },
  { key: 'tel',          label: 'TEL',      scope: 'both' },
  { key: 'fax',          label: 'FAX',      scope: 'both' },
  { key: 'email',        label: 'メール',   scope: 'both' },
  { key: 'invoiceNumber', label: '登録番号', scope: 'company' },
  { key: 'manager',      label: '担当者',   scope: 'branch' },
  { key: 'logo',         label: 'ロゴ',     scope: 'company' }
];

/* 帳票テンプレート編集画面で表示可否を設定する項目（指示の10項目） */
const TPL_FIELDS = [
  { key: 'companyName', label: '会社名' },
  { key: 'branch1', label: '主拠点' },
  { key: 'branch2', label: '副拠点' },
  { key: 'address', label: '住所' },
  { key: 'tel', label: 'TEL' },
  { key: 'fax', label: 'FAX' },
  { key: 'email', label: 'メール' },
  { key: 'manager', label: '担当者' },
  { key: 'invoiceNumber', label: '登録番号' },
  { key: 'logo', label: 'ロゴ' }
];

/* レイアウト既定値（旧テンプレートはこの値で補完＝既存テンプレート移行対応） */
const TPL_LAYOUT_DEFAULTS = { branchMode: 'both', paper: 'portrait', watermark: true, footer: true };

/* マスタ未設定時の既定値（会社・拠点とも「表示する」） */
const DEFAULT_COMPANY_VISIBLE = { address: true, tel: true, fax: true, email: false, invoiceNumber: true, logo: true };
const DEFAULT_BRANCH_VISIBLE  = { address: true, tel: true, fax: true, email: false, manager: true };

const DOC_KIND_LABEL = {
  quote: '見積書', purchase_order: '発注書', delivery_note: '納品書', invoice: '請求書',
  receipt_note: '入庫伝票', shipping_slip: '出庫伝票', picking_list: 'ピッキングリスト'
};
const DOC_KIND_BADGE = {
  quote: 'sky', purchase_order: 'violet', delivery_note: 'green', invoice: 'green',
  receipt_note: 'amber', shipping_slip: 'sky', picking_list: 'violet'
};

const Issuer = {
  _last: null,   /* 直前に使用した発行元（次の伝票作成時に引き継ぐ） */

  /* ------------------------------ マスタ参照 ------------------------------ */
  companies(onlyActive) {
    const list = (Store.db.companies || []).slice();
    return (onlyActive ? list.filter(c => c.isActive !== false) : list)
      .sort((a, b) => String(a.companyCode || '').localeCompare(String(b.companyCode || '')));
  },
  branches(companyId, onlyActive) {
    const list = (Store.db.branches || []).filter(b => !companyId || b.companyId === companyId);
    return (onlyActive ? list.filter(b => b.isActive !== false) : list)
      .sort((a, b) => String(a.branchCode || '').localeCompare(String(b.branchCode || '')));
  },
  templates(onlyActive) {
    const list = (Store.db.docTemplates || []).slice();
    return (onlyActive ? list.filter(t => t.isActive !== false) : list);
  },
  company(id) { return (Store.db.companies || []).find(c => c.id === id) || null; },
  branch(id) { return (Store.db.branches || []).find(b => b.id === id) || null; },
  template(id) { return (Store.db.docTemplates || []).find(t => t.id === id) || null; },

  companyVisible(c) { return Object.assign({}, DEFAULT_COMPANY_VISIBLE, (c && c.visibleFields) || {}); },
  branchVisible(b) { return Object.assign({}, DEFAULT_BRANCH_VISIBLE, (b && b.visibleFields) || {}); },

  /* テンプレートの既定値補完（旧テンプレート＝表示true・拠点は両方・A4縦として移行） */
  tplNorm(t) {
    const out = Object.assign({}, t || {});
    TPL_FIELDS.forEach(f => { if (out[f.key] === undefined) out[f.key] = true; });
    Object.keys(TPL_LAYOUT_DEFAULTS).forEach(k => { if (out[k] === undefined) out[k] = TPL_LAYOUT_DEFAULTS[k]; });
    return out;
  },

  /* 帳票種別・会社に適合するテンプレート（会社専用 > 共通、標準 > 先頭） */
  templateFor(docKind, companyId) {
    if (!docKind) return null;
    const list = this.templates(true).filter(t => t.docKind === docKind);
    if (!list.length) return null;
    return list.find(t => t.companyId === companyId && t.isDefault)
        || list.find(t => !t.companyId && t.isDefault)
        || list.find(t => t.companyId === companyId)
        || list[0];
  },

  /* 表示判定（テンプレート指定 && マスタの表示可否） */
  show(template, master, key) {
    if (template && template[key] === false) return false;
    if (master && master[key] === false) return false;
    return true;
  },

  /* 伝票レコードから発行元コンテキストを解決（旧データは既定会社へフォールバック） */
  resolve(src) {
    src = src || {};
    const cos = this.companies(true);
    let co = src.companyId ? this.company(src.companyId) : null;
    if (!co) co = this.company((this._last || {}).companyId) || cos[0] || null;
    let b1 = src.branch1Id ? this.branch(src.branch1Id) : null;
    let b2 = src.branch2Id ? this.branch(src.branch2Id) : null;
    if (!co) { b1 = null; b2 = null; }
    if (b1 && co && b1.companyId !== co.id) b1 = null;
    if (b2 && co && b2.companyId !== co.id) b2 = null;
    if (b2 && b1 && b2.id === b1.id) b2 = null;
    const template = src.templateId ? this.template(src.templateId) : this.templateFor(src.docKind, co && co.id);
    return { company: co, branch1: b1, branch2: b2, template };
  },

  /* テーブル表示用のラベル */
  label(rec) {
    const c = (rec.companyId && this.company(rec.companyId)) || this.company(this.resolve(rec).company && this.resolve(rec).company.id);
    if (!c) return '—';
    const b1 = rec.branch1Id ? this.branch(rec.branch1Id) : null;
    const b2 = rec.branch2Id ? this.branch(rec.branch2Id) : null;
    return esc(c.name) + (b1 ? ` <span class="tiny muted">／ ${esc(b1.name)}${b2 ? '・' + esc(b2.name) : ''}</span>` : '');
  },

  /* ------------------------------ 帳票ヘッダーHTML ------------------------------ */
  branchBlock(b, no) {
    if (!b) return '';
    const t = this._tpl;
    const v = this.branchVisible(b);
    const out = [];
    const nm = this.show(t, v, 'branchName') ? b.name : '';
    if (nm) out.push(`<b class="nm">【拠点${no === 1 ? '①' : '②'}】${esc(nm)}</b>`);
    if (this.show(t, v, 'address')) {
      const addr = [(b.postalCode || '').trim(), (b.address || '').trim()].filter(Boolean).join(' ');
      if (addr) out.push(`<span class="il">${esc(addr)}</span>`);
    }
    if (this.show(t, v, 'tel') && b.tel) out.push(`<span class="il">TEL：${esc(b.tel)}</span>`);
    if (this.show(t, v, 'fax') && b.fax) out.push(`<span class="il">FAX：${esc(b.fax)}</span>`);
    if (this.show(t, v, 'email') && b.email) out.push(`<span class="il">E-mail：${esc(b.email)}</span>`);
    if (this.show(t, v, 'manager') && b.managerName) out.push(`<span class="il">担当：${esc(b.managerName)}</span>`);
    return out.length ? `<div class="issuer-br">${out.join('')}</div>` : '';
  },

  /* ctx = { company, branch1, branch2, template } */
  headerHtml(ctx) {
    ctx = ctx || {};
    const c = ctx.company;
    if (!c) return '';
    const t = this.tplNorm(ctx.template);
    this._tpl = t;
    const v = this.companyVisible(c);
    const head = [];
    if (this.show(t, v, 'logo') && c.logoUrl) head.push(`<img class="issuer-logo" src="${esc(c.logoUrl)}" alt="">`);
    if (this.show(t, v, 'companyName') && c.name) head.push(`<b>${esc(c.name)}</b>`);
    const lines = [];
    if (this.show(t, v, 'address')) {
      const addr = [(c.postalCode || '').trim(), (c.address || '').trim()].filter(Boolean).join(' ');
      if (addr) lines.push(`<span class="il">${esc(addr)}</span>`);
    }
    if (this.show(t, v, 'tel') && c.tel) lines.push(`<span class="il">TEL：${esc(c.tel)}</span>`);
    if (this.show(t, v, 'fax') && c.fax) lines.push(`<span class="il">FAX：${esc(c.fax)}</span>`);
    if (this.show(t, v, 'email') && c.email) lines.push(`<span class="il">E-mail：${esc(c.email)}</span>`);
    if (this.show(t, v, 'invoiceNumber') && c.invoiceNumber) lines.push(`<span class="il">登録番号：${esc(c.invoiceNumber)}</span>`);
    const mode = t.branchMode || 'both';
    const b1 = t.branch1 !== false ? this.branchBlock(ctx.branch1, 1) : '';
    const b2 = (mode !== 'main' && t.branch2 !== false) ? this.branchBlock(ctx.branch2, 2) : '';
    const bCls = mode === 'two_col' ? ' two-col' : '';
    const any = head.length || lines.length || b1 || b2;
    if (!any) return '';
    return `<div class="issuer">
      ${head.length ? `<div class="issuer-head">${head.join('')}</div>` : ''}
      ${lines.length ? `<div class="issuer-lines">${lines.join('')}</div>` : ''}
      ${(b1 || b2) ? `<div class="issuer-branches${bCls}">${b1}${b2}</div>` : ''}
    </div>`;
  },

  /* サンプル表示（会社・拠点マスタ画面／フォームのプレビュー） */
  previewHtml(companyId, branch1Id, branch2Id) {
    const html = this.headerHtml(this.resolve({ companyId, branch1Id, branch2Id, docKind: this._previewKind || null }));
    return html || '<div class="tiny muted">発行元の表示項目がありません（会社名など表示可否を確認してください）</div>';
  },

  /* ------------------------------ 選択UI（画面） ------------------------------ */
  companyOptions(sel, onlyActive = true) {
    return this.companies(onlyActive).map(c => `<option value="${esc(c.id)}"${sel === c.id ? ' selected' : ''}>${esc(c.companyCode)} ${esc(c.name)}</option>`).join('');
  },
  branchOptions(companyId, sel, allowEmpty, excludeId) {
    const list = this.branches(companyId, true).filter(b => b.id !== excludeId);
    return (allowEmpty ? `<option value="">（指定しない）</option>` : '')
      + list.map(b => `<option value="${esc(b.id)}"${sel === b.id ? ' selected' : ''}>${esc(b.branchCode)} ${esc(b.name)}</option>`).join('');
  },
  defaultSel() {
    const cos = this.companies(true);
    const last = this._last && cos.find(c => c.id === this._last.companyId) ? this._last : null;
    const co = last ? last.companyId : (cos[0] || {}).id || '';
    const bs = this.branches(co, true);
    const b1 = last ? (bs.find(b => b.id === last.branch1Id) ? last.branch1Id : (bs[0] || {}).id || '') : (bs[0] || {}).id || '';
    return { companyId: co, branch1Id: b1, branch2Id: '' };
  },

  /* 伝票作成フォームへ埋め込む発行元セレクタ（会社→拠点①→拠点②のカスケード） */
  pickerHtml(prefix, sel, opt) {
    opt = opt || {};
    const d = Object.assign({}, this.defaultSel(), sel || {});
    if (sel && sel.companyId) d.companyId = sel.companyId;
    if (sel && 'branch1Id' in sel) d.branch1Id = sel.branch1Id || '';
    if (sel && 'branch2Id' in sel) d.branch2Id = sel.branch2Id || '';
    const cosAll = this.companies(true);
    if (!d.companyId || !cosAll.some(c => c.id === d.companyId)) d.companyId = (cosAll[0] || {}).id || '';
    if (d.branch1Id && !this.branches(d.companyId, true).some(b => b.id === d.branch1Id)) d.branch1Id = '';
    if (d.branch2Id && (!this.branches(d.companyId, true).some(b => b.id === d.branch2Id) || d.branch2Id === d.branch1Id)) d.branch2Id = '';
    const cos = this.companies(true);
    if (!cos.length) return `<div class="note amber">会社マスタが未登録です。システム → 会社・拠点マスタ から登録してください。</div>`;
    this._previewKind = opt.docKind || null;
    return `<div class="issuer-picker">
      <div class="field"><label>発行会社 *</label><select class="inp" id="${prefix}_co" onchange="Issuer.onCompanyChange('${prefix}', this.value)">${this.companyOptions(d.companyId)}</select></div>
      <div class="field"><label>発行拠点①</label><select class="inp" id="${prefix}_b1" onchange="Issuer.onBranch1Change('${prefix}', this.value)">${this.branchOptions(d.companyId, d.branch1Id, true)}</select></div>
      <div class="field"><label>発行拠点②（任意）</label><select class="inp" id="${prefix}_b2" onchange="Issuer.onPickChange('${prefix}')">${this.branchOptions(d.companyId, d.branch2Id, true, d.branch1Id)}</select></div>
    </div>
    <div class="issuer-preview" id="${prefix}_prev">${this.previewHtml(d.companyId, d.branch1Id, d.branch2Id)}</div>`;
  },

  _el(id) { return document.getElementById(id); },
  onCompanyChange(prefix, companyId) {
    const b1 = this._el(prefix + '_b1'), b2 = this._el(prefix + '_b2');
    const first = (this.branches(companyId, true)[0] || {}).id || '';
    if (b1) b1.innerHTML = this.branchOptions(companyId, first, true);
    if (b2) b2.innerHTML = this.branchOptions(companyId, '', true, first);
    this.onPickChange(prefix);
  },
  onBranch1Change(prefix, branch1Id) {
    const b2 = this._el(prefix + '_b2');
    const co = this._el(prefix + '_co');
    if (b2) {
      const keep = (this.branches(co ? co.value : '', true).some(b => b.id === b2.value) && b2.value !== branch1Id) ? b2.value : '';
      b2.innerHTML = this.branchOptions(co ? co.value : '', keep, true, branch1Id);
    }
    this.onPickChange(prefix);
  },
  onPickChange(prefix) {
    const co = this._el(prefix + '_co'), b1 = this._el(prefix + '_b1'), b2 = this._el(prefix + '_b2');
    const prev = this._el(prefix + '_prev');
    if (prev) prev.innerHTML = this.previewHtml(co ? co.value : '', b1 ? b1.value : '', b2 ? b2.value : '');
  },

  read(prefix) {
    const co = this._el(prefix + '_co'), b1 = this._el(prefix + '_b1'), b2 = this._el(prefix + '_b2');
    if (!co) return { companyId: null, branch1Id: null, branch2Id: null };
    const out = {
      companyId: co.value || null,
      branch1Id: (b1 && b1.value) || null,
      branch2Id: (b2 && b2.value) || null
    };
    if (out.branch2Id && out.branch1Id === out.branch2Id) out.branch2Id = null;
    this._last = { companyId: out.companyId, branch1Id: out.branch1Id };
    return out;
  },

  /* 入力検証（発行会社必須・拠点は会社配下のみ・①と②の重複禁止） */
  validate(prefix) {
    const s = this.read(prefix);
    if (!s.companyId) return '発行会社は必須です';
    const co = this.company(s.companyId);
    if (!co || co.isActive === false) return '選択した発行会社は無効です';
    if (s.branch1Id && (!this.branch(s.branch1Id) || this.branch(s.branch1Id).companyId !== co.id)) return '発行拠点①は発行会社の配下から選択してください';
    if (s.branch2Id && (!this.branch(s.branch2Id) || this.branch(s.branch2Id).companyId !== co.id)) return '発行拠点②は発行会社の配下から選択してください';
    if (s.branch1Id && s.branch2Id && s.branch1Id === s.branch2Id) return '発行拠点①と②には別の拠点を選択してください';
    return null;
  },

  /* レコードへ保存する発行元スナップショット（新規作成時に使用） */
  stamp(prefix) {
    const s = this.read(prefix);
    return { companyId: s.companyId, branch1Id: s.branch1Id, branch2Id: s.branch2Id };
  }
};

/* ==========================================================================
   会社・拠点マスタ 画面
   ========================================================================== */
let coQ = '';

Views.companies = () => {
  const all = Issuer.companies(false);
  const active = all.filter(c => c.isActive !== false);
  const branchAll = Issuer.branches('', false);
  const tplAll = Issuer.templates(false);
  const q = coQ.toLowerCase();
  const cos = all.filter(c => !q || (c.companyCode + c.name + (c.address || '') + (c.tel || '')).toLowerCase().includes(q));

  const rows = cos.map(c => {
    const bs = Issuer.branches(c.id, false);
    return `<tr>
      <td class="mono">${esc(c.companyCode)}</td>
      <td><span class="strong">${esc(c.name)}</span>${c.notes ? `<div class="tiny muted">${esc(c.notes)}</div>` : ''}</td>
      <td class="tiny">${esc(c.postalCode || '')} ${esc(c.address || '—')}</td>
      <td class="sm">${esc(c.tel || '—')}${c.fax ? `<div class="tiny muted">FAX ${esc(c.fax)}</div>` : ''}</td>
      <td class="mono tiny">${esc(c.invoiceNumber || '—')}</td>
      <td class="num">${bs.length}</td>
      <td>${c.isActive === false ? '<span class="badge gray">無効</span>' : '<span class="badge green">有効</span>'}</td>
      <td class="right"><div class="tb-act">
        <button class="btn xs" onclick="IssuerAdmin.branchForm('','${c.id}')">拠点追加</button>
        <button class="btn xs" onclick="IssuerAdmin.companyForm('${c.id}')">編集</button>
        <button class="btn xs" onclick="IssuerAdmin.toggleCompany('${c.id}')">${c.isActive === false ? '有効化' : '無効化'}</button>
      </div></td></tr>`;
  }).join('');

  const branchRows = branchAll.map(b => {
    const co = Issuer.company(b.companyId) || {};
    return `<tr>
      <td class="mono">${esc((co.companyCode || '') + ' / ' + (b.branchCode || ''))}</td>
      <td class="strong">${esc(b.name)}<div class="tiny muted">${esc(co.name || '—')}</div></td>
      <td class="tiny">${esc(b.postalCode || '')} ${esc(b.address || '—')}</td>
      <td class="sm">${esc(b.tel || '—')}${b.fax ? `<div class="tiny muted">FAX ${esc(b.fax)}</div>` : ''}</td>
      <td class="sm">${esc(b.managerName || '—')}</td>
      <td>${b.isActive === false ? '<span class="badge gray">無効</span>' : '<span class="badge green">有効</span>'}</td>
      <td class="right"><div class="tb-act">
        <button class="btn xs" onclick="IssuerAdmin.branchForm('${b.id}','${b.companyId}')">編集</button>
        <button class="btn xs" onclick="IssuerAdmin.toggleBranch('${b.id}')">${b.isActive === false ? '有効化' : '無効化'}</button>
        <button class="btn xs danger" onclick="IssuerAdmin.deleteBranch('${b.id}')">削除</button>
      </div></td></tr>`;
  }).join('');

  const samples = active.slice(0, 3).map(c => {
    const bs = Issuer.branches(c.id, true);
    return `<div class="issuer-sample">
      <div class="tiny muted mb8">${esc(c.name)} の発行元表示プレビュー（${bs.length ? esc(bs.slice(0, 2).map(b => b.name).join('・')) : '拠点なし'}）</div>
      ${Issuer.headerHtml(Issuer.resolve({ companyId: c.id, branch1Id: (bs[0] || {}).id, branch2Id: (bs[1] || {}).id }))}
    </div>`;
  }).join('');

  return `<div class="vstack" style="gap:16px">
    <div class="grid g4">
      ${kpiCard({ label: '会社マスタ', icon: 'factory', bg: 'var(--green-100)', fg: 'var(--green-700)', value: all.length, unit: '社', foot: `有効 ${active.length} 社` })}
      ${kpiCard({ label: '拠点マスタ', icon: 'users', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: branchAll.length, unit: '拠点', foot: `有効 ${branchAll.filter(b => b.isActive !== false).length} 拠点` })}
      ${kpiCard({ label: '帳票テンプレート', icon: 'printer', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: tplAll.length, unit: '件', foot: `標準 ${tplAll.filter(t => t.isDefault).length} 件` })}
      ${kpiCard({ label: 'グループ会社', icon: 'layers', bg: 'var(--amber-100)', fg: 'var(--amber-600)', value: active.length, unit: '社', foot: '伝票発行時に選択できます' })}
    </div>

    <div class="note green">${ico('factory', 15)} 伝票（見積書・発注書・納品書・請求書・入庫伝票・出庫伝票など）の上部には、選択した<b>発行会社</b>と<b>発行拠点（最大2件）</b>が印字されます。表示する項目は会社・拠点ごと、および帳票テンプレートで制御できます。</div>

    <div class="card">
      <div class="card-h"><h2>${ico('factory', 16)} 会社マスタ</h2><span class="sub">複数のグループ会社・法人を登録できます</span>
        <div class="sp hstack">
          <div style="position:relative;min-width:200px">
            <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--ink-400)">${ico('search', 16)}</span>
            <input class="inp" style="padding-left:34px" placeholder="会社コード・会社名・住所" value="${esc(coQ)}" oninput="coQ=this.value;App.repaint()">
          </div>
          <button class="btn sm primary" onclick="IssuerAdmin.companyForm('')">${ico('plus', 14)} 会社を登録</button>
        </div>
      </div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>コード</th><th>会社名</th><th>所在地</th><th>連絡先</th><th>登録番号</th><th class="right">拠点</th><th>状態</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8">${emptyBox('会社が登録されていません', '「会社を登録」から追加してください')}</td></tr>`}</tbody>
      </table></div></div>
    </div>

    <div class="card">
      <div class="card-h"><h2>${ico('users', 16)} 拠点マスタ</h2><span class="sub">会社 1 : N 拠点（伝票には最大2拠点を印字）</span>
        <div class="sp"><button class="btn sm primary" onclick="IssuerAdmin.branchForm('','${(active[0] || {}).id || ''}')">${ico('plus', 14)} 拠点を登録</button></div></div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>会社／拠点コード</th><th>拠点名</th><th>所在地</th><th>連絡先</th><th>担当者</th><th>状態</th><th></th></tr></thead>
        <tbody>${branchRows || `<tr><td colspan="7">${emptyBox('拠点が登録されていません', '会社を登録したうえで拠点を追加してください')}</td></tr>`}</tbody>
      </table></div></div>
    </div>

    <div class="card">
      <div class="card-h"><h2>${ico('eye', 16)} 発行元表示プレビュー</h2><span class="sub">帳票に印字される内容（非表示・空の項目は出力されません）</span></div>
      <div class="card-b"><div class="grid g3">${samples || emptyBox('プレビューがありません', '会社を登録してください')}</div></div>
    </div>
  </div>`;
};

/* ==========================================================================
   帳票テンプレート 画面
   ========================================================================== */
Views.docTemplates = () => {
  if (typeof TplEditor !== 'undefined' && TplEditor.state.open) return TplEditor.html();
  const list = Issuer.templates(false);
  const kinds = Object.keys(DOC_KIND_LABEL);
  const rows = list.map(t => {
    const co = t.companyId ? Issuer.company(t.companyId) : null;
    const on = ISSUER_FIELD_DEFS.filter(f => t[f.key] !== false).map(f => f.label);
    const off = ISSUER_FIELD_DEFS.filter(f => t[f.key] === false).map(f => f.label);
    return `<tr>
      <td class="mono">${esc(t.templateCode || '')}</td>
      <td class="strong">${esc(t.name)}${t.notes ? `<div class="tiny muted">${esc(t.notes)}</div>` : ''}</td>
      <td><span class="badge ${DOC_KIND_BADGE[t.docKind] || 'gray'}">${esc(DOC_KIND_LABEL[t.docKind] || t.docKind)}</span></td>
      <td class="sm">${co ? esc(co.name) : '<span class="badge gray">全社共通</span>'}</td>
      <td class="tiny">${on.map(x => `<span class="badge green">${esc(x)}</span>`).join(' ')}${off.length ? ' ' + off.map(x => `<span class="badge gray">${esc(x)}</span>`).join(' ') : ''}</td>
      <td>${t.isDefault ? '<span class="badge amber">標準</span>' : '<span class="muted">—</span>'}</td>
      <td>${t.isActive === false ? '<span class="badge gray">無効</span>' : '<span class="badge green">有効</span>'}</td>
      <td class="right"><div class="tb-act">
        <button class="btn xs" onclick="IssuerAdmin.templateForm('${t.id}')">編集</button>
        <button class="btn xs" onclick="IssuerAdmin.duplicateTemplate('${t.id}')">複製</button>
        <button class="btn xs danger" onclick="IssuerAdmin.deleteTemplate('${t.id}')">削除</button>
      </div></td></tr>`;
  }).join('');

  return `<div class="vstack" style="gap:16px">
    <div class="grid g3">
      ${kpiCard({ label: 'テンプレート数', icon: 'printer', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: list.length, unit: '件', foot: '帳票種別ごとに複数登録できます' })}
      ${kpiCard({ label: '帳票種別', icon: 'file', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: kinds.filter(k => list.some(t => t.docKind === k)).length, unit: '種', foot: '見積書・発注書・納品書・請求書・入庫・出庫' })}
      ${kpiCard({ label: '標準テンプレート', icon: 'check', bg: 'var(--green-100)', fg: 'var(--green-700)', value: list.filter(t => t.isDefault).length, unit: '件', foot: '帳票発行時に自動適用' })}
    </div>
    <div class="note">${ico('printer', 15)} テンプレートごとに <b>☑会社名 ☑拠点名 ☑住所 ☑TEL ☑FAX ☑登録番号 ☐メール ☑ロゴ</b> の表示可否を設定できます。同じ帳票種別で「標準」に設定されたテンプレートが発行時に使われます（会社専用テンプレートが優先）。</div>
    <div class="card">
      <div class="card-h"><h2>${ico('printer', 16)} 帳票テンプレート</h2><span class="sub">表示項目の組み合わせを定義</span>
        <div class="sp"><button class="btn sm primary" onclick="IssuerAdmin.templateForm('')">${ico('plus', 14)} テンプレートを登録</button></div></div>
      <div class="card-b tight"><div class="table-wrap"><table class="tb">
        <thead><tr><th>コード</th><th>テンプレート名</th><th>帳票種別</th><th>対象会社</th><th>表示項目</th><th>標準</th><th>状態</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8">${emptyBox('テンプレートがありません', '標準テンプレートを自動生成するには再読み込みしてください')}</td></tr>`}</tbody>
      </table></div></div>
    </div>
  </div>`;
};

/* ==========================================================================
   マスタ管理アクション
   ========================================================================== */
const chkBox = (id, label, on) => `<label class="chk"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><span>${esc(label)}</span></label>`;

const IssuerAdmin = {
  /* ------------------------- 会社 ------------------------- */
  companyForm(id) {
    const c = id ? Issuer.company(id) : null;
    const v = Issuer.companyVisible(c);
    UI.modal(c ? '会社を編集' : '会社を登録', c ? c.name : 'グループ会社・自社を登録します（複数登録可）', `
      <div class="form-grid">
        <div class="field"><label>会社コード *</label><input class="inp" id="co_code" value="${esc(c ? c.companyCode : '')}" placeholder="C001"></div>
        <div class="field span2"><label>会社名 *</label><input class="inp" id="co_name" value="${esc(c ? c.name : '')}" placeholder="例：セトラスホールディングス株式会社"></div>
        <div class="field"><label>郵便番号</label><input class="inp" id="co_postal" value="${esc(c ? c.postalCode : '')}" placeholder="〒761-0000"></div>
        <div class="field span2"><label>住所</label><input class="inp" id="co_addr" value="${esc(c ? c.address : '')}" placeholder="香川県高松市○○町1-2-3"></div>
        <div class="field"><label>電話番号</label><input class="inp" id="co_tel" value="${esc(c ? c.tel : '')}" placeholder="087-000-0000"></div>
        <div class="field"><label>FAX番号</label><input class="inp" id="co_fax" value="${esc(c ? c.fax : '')}" placeholder="087-000-0001"></div>
        <div class="field"><label>メールアドレス</label><input class="inp" id="co_mail" value="${esc(c ? c.email : '')}"></div>
        <div class="field"><label>適格請求書登録番号</label><input class="inp" id="co_inv" value="${esc(c ? c.invoiceNumber : '')}" placeholder="T1234567890123"></div>
        <div class="field"><label>ロゴ画像URL</label><input class="inp" id="co_logo" value="${esc(c ? c.logoUrl : '')}" placeholder="https://…/logo.png"></div>
        <div class="field"><label>有効／無効</label><select class="inp" id="co_active">
          <option value="1"${!c || c.isActive !== false ? ' selected' : ''}>有効</option>
          <option value="0"${c && c.isActive === false ? ' selected' : ''}>無効</option></select></div>
        <div class="field span3"><label>備考</label><input class="inp" id="co_notes" value="${esc(c ? c.notes : '')}"></div>
      </div>
      <div class="hr"></div>
      <b class="sm">帳票への表示項目</b><span class="tiny muted">（チェックを外した項目は帳票に出力されません）</span>
      <div class="chk-row mt8">${ISSUER_FIELD_DEFS.filter(f => f.scope !== 'branch').map(f => chkBox('co_v_' + f.key, f.label, v[f.key] !== false)).join('')}</div>
      <div class="note mt12">住所を非表示にすると郵便番号も出力されません。ロゴはURLを登録した場合のみ印字されます。</div>`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="IssuerAdmin.saveCompany('${id || ''}')">${ico('check', 15)} 保存</button>`);
  },
  saveCompany(id) {
    const g = n => (document.getElementById(n) || {}).value || '';
    const code = g('co_code').trim(), name = g('co_name').trim();
    if (!code || !name) return UI.toast('会社コードと会社名は必須です', 'err');
    if ((Store.db.companies || []).some(c => c.companyCode === code && c.id !== id)) return UI.toast('同じ会社コードが既に登録されています', 'err');
    const visibleFields = {};
    ISSUER_FIELD_DEFS.filter(f => f.scope !== 'branch').forEach(f => { visibleFields[f.key] = !!document.getElementById('co_v_' + f.key)?.checked; });
    const now = new Date().toISOString();
    const body = { companyCode: code, name, postalCode: g('co_postal'), address: g('co_addr'), tel: g('co_tel'), fax: g('co_fax'),
      email: g('co_mail'), invoiceNumber: g('co_inv'), logoUrl: g('co_logo'), notes: g('co_notes'),
      isActive: g('co_active') !== '0', visibleFields, updatedAt: now };
    if (id) Object.assign(Issuer.company(id), body);
    else Store.db.companies.push(Object.assign({ id: uid(), createdAt: now }, body));
    Store.save(); UI.closeModal(); App.repaint();
    UI.toast(`会社「${name}」を${id ? '更新' : '登録'}しました`, 'ok');
  },
  toggleCompany(id) {
    const c = Issuer.company(id); if (!c) return;
    if (c.isActive !== false && Issuer.companies(true).length <= 1) return UI.toast('有効な会社が1社のみのため無効化できません', 'err');
    c.isActive = c.isActive === false; c.updatedAt = new Date().toISOString();
    Store.save(); App.repaint(); UI.toast(`会社「${c.name}」を${c.isActive ? '有効化' : '無効化'}しました`, 'ok');
  },

  /* ------------------------- 拠点 ------------------------- */
  branchForm(id, companyId) {
    const b = id ? Issuer.branch(id) : null;
    const coId = (b && b.companyId) || companyId || (Issuer.companies(true)[0] || {}).id || '';
    if (!coId) return UI.toast('先に会社マスタを登録してください', 'err');
    const v = Issuer.branchVisible(b);
    UI.modal(b ? '拠点を編集' : '拠点を登録', b ? b.name : '会社配下に拠点を登録します（1社に複数可）', `
      <div class="form-grid">
        <div class="field span2"><label>会社 *</label><select class="inp" id="br_co">${Issuer.companies(false).map(c => `<option value="${esc(c.id)}"${coId === c.id ? ' selected' : ''}>${esc(c.companyCode)} ${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>拠点コード *</label><input class="inp" id="br_code" value="${esc(b ? b.branchCode : '')}" placeholder="H001"></div>
        <div class="field span3"><label>拠点名 *</label><input class="inp" id="br_name" value="${esc(b ? b.name : '')}" placeholder="例：高松事業所／神山農場"></div>
        <div class="field"><label>郵便番号</label><input class="inp" id="br_postal" value="${esc(b ? b.postalCode : '')}" placeholder="〒761-0000"></div>
        <div class="field span2"><label>住所</label><input class="inp" id="br_addr" value="${esc(b ? b.address : '')}"></div>
        <div class="field"><label>電話番号</label><input class="inp" id="br_tel" value="${esc(b ? b.tel : '')}"></div>
        <div class="field"><label>FAX番号</label><input class="inp" id="br_fax" value="${esc(b ? b.fax : '')}"></div>
        <div class="field"><label>メールアドレス</label><input class="inp" id="br_mail" value="${esc(b ? b.email : '')}"></div>
        <div class="field"><label>担当者名</label><input class="inp" id="br_mgr" value="${esc(b ? b.managerName : '')}"></div>
        <div class="field"><label>有効／無効</label><select class="inp" id="br_active">
          <option value="1"${!b || b.isActive !== false ? ' selected' : ''}>有効</option>
          <option value="0"${b && b.isActive === false ? ' selected' : ''}>無効</option></select></div>
        <div class="field span3"><label>備考</label><input class="inp" id="br_notes" value="${esc(b ? b.notes : '')}"></div>
      </div>
      <div class="hr"></div>
      <b class="sm">帳票への表示項目</b><span class="tiny muted">（拠点ごとに出力可否を設定）</span>
      <div class="chk-row mt8">${ISSUER_FIELD_DEFS.filter(f => f.scope !== 'company').map(f => chkBox('br_v_' + f.key, f.label, v[f.key] !== false)).join('')}</div>`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="IssuerAdmin.saveBranch('${id || ''}')">${ico('check', 15)} 保存</button>`);
  },
  saveBranch(id) {
    const g = n => (document.getElementById(n) || {}).value || '';
    const code = g('br_code').trim(), name = g('br_name').trim(), companyId = g('br_co');
    if (!code || !name) return UI.toast('拠点コードと拠点名は必須です', 'err');
    if (!companyId) return UI.toast('会社を選択してください', 'err');
    if ((Store.db.branches || []).some(b => b.companyId === companyId && b.branchCode === code && b.id !== id)) return UI.toast('同じ会社に同じ拠点コードが既に登録されています', 'err');
    const visibleFields = {};
    ISSUER_FIELD_DEFS.filter(f => f.scope !== 'company').forEach(f => { visibleFields[f.key] = !!document.getElementById('br_v_' + f.key)?.checked; });
    const now = new Date().toISOString();
    const body = { companyId, branchCode: code, name, postalCode: g('br_postal'), address: g('br_addr'), tel: g('br_tel'), fax: g('br_fax'),
      email: g('br_mail'), managerName: g('br_mgr'), notes: g('br_notes'), isActive: g('br_active') !== '0', visibleFields, updatedAt: now };
    if (id) Object.assign(Issuer.branch(id), body);
    else Store.db.branches.push(Object.assign({ id: uid(), createdAt: now }, body));
    Store.save(); UI.closeModal(); App.repaint();
    UI.toast(`拠点「${name}」を${id ? '更新' : '登録'}しました`, 'ok');
  },
  toggleBranch(id) {
    const b = Issuer.branch(id); if (!b) return;
    b.isActive = b.isActive === false; b.updatedAt = new Date().toISOString();
    Store.save(); App.repaint(); UI.toast(`拠点「${b.name}」を${b.isActive ? '有効化' : '無効化'}しました`, 'ok');
  },
  deleteBranch(id) {
    const b = Issuer.branch(id); if (!b) return;
    const used = ['orders', 'purchaseOrders', 'receipts', 'shipments', 'documents'].some(k =>
      (Store.db[k] || []).some(r => r.branch1Id === id || r.branch2Id === id));
    if (used) { this.toggleBranch(id); return UI.toast('使用中の拠点のため無効化しました', 'warn'); }
    UI.confirm('拠点の削除', `${b.name} を削除します。よろしいですか？`, () => {
      Store.db.branches = Store.db.branches.filter(x => x.id !== id);
      Store.save(); App.repaint(); UI.toast('削除しました', 'ok');
    }, '削除する', 'danger');
  },

  /* ------------------------- 帳票テンプレート ------------------------- */
  templateForm(id) {
    if (typeof TplEditor !== 'undefined') return TplEditor.open(id);
    const t = id ? Issuer.template(id) : null;
    UI.modal(t ? 'テンプレートを編集' : 'テンプレートを登録', t ? t.name : '帳票種別ごとの表示項目を定義します', `
      <div class="form-grid">
        <div class="field"><label>テンプレートコード *</label><input class="inp" id="tp_code" value="${esc(t ? t.templateCode : '')}" placeholder="Q-STD"></div>
        <div class="field span2"><label>テンプレート名 *</label><input class="inp" id="tp_name" value="${esc(t ? t.name : '')}" placeholder="標準見積書"></div>
        <div class="field"><label>帳票種別 *</label><select class="inp" id="tp_kind">
          ${Object.entries(DOC_KIND_LABEL).map(([k, l]) => `<option value="${k}"${t && t.docKind === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div class="field span2"><label>対象会社</label><select class="inp" id="tp_co">
          <option value=""${!t || !t.companyId ? ' selected' : ''}>全社共通</option>
          ${Issuer.companies(false).map(c => `<option value="${esc(c.id)}"${t && t.companyId === c.id ? ' selected' : ''}>${esc(c.name)} 専用</option>`).join('')}</select></div>
        <div class="field"><label>標準テンプレート</label><select class="inp" id="tp_def">
          <option value="0"${!t || !t.isDefault ? ' selected' : ''}>使用しない</option>
          <option value="1"${t && t.isDefault ? ' selected' : ''}>標準として使用</option></select></div>
        <div class="field"><label>有効／無効</label><select class="inp" id="tp_active">
          <option value="1"${!t || t.isActive !== false ? ' selected' : ''}>有効</option>
          <option value="0"${t && t.isActive === false ? ' selected' : ''}>無効</option></select></div>
      </div>
      <div class="hr"></div>
      <b class="sm">帳票に表示する項目</b><span class="tiny muted">（チェックした項目だけを印字します）</span>
      <div class="chk-row mt8">${ISSUER_FIELD_DEFS.map(f => chkBox('tp_v_' + f.key, f.label, !t || t[f.key] !== false)).join('')}</div>
      <div class="field mt12"><label>備考</label><input class="inp" id="tp_notes" value="${esc(t ? t.notes : '')}"></div>`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="IssuerAdmin.saveTemplate('${id || ''}')">${ico('check', 15)} 保存</button>`);
  },
  saveTemplate(id) {
    const g = n => (document.getElementById(n) || {}).value || '';
    const code = g('tp_code').trim(), name = g('tp_name').trim();
    if (!code || !name) return UI.toast('テンプレートコードと名称は必須です', 'err');
    if ((Store.db.docTemplates || []).some(t => t.templateCode === code && t.id !== id)) return UI.toast('同じコードが既に登録されています', 'err');
    const body = { templateCode: code, name, docKind: g('tp_kind'), companyId: g('tp_co') || null,
      isDefault: g('tp_def') === '1', isActive: g('tp_active') !== '0', notes: g('tp_notes'), updatedAt: new Date().toISOString() };
    ISSUER_FIELD_DEFS.forEach(f => { body[f.key] = !!document.getElementById('tp_v_' + f.key)?.checked; });
    if (body.isDefault) {
      (Store.db.docTemplates || []).forEach(t => {
        if (t.id !== id && t.docKind === body.docKind && (t.companyId || null) === (body.companyId || null)) t.isDefault = false;
      });
    }
    if (id) Object.assign(Issuer.template(id), body);
    else Store.db.docTemplates.push(Object.assign({ id: uid(), createdAt: new Date().toISOString() }, body));
    Store.save(); UI.closeModal(); App.repaint();
    UI.toast(`テンプレート「${name}」を${id ? '更新' : '登録'}しました`, 'ok');
  },
  duplicateTemplate(id) {
    const t = Issuer.template(id); if (!t) return;
    const copy = Object.assign({}, t, { id: uid(), templateCode: (t.templateCode || 'TP') + '-C', name: t.name + '（複製）',
      isDefault: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    Store.db.docTemplates.push(copy); Store.save(); App.repaint();
    UI.toast('テンプレートを複製しました', 'ok');
  },
  deleteTemplate(id) {
    const t = Issuer.template(id); if (!t) return;
    UI.confirm('テンプレートの削除', `${t.name} を削除します。よろしいですか？`, () => {
      Store.db.docTemplates = Store.db.docTemplates.filter(x => x.id !== id);
      Store.save(); App.repaint(); UI.toast('削除しました', 'ok');
    }, '削除する', 'danger');
  }
};


/* ==========================================================================
   帳票発行 画面（v3 仕様：見積書・発注書・納品書・請求書・入庫伝票・出庫伝票・ピッキング）
   ※ 04-views-b.js の Views.docs を上書きする（発行元・テンプレート対応）
   ========================================================================== */
let docTab = 'delivery_note';

Views.docs = () => {
  const confirmed = Store.db.shipments.filter(s => s.status === 'confirmed').slice().sort((a, b) => b.shipDate.localeCompare(a.shipDate));
  const orders = Store.db.orders.filter(o => o.status !== 'cancelled').slice().sort((a, b) => b.orderDate.localeCompare(a.orderDate));
  const pos = Store.db.purchaseOrders.slice().sort((a, b) => b.orderDate.localeCompare(a.orderDate));
  const receipts = Store.db.receipts.slice().sort((a, b) => b.receiptDate.localeCompare(a.receiptDate));
  const docs = Store.db.documents.slice().sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || ''))).slice(0, 80);
  const tabs = [
    ['delivery_note', '納品書'], ['shipping_slip', '出庫伝票'], ['picking_list', 'ピッキング'],
    ['quote', '見積書'], ['invoice', '請求書'], ['purchase_order', '発注書'], ['receipt_note', '入庫伝票']
  ];
  const callFor = { delivery_note: 'delivery', shipping_slip: 'slip', picking_list: 'picking', quote: 'quote', invoice: 'invoice', purchase_order: 'purchaseOrder', receipt_note: 'receiptNote' };
  const issuerCell = rec => {
    const c = rec && rec.companyId ? Issuer.company(rec.companyId) : null;
    if (!c) return '<span class="tiny muted">既定会社</span>';
    const b1 = rec.branch1Id ? Issuer.branch(rec.branch1Id) : null;
    const b2 = rec.branch2Id ? Issuer.branch(rec.branch2Id) : null;
    const bs = [b1 && b1.name, b2 && b2.name].filter(Boolean).join('・');
    return `<b class="sm">${esc(c.name)}</b><div class="tiny muted">${esc(bs || '拠点指定なし')}</div>`;
  };
  let rows = [];
  if (docTab === 'delivery_note' || docTab === 'shipping_slip' || docTab === 'picking_list') {
    rows = confirmed.map(s => ({ id: s.id, no: s.shipmentNo, sub: `${s.customerName} ／ ${dJP(s.shipDate)} ／ ${num(Store.shipLines(s.id).reduce((a, l) => a + l.quantity, 0))} 点`, src: s }));
  } else if (docTab === 'quote' || docTab === 'invoice') {
    rows = orders.map(o => ({ id: o.id, no: o.orderNo, sub: `${o.customerName} ／ ${dJP(o.orderDate)} ／ ${money(o.total)}`, src: o }));
  } else if (docTab === 'purchase_order') {
    rows = pos.map(p => ({ id: p.id, no: p.poNo, sub: `${p.supplierName} ／ ${dJP(p.orderDate)} ／ ${money(p.total)}`, src: p }));
  } else {
    rows = receipts.map(r => ({ id: r.id, no: r.receiptNo, sub: `${r.supplierName} ／ ${dJP(r.receiptDate)} ／ ${money(r.total)}`, src: r }));
  }
  const tpl = Issuer.templateFor(docTab, null);
  return `<div class="vstack" style="gap:16px">
    <div class="grid g4">
      ${kpiCard({ label: '発行可能な出荷', icon: 'truck', bg: 'var(--green-100)', fg: 'var(--green-700)', value: confirmed.length, unit: '件', foot: '出荷確定済み' })}
      ${kpiCard({ label: '見積書', icon: 'file', bg: 'var(--sky-100)', fg: 'var(--sky-600)', value: Store.db.documents.filter(d => d.docKind === 'quote').length, unit: '枚', foot: 'QT-YYYYMMDD-0001' })}
      ${kpiCard({ label: '請求書', icon: 'yen', bg: 'var(--green-50)', fg: 'var(--green-700)', value: Store.db.documents.filter(d => d.docKind === 'invoice').length, unit: '枚', foot: 'IV-YYYYMMDD-0001' })}
      ${kpiCard({ label: '発行済み帳票', icon: 'printer', bg: 'var(--violet-50)', fg: 'var(--violet-600)', value: Store.db.documents.length, unit: '枚', foot: '全帳票の累計' })}
    </div>
    <div class="note">${ico('printer', 15)} 帳票上部には<b>発行会社・発行拠点（最大2件）</b>が印字されます。表示項目はテンプレート「${tpl ? esc(tpl.name) : '組み込みレイアウト'}」と会社・拠点マスタの表示設定に従い、非表示・未入力の項目は出力されません（空行を作りません）。</div>
    <div class="card">
      <div class="card-h"><h2>${ico('printer', 16)} 伝票を発行する</h2><span class="sub">帳票種別を選択してください</span>
        <div class="sp"><button class="btn sm" onclick="App.go('docTemplates')">${ico('settings', 14)} テンプレート設定</button></div></div>
      <div class="card-b tight">
        <div style="padding:12px 16px;border-bottom:1px solid var(--ink-100)">
          <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${docTab === k ? 'on' : ''}" onclick="docTab='${k}';App.repaint()">${l} <span class="cnt">${k === 'delivery_note' || k === 'shipping_slip' || k === 'picking_list' ? confirmed.length : k === 'quote' || k === 'invoice' ? orders.length : k === 'purchase_order' ? pos.length : receipts.length}</span></button>`).join('')}</div>
        </div>
        <div class="card-b" style="padding:14px 16px">
          ${rows.length ? `<div class="vstack">${rows.slice(0, 60).map(r => `<div class="hstack" style="padding:11px 13px;border:1px solid var(--ink-200);border-radius:12px;background:#fff">
            <div style="flex:1;min-width:0"><b class="sm">${esc(r.no)}</b><div class="tiny muted">${esc(r.sub)}</div></div>
            <div style="min-width:160px">${issuerCell(r.src)}</div>
            <div class="tb-act"><button class="btn xs primary" onclick="Print.${callFor[docTab]}('${r.id}')">${ico('print', 13)} 発行</button></div>
          </div>`).join('')}</div>` : emptyBox('発行できる伝票がありません', '帳票種別を切り替えるか、先に出荷確定・受注登録を行ってください')}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-h"><h2>${ico('history', 16)} 帳票発行履歴</h2><span class="badge gray">${Store.db.documents.length}</span></div>
      <div class="card-b tight">${docs.length ? `<div class="table-wrap"><table class="tb">
        <thead><tr><th>帳票番号</th><th>種別</th><th>発行元（会社／拠点）</th><th>宛先</th><th>テンプレート</th><th>発行日時</th><th></th></tr></thead>
        <tbody>${docs.map(d => {
          const t = d.templateId ? Issuer.template(d.templateId) : null;
          return `<tr>
            <td class="mono">${esc(d.docNo)}</td>
            <td><span class="badge ${DOC_KIND_BADGE[d.docKind] || 'gray'}">${esc(DOC_KIND_LABEL[d.docKind] || d.docKind)}</span></td>
            <td>${issuerCell(d)}</td>
            <td class="sm">${esc(d.customerName || '—')}</td>
            <td class="tiny muted">${t ? esc(t.name) : '—'}</td>
            <td class="tiny muted nowrap">${dtJP(d.issuedAt)}</td>
            <td class="right"><button class="btn xs" onclick="Print.reissue('${d.id}')">再発行</button></td></tr>`;
        }).join('')}</tbody>
      </table></div>` : emptyBox('帳票履歴がありません', '帳票を発行すると履歴が残ります')}</div>
    </div>
  </div>`;
};


/* ===== 05-print.js ===== */
/* ==========================================================================
   アグリERP — 帳票出力（見積書・発注書・納品書・請求書・入庫伝票・出庫伝票・ピッキング）
   - 帳票上部には発行元（会社マスタ＋拠点マスタ最大2件）を表示する（Issuer.headerHtml）
   - 表示可否は「帳票テンプレート（doc_templates）× マスタの表示可否」で決まり、
     非表示・未入力の項目は HTML を出力しない（空行・空白領域を作らない）
   - A4 印刷CSS + window.print() で「PDFに保存」に対応
   ========================================================================== */
const Print = {
  /* 発行元コンテキスト（会社・拠点・テンプレート）を解決 */
  ctxOf(rec, opt) {
    const src = Object.assign({}, rec || {});
    if (opt && opt.docKind) src.docKind = opt.docKind;
    if (opt && opt.template) src.templateId = opt.template.id || null;
    const ctx = Issuer.resolve(src);
    if (opt && opt.template) ctx.template = opt.template;
    if (opt && opt.companyId) { const c = Issuer.company(opt.companyId); if (c) { ctx.company = c; if (ctx.branch1 && ctx.branch1.companyId !== c.id) ctx.branch1 = null; if (ctx.branch2 && ctx.branch2.companyId !== c.id) ctx.branch2 = null; } }
    if (opt && 'branch1Id' in opt) ctx.branch1 = opt.branch1Id ? Issuer.branch(opt.branch1Id) : null;
    if (opt && 'branch2Id' in opt) ctx.branch2 = opt.branch2Id ? Issuer.branch(opt.branch2Id) : null;
    return ctx;
  },
  co() { return Issuer.companies(true)[0] || {}; },

  /* 帳票共通ヘッダ（タイトル・帳票番号・発行元） */
  head(title, docNo, sub, rec) {
    const ctx = this.ctxOf(rec, this._pv);
    return `<div class="sheet-head">
      <div><h1>${esc(title)}</h1><div style="font-size:8.5pt;color:#64748b;margin-top:3px">${esc(sub || '')}</div></div>
      ${Issuer.headerHtml(ctx)}
    </div>
    <div class="sheet-meta">
      <div class="box"><div class="t">帳票番号</div><div class="v">${esc(docNo)}</div></div>
      <div class="box"><div class="t">発行日</div><div class="v">${dJPfull(TODAY)}</div></div>
    </div>`;
  },
  foot(rec, docNo, refNo) {
    if (this._pv && this._pv.footer === false) return '';
    const ctx = this.ctxOf(rec, this._pv);
    const c = ctx.company || {};
    const showName = !ctx.template || ctx.template.companyName !== false;
    return `<div class="sheet-foot"><span>${esc(showName ? (c.name || '') : '')}</span><span>${esc(docNo)}${refNo ? ' ／ ' + esc(refNo) : ''}</span></div>`;
  },

  /* 帳票発行履歴の登録（発行会社・拠点・テンプレートをスナップショット保存） */
  record(kind, ref, extra, ctx) {
    if (this._pv && this._pv.preview) {
      return Object.assign({ id: 'preview', docKind: kind, docNo: (extra || {}).docNo || '（プレビュー）' }, ref || {});
    }
    const doc = Object.assign({
      id: uid(), docKind: kind, issuedAt: new Date().toISOString(),
      issuedBy: Auth.user ? Auth.user.id : null, printedCount: 1,
      companyId: (ctx.company || {}).id || null,
      branch1Id: (ctx.branch1 || {}).id || null,
      branch2Id: (ctx.branch2 || {}).id || null,
      templateId: (ctx.template || {}).id || null
    }, ref || {}, extra || {});
    Store.db.documents.unshift(doc);
    Store.save();
    return doc;
  },

  render(html) {
    if (this._pv && this._pv.preview) { this._out = html; return html; }
    const root = document.getElementById('printRoot');
    root.innerHTML = html;
    setTimeout(() => window.print(), 120);
  },

  /* ------------------------- 納品書 ------------------------- */
  delivery(shipmentId) {
    const s = Store.shipment(shipmentId); if (!s) return;
    const c = Store.customer(s.customerId) || {};
    const lines = Store.shipLines(s.id);
    const ctx = this.ctxOf(Object.assign({ docKind: 'delivery_note' }, s));
    const doc = this.record('delivery_note', { shipmentId: s.id, shipmentNo: s.shipmentNo, orderId: s.orderId, customerId: s.customerId, customerName: s.customerName }, { docNo: Store.nextNo('DN') }, ctx);
    let sub = 0, tax = 0;
    const rows = lines.map((l, i) => {
      const it = Store.item(l.itemId) || {};
      const price = it.salePrice || 0;
      const amt = price * l.quantity;
      sub += amt; tax += amt * ((it.taxRate || 8) / 100);
      return `<tr><td style="text-align:center">${i + 1}</td><td>${esc(it.code || '')}</td><td><b>${esc(l.itemName)}</b>${it.spec ? `<div style="font-size:8pt;color:#64748b">${esc(it.spec)}</div>` : ''}</td>
        <td class="num">${dec(l.quantity)}</td><td style="text-align:center">${esc(it.unit || '')}</td>
        <td class="num">${money(price)}</td><td class="num">${money(Math.round(amt))}</td></tr>`;
    }).join('');
    const total = Math.round(sub + tax);

    this.render(`<div class="sheet${this.paperCls()}">
      ${this.wm('納品書')}
      ${this.head('納 品 書', doc.docNo, `出荷番号 ${s.shipmentNo}${s.orderNo ? ' ／ 受注番号 ' + s.orderNo : ''}`, Object.assign({ docKind: 'delivery_note' }, s))}
      <div class="sheet-meta" style="margin-top:-4px">
        <div class="box" style="min-width:52%">
          <div class="t">納品先</div>
          <div class="v">${esc(s.customerName || c.name || '')} 御中</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">${esc(s.shipToAddr || c.address || '')}${c.tel ? `<br>TEL ${esc(c.tel)}` : ''}</div>
        </div>
        <div class="box" style="min-width:40%">
          <div class="t">納品日／出荷日</div>
          <div class="v">${dJPfull(s.shipDate)}</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">支払条件：${esc(c.paymentTerms || '翌月末')}　締日：${c.closingDay === 31 ? '末日' : (c.closingDay || '') + '日'}</div>
        </div>
      </div>
      <p style="font-size:10.5pt;margin:6px 0 10px">下記のとおり納品いたしましたので、ご査収くださいますようお願い申し上げます。</p>
      <table>
        <thead><tr><th style="width:7%">No.</th><th style="width:12%">コード</th><th>品名</th><th style="width:11%">数量</th><th style="width:9%">単位</th><th style="width:14%">単価</th><th style="width:15%">金額</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals"><table>
        <tr><td>小計（税抜）</td><td class="num">${money(Math.round(sub))}</td></tr>
        <tr><td>消費税（8%）</td><td class="num">${money(Math.round(tax))}</td></tr>
        <tr class="grand"><td>合計</td><td class="num">${money(total)}</td></tr>
      </table></div>
      <div class="sheet-note">※ 本納品書は帳票番号 ${esc(doc.docNo)} として発行されました。${s.remarks ? '　備考：' + esc(s.remarks) : ''}</div>
      <div class="sign"><div class="s"><b>納品先 受領印</b></div><div class="s"><b>担当者</b></div></div>
      ${this.foot(Object.assign({ docKind: 'delivery_note' }, s), doc.docNo, s.shipmentNo)}
    </div>`);
  },

  /* ------------------------- 出庫伝票（出荷伝票） ------------------------- */
  slip(shipmentId) {
    const s = Store.shipment(shipmentId); if (!s) return;
    const c = Store.customer(s.customerId) || {};
    const lines = Store.shipLines(s.id);
    const ctx = this.ctxOf(Object.assign({ docKind: 'shipping_slip' }, s));
    const doc = this.record('shipping_slip', { shipmentId: s.id, shipmentNo: s.shipmentNo, orderId: s.orderId, customerId: s.customerId, customerName: s.customerName }, { docNo: Store.nextNo('SL') }, ctx);
    const rows = lines.map((l, i) => {
      const it = Store.item(l.itemId) || {};
      return `<tr><td style="text-align:center">${i + 1}</td><td>${esc(it.code || '')}</td><td><b>${esc(l.itemName)}</b></td>
        <td class="num">${dec(l.quantity)}</td><td style="text-align:center">${esc(it.unit || '')}</td>
        <td style="text-align:center">${esc(it.location || '—')}</td><td>${esc(l.lotNo || '')}</td><td style="text-align:center"><span class="pick-chk"></span></td></tr>`;
    }).join('');

    this.render(`<div class="sheet${this.paperCls()}">
      ${this.head('出 庫 伝 票', doc.docNo, `出荷番号 ${s.shipmentNo}${s.orderNo ? ' ／ 受注番号 ' + s.orderNo : ''}`, Object.assign({ docKind: 'shipping_slip' }, s))}
      <div class="sheet-meta" style="margin-top:-4px">
        <div class="box" style="min-width:52%">
          <div class="t">出荷先</div>
          <div class="v">${esc(s.shipToName || s.customerName || '')} 様</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">${esc(s.shipToAddr || c.address || '')}${c.tel ? `<br>TEL ${esc(c.tel)}` : ''}</div>
        </div>
        <div class="box" style="min-width:40%">
          <div class="t">出荷日</div>
          <div class="v">${dJPfull(s.shipDate)}</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">運送会社：${esc(s.carrier || '—')}<br>追跡番号：${esc(s.trackingNo || '—')}</div>
        </div>
      </div>
      <table>
        <thead><tr><th style="width:7%">No.</th><th style="width:12%">コード</th><th>品名</th><th style="width:11%">数量</th><th style="width:9%">単位</th><th style="width:12%">保管場所</th><th style="width:14%">ロット</th><th style="width:9%">確認</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="sheet-note">※ 本伝票は帳票番号 ${esc(doc.docNo)} として発行されました。商品の受け取り時に数量をご確認ください。</div>
      <div style="margin-top:14px;display:flex;gap:14px;align-items:flex-start;justify-content:space-between">
        <div style="display:flex;gap:14px;align-items:flex-end">
          <div><div style="font-size:8pt;color:#64748b;margin-bottom:3px">出荷番号バーコード（将来拡張）</div>
            <div class="barcode">${Array.from({ length: 42 }, (_, i) => `<i style="height:${18 + ((i * 7 + 5) % 17)}px;width:${(i % 3) + 1}px"></i>`).join('')}</div>
            <div style="font-size:8pt;font-family:monospace;margin-top:2px">${esc(s.shipmentNo)}</div></div>
          <div><div style="font-size:8pt;color:#64748b;margin-bottom:3px">QR（将来拡張）</div><div class="qr"></div></div>
        </div>
        <div class="sign" style="margin-top:0"><div class="s"><b>出庫担当</b></div><div class="s"><b>受領印</b></div></div>
      </div>
      ${this.foot(Object.assign({ docKind: 'shipping_slip' }, s), doc.docNo, s.shipmentNo)}
    </div>`);
  },

  /* ------------------------- ピッキングリスト ------------------------- */
  picking(shipmentId) {
    const s = Store.shipment(shipmentId); if (!s) return;
    const lines = Store.shipLines(s.id).slice().sort((a, b) => {
      const ia = Store.item(a.itemId) || {}, ib = Store.item(b.itemId) || {};
      return String(ia.location || '').localeCompare(String(ib.location || ''));
    });
    const ctx = this.ctxOf(Object.assign({ docKind: 'picking_list' }, s));
    const doc = this.record('picking_list', { shipmentId: s.id, shipmentNo: s.shipmentNo, orderId: s.orderId, customerId: s.customerId, customerName: s.customerName }, { docNo: Store.nextNo('PL') }, ctx);
    const rows = lines.map((l, i) => {
      const it = Store.item(l.itemId) || {};
      return `<tr><td style="text-align:center">${i + 1}</td><td style="text-align:center"><span class="pick-chk"></span></td>
        <td style="text-align:center"><b>${esc(it.location || '—')}</b></td><td>${esc(it.code || '')}</td><td><b>${esc(l.itemName)}</b>${it.spec ? `<div style="font-size:8pt;color:#64748b">${esc(it.spec)}</div>` : ''}</td>
        <td class="num" style="font-size:12pt"><b>${dec(l.quantity)}</b></td><td style="text-align:center">${esc(it.unit || '')}</td>
        <td style="text-align:center">${it.stock >= l.quantity ? '○' : '△'}</td></tr>`;
    }).join('');
    const totalQty = lines.reduce((a, l) => a + l.quantity, 0);

    this.render(`<div class="sheet landscape">
      ${this.head('ピッキングリスト', doc.docNo, `出荷番号 ${s.shipmentNo} ／ 出荷日 ${dJPfull(s.shipDate)}`, Object.assign({ docKind: 'picking_list' }, s))}
      <div class="sheet-meta" style="margin-top:-4px">
        <div class="box" style="min-width:38%"><div class="t">出荷先</div><div class="v">${esc(s.customerName)} 様</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:2px">${esc(s.shipToAddr || '')}</div></div>
        <div class="box" style="min-width:26%"><div class="t">合計数量</div><div class="v">${dec(totalQty)} 点</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:2px">明細 ${lines.length} 行</div></div>
        <div class="box" style="min-width:26%"><div class="t">運送／追跡</div><div class="v" style="font-size:9.5pt">${esc(s.carrier || '—')}</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:2px">${esc(s.trackingNo || '—')}</div></div>
      </div>
      <table>
        <thead><tr><th style="width:6%">No.</th><th style="width:8%">完了</th><th style="width:12%">保管場所</th><th style="width:12%">コード</th><th>品名</th><th style="width:12%">数量</th><th style="width:8%">単位</th><th style="width:8%">在庫</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="sheet-note">※ 保管場所の順に並んでいます。ピッキング完了後、チェック欄に印を付けてください。在庫欄 ○＝引当可 ／ △＝在庫不足。</div>
      <div class="sign" style="margin-top:14px"><div class="s"><b>ピッキング担当</b></div><div class="s"><b>検品担当</b></div><div class="s"><b>出庫担当</b></div></div>
      ${this.foot(Object.assign({ docKind: 'picking_list' }, s), doc.docNo, s.shipmentNo)}
    </div>`);
  },

  /* ------------------------- 見積書（受注ベース） ------------------------- */
  quote(orderId) {
    const o = Store.order(orderId); if (!o) return;
    const c = Store.customer(o.customerId) || {};
    const lines = Store.orderLines(o.id);
    const ctx = this.ctxOf(Object.assign({ docKind: 'quote' }, o));
    const doc = this.record('quote', { orderId: o.id, customerId: o.customerId, customerName: o.customerName }, { docNo: Store.nextNo('QT') }, ctx);
    const rows = lines.map((l, i) => `<tr><td style="text-align:center">${i + 1}</td><td>${esc((Store.item(l.itemId) || {}).code || '')}</td>
      <td><b>${esc(l.itemName)}</b>${(Store.item(l.itemId) || {}).spec ? `<div style="font-size:8pt;color:#64748b">${esc((Store.item(l.itemId) || {}).spec)}</div>` : ''}</td>
      <td class="num">${dec(l.quantity)}</td><td style="text-align:center">${esc(l.unit || '')}</td>
      <td class="num">${money(l.unitPrice)}</td><td class="num">${money(Math.round(l.amount))}</td></tr>`).join('');
    const sub = lines.reduce((a, l) => a + l.amount, 0);
    const tax = Math.round(sub * 0.08);

    this.render(`<div class="sheet${this.paperCls()}">
      ${this.wm('見積書')}
      ${this.head('見 積 書', doc.docNo, `受注番号 ${o.orderNo} ／ 見積日 ${dJPfull(o.orderDate)}`, Object.assign({ docKind: 'quote' }, o))}
      <div class="sheet-meta" style="margin-top:-4px">
        <div class="box" style="min-width:52%">
          <div class="t">見積先</div>
          <div class="v">${esc(o.customerName || c.name || '')} 御中</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">${esc(c.address || '')}${c.tel ? `<br>TEL ${esc(c.tel)}` : ''}</div>
        </div>
        <div class="box" style="min-width:40%">
          <div class="t">見積金額（税込）</div>
          <div class="v">${money(Math.round(sub + tax))}</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">有効期限：${dJPfull(todayStr(addDays(new Date(), 30)))}</div>
        </div>
      </div>
      <p style="font-size:10.5pt;margin:6px 0 10px">下記のとおりお見積り申し上げます。</p>
      <table>
        <thead><tr><th style="width:7%">No.</th><th style="width:12%">コード</th><th>品名</th><th style="width:11%">数量</th><th style="width:9%">単位</th><th style="width:14%">単価</th><th style="width:15%">金額</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals"><table>
        <tr><td>小計（税抜）</td><td class="num">${money(Math.round(sub))}</td></tr>
        <tr><td>消費税（8%）</td><td class="num">${money(tax)}</td></tr>
        <tr class="grand"><td>合計</td><td class="num">${money(Math.round(sub + tax))}</td></tr>
      </table></div>
      <div class="sheet-note">※ 本見積書は帳票番号 ${esc(doc.docNo)} として発行されました。${o.remarks ? '　備考：' + esc(o.remarks) : ''}</div>
      ${this.foot(Object.assign({ docKind: 'quote' }, o), doc.docNo, o.orderNo)}
    </div>`);
  },

  /* ------------------------- 請求書（受注ベース） ------------------------- */
  invoice(orderId) {
    const o = Store.order(orderId); if (!o) return;
    const c = Store.customer(o.customerId) || {};
    const lines = Store.orderLines(o.id);
    const ctx = this.ctxOf(Object.assign({ docKind: 'invoice' }, o));
    const doc = this.record('invoice', { orderId: o.id, customerId: o.customerId, customerName: o.customerName }, { docNo: Store.nextNo('IV') }, ctx);
    const rows = lines.map((l, i) => `<tr><td style="text-align:center">${i + 1}</td><td>${esc((Store.item(l.itemId) || {}).code || '')}</td>
      <td><b>${esc(l.itemName)}</b></td><td class="num">${dec(l.quantity)}</td><td style="text-align:center">${esc(l.unit || '')}</td>
      <td class="num">${money(l.unitPrice)}</td><td class="num">${money(Math.round(l.amount))}</td></tr>`).join('');
    const sub = lines.reduce((a, l) => a + l.amount, 0);
    const tax = Math.round(sub * 0.08);

    this.render(`<div class="sheet${this.paperCls()}">
      ${this.wm('請求書')}
      ${this.head('請 求 書', doc.docNo, `受注番号 ${o.orderNo} ／ 請求日 ${dJPfull(TODAY)}`, Object.assign({ docKind: 'invoice' }, o))}
      <div class="sheet-meta" style="margin-top:-4px">
        <div class="box" style="min-width:52%">
          <div class="t">請求先</div>
          <div class="v">${esc(o.customerName || c.name || '')} 御中</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">${esc(c.address || '')}${c.tel ? `<br>TEL ${esc(c.tel)}` : ''}</div>
        </div>
        <div class="box" style="min-width:40%">
          <div class="t">ご請求金額（税込）</div>
          <div class="v">${money(Math.round(sub + tax))}</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">支払条件：${esc(c.paymentTerms || '翌月末')}　締日：${c.closingDay === 31 ? '末日' : (c.closingDay || '') + '日'}</div>
        </div>
      </div>
      <p style="font-size:10.5pt;margin:6px 0 10px">下記のとおりご請求申し上げます。</p>
      <table>
        <thead><tr><th style="width:7%">No.</th><th style="width:12%">コード</th><th>品名</th><th style="width:11%">数量</th><th style="width:9%">単位</th><th style="width:14%">単価</th><th style="width:15%">金額</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals"><table>
        <tr><td>小計（税抜）</td><td class="num">${money(Math.round(sub))}</td></tr>
        <tr><td>消費税（8%）</td><td class="num">${money(tax)}</td></tr>
        <tr class="grand"><td>合計</td><td class="num">${money(Math.round(sub + tax))}</td></tr>
      </table></div>
      <div class="sheet-note">※ 本請求書は帳票番号 ${esc(doc.docNo)} として発行されました。登録番号は発行元情報をご確認ください。${o.remarks ? '　備考：' + esc(o.remarks) : ''}</div>
      <div class="sign"><div class="s"><b>担当者</b></div><div class="s"><b>経理確認</b></div></div>
      ${this.foot(Object.assign({ docKind: 'invoice' }, o), doc.docNo, o.orderNo)}
    </div>`);
  },

  /* ------------------------- 発注書（発注ベース） ------------------------- */
  purchaseOrder(poId) {
    const p = Store.po(poId); if (!p) return;
    const lines = Store.poLines(p.id);
    const ctx = this.ctxOf(Object.assign({ docKind: 'purchase_order' }, p));
    const doc = this.record('purchase_order', { poId: p.id, customerId: p.supplierId, customerName: p.supplierName }, { docNo: p.poNo }, ctx);
    const rows = lines.map((l, i) => `<tr><td style="text-align:center">${i + 1}</td><td>${esc((Store.item(l.itemId) || {}).code || '')}</td>
      <td><b>${esc(l.itemName)}</b></td><td class="num">${dec(l.quantity)}</td><td style="text-align:center">${esc(l.unit || '')}</td>
      <td class="num">${money(l.unitPrice)}</td><td class="num">${money(Math.round(l.amount))}</td><td class="nowrap">${dJP(l.expectedDate || p.expectedDate)}</td></tr>`).join('');
    const sub = lines.reduce((a, l) => a + l.amount, 0);
    const tax = Math.round(sub * 0.08);

    this.render(`<div class="sheet${this.paperCls()}">
      ${this.wm('発注書')}
      ${this.head('発 注 書', doc.docNo, `発注日 ${dJPfull(p.orderDate)} ／ 入荷予定 ${dJPfull(p.expectedDate)}`, Object.assign({ docKind: 'purchase_order' }, p))}
      <div class="sheet-meta" style="margin-top:-4px">
        <div class="box" style="min-width:52%">
          <div class="t">発注先</div>
          <div class="v">${esc(p.supplierName)} 御中</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">${esc((Store.supplier(p.supplierId) || {}).address || '')}</div>
        </div>
        <div class="box" style="min-width:40%">
          <div class="t">発注金額（税込）</div>
          <div class="v">${money(Math.round(sub + tax))}</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">入荷予定日：${dJPfull(p.expectedDate)}</div>
        </div>
      </div>
      <p style="font-size:10.5pt;margin:6px 0 10px">下記のとおり発注いたします。</p>
      <table>
        <thead><tr><th style="width:7%">No.</th><th style="width:12%">コード</th><th>品名</th><th style="width:11%">数量</th><th style="width:9%">単位</th><th style="width:13%">単価</th><th style="width:14%">金額</th><th style="width:14%">納期</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals"><table>
        <tr><td>小計（税抜）</td><td class="num">${money(Math.round(sub))}</td></tr>
        <tr><td>消費税（8%）</td><td class="num">${money(tax)}</td></tr>
        <tr class="grand"><td>合計</td><td class="num">${money(Math.round(sub + tax))}</td></tr>
      </table></div>
      <div class="sheet-note">※ 本発注書は帳票番号 ${esc(doc.docNo)} として発行されました。${p.remarks ? '　備考：' + esc(p.remarks) : ''}</div>
      <div class="sign"><div class="s"><b>発注担当</b></div><div class="s"><b>承認</b></div></div>
      ${this.foot(Object.assign({ docKind: 'purchase_order' }, p), doc.docNo, p.poNo)}
    </div>`);
  },

  /* ------------------------- 入庫伝票（入荷ベース） ------------------------- */
  receiptNote(receiptId) {
    const r = Store.db.receipts.find(x => x.id === receiptId); if (!r) return;
    const lines = Store.receiptLines(r.id);
    const ctx = this.ctxOf(Object.assign({ docKind: 'receipt_note' }, r));
    const doc = this.record('receipt_note', { receiptId: r.id, customerId: r.supplierId, customerName: r.supplierName }, { docNo: r.receiptNo }, ctx);
    const rows = lines.map((l, i) => `<tr><td style="text-align:center">${i + 1}</td><td>${esc((Store.item(l.itemId) || {}).code || '')}</td>
      <td><b>${esc(l.itemName)}</b></td><td class="num">${dec(l.quantity)}</td><td style="text-align:center">${esc((Store.item(l.itemId) || {}).unit || '')}</td>
      <td class="num">${money(l.unitCost)}</td><td class="num">${money(Math.round(l.amount))}</td><td>${esc(l.lotNo || '')}</td></tr>`).join('');
    const sub = lines.reduce((a, l) => a + l.amount, 0);
    const tax = Math.round(sub * 0.08);

    this.render(`<div class="sheet${this.paperCls()}">
      ${this.wm('入庫伝票')}
      ${this.head('入 庫 伝 票', doc.docNo, `入荷日 ${dJPfull(r.receiptDate)}${r.poId ? ' ／ 発注番号 ' + ((Store.po(r.poId) || {}).poNo || '') : ''}`, Object.assign({ docKind: 'receipt_note' }, r))}
      <div class="sheet-meta" style="margin-top:-4px">
        <div class="box" style="min-width:52%">
          <div class="t">仕入先</div>
          <div class="v">${esc(r.supplierName)}</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">${esc((Store.supplier(r.supplierId) || {}).address || '')}</div>
        </div>
        <div class="box" style="min-width:40%">
          <div class="t">入庫金額（税込）</div>
          <div class="v">${money(Math.round(sub + tax))}</div>
          <div style="font-size:8.5pt;color:#475569;margin-top:3px">入荷明細 ${lines.length} 行</div>
        </div>
      </div>
      <table>
        <thead><tr><th style="width:7%">No.</th><th style="width:12%">コード</th><th>品名</th><th style="width:11%">入庫数</th><th style="width:9%">単位</th><th style="width:14%">単価</th><th style="width:15%">金額</th><th style="width:10%">ロット</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals"><table>
        <tr><td>小計（税抜）</td><td class="num">${money(Math.round(sub))}</td></tr>
        <tr><td>消費税（8%）</td><td class="num">${money(tax)}</td></tr>
        <tr class="grand"><td>合計</td><td class="num">${money(Math.round(sub + tax))}</td></tr>
      </table></div>
      <div class="sheet-note">※ 本入庫伝票は帳票番号 ${esc(doc.docNo)} として発行されました。入庫数量をご確認のうえ受領印を押印してください。${r.remarks ? '　備考：' + esc(r.remarks) : ''}</div>
      <div class="sign"><div class="s"><b>受領印</b></div><div class="s"><b>検収担当</b></div></div>
      ${this.foot(Object.assign({ docKind: 'receipt_note' }, r), doc.docNo, r.receiptNo)}
    </div>`);
  },

  /* ------------------------- プレビュー用（帳票テンプレート編集画面） ------------------------- */
  wm(text) { return (!this._pv || this._pv.watermark !== false) ? `<div class="watermark">${text}</div>` : ''; },
  paperCls() { return (this._pv && this._pv.paper === 'landscape') ? ' landscape' : ''; },

  /* HTML生成のみ（履歴登録・印刷なし）。opt = { template, companyId, branch1Id, branch2Id, paper, watermark, footer } */
  build(kind, opt) {
    const map = { quote: 'quote', invoice: 'invoice', delivery_note: 'delivery', shipping_slip: 'slip', purchase_order: 'purchaseOrder', receipt_note: 'receiptNote' };
    const fn = map[kind];
    if (!fn) return '';
    const prevPv = this._pv, prevOut = this._out, prevDry = Store._dryRun;
    this._pv = Object.assign({ preview: true }, opt || {});
    this._out = null;
    Store._dryRun = true;
    let demo = null;
    try {
      let id = this.sampleId(kind);
      if (!id) { demo = this.demo(kind); id = demo.id; }
      this[fn](id);
      return this._out || '';
    } catch (e) {
      return `<div class="note rose">プレビューを生成できませんでした（${esc(e.message)}）</div>`;
    } finally {
      if (demo) this.demoClean(demo.id);
      this._pv = prevPv; this._out = prevOut; Store._dryRun = prevDry;
    }
  },

  /* プレビューに使う実データ（最新の1件） */
  sampleId(kind) {
    const db = Store.db || {};
    const latest = arr => {
      const list = (arr || []).slice().sort((a, b) => String(b.orderDate || b.shipDate || b.receiptDate || b.issuedAt || '').localeCompare(String(a.orderDate || a.shipDate || a.receiptDate || a.issuedAt || '')));
      return (list[0] || {}).id || null;
    };
    if (kind === 'quote' || kind === 'invoice') return latest((db.orders || []).filter(o => o.status !== 'cancelled'));
    if (kind === 'purchase_order') return latest(db.purchaseOrders);
    if (kind === 'receipt_note') return latest(db.receipts);
    const conf = (db.shipments || []).filter(s => s.status === 'confirmed');
    return latest(conf.length ? conf : db.shipments);
  },

  /* 実データがない環境（初期状態）でもプレビューできるようサンプルを一時投入 */
  demo(kind) {
    const db = Store.db;
    const its = (db.items || []).slice(0, 3);
    const cust = (db.customers || [])[0] || { id: null, name: 'デモ得意先 株式会社', address: '東京都千代田区1-2-3', tel: '03-0000-0000' };
    const sup = (db.suppliers || [])[0] || { id: null, name: 'デモ仕入先 株式会社', address: '大阪府大阪市1-2-3' };
    const line = (i, extra) => {
      const it = its[i] || {};
      const qty = (i + 1) * 10, price = 1200 + i * 350;
      return Object.assign({
        id: 'pv_line_' + i, itemId: it.id || null, itemName: it.name || ('デモ品目' + (i + 1)), unit: it.unit || 'ケース',
        quantity: qty, unitPrice: price, unitCost: price - 300, amount: qty * price,
        lotNo: 'LOT-' + (1001 + i), shippedQty: 0, receivedQty: 0, expectedDate: TODAY
      }, extra || {});
    };
    if (kind === 'quote' || kind === 'invoice') {
      const id = 'pv_order';
      db.orders.unshift({ id, orderNo: 'PV-0001', orderDate: TODAY, customerId: cust.id, customerName: cust.name, salesRepId: null, status: 'received', total: 0, remarks: '（プレビュー用サンプル）' });
      for (let i = 0; i < 3; i++) db.orderLines.push(line(i, { id: 'pv_o_l' + i, orderId: id }));
      return { id };
    }
    if (kind === 'delivery_note' || kind === 'shipping_slip') {
      const id = 'pv_ship';
      db.shipments.unshift({ id, shipmentNo: 'PV-0001', shipDate: TODAY, customerId: cust.id, customerName: cust.name, shipToName: cust.name, shipToAddr: cust.address || '', status: 'confirmed', carrier: 'ヤマト運輸', trackingNo: '0000-0000-0000', remarks: '' });
      for (let i = 0; i < 3; i++) db.shipmentLines.push(line(i, { id: 'pv_s_l' + i, shipmentId: id }));
      return { id };
    }
    if (kind === 'purchase_order') {
      const id = 'pv_po';
      db.purchaseOrders.unshift({ id, poNo: 'PV-0001', orderDate: TODAY, expectedDate: TODAY, supplierId: sup.id, supplierName: sup.name, status: 'ordered', total: 0, remarks: '' });
      for (let i = 0; i < 3; i++) db.poLines.push(line(i, { id: 'pv_p_l' + i, poId: id }));
      return { id };
    }
    const id = 'pv_rec';
    db.receipts.unshift({ id, receiptNo: 'PV-0001', receiptDate: TODAY, supplierId: sup.id, supplierName: sup.name, status: 'received', total: 0, remarks: '' });
    for (let i = 0; i < 3; i++) db.receiptLines.push(line(i, { id: 'pv_r_l' + i, receiptId: id }));
    return { id };
  },
  demoClean(id) {
    const db = Store.db;
    db.orders = db.orders.filter(x => x.id !== id); db.orderLines = db.orderLines.filter(x => x.orderId !== id);
    db.shipments = db.shipments.filter(x => x.id !== id); db.shipmentLines = db.shipmentLines.filter(x => x.shipmentId !== id);
    db.purchaseOrders = db.purchaseOrders.filter(x => x.id !== id); db.poLines = db.poLines.filter(x => x.poId !== id);
    db.receipts = db.receipts.filter(x => x.id !== id); db.receiptLines = db.receiptLines.filter(x => x.receiptId !== id);
  },

  /* プレビューと同一HTMLを印刷（ブラウザの「PDFに保存」でPDF化） */
  exportPdf(html, opt) {
    opt = opt || {};
    let st = document.getElementById('printPaper');
    if (!st) { st = document.createElement('style'); st.id = 'printPaper'; document.head.appendChild(st); }
    st.textContent = '@media print{@page{size:A4' + (opt.paper === 'landscape' ? ' landscape' : '') + ';margin:0}}';
    const root = document.getElementById('printRoot');
    if (root) root.innerHTML = html;
    setTimeout(() => window.print(), 150);
  },

  /* 再発行（履歴から） */
  reissue(docId) {
    const d = Store.db.documents.find(x => x.id === docId);
    if (!d) return UI.toast('帳票が見つかりません', 'err');
    d.printedCount = (d.printedCount || 0) + 1; Store.save();
    switch (d.docKind) {
      case 'delivery_note': return this.delivery(d.shipmentId);
      case 'shipping_slip': return this.slip(d.shipmentId);
      case 'picking_list': return this.picking(d.shipmentId);
      case 'quote': return this.quote(d.orderId);
      case 'invoice': return this.invoice(d.orderId);
      case 'purchase_order': return this.purchaseOrder(d.poId);
      case 'receipt_note': return this.receiptNote(d.receiptId);
      default: return UI.toast('この帳票は再発行できません', 'warn');
    }
  }
};


/* ===== 08-tpl-editor.js ===== */
/* ==========================================================================
   アグリERP — 帳票テンプレート編集（PDFプレビュー付き 2カラムエディタ）
   - 左：テンプレート設定／表示項目設定／レイアウト設定
   - 右：帳票プレビュー（見積書・発注書・納品書・請求書・入庫伝票・出庫伝票）
   - 設定変更はプレビューへ即時反映。PDF出力はプレビューと同一HTMLを印刷（PDF保存）
   - 既存テンプレートは Issuer.tplNorm() で不足項目を補完（移行対応）
   ========================================================================== */

/* プレビュー対象の帳票（ピッキングリストは対象外） */
const TPL_PREVIEW_KINDS = ['quote', 'purchase_order', 'delivery_note', 'invoice', 'receipt_note', 'shipping_slip'];

const TplEditor = {
  state: { open: false, id: null, draft: null, previewKind: null, zoom: 0 },

  /* ------------------------------ 開く／戻る ------------------------------ */
  open(id) {
    const t = id ? Issuer.template(id) : null;
    const kind = (t && t.docKind) || 'quote';
    this.state = {
      open: true, id: id || null, zoom: 0, previewKind: TPL_PREVIEW_KINDS.indexOf(kind) >= 0 ? kind : 'quote',
      draft: Object.assign(Issuer.tplNorm(t || {}), {
        templateCode: (t && t.templateCode) || this.nextCode(kind),
        name: (t && t.name) || (DOC_KIND_LABEL[kind] || '帳票') + 'テンプレート',
        docKind: kind,
        companyId: (t && t.companyId) || null,
        isDefault: !!(t && t.isDefault),
        isActive: !t || t.isActive !== false,
        notes: (t && t.notes) || ''
      })
    };
    App.page = 'docTemplates';
    App.repaint();
    document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('on', el.dataset.nav === 'docTemplates'));
    setTimeout(() => this.fit(), 40);
  },
  close() {
    this.state = { open: false, id: null, draft: null, previewKind: null, zoom: 0 };
    App.repaint();
  },
  nextCode(kind) {
    const p = { quote: 'Q', purchase_order: 'PO', delivery_note: 'DN', invoice: 'IV', receipt_note: 'RN', shipping_slip: 'SL', picking_list: 'PL' }[kind] || 'TP';
    const used = (Store.db.docTemplates || []).map(t => String(t.templateCode || ''));
    for (let i = 1; i < 100; i++) {
      const c = p + '-T' + String(i).padStart(2, '0');
      if (used.indexOf(c) < 0) return c;
    }
    return p + '-T' + Date.now();
  },

  /* ------------------------------ プレビュー生成 ------------------------------ */
  sel() {
    const d = this.state.draft || {};
    let co = (d.companyId && Issuer.company(d.companyId)) || null;
    if (!co) {
      const cos = Issuer.companies(true);
      /* 全社共通テンプレートは「主拠点＋副拠点」が確認できる会社を優先 */
      co = cos.filter(c => Issuer.branches(c.id, true).length >= 2)[0] || cos[0] || null;
    }
    const bs = co ? Issuer.branches(co.id, true) : [];
    return { companyId: co ? co.id : null, branch1Id: (bs[0] || {}).id || null, branch2Id: (bs[1] || {}).id || null };
  },
  previewHtml() {
    const d = this.state.draft;
    if (!d) return '';
    const kind = this.state.previewKind || d.docKind;
    const sel = this.sel();
    return Print.build(kind, Object.assign({}, sel, {
      template: Issuer.tplNorm(d),
      paper: d.paper || 'portrait',
      watermark: d.watermark !== false,
      footer: d.footer !== false
    }));
  },
  refresh() {
    const d = this.state.draft; if (!d || !this.state.open) return;
    const body = document.getElementById('tplPrevBody');
    if (body) body.innerHTML = this.previewHtml();
    this.refreshInfo();
    this.fit();
  },
  refreshInfo() {
    const d = this.state.draft; if (!d) return;
    const el = document.getElementById('tplPrevInfo');
    if (!el) return;
    const kind = this.state.previewKind || d.docKind;
    const on = TPL_FIELDS.filter(f => d[f.key] !== false).length;
    el.innerHTML = `${esc(DOC_KIND_LABEL[kind] || kind)} ／ 表示項目 ${on}/${TPL_FIELDS.length} ／ ${{ main: '主拠点のみ', both: '主拠点＋副拠点', two_col: '2カラム表示' }[d.branchMode || 'both']} ／ ${d.paper === 'landscape' ? 'A4横' : 'A4縦'}`;
  },
  fit() {
    const wrap = document.getElementById('tplPrevWrap'), holder = document.getElementById('tplPrevHolder'), body = document.getElementById('tplPrevBody');
    if (!wrap || !holder || !body) return;
    const sheet = body.querySelector('.sheet');
    if (!sheet) return;
    const w = sheet.offsetWidth || 794;
    const avail = Math.max(240, wrap.clientWidth - 24);
    let s = this.state.zoom > 0 ? this.state.zoom : Math.min(1, avail / w);
    s = Math.min(1.6, Math.max(0.28, s));
    body.style.transform = 'scale(' + s.toFixed(3) + ')';
    body.style.width = w + 'px';
    holder.style.width = (w * s) + 'px';
    holder.style.height = (sheet.offsetHeight * s) + 'px';
    const lbl = document.getElementById('tplZoomLbl');
    if (lbl) lbl.textContent = Math.round(s * 100) + '%';
  },
  zoomBy(delta) {
    const wrap = document.getElementById('tplPrevWrap'), body = document.getElementById('tplPrevBody');
    if (!wrap || !body) return;
    const sheet = body.querySelector('.sheet');
    const w = (sheet && sheet.offsetWidth) || 794;
    const cur = this.state.zoom > 0 ? this.state.zoom : Math.min(1, (wrap.clientWidth - 24) / w);
    this.state.zoom = Math.min(1.6, Math.max(0.28, cur + delta));
    this.fit();
  },
  zoomFit() { this.state.zoom = 0; this.fit(); },

  /* ------------------------------ 入力ハンドラ ------------------------------ */
  set(k, v) {
    const d = this.state.draft; if (!d) return;
    d[k] = v;
    if (k === 'paper') this.refresh();
    else this.refreshInfo();
  },
  setKind(k) {
    const d = this.state.draft; if (!d) return;
    d.docKind = k;
    if (TPL_PREVIEW_KINDS.indexOf(k) >= 0) this.state.previewKind = k;
    this.refresh();
  },
  setCompany(id) {
    const d = this.state.draft; if (!d) return;
    d.companyId = id || null;
    this.refresh();
  },
  previewKind(k) {
    this.state.previewKind = k;
    document.querySelectorAll('[data-pk]').forEach(b => b.classList.toggle('on', b.dataset.pk === k));
    this.refresh();
  },
  /* 表示項目のオン／オフ（即時反映） */
  toggle(k) {
    const d = this.state.draft; if (!d) return;
    d[k] = d[k] === false;
    const el = document.getElementById('te_f_' + k);
    if (el) { el.classList.toggle('on', d[k] !== false); const bx = el.querySelector('.bx'); if (bx) bx.textContent = d[k] !== false ? '✓' : ''; }
    this.refresh();
  },
  /* レイアウト設定（セグメント） */
  seg(k, v) {
    const d = this.state.draft; if (!d) return;
    d[k] = v;
    document.querySelectorAll('[data-seg="' + k + '"]').forEach(b => b.classList.toggle('on', b.dataset.val === String(v)));
    this.refresh();
  },

  /* ------------------------------ 保存・PDF ------------------------------ */
  save() {
    const d = this.state.draft; if (!d) return;
    const code = String(d.templateCode || '').trim(), name = String(d.name || '').trim();
    if (!code || !name) return UI.toast('テンプレートコードと名称は必須です', 'err');
    if ((Store.db.docTemplates || []).some(t => t.templateCode === code && t.id !== this.state.id)) return UI.toast('同じテンプレートコードが既に登録されています', 'err');
    const now = new Date().toISOString();
    const body = {
      templateCode: code, name, docKind: d.docKind, companyId: d.companyId || null,
      isDefault: !!d.isDefault, isActive: d.isActive !== false, notes: d.notes || '',
      branchMode: d.branchMode || 'both', paper: d.paper || 'portrait',
      watermark: d.watermark !== false, footer: d.footer !== false, updatedAt: now
    };
    TPL_FIELDS.forEach(f => { body[f.key] = d[f.key] !== false; });
    if (body.isDefault) {
      (Store.db.docTemplates || []).forEach(t => {
        if (t.id !== this.state.id && t.docKind === body.docKind && (t.companyId || null) === (body.companyId || null)) t.isDefault = false;
      });
    }
    if (this.state.id) Object.assign(Issuer.template(this.state.id), body);
    else Store.db.docTemplates.push(Object.assign({ id: uid(), createdAt: now }, body));
    Store.save();
    UI.toast('テンプレート「' + name + '」を保存しました', 'ok');
    this.close();
  },
  pdf() {
    const html = this.previewHtml();
    if (!html) return UI.toast('プレビューを生成できませんでした', 'err');
    Print.exportPdf(html, { paper: (this.state.draft || {}).paper });
    UI.toast('プレビューと同じ内容を印刷ダイアログに出力しました（「PDFに保存」を選択してください）', 'ok');
  },

  /* ------------------------------ 画面 ------------------------------ */
  toggleBtn(f) {
    const on = this.state.draft[f.key] !== false;
    return `<button class="tgl${on ? ' on' : ''}" id="te_f_${f.key}" onclick="TplEditor.toggle('${f.key}')" aria-pressed="${on}">
      <span class="bx">${on ? '✓' : ''}</span><span>${esc(f.label)}</span></button>`;
  },
  segBtn(k, v, label) {
    const on = String(this.state.draft[k]) === String(v);
    return `<button class="seg-i${on ? ' on' : ''}" data-seg="${k}" data-val="${v}" onclick="TplEditor.seg('${k}','${v}')">${esc(label)}</button>`;
  },

  html() {
    const d = this.state.draft;
    const pk = this.state.previewKind || d.docKind;
    const cos = Issuer.companies(false);
    const left = `
      <div class="card">
        <div class="card-h"><h2>${ico('file', 15)} テンプレート設定</h2></div>
        <div class="card-b">
          <div class="form-grid c2" style="gap:11px">
            <div class="field"><label>テンプレートコード *</label><input class="inp" id="te_code" value="${esc(d.templateCode || '')}" oninput="TplEditor.set('templateCode', this.value)"></div>
            <div class="field"><label>帳票種別 *</label><select class="inp" id="te_kind" onchange="TplEditor.setKind(this.value)">
              ${Object.keys(DOC_KIND_LABEL).map(k => `<option value="${k}"${d.docKind === k ? ' selected' : ''}>${esc(DOC_KIND_LABEL[k])}</option>`).join('')}</select></div>
            <div class="field span2"><label>テンプレート名 *</label><input class="inp" id="te_name" value="${esc(d.name || '')}" oninput="TplEditor.set('name', this.value)"></div>
            <div class="field span2"><label>対象会社</label><select class="inp" id="te_co" onchange="TplEditor.setCompany(this.value)">
              <option value=""${!d.companyId ? ' selected' : ''}>全社共通</option>
              ${cos.map(c => `<option value="${esc(c.id)}"${d.companyId === c.id ? ' selected' : ''}>${esc(c.name)} 専用</option>`).join('')}</select></div>
            <div class="field"><label>標準テンプレート</label><select class="inp" onchange="TplEditor.set('isDefault', this.value === '1')">
              <option value="0"${!d.isDefault ? ' selected' : ''}>使用しない</option>
              <option value="1"${d.isDefault ? ' selected' : ''}>標準として使用</option></select></div>
            <div class="field"><label>有効／無効</label><select class="inp" onchange="TplEditor.set('isActive', this.value === '1')">
              <option value="1"${d.isActive !== false ? ' selected' : ''}>有効</option>
              <option value="0"${d.isActive === false ? ' selected' : ''}>無効</option></select></div>
            <div class="field span2"><label>備考</label><input class="inp" value="${esc(d.notes || '')}" oninput="TplEditor.set('notes', this.value)"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-h"><h2>${ico('check', 15)} 表示項目設定</h2><span class="sub">チェックした項目だけを帳票に印字します</span>
          <div class="sp"><button class="btn xs" onclick="TPL_FIELDS.forEach(f=>{if(TplEditor.state.draft[f.key]===false)TplEditor.toggle(f.key)})">すべて表示</button></div></div>
        <div class="card-b"><div class="tgl-grid">${TPL_FIELDS.map(f => this.toggleBtn(f)).join('')}</div>
          <div class="tiny muted mt8">主拠点・副拠点は「レイアウト設定」の拠点表示方法と組み合わせて制御されます。</div></div>
      </div>

      <div class="card">
        <div class="card-h"><h2>${ico('settings', 15)} レイアウト設定</h2></div>
        <div class="card-b vstack" style="gap:13px">
          <div>
            <label class="lbl">拠点表示</label>
            <div class="seg">${this.segBtn('branchMode', 'main', '主拠点のみ')}${this.segBtn('branchMode', 'both', '主拠点＋副拠点')}${this.segBtn('branchMode', 'two_col', '2カラム表示')}</div>
          </div>
          <div>
            <label class="lbl">用紙</label>
            <div class="seg">${this.segBtn('paper', 'portrait', 'A4 縦')}${this.segBtn('paper', 'landscape', 'A4 横')}</div>
          </div>
          <div>
            <label class="lbl">印字オプション</label>
            <div class="seg">${this.segBtn('watermark', true, '透かし文字')}${this.segBtn('watermark', false, '透かしなし')}</div>
            <div class="seg mt8">${this.segBtn('footer', true, 'フッター表示')}${this.segBtn('footer', false, 'フッターなし')}</div>
          </div>
        </div>
      </div>`;

    const right = `
      <div class="card">
        <div class="card-h"><h2>${ico('eye', 15)} 帳票プレビュー</h2><span class="sub" id="tplPrevInfo"></span>
          <div class="sp hstack" style="gap:6px">
            <button class="btn xs" onclick="TplEditor.zoomBy(-0.1)" title="縮小">－</button>
            <span class="tiny muted" id="tplZoomLbl" style="min-width:38px;text-align:center">100%</span>
            <button class="btn xs" onclick="TplEditor.zoomBy(0.1)" title="拡大">＋</button>
            <button class="btn xs" onclick="TplEditor.zoomFit()">全体</button>
          </div></div>
        <div style="padding:10px 16px;border-bottom:1px solid var(--ink-100)">
          <div class="tabs" style="flex-wrap:wrap">${TPL_PREVIEW_KINDS.map(k => `<button class="tab${pk === k ? ' on' : ''}" data-pk="${k}" onclick="TplEditor.previewKind('${k}')">${esc(DOC_KIND_LABEL[k])}</button>`).join('')}</div>
        </div>
        <div class="card-b tpl-prev-b">
          <div class="tpl-prev-wrap" id="tplPrevWrap">
            <div class="tpl-prev-holder" id="tplPrevHolder">
              <div class="tpl-scale" id="tplPrevBody">${this.previewHtml()}</div>
            </div>
          </div>
          <div class="tiny muted mt8">プレビューは実際の帳票レイアウトに現在の設定を適用したイメージです。PDF出力はこの内容をそのままA4で生成します。</div>
        </div>
      </div>`;

    return `<div class="vstack" style="gap:14px">
      <div class="hstack" style="gap:9px;flex-wrap:wrap">
        <button class="btn sm" onclick="TplEditor.close()">← テンプレート一覧へ</button>
        <div class="sp hstack" style="gap:8px">
          <span class="badge gray">${this.state.id ? '編集中' : '新規作成'}</span>
          <button class="btn sm" onclick="TplEditor.close()">キャンセル</button>
          <button class="btn sm" onclick="TplEditor.pdf()">${ico('printer', 14)} PDF出力</button>
          <button class="btn sm primary" onclick="TplEditor.save()">${ico('check', 14)} 保存</button>
        </div>
      </div>
      <div class="tpl-editor">
        <div class="tpl-left">${left}</div>
        <div class="tpl-right">${right}</div>
      </div>
    </div>`;
  }
};


/* ===== 06-app.js ===== */
/* ==========================================================================
   アグリERP — ルーティング・画面描画・業務アクション
   ========================================================================== */
const App = {
  page: 'dashboard',
  renderNav() {
    const nav = document.getElementById('nav');
    nav.innerHTML = MENU.map(g => {
      const items = g.items.filter(i => Auth.can(i.id));
      if (!items.length) return '';
      return `<div class="nav-group"><p>${esc(g.group)}</p>${items.map(i => {
        let badgeHtml = '';
        if (i.badge === 'alerts') { const n = Store.alerts().length; if (n) badgeHtml = `<span class="cnt">${n}</span>`; }
        return `<button class="nav-item ${App.page === i.id ? 'on' : ''}" data-nav="${i.id}" onclick="App.go('${i.id}')">${ico(i.icon, 17)}<span>${esc(i.label)}</span>${badgeHtml}</button>`;
      }).join('')}</div>`;
    }).join('');
  },
  go(id) {
    if (!Auth.can(id)) { UI.toast('この機能を利用する権限がありません', 'err'); return; }
    this.page = id;
    UI.closeSidebar();
    const meta = MENU.flatMap(g => g.items).find(i => i.id === id) || { label: id, sub: '' };
    document.getElementById('pgTitle').textContent = meta.label;
    document.getElementById('pgSub').textContent = meta.sub;
    document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('on', el.dataset.nav === id));
    this.repaint();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },
  repaint() {
    const v = document.getElementById('view');
    const fn = Views[this.page];
    v.innerHTML = fn ? fn() : emptyBox('画面がありません', '');
    const n = Store.alerts().length;
    const b = document.getElementById('bellCnt');
    b.textContent = n; b.style.display = n ? 'grid' : 'none';
    const navBadge = document.querySelector('[data-nav="alerts"] .cnt');
    if (navBadge) navBadge.textContent = n;
  },
  /* トップバー：本日のピッキングリストをまとめて印刷 */
  printQuick() {
    const ships = Store.db.shipments.filter(s => s.shipDate === TODAY && s.status !== 'cancelled');
    if (!ships.length) return UI.toast('本日の出荷予定がありません', 'warn');
    const root = document.getElementById('printRoot');
    root.innerHTML = ships.map(s => {
      const lines = Store.shipLines(s.id);
      const docNo = Store.nextNo('PL');
      const ctx = Issuer.resolve(Object.assign({ docKind: 'picking_list' }, s));
      Store.db.documents.unshift({
        id: uid(), docKind: 'picking_list', docNo, shipmentId: s.id, shipmentNo: s.shipmentNo, customerName: s.customerName,
        issuedAt: new Date().toISOString(), printedCount: 1,
        companyId: (ctx.company || {}).id || null, branch1Id: (ctx.branch1 || {}).id || null,
        branch2Id: (ctx.branch2 || {}).id || null, templateId: (ctx.template || {}).id || null
      });
      return `<div class="sheet landscape">
        ${Print.head('ピッキングリスト', docNo, `出荷番号 ${s.shipmentNo} ／ 出荷日 ${dJPfull(s.shipDate)}`, Object.assign({ docKind: 'picking_list' }, s))}
        <div class="sheet-meta" style="margin-top:-4px">
          <div class="box" style="min-width:40%"><div class="t">出荷先</div><div class="v">${esc(s.customerName)} 様</div></div>
          <div class="box" style="min-width:30%"><div class="t">合計数量</div><div class="v">${dec(lines.reduce((a, l) => a + l.quantity, 0))} 点</div></div>
          <div class="box" style="min-width:26%"><div class="t">運送会社</div><div class="v" style="font-size:10pt">${esc(s.carrier || '—')}</div></div>
        </div>
        <table><thead><tr><th style="width:6%">No.</th><th style="width:9%">完了</th><th style="width:13%">保管場所</th><th>品名</th><th style="width:13%">数量</th><th style="width:9%">単位</th></tr></thead>
        <tbody>${lines.map((l, i) => { const it = Store.item(l.itemId) || {}; return `<tr><td style="text-align:center">${i + 1}</td><td style="text-align:center"><span class="pick-chk"></span></td>
          <td style="text-align:center"><b>${esc(it.location || '—')}</b></td><td>${esc(l.itemName)}</td><td class="num" style="font-size:12pt"><b>${dec(l.quantity)}</b></td><td style="text-align:center">${esc(it.unit || '')}</td></tr>`; }).join('')}</tbody></table>
        ${Print.foot(Object.assign({ docKind: 'picking_list' }, s), docNo, s.shipmentNo)}</div>`;
    }).join('');
    Store.save();
    UI.toast(`本日の出荷 ${ships.length} 件のピッキングリストを発行しました`, 'ok');
    setTimeout(() => window.print(), 200);
  }
};

/* ==========================================================================
   業務アクション（受注・発注・入荷・出荷・マスタ）
   ========================================================================== */
const Actions = {

  /* ------------------------- 商品／資材マスタ ------------------------- */
  itemForm(kind, id) {
    const it = id ? Store.item(id) : null;
    const isP = kind === 'product';
    const opts = (sel, list, valKey, lblKey) => list.map(x => `<option value="${x.id}"${sel === x.id ? ' selected' : ''}>${esc(x[lblKey])}</option>`).join('');
    UI.modal(it ? `${it.name} を編集` : (isP ? '商品を新規登録' : '資材を新規登録'), isP ? '商品マスタ' : '資材マスタ', `
      <div class="form-grid">
        <div class="field"><label>コード *</label><input class="inp" id="f_code" value="${esc(it ? it.code : '')}" placeholder="${isP ? 'P016' : 'M011'}"></div>
        <div class="field"><label>品名 *</label><input class="inp" id="f_name" value="${esc(it ? it.name : '')}"></div>
        <div class="field"><label>カナ</label><input class="inp" id="f_kana" value="${esc(it ? it.kana : '')}"></div>
        <div class="field"><label>カテゴリ</label><input class="inp" id="f_cat" value="${esc(it ? it.category : '')}" placeholder="${isP ? '果菜類' : '梱包資材'}"></div>
        <div class="field"><label>単位</label><input class="inp" id="f_unit" value="${esc(it ? it.unit : 'ケース')}"></div>
        <div class="field"><label>規格</label><input class="inp" id="f_spec" value="${esc(it ? it.spec : '')}" placeholder="10kg/ケース"></div>
        ${isP ? `<div class="field"><label>販売単価</label><input class="inp" type="number" id="f_sale" value="${it ? it.salePrice : 0}"></div>` : ''}
        <div class="field"><label>仕入単価</label><input class="inp" type="number" id="f_cost" value="${it ? it.costPrice : 0}"></div>
        <div class="field"><label>発注点</label><input class="inp" type="number" id="f_rop" value="${it ? it.reorderPoint : 0}"></div>
        <div class="field"><label>発注ロット</label><input class="inp" type="number" id="f_roq" value="${it ? it.reorderQty : 0}"></div>
        <div class="field"><label>安全在庫</label><input class="inp" type="number" id="f_safe" value="${it ? it.safetyStock : 0}"></div>
        <div class="field"><label>保管場所</label><input class="inp" id="f_loc" value="${esc(it ? it.location : '')}" placeholder="A-01"></div>
        <div class="field"><label>主仕入先</label><select class="inp" id="f_sup">${opts(it ? it.supplierId : '', Store.db.suppliers, 'id', 'name')}</select></div>
        <div class="field"><label>バーコード（JAN）</label><input class="inp" id="f_jan" value="${esc(it ? it.janCode : '')}" placeholder="将来拡張"></div>
        <div class="field"><label>現在庫${it ? '' : '（初期値）'}</label><input class="inp" type="number" id="f_stock" value="${it ? it.stock : 0}" ${it ? 'readonly title="在庫は入荷・出荷でのみ変動します"' : ''}></div>
        <div class="field span3"><label>備考</label><input class="inp" id="f_notes" value="${esc(it ? it.notes : '')}"></div>
      </div>
      ${it ? '<div class="note mt12">現在庫は入荷（＋）・出荷確定（−）・在庫調整のトランザクション経由でのみ変動します。</div>' : ''}`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.saveItem('${kind}','${id || ''}')">${ico('check', 15)} 保存</button>`);
  },
  saveItem(kind, id) {
    const v = n => document.getElementById(n) ? document.getElementById(n).value : '';
    const code = v('f_code').trim(), name = v('f_name').trim();
    if (!code || !name) return UI.toast('コードと品名は必須です', 'err');
    if (Store.db.items.some(i => i.code === code && i.id !== id)) return UI.toast('同じコードが既に登録されています', 'err');
    if (id) {
      const it = Store.item(id);
      Object.assign(it, {
        code, name, kana: v('f_kana'), category: v('f_cat'), unit: v('f_unit'), spec: v('f_spec'),
        costPrice: +v('f_cost'), reorderPoint: +v('f_rop'), reorderQty: +v('f_roq'), safetyStock: +v('f_safe'),
        location: v('f_loc'), supplierId: v('f_sup'), janCode: v('f_jan'), notes: v('f_notes')
      });
      if (kind === 'product') it.salePrice = +v('f_sale');
      UI.toast(`${name} を更新しました`, 'ok');
    } else {
      const newItem = {
        id: uid(), kind, code, name, kana: v('f_kana'), category: v('f_cat'), unit: v('f_unit'), spec: v('f_spec'),
        salePrice: kind === 'product' ? +v('f_sale') : 0, costPrice: +v('f_cost'), taxRate: 8,
        reorderPoint: +v('f_rop'), reorderQty: +v('f_roq'), safetyStock: +v('f_safe'), stock: 0,
        location: v('f_loc'), supplierId: v('f_sup'), janCode: v('f_jan'), barcode: 'AG' + code, qrPayload: code,
        active: true, notes: v('f_notes')
      };
      Store.db.items.push(newItem);
      const init = +v('f_stock');
      if (init > 0) Store.applyStock(newItem.id, init, 'adjustment', { table: 'items', id: newItem.id, no: '初期在庫', notes: '新規登録時の初期在庫' });
      UI.toast(`${name} を登録しました`, 'ok');
    }
    Store.save(); UI.closeModal(); App.renderNav(); App.repaint();
  },
  deleteItem(id) {
    const it = Store.item(id);
    if (Store.db.orderLines.some(l => l.itemId === id) || Store.db.poLines.some(l => l.itemId === id)) {
      it.active = false; Store.save(); App.repaint(); return UI.toast(`${it.name} は使用中のため無効化しました`, 'warn');
    }
    UI.confirm('削除の確認', `${it.name} を削除します。よろしいですか？`, () => {
      Store.db.items = Store.db.items.filter(i => i.id !== id); Store.save(); App.repaint(); UI.toast('削除しました', 'ok');
    }, '削除する', 'danger');
  },
  stockHistory(id) {
    const it = Store.item(id);
    const mv = Store.db.movements.filter(m => m.itemId === id).slice(0, 40);
    UI.modal(`${it.name} の入出庫履歴`, `現在庫 ${dec(it.stock)} ${it.unit} ／ 発注点 ${dec(it.reorderPoint)}`, `
      <div class="grid g3 mb16">
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">現在庫</div><div class="k-v" style="font-size:21px">${dec(it.stock)}</div></div>
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">入荷累計</div><div class="k-v" style="font-size:21px">${dec(mv.filter(m => m.moveType === 'receipt').reduce((a, m) => a + m.quantity, 0))}</div></div>
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">出荷累計</div><div class="k-v" style="font-size:21px">${dec(Math.abs(mv.filter(m => m.moveType === 'shipment').reduce((a, m) => a + m.quantity, 0)))}</div></div>
      </div>
      <div class="table-wrap"><table class="tb" style="min-width:520px">
        <thead><tr><th>日時</th><th>区分</th><th class="right">増減</th><th class="right">残高</th><th>伝票</th></tr></thead>
        <tbody>${mv.map(m => `<tr><td class="sm nowrap">${dtJP(m.movedAt)}</td>
          <td><span class="badge ${moveBadge(m.moveType)}">${moveLabel(m.moveType)}</span></td>
          <td class="num" style="color:${m.quantity > 0 ? 'var(--green-700)' : 'var(--rose-600)'};font-weight:700">${m.quantity > 0 ? '+' : ''}${dec(m.quantity)}</td>
          <td class="num">${dec(m.balanceAfter)}</td><td class="mono">${esc(m.refNo || '—')}</td></tr>`).join('') || '<tr><td colspan="5" class="center muted">履歴がありません</td></tr>'}</tbody>
      </table></div>`, `<button class="btn" onclick="UI.closeModal()">閉じる</button>`, 'wide');
  },
  adjustStock() {
    UI.modal('在庫調整', '棚卸差異・ロスなどの調整（履歴に記録されます）', `
      <div class="form-grid c2">
        <div class="field span2"><label>対象品目</label><select class="inp" id="a_item">${Store.db.items.map(i => `<option value="${i.id}">${esc(i.code)} ${esc(i.name)}（現在庫 ${dec(i.stock)} ${esc(i.unit)}）</option>`).join('')}</select></div>
        <div class="field"><label>調整区分</label><select class="inp" id="a_type"><option value="adjustment">棚卸調整</option><option value="loss">ロス・廃棄</option><option value="return">返品</option><option value="receipt">入荷（直接）</option></select></div>
        <div class="field"><label>増減数量（マイナスで減算）</label><input class="inp" type="number" id="a_qty" value="0"></div>
        <div class="field span2"><label>理由・備考</label><input class="inp" id="a_notes" placeholder="例：棚卸差異、品質不良による廃棄"></div>
      </div>`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.saveAdjust()">${ico('check', 15)} 調整を実行</button>`);
  },
  saveAdjust() {
    const id = document.getElementById('a_item').value;
    const qty = +document.getElementById('a_qty').value;
    const type = document.getElementById('a_type').value;
    const notes = document.getElementById('a_notes').value;
    if (!qty) return UI.toast('数量を入力してください', 'err');
    const it = Store.item(id);
    if (it.stock + qty < 0) return UI.toast('在庫がマイナスになる調整はできません', 'err');
    Store.applyStock(id, qty, type, { table: 'items', id, no: 'ADJ-' + TODAY.replace(/-/g, ''), notes });
    Store.save(); UI.closeModal(); App.repaint();
    UI.toast(`${it.name} の在庫を ${qty > 0 ? '+' : ''}${dec(qty)} 調整しました`, 'ok');
  },

  /* ------------------------- 得意先・仕入先 ------------------------- */
  customerForm(id) {
    const c = id ? Store.customer(id) : null;
    UI.modal(c ? '得意先を編集' : '得意先を新規登録', '得意先マスタ', `
      <div class="form-grid">
        <div class="field"><label>コード *</label><input class="inp" id="c_code" value="${esc(c ? c.code : '')}" placeholder="C006"></div>
        <div class="field span2"><label>得意先名 *</label><input class="inp" id="c_name" value="${esc(c ? c.name : '')}"></div>
        <div class="field"><label>カナ</label><input class="inp" id="c_kana" value="${esc(c ? c.kana : '')}"></div>
        <div class="field"><label>電話番号</label><input class="inp" id="c_tel" value="${esc(c ? c.tel : '')}"></div>
        <div class="field"><label>担当者</label><input class="inp" id="c_contact" value="${esc(c ? c.contact : '')}"></div>
        <div class="field span3"><label>住所</label><input class="inp" id="c_addr" value="${esc(c ? c.address : '')}"></div>
        <div class="field"><label>締め日</label><input class="inp" type="number" id="c_close" value="${c ? c.closingDay : 31}"></div>
        <div class="field"><label>支払条件</label><input class="inp" id="c_pay" value="${esc(c ? c.paymentTerms : '翌月末')}"></div>
        <div class="field"><label>メール</label><input class="inp" id="c_mail" value="${esc(c ? c.email : '')}"></div>
        <div class="field"><label>営業担当者</label><select class="inp" id="c_rep">
          <option value="">（未設定）</option>
          ${Store.salesReps().map(u => `<option value="${esc(u.id)}"${c && c.salesRepId === u.id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}
        </select><span class="hint">伝票検索の「営業担当者」条件に使用します</span></div>
      </div>`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.saveCustomer('${id || ''}')">${ico('check', 15)} 保存</button>`);
  },
  saveCustomer(id) {
    const g = n => document.getElementById(n).value;
    if (!g('c_code') || !g('c_name')) return UI.toast('コードと得意先名は必須です', 'err');
    const rep = (document.getElementById('c_rep') || {}).value || null;
    if (id) { Object.assign(Store.customer(id), { code: g('c_code'), name: g('c_name'), kana: g('c_kana'), tel: g('c_tel'), contact: g('c_contact'), address: g('c_addr'), closingDay: +g('c_close'), paymentTerms: g('c_pay'), email: g('c_mail'), salesRepId: rep }); UI.toast('得意先を更新しました', 'ok'); }
    else { Store.db.customers.push({ id: uid(), code: g('c_code'), name: g('c_name'), kana: g('c_kana'), tel: g('c_tel'), contact: g('c_contact'), address: g('c_addr'), closingDay: +g('c_close'), paymentTerms: g('c_pay'), email: g('c_mail'), salesRepId: rep, active: true, notes: '' }); UI.toast('得意先を登録しました', 'ok'); }
    Store.save(); UI.closeModal(); App.repaint();
  },
  deleteCustomer(id) {
    if (Store.db.orders.some(o => o.customerId === id)) return UI.toast('受注履歴があるため削除できません', 'err');
    UI.confirm('削除の確認', `${Store.customer(id).name} を削除します。`, () => {
      Store.db.customers = Store.db.customers.filter(c => c.id !== id); Store.save(); App.repaint(); UI.toast('削除しました', 'ok');
    }, '削除する', 'danger');
  },
  supplierForm(id) {
    const s = id ? Store.supplier(id) : null;
    UI.modal(s ? '仕入先を編集' : '仕入先を新規登録', '仕入先マスタ', `
      <div class="form-grid">
        <div class="field"><label>コード *</label><input class="inp" id="s_code" value="${esc(s ? s.code : '')}" placeholder="S005"></div>
        <div class="field span2"><label>仕入先名 *</label><input class="inp" id="s_name" value="${esc(s ? s.name : '')}"></div>
        <div class="field"><label>カナ</label><input class="inp" id="s_kana" value="${esc(s ? s.kana : '')}"></div>
        <div class="field"><label>電話番号</label><input class="inp" id="s_tel" value="${esc(s ? s.tel : '')}"></div>
        <div class="field"><label>担当者</label><input class="inp" id="s_contact" value="${esc(s ? s.contact : '')}"></div>
        <div class="field span3"><label>住所</label><input class="inp" id="s_addr" value="${esc(s ? s.address : '')}"></div>
        <div class="field"><label>締め日</label><input class="inp" type="number" id="s_close" value="${s ? s.closingDay : 31}"></div>
        <div class="field"><label>支払条件</label><input class="inp" id="s_pay" value="${esc(s ? s.paymentTerms : '翌月末')}"></div>
        <div class="field"><label>リードタイム（日）</label><input class="inp" type="number" id="s_lead" value="${s ? s.leadTime : 3}"></div>
      </div>`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.saveSupplier('${id || ''}')">${ico('check', 15)} 保存</button>`);
  },
  saveSupplier(id) {
    const g = n => document.getElementById(n).value;
    if (!g('s_code') || !g('s_name')) return UI.toast('コードと仕入先名は必須です', 'err');
    if (id) { Object.assign(Store.supplier(id), { code: g('s_code'), name: g('s_name'), kana: g('s_kana'), tel: g('s_tel'), contact: g('s_contact'), address: g('s_addr'), closingDay: +g('s_close'), paymentTerms: g('s_pay'), leadTime: +g('s_lead') }); UI.toast('仕入先を更新しました', 'ok'); }
    else { Store.db.suppliers.push({ id: uid(), code: g('s_code'), name: g('s_name'), kana: g('s_kana'), tel: g('s_tel'), contact: g('s_contact'), address: g('s_addr'), closingDay: +g('s_close'), paymentTerms: g('s_pay'), leadTime: +g('s_lead'), active: true, notes: '' }); UI.toast('仕入先を登録しました', 'ok'); }
    Store.save(); UI.closeModal(); App.repaint();
  },
  deleteSupplier(id) {
    if (Store.db.purchaseOrders.some(p => p.supplierId === id)) return UI.toast('発注履歴があるため削除できません', 'err');
    UI.confirm('削除の確認', `${Store.supplier(id).name} を削除します。`, () => {
      Store.db.suppliers = Store.db.suppliers.filter(s => s.id !== id); Store.save(); App.repaint(); UI.toast('削除しました', 'ok');
    }, '削除する', 'danger');
  },

  /* ------------------------- 受注 ------------------------- */
  orderForm() {
    window.__lines = [{ itemId: Store.db.items[0].id, qty: 1, price: Store.db.items[0].salePrice }];
    const c0 = Store.db.customers[0] || {};
    window.__oCust = c0.id || '';
    window.__oRep = c0.salesRepId || ((Store.salesReps()[0] || {}).id || '');
    this._drawOrderForm();
  },
  /* 得意先の変更で営業担当者を既定担当へ追従 */
  chgOrderCust(custId) {
    const c = Store.customer(custId) || {};
    window.__oCust = custId;
    window.__oRep = c.salesRepId || window.__oRep;
    this._drawOrderForm();
  },
  _drawOrderForm() {
    const prev = document.getElementById('o_co') ? Issuer.read('o') : (window.__oIssuer || {});
    window.__oIssuer = prev;
    const body = `
      <div class="form-grid">
        <div class="field"><label>受注番号</label><input class="inp" value="${Store.nextNo('ORD')}" readonly title="保存時に確定します"></div>
        <div class="field"><label>受注日 *</label><input class="inp" type="date" id="o_date" value="${TODAY}"></div>
        <div class="field"><label>納期 *</label><input class="inp" type="date" id="o_due" value="${todayStr(addDays(new Date(), 2))}"></div>
        <div class="field span2"><label>得意先 *</label><select class="inp" id="o_cust" onchange="Actions.chgOrderCust(this.value)">${Store.db.customers.map(x => `<option value="${x.id}"${window.__oCust === x.id ? ' selected' : ''}>${esc(x.code)} ${esc(x.name)}</option>`).join('')}</select></div>
        <div class="field"><label>営業担当者</label><select class="inp" id="o_rep">${Store.salesReps().map(u => `<option value="${esc(u.id)}"${window.__oRep === u.id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>
      </div>

      <div class="hr"></div>
      <div class="hstack mb8"><b style="font-size:13px">${ico('factory', 14)} 発行元情報</b><span class="tiny muted">帳票の上部に印字されます（発行会社は必須）</span></div>
      ${Issuer.pickerHtml('o', prev, { docKind: 'quote' })}
      <div class="hr"></div>
      <div class="hstack mb12"><b style="font-size:13px">受注明細</b><div class="sp"><button class="btn sm" onclick="Actions.addOrderLine()">${ico('plus', 14)} 行を追加</button></div></div>
      <div class="table-wrap"><table class="line-tb" style="min-width:620px">
        <thead><tr><th style="width:40%">商品</th><th style="width:15%">数量</th><th style="width:18%">単価</th><th style="width:18%">金額</th><th></th></tr></thead>
        <tbody>${window.__lines.map((l, i) => `<tr>
          <td><select class="inp" onchange="Actions.updLine(${i},'itemId',this.value)">
            ${Store.db.items.filter(x => x.kind === 'product').map(x => `<option value="${x.id}"${l.itemId === x.id ? ' selected' : ''}>${esc(x.code)} ${esc(x.name)}（在庫 ${dec(x.stock)}）</option>`).join('')}
          </select></td>
          <td><input class="inp num" type="number" value="${l.qty}" oninput="Actions.updLine(${i},'qty',+this.value)"></td>
          <td><input class="inp num" type="number" value="${l.price}" oninput="Actions.updLine(${i},'price',+this.value)"></td>
          <td class="num" style="font-weight:700">${money(l.qty * l.price)}</td>
          <td class="right">${window.__lines.length > 1 ? `<button class="btn xs danger" onclick="Actions.delLine(${i})">${ico('x', 13)}</button>` : ''}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="hr"></div>
      <div class="hstack" style="justify-content:flex-end;gap:22px">
        <span class="sm muted">小計 <b>${money(window.__lines.reduce((a, l) => a + l.qty * l.price, 0))}</b></span>
        <span class="sm muted">消費税 <b>${money(Math.round(window.__lines.reduce((a, l) => a + l.qty * l.price, 0) * .08))}</b></span>
        <span style="font-size:15px;font-weight:800">合計 ${money(Math.round(window.__lines.reduce((a, l) => a + l.qty * l.price, 0) * 1.08))}</span>
      </div>
      <div class="field mt12"><label>備考</label><input class="inp" id="o_remarks" placeholder="納品時のご要望など"></div>`;
    UI.modal('受注登録', '受注番号は保存時に自動採番されます', body,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.saveOrder()">${ico('check', 15)} 受注を登録</button>`, 'wide');
  },
  addOrderLine() { window.__lines.push({ itemId: Store.db.items[0].id, qty: 1, price: Store.db.items[0].salePrice }); this._drawOrderForm(); },
  delLine(i) { window.__lines.splice(i, 1); this._drawOrderForm(); },
  updLine(i, k, v) {
    window.__lines[i][k] = v;
    if (k === 'itemId') window.__lines[i].price = Store.item(v).salePrice;
    this._drawOrderForm();
  },
  saveOrder() {
    const custId = document.getElementById('o_cust').value;
    const lines = window.__lines.filter(l => l.qty > 0);
    if (!lines.length) return UI.toast('明細を1行以上入力してください', 'err');
    const issErr = Issuer.validate('o'); if (issErr) return UI.toast(issErr, 'err');
    const issuer = Issuer.stamp('o');
    const orderNo = Store.nextNo('ORD', document.getElementById('o_date').value);
    let sub = 0;
    const oid = uid();
    const ols = lines.map((l, i) => {
      const it = Store.item(l.itemId); const amt = l.qty * l.price; sub += amt;
      return { id: uid(), orderId: oid, lineNo: i + 1, itemId: l.itemId, itemName: it.name, unit: it.unit,
        quantity: l.qty, unitPrice: l.price, taxRate: 8, amount: amt, shippedQty: 0,
        dueDate: document.getElementById('o_due').value, notes: '' };
    });
    const tax = Math.round(sub * .08);
    Store.db.orders.unshift({
      id: oid, orderNo, customerId: custId, customerName: Store.customer(custId).name,
      salesRepId: (document.getElementById('o_rep') || {}).value || null,
      orderDate: document.getElementById('o_date').value, dueDate: document.getElementById('o_due').value,
      shipDate: document.getElementById('o_due').value, status: 'received',
      companyId: issuer.companyId, branch1Id: issuer.branch1Id, branch2Id: issuer.branch2Id,
      subtotal: sub, tax, total: sub + tax, remarks: document.getElementById('o_remarks').value,
      createdBy: Auth.user ? Auth.user.id : null, createdAt: new Date().toISOString()
    });
    ols.forEach(l => Store.db.orderLines.push(l));
    Store.save(); UI.closeModal(); App.renderNav(); App.repaint();
    UI.toast(`受注 ${orderNo} を登録しました`, 'ok');
  },
  orderDetail(id) {
    const o = Store.order(id);
    const lines = Store.orderLines(o.id);
    UI.modal(`受注 ${o.orderNo}`, `${o.customerName} ／ 受注日 ${dJP(o.orderDate)}`, `
      <div class="grid g3 mb16">
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">受注金額</div><div class="k-v" style="font-size:20px">${money(o.total)}</div></div>
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">納期</div><div class="k-v" style="font-size:20px">${dJP(o.dueDate)}</div><div class="k-f">${relDay(o.dueDate)}</div></div>
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">受注残</div><div class="k-v" style="font-size:20px">${dec(Store.orderRemaining(o))}</div><div class="k-f">${badge(o.status)}</div></div>
      </div>
      <div class="table-wrap"><table class="tb" style="min-width:600px">
        <thead><tr><th>No.</th><th>品名</th><th class="right">受注数</th><th class="right">出荷済</th><th class="right">残</th><th class="right">単価</th><th class="right">金額</th></tr></thead>
        <tbody>${lines.map(l => `<tr><td>${l.lineNo}</td><td class="strong">${esc(l.itemName)}</td>
          <td class="num">${dec(l.quantity)}</td><td class="num muted">${dec(l.shippedQty)}</td>
          <td class="num" style="font-weight:700;color:${l.quantity - l.shippedQty > 0 ? 'var(--rose-600)' : 'inherit'}">${dec(l.quantity - l.shippedQty)}</td>
          <td class="num">${money(l.unitPrice)}</td><td class="num">${money(l.amount)}</td></tr>`).join('')}</tbody>
      </table></div>
      ${o.remarks ? `<div class="note mt12">備考：${esc(o.remarks)}</div>` : ''}
      ${Store.db.shipments.filter(s => s.orderId === o.id).length ? `<div class="hr"></div><b class="sm">関連する出荷</b>
        <div class="table-wrap mt8"><table class="tb" style="min-width:480px"><thead><tr><th>出荷番号</th><th>出荷日</th><th>状態</th></tr></thead>
        <tbody>${Store.db.shipments.filter(s => s.orderId === o.id).map(s => `<tr><td class="mono">${esc(s.shipmentNo)}</td><td class="sm">${dJP(s.shipDate)}</td><td>${s.status === 'confirmed' ? '<span class="badge green">確定</span>' : '<span class="badge amber">指示済</span>'}</td></tr>`).join('')}</tbody></table></div>` : ''}`,
      `<button class="btn" onclick="UI.closeModal()">閉じる</button>
       ${Store.orderRemaining(o) > 0 ? `<button class="btn primary" onclick="UI.closeModal();Actions.newShipFromOrder('${o.id}')">${ico('truck', 15)} 出荷指示を作成</button>` : ''}
       <button class="btn danger" onclick="UI.closeModal();Actions.cancelOrder('${o.id}')">取消</button>`, 'wide');
  },
  cancelOrder(id) {
    const o = Store.order(id);
    UI.confirm('受注の取消', `${o.orderNo} を取消します。よろしいですか？`, () => {
      o.status = 'cancelled'; Store.save(); App.repaint(); UI.toast('受注を取消しました', 'warn');
    }, '取消する', 'danger');
  },

  /* ------------------------- 発注 ------------------------- */
  newPOFor(itemId) {
    const it = itemId ? Store.item(itemId) : null;
    window.__poLines = [it ? { itemId: it.id, qty: it.reorderQty || 1, price: it.costPrice } : { itemId: Store.db.items[0].id, qty: 1, price: Store.db.items[0].costPrice }];
    if (it) {
      const sup = Store.supplier(it.supplierId) || Store.db.suppliers[0];
      window.__poSup = sup.id; window.__poLead = sup.leadTime;
    } else { window.__poSup = Store.db.suppliers[0].id; window.__poLead = Store.db.suppliers[0].leadTime; }
    this._drawPOForm();
  },
  _drawPOForm() {
    const prev = document.getElementById('p_co') ? Issuer.read('p') : (window.__poIssuer || {});
    window.__poIssuer = prev;
    const sup = Store.supplier(window.__poSup) || Store.db.suppliers[0];
    const exp = todayStr(addDays(new Date(), sup.leadTime));
    const body = `
      <div class="form-grid">
        <div class="field"><label>発注番号</label><input class="inp" value="${Store.nextNo('PO')}" readonly></div>
        <div class="field"><label>発注日 *</label><input class="inp" type="date" id="p_date" value="${TODAY}"></div>
        <div class="field"><label>入荷予定日 *</label><input class="inp" type="date" id="p_exp" value="${exp}"><span class="hint">リードタイム ${sup.leadTime} 日から自動計算</span></div>
        <div class="field span3"><label>仕入先 *</label><select class="inp" onchange="Actions.chgPOSup(this.value)">
          ${Store.db.suppliers.map(s => `<option value="${s.id}"${window.__poSup === s.id ? ' selected' : ''}>${esc(s.code)} ${esc(s.name)}（LT ${s.leadTime}日）</option>`).join('')}</select></div>
      </div>

      <div class="hr"></div>
      <div class="hstack mb8"><b style="font-size:13px">${ico('factory', 14)} 発行元情報</b><span class="tiny muted">帳票の上部に印字されます（発行会社は必須）</span></div>
      ${Issuer.pickerHtml('p', prev, { docKind: 'purchase_order' })}
      <div class="hr"></div>
      <div class="hstack mb12"><b style="font-size:13px">発注明細</b><div class="sp"><button class="btn sm" onclick="Actions.addPOLine()">${ico('plus', 14)} 行を追加</button></div></div>
      <div class="table-wrap"><table class="line-tb" style="min-width:620px">
        <thead><tr><th style="width:40%">品目</th><th style="width:15%">数量</th><th style="width:18%">仕入単価</th><th style="width:18%">金額</th><th></th></tr></thead>
        <tbody>${window.__poLines.map((l, i) => `<tr>
          <td><select class="inp" onchange="Actions.updPOLine(${i},'itemId',this.value)">
            ${Store.db.items.map(x => `<option value="${x.id}"${l.itemId === x.id ? ' selected' : ''}>${esc(x.code)} ${esc(x.name)}（在庫 ${dec(x.stock)}／発注点 ${dec(x.reorderPoint)}）</option>`).join('')}
          </select></td>
          <td><input class="inp num" type="number" value="${l.qty}" oninput="Actions.updPOLine(${i},'qty',+this.value)"></td>
          <td><input class="inp num" type="number" value="${l.price}" oninput="Actions.updPOLine(${i},'price',+this.value)"></td>
          <td class="num" style="font-weight:700">${money(l.qty * l.price)}</td>
          <td class="right">${window.__poLines.length > 1 ? `<button class="btn xs danger" onclick="Actions.delPOLine(${i})">${ico('x', 13)}</button>` : ''}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="hr"></div>
      <div class="hstack" style="justify-content:flex-end;gap:22px">
        <span class="sm muted">小計 <b>${money(window.__poLines.reduce((a, l) => a + l.qty * l.price, 0))}</b></span>
        <span style="font-size:15px;font-weight:800">合計（税込）${money(Math.round(window.__poLines.reduce((a, l) => a + l.qty * l.price, 0) * 1.08))}</span>
      </div>
      <div class="field mt12"><label>備考</label><input class="inp" id="p_remarks" placeholder="納品方法・時間指定など"></div>`;
    UI.modal('発注登録', '発注番号は保存時に自動採番されます', body,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.savePO()">${ico('check', 15)} 発注する</button>`, 'wide');
  },
  chgPOSup(id) { window.__poSup = id; this._drawPOForm(); },
  addPOLine() { window.__poLines.push({ itemId: Store.db.items[0].id, qty: 1, price: Store.db.items[0].costPrice }); this._drawPOForm(); },
  delPOLine(i) { window.__poLines.splice(i, 1); this._drawPOForm(); },
  updPOLine(i, k, v) { window.__poLines[i][k] = v; if (k === 'itemId') window.__poLines[i].price = Store.item(v).costPrice; this._drawPOForm(); },
  savePO() {
    const lines = window.__poLines.filter(l => l.qty > 0);
    if (!lines.length) return UI.toast('明細を1行以上入力してください', 'err');
    const supId = window.__poSup;
    const issErr = Issuer.validate('p'); if (issErr) return UI.toast(issErr, 'err');
    const issuer = Issuer.stamp('p');
    const poNo = Store.nextNo('PO', document.getElementById('p_date').value);
    const exp = document.getElementById('p_exp').value;
    let sub = 0; const pid = uid();
    const pls = lines.map((l, i) => {
      const it = Store.item(l.itemId); const amt = l.qty * l.price; sub += amt;
      return { id: uid(), poId: pid, lineNo: i + 1, itemId: l.itemId, itemName: it.name, unit: it.unit,
        quantity: l.qty, unitPrice: l.price, taxRate: 8, amount: amt, receivedQty: 0, expectedDate: exp, notes: '' };
    });
    const tax = Math.round(sub * .08);
    Store.db.purchaseOrders.unshift({
      id: pid, poNo, supplierId: supId, supplierName: Store.supplier(supId).name,
      orderDate: document.getElementById('p_date').value, expectedDate: exp, status: 'ordered',
      companyId: issuer.companyId, branch1Id: issuer.branch1Id, branch2Id: issuer.branch2Id,
      subtotal: sub, tax, total: sub + tax, remarks: document.getElementById('p_remarks').value,
      createdBy: Auth.user ? Auth.user.id : null, createdAt: new Date().toISOString()
    });
    pls.forEach(l => Store.db.poLines.push(l));
    Store.save(); UI.closeModal(); App.renderNav(); App.repaint();
    UI.toast(`発注 ${poNo} を登録しました`, 'ok');
  },
  poDetail(id) {
    const p = Store.po(id); const lines = Store.poLines(p.id);
    UI.modal(`発注 ${p.poNo}`, `${p.supplierName} ／ 発注日 ${dJP(p.orderDate)}`, `
      <div class="grid g3 mb16">
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">発注金額</div><div class="k-v" style="font-size:20px">${money(p.total)}</div></div>
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">入荷予定日</div><div class="k-v" style="font-size:20px">${dJP(p.expectedDate)}</div><div class="k-f">${relDay(p.expectedDate)}</div></div>
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">発注残</div><div class="k-v" style="font-size:20px">${dec(Store.poRemaining(p))}</div><div class="k-f">${badge(p.status)}</div></div>
      </div>
      <div class="table-wrap"><table class="tb" style="min-width:600px">
        <thead><tr><th>No.</th><th>品名</th><th class="right">発注数</th><th class="right">入荷済</th><th class="right">残</th><th class="right">単価</th><th class="right">金額</th></tr></thead>
        <tbody>${lines.map(l => `<tr><td>${l.lineNo}</td><td class="strong">${esc(l.itemName)}</td>
          <td class="num">${dec(l.quantity)}</td><td class="num muted">${dec(l.receivedQty)}</td>
          <td class="num" style="font-weight:700">${dec(l.quantity - l.receivedQty)}</td>
          <td class="num">${money(l.unitPrice)}</td><td class="num">${money(l.amount)}</td></tr>`).join('')}</tbody>
      </table></div>`,
      `<button class="btn" onclick="UI.closeModal()">閉じる</button>
       ${Store.poRemaining(p) > 0 ? `<button class="btn primary" onclick="UI.closeModal();Actions.receiveForm('${p.id}')">${ico('inbox', 15)} 入荷処理</button>` : ''}`, 'wide');
  },

  /* ------------------------- 入荷処理（在庫加算） ------------------------- */
  receiveForm(poId) {
    if (poId) {
      const p = Store.po(poId);
      window.__rcPO = poId;
      window.__rcLines = Store.poLines(p.id).filter(l => l.receivedQty < l.quantity)
        .map(l => ({ poLineId: l.id, itemId: l.itemId, qty: l.quantity - l.receivedQty, cost: l.unitPrice, lot: '' }));
    } else {
      window.__rcPO = ''; window.__rcLines = [{ poLineId: null, itemId: Store.db.items[0].id, qty: 1, cost: Store.db.items[0].costPrice, lot: '' }];
    }
    this._drawReceiveForm();
  },
  _drawReceiveForm() {
    const prev = document.getElementById('r_co') ? Issuer.read('r') : (window.__rcIssuer || {});
    window.__rcIssuer = prev;
    const p = window.__rcPO ? Store.po(window.__rcPO) : null;
    const body = `
      <div class="form-grid">
        <div class="field"><label>入荷番号</label><input class="inp" value="${Store.nextNo('RC')}" readonly></div>
        <div class="field"><label>入荷日 *</label><input class="inp" type="date" id="r_date" value="${TODAY}"></div>
        <div class="field"><label>仕入先 *</label><select class="inp" id="r_sup" ${p ? 'disabled' : ''}>
          ${Store.db.suppliers.map(s => `<option value="${s.id}"${p && p.supplierId === s.id ? ' selected' : ''}>${esc(s.code)} ${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field span3"><label>対象発注</label><select class="inp" onchange="Actions.chgRcPO(this.value)">
          <option value="">発注に紐付けない（直接入荷）</option>
          ${Store.db.purchaseOrders.filter(x => Store.poRemaining(x) > 0).map(x => `<option value="${x.id}"${window.__rcPO === x.id ? ' selected' : ''}>${esc(x.poNo)} ／ ${esc(x.supplierName)} ／ 残 ${dec(Store.poRemaining(x))}</option>`).join('')}
        </select></div>
      </div>

      <div class="hr"></div>
      <div class="hstack mb8"><b style="font-size:13px">${ico('factory', 14)} 発行元情報</b><span class="tiny muted">帳票の上部に印字されます（発行会社は必須）</span></div>
      ${Issuer.pickerHtml('r', prev, { docKind: 'receipt_note' })}
      <div class="note green mt12">${ico('check', 15)} 確定すると、下記の数量が現在庫に<b>自動加算</b>され、入出庫履歴に「入荷」として記録されます。</div>
      <div class="hr"></div>
      <div class="hstack mb12"><b style="font-size:13px">入荷明細</b><div class="sp"><button class="btn sm" onclick="Actions.addRcLine()">${ico('plus', 14)} 行を追加</button></div></div>
      <div class="table-wrap"><table class="line-tb" style="min-width:640px">
        <thead><tr><th style="width:38%">品目</th><th style="width:14%">入荷数</th><th style="width:14%">仕入単価</th><th style="width:14%">ロット</th><th style="width:14%">現在庫→</th><th></th></tr></thead>
        <tbody>${window.__rcLines.map((l, i) => { const it = Store.item(l.itemId);
          return `<tr><td><select class="inp" onchange="Actions.updRcLine(${i},'itemId',this.value)">
            ${Store.db.items.map(x => `<option value="${x.id}"${l.itemId === x.id ? ' selected' : ''}>${esc(x.code)} ${esc(x.name)}</option>`).join('')}</select></td>
          <td><input class="inp num" type="number" value="${l.qty}" oninput="Actions.updRcLine(${i},'qty',+this.value)"></td>
          <td><input class="inp num" type="number" value="${l.cost}" oninput="Actions.updRcLine(${i},'cost',+this.value)"></td>
          <td><input class="inp" value="${esc(l.lot)}" placeholder="任意" oninput="Actions.updRcLine(${i},'lot',this.value)"></td>
          <td class="num sm">${dec(it.stock)} → <b style="color:var(--green-700)">${dec(it.stock + l.qty)}</b></td>
          <td class="right">${window.__rcLines.length > 1 ? `<button class="btn xs danger" onclick="Actions.delRcLine(${i})">${ico('x', 13)}</button>` : ''}</td></tr>`; }).join('')}</tbody>
      </table></div>
      <div class="hr"></div>
      <div class="hstack" style="justify-content:flex-end;gap:22px">
        <span class="sm muted">入荷金額 <b>${money(window.__rcLines.reduce((a, l) => a + l.qty * l.cost, 0))}</b></span>
      </div>
      <div class="field mt12"><label>備考</label><input class="inp" id="r_remarks"></div>`;
    UI.modal('入荷処理', '入荷確定で在庫に自動加算', body,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.saveReceipt()">${ico('check', 15)} 入荷を確定</button>`, 'wide');
  },
  chgRcPO(id) { window.__rcPO = id; if (id) this.receiveForm(id); else { window.__rcLines = [{ poLineId: null, itemId: Store.db.items[0].id, qty: 1, cost: Store.db.items[0].costPrice, lot: '' }]; this._drawReceiveForm(); } },
  addRcLine() { window.__rcLines.push({ poLineId: null, itemId: Store.db.items[0].id, qty: 1, cost: Store.db.items[0].costPrice, lot: '' }); this._drawReceiveForm(); },
  delRcLine(i) { window.__rcLines.splice(i, 1); this._drawReceiveForm(); },
  updRcLine(i, k, v) { window.__rcLines[i][k] = v; if (k === 'itemId') window.__rcLines[i].cost = Store.item(v).costPrice; this._drawReceiveForm(); },
  saveReceipt() {
    const lines = window.__rcLines.filter(l => l.qty > 0);
    if (!lines.length) return UI.toast('入荷数量を入力してください', 'err');
    const issErr = Issuer.validate('r'); if (issErr) return UI.toast(issErr, 'err');
    const issuer = Issuer.stamp('r');
    const poId = window.__rcPO || null;
    const supId = poId ? Store.po(poId).supplierId : document.getElementById('r_sup').value;
    const receiptNo = Store.nextNo('RC');
    const rid = uid();
    let sub = 0;
    const rls = lines.map(l => {
      const it = Store.item(l.itemId); const amt = l.qty * l.cost; sub += amt;
      return { id: uid(), receiptId: rid, poLineId: l.poLineId, itemId: l.itemId, itemName: it.name, quantity: l.qty, unitCost: l.cost, amount: amt, lotNo: l.lot, expiry: '' };
    });
    const tax = Math.round(sub * .08);
    Store.db.receipts.unshift({
      id: rid, receiptNo, poId, supplierId: supId, supplierName: Store.supplier(supId).name,
      receiptDate: document.getElementById('r_date').value, status: 'confirmed',
      companyId: issuer.companyId, branch1Id: issuer.branch1Id, branch2Id: issuer.branch2Id,
      subtotal: sub, tax, total: sub + tax, remarks: document.getElementById('r_remarks').value,
      receivedBy: Auth.user ? Auth.user.id : null, createdAt: new Date().toISOString()
    });
    /* 在庫加算 + 発注残更新 */
    rls.forEach(l => {
      Store.db.receiptLines.push(l);
      Store.applyStock(l.itemId, l.quantity, 'receipt', { table: 'receipts', id: rid, no: receiptNo, notes: '入荷確定' });
      if (l.poLineId) { const pl = Store.db.poLines.find(x => x.id === l.poLineId); if (pl) pl.receivedQty += l.quantity; }
    });
    /* 発注ステータス更新 */
    if (poId) {
      const p = Store.po(poId);
      const rem = Store.poRemaining(p);
      p.status = rem <= 0 ? 'received' : 'partial';
    }
    Store.save(); UI.closeModal(); App.renderNav(); App.repaint();
    UI.toast(`入荷 ${receiptNo} を確定し、在庫に加算しました`, 'ok');
  },
  receiptDetail(id) {
    const r = Store.db.receipts.find(x => x.id === id);
    const lines = Store.receiptLines(id);
    UI.modal(`入荷 ${r.receiptNo}`, `${r.supplierName} ／ ${dJP(r.receiptDate)}`, `
      <div class="table-wrap"><table class="tb" style="min-width:520px">
        <thead><tr><th>品名</th><th class="right">入荷数</th><th class="right">単価</th><th class="right">金額</th><th>ロット</th></tr></thead>
        <tbody>${lines.map(l => `<tr><td class="strong">${esc(l.itemName)}</td><td class="num">${dec(l.quantity)}</td>
          <td class="num">${money(l.unitCost)}</td><td class="num">${money(l.amount)}</td><td class="mono">${esc(l.lotNo || '—')}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3" class="right strong">合計（税込）</td><td class="num strong">${money(r.total)}</td><td></td></tr></tfoot>
      </table></div>`, `<button class="btn" onclick="UI.closeModal()">閉じる</button>`, 'wide');
  },

  /* ------------------------- 出荷 ------------------------- */
  shipFromOrderPick() {
    const backlog = Store.orderBacklog();
    if (!backlog.length) return UI.toast('出荷可能な受注残がありません', 'warn');
    const orders = [...new Set(backlog.map(r => r.orderId))];
    UI.modal('受注から出荷指示を作成', '未出荷の受注を選択してください', `
      <div class="vstack">${orders.map(oid => {
        const o = Store.order(oid); const rem = Store.orderRemaining(o);
        return `<button class="chip" style="justify-content:space-between;width:100%" onclick="UI.closeModal();Actions.newShipFromOrder('${oid}')">
          <span><b>${esc(o.orderNo)}</b> ${esc(o.customerName)}</span>
          <span class="hstack"><span class="badge ${o.dueDate < TODAY ? 'rose' : 'sky'}">${dJP(o.dueDate)}</span><span class="badge amber">残 ${dec(rem)}</span></span></button>`;
      }).join('')}</div>`, `<button class="btn" onclick="UI.closeModal()">閉じる</button>`, 'slim');
  },
  newShipFromOrder(orderId) {
    const o = Store.order(orderId);
    window.__shOrder = orderId;
    window.__shLines = Store.orderLines(orderId).filter(l => l.shippedQty < l.quantity)
      .map(l => ({ orderLineId: l.id, itemId: l.itemId, qty: l.quantity - l.shippedQty, lot: '' }));
    this._drawShipForm();
  },
  _drawShipForm() {
    const prev = document.getElementById('sh_co') ? Issuer.read('sh') : (window.__shIssuer || {});
    window.__shIssuer = prev;
    const o = Store.order(window.__shOrder);
    const c = Store.customer(o.customerId) || {};
    const body = `
      <div class="form-grid">
        <div class="field"><label>出荷番号</label><input class="inp" value="${Store.nextNo('SH')}" readonly></div>
        <div class="field"><label>出荷日 *</label><input class="inp" type="date" id="sh_date" value="${o.dueDate || TODAY}"></div>
        <div class="field"><label>運送会社</label><select class="inp" id="sh_carrier">
          <option>ヤマト運輸</option><option>佐川急便</option><option>福山通運</option><option>西濃運輸</option><option>自社配送</option><option>その他</option></select></div>
        <div class="field span3"><label>出荷先</label><input class="inp" id="sh_to" value="${esc(c.name || '')} ${esc(c.address || '')}"></div>
      </div>

      <div class="hr"></div>
      <div class="hstack mb8"><b style="font-size:13px">${ico('factory', 14)} 発行元情報</b><span class="tiny muted">帳票の上部に印字されます（発行会社は必須）</span></div>
      ${Issuer.pickerHtml('sh', prev, { docKind: 'delivery_note' })}
      <div class="note mt12">${ico('truck', 15)} 出荷指示を作成後、「出荷確定」で在庫から<b>自動減算</b>されます。</div>
      <div class="hr"></div>
      <div class="table-wrap"><table class="line-tb" style="min-width:600px">
        <thead><tr><th style="width:44%">品名</th><th style="width:18%">出荷数</th><th style="width:18%">ロット</th><th style="width:20%">現在庫</th></tr></thead>
        <tbody>${window.__shLines.map((l, i) => { const it = Store.item(l.itemId); const ok = it.stock >= l.qty;
          return `<tr><td><b>${esc(it.name)}</b><div class="tiny muted">${esc(it.location || '')}</div></td>
          <td><input class="inp num" type="number" value="${l.qty}" oninput="Actions.updShLine(${i},'qty',+this.value)"></td>
          <td><input class="inp" value="${esc(l.lot)}" oninput="Actions.updShLine(${i},'lot',this.value)"></td>
          <td class="num" style="color:${ok ? 'inherit' : 'var(--rose-600)'};font-weight:700">${dec(it.stock)}${ok ? '' : ' ⚠不足'}</td></tr>`; }).join('')}</tbody>
      </table></div>
      <div class="field mt12"><label>備考</label><input class="inp" id="sh_remarks"></div>`;
    UI.modal('出荷指示の作成', `受注 ${o.orderNo} ／ ${o.customerName}`, body,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.saveShipment()">${ico('check', 15)} 出荷指示を作成</button>`, 'wide');
  },
  updShLine(i, k, v) { window.__shLines[i][k] = v; this._drawShipForm(); },
  saveShipment() {
    const lines = window.__shLines.filter(l => l.qty > 0);
    if (!lines.length) return UI.toast('出荷数量を入力してください', 'err');
    const o = Store.order(window.__shOrder);
    const issErr = Issuer.validate('sh'); if (issErr) return UI.toast(issErr, 'err');
    const issuer = Issuer.stamp('sh');
    const sid = uid();
    const shipNo = Store.nextNo('SH', document.getElementById('sh_date').value);
    Store.db.shipments.unshift({
      id: sid, shipmentNo: shipNo, orderId: o.id, orderNo: o.orderNo, customerId: o.customerId, customerName: o.customerName,
      shipDate: document.getElementById('sh_date').value, status: 'instructed',
      companyId: issuer.companyId, branch1Id: issuer.branch1Id, branch2Id: issuer.branch2Id,
      carrier: document.getElementById('sh_carrier').value, trackingNo: '',
      shipToName: document.getElementById('sh_to').value, shipToAddr: (Store.customer(o.customerId) || {}).address || '',
      remarks: document.getElementById('sh_remarks').value, confirmedAt: null,
      createdBy: Auth.user ? Auth.user.id : null, createdAt: new Date().toISOString()
    });
    lines.forEach(l => Store.db.shipmentLines.push({
      id: uid(), shipmentId: sid, orderLineId: l.orderLineId, itemId: l.itemId,
      itemName: Store.item(l.itemId).name, unit: Store.item(l.itemId).unit, quantity: l.qty, lotNo: l.lot, notes: ''
    }));
    if (o.status === 'received') o.status = 'instructed';
    Store.save(); UI.closeModal(); App.renderNav(); App.repaint();
    UI.toast(`出荷指示 ${shipNo} を作成しました`, 'ok');
  },
  openShipment(id) {
    const s = Store.shipment(id);
    const lines = Store.shipLines(id);
    const qty = lines.reduce((a, l) => a + l.quantity, 0);
    UI.modal(`出荷 ${s.shipmentNo}`, `${s.customerName} ／ ${dJP(s.shipDate)}`, `
      <div class="grid g3 mb16">
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">状態</div><div class="k-v" style="font-size:19px">${s.status === 'confirmed' ? '確定済' : '指示済'}</div><div class="k-f">${s.confirmedAt ? dtJP(s.confirmedAt) + ' 確定' : '未確定'}</div></div>
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">合計数量</div><div class="k-v" style="font-size:19px">${num(qty)} 点</div><div class="k-f">${lines.length} 明細</div></div>
        <div class="kpi" style="padding:11px 13px"><div class="k-lb">運送／追跡</div><div class="k-v" style="font-size:15px">${esc(s.carrier || '—')}</div><div class="k-f">${esc(s.trackingNo || '未設定')}</div></div>
      </div>
      <div class="table-wrap"><table class="tb" style="min-width:600px">
        <thead><tr><th>品名</th><th class="right">数量</th><th>ロット</th><th class="right">現在庫</th></tr></thead>
        <tbody>${lines.map(l => { const it = Store.item(l.itemId) || {}; return `<tr><td class="strong">${esc(l.itemName)}<div class="tiny muted">${esc(it.location || '')}</div></td>
          <td class="num">${dec(l.quantity)} <span class="tiny muted">${esc(it.unit || '')}</span></td>
          <td class="mono">${esc(l.lotNo || '—')}</td><td class="num">${dec(it.stock)}</td></tr>`; }).join('')}</tbody>
      </table></div>
      <div class="hr"></div>
      <div class="hstack">
        <span class="sm muted">出荷先：${esc(s.shipToName || s.customerName)}</span>
        <span class="sp"></span>
        ${s.status === 'confirmed' ? `<button class="btn" onclick="Print.delivery('${s.id}')">${ico('print', 14)} 納品書</button>
          <button class="btn" onclick="Print.slip('${s.id}')">${ico('print', 14)} 出荷伝票</button>
          <button class="btn primary" onclick="Print.picking('${s.id}')">${ico('print', 14)} ピッキングリスト</button>` : ''}
      </div>`,
      `${s.status === 'instructed' ? `<button class="btn" onclick="UI.closeModal()">閉じる</button>
        <button class="btn primary" onclick="UI.closeModal();Actions.confirmShipment('${s.id}')">${ico('check', 15)} 出荷を確定する</button>` : `<button class="btn" onclick="UI.closeModal()">閉じる</button>`}`, 'wide');
  },
  confirmShipment(id) {
    const s = Store.shipment(id);
    if (s.status === 'confirmed') return UI.toast('この出荷はすでに確定済みです', 'warn');
    const lines = Store.shipLines(id);
    const short = lines.filter(l => { const it = Store.item(l.itemId); return it && it.stock < l.quantity; });
    const msg = `出荷 ${s.shipmentNo} を確定します。在庫から ${lines.reduce((a, l) => a + l.quantity, 0)} 点が自動減算され、受注残が更新されます。`
      + (short.length ? `\n※ 在庫不足の明細が ${short.length} 件あります（在庫がマイナスになる可能性があります）。` : '');
    UI.confirm('出荷確定', msg, () => {
      s.status = 'confirmed'; s.confirmedAt = new Date().toISOString();
      if (!s.trackingNo) s.trackingNo = 'TRK' + Math.floor(100000 + Math.random() * 899999);
      /* 在庫減算 + 受注残更新 */
      lines.forEach(l => {
        Store.applyStock(l.itemId, -l.quantity, 'shipment', { table: 'shipments', id: s.id, no: s.shipmentNo, notes: '出荷確定' });
        if (l.orderLineId) { const ol = Store.db.orderLines.find(x => x.id === l.orderLineId); if (ol) ol.shippedQty += l.quantity; }
      });
      if (s.orderId) {
        const o = Store.order(s.orderId);
        o.status = Store.orderRemaining(o) <= 0 ? 'shipped' : 'partial';
      }
      Store.save(); App.renderNav(); App.repaint();
      UI.toast(`出荷 ${s.shipmentNo} を確定し、在庫を減算しました`, 'ok');
      setTimeout(() => {
        UI.confirm('帳票を発行しますか？', '納品書・出荷伝票・ピッキングリストを発行できます。', () => {
          Print.delivery(s.id);
        }, '納品書を発行', 'primary');
      }, 400);
    }, '出荷を確定する', 'primary');
  },
  docPick(shipmentId) {
    const s = Store.shipment(shipmentId);
    UI.modal('帳票を選択', `${s.shipmentNo} ／ ${s.customerName}`, `
      <div class="vstack">
        <button class="chip" style="justify-content:flex-start;padding:14px" onclick="UI.closeModal();Print.delivery('${s.id}')">${ico('file', 18)} <span style="text-align:left"><b>納品書</b><div class="tiny muted">DN-YYYYMMDD-0001／金額入り・受領印欄あり</div></span></button>
        <button class="chip" style="justify-content:flex-start;padding:14px" onclick="UI.closeModal();Print.slip('${s.id}')">${ico('clipboard', 18)} <span style="text-align:left"><b>出荷伝票</b><div class="tiny muted">SL-YYYYMMDD-0001／バーコード・QR欄あり</div></span></button>
        <button class="chip" style="justify-content:flex-start;padding:14px" onclick="UI.closeModal();Print.picking('${s.id}')">${ico('check', 18)} <span style="text-align:left"><b>ピッキングリスト</b><div class="tiny muted">PL-YYYYMMDD-0001／保管場所順・チェック欄あり</div></span></button>
      </div>`, `<button class="btn" onclick="UI.closeModal()">閉じる</button>`, 'slim');
  },

  /* ------------------------- ユーザー管理（ID・パスワード認証） ------------------------- */
  /* ------------------------- 組織マスタ（システム管理者のみ） ------------------------- */
  organizationForm(id) {
    if (!Tenant.isSystemAdmin()) return UI.toast('組織マスタはシステム管理者のみ操作できます', 'err');
    const o = id ? Tenant.org(id) : null;
    UI.modal(o ? '組織を編集' : '組織を登録', o ? o.organizationCode : 'テナント（組織）を追加します', `
      <div class="form-grid c2">
        <div class="field"><label>組織コード *</label><input class="inp" id="o_code" value="${esc(o ? o.organizationCode : '')}" placeholder="例：C-FARM"></div>
        <div class="field"><label>組織名 *</label><input class="inp" id="o_name" value="${esc(o ? o.organizationName : '')}" placeholder="例：Ｃファーム"></div>
        <div class="field"><label>状態</label><select class="inp" id="o_active">
          <option value="1"${!o || o.isActive !== false ? ' selected' : ''}>有効</option>
          <option value="0"${o && o.isActive === false ? ' selected' : ''}>停止</option></select></div>
      </div>
      <div class="note mt12">${ico('shield', 15)} 組織を追加すると、その組織専用の会社・拠点・得意先・伝票を登録できます。他組織のデータは参照できません。</div>`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.saveOrganization('${id || ''}')">${ico('check', 15)} 保存</button>`);
  },
  saveOrganization(id) {
    if (!Tenant.isSystemAdmin()) return UI.toast('組織マスタはシステム管理者のみ操作できます', 'err');
    const g = n => (document.getElementById(n) || {}).value || '';
    const code = g('o_code').trim(), name = g('o_name').trim();
    if (!code || !name) return UI.toast('組織コードと組織名は必須です', 'err');
    if ((Store.db.organizations || []).some(o => String(o.organizationCode).toUpperCase() === code.toUpperCase() && String(o.id) !== String(id)))
      return UI.toast('同じ組織コードが既に登録されています', 'err');
    const now = new Date().toISOString();
    if (id) {
      const o = Tenant.org(id);
      Object.assign(o, { organizationCode: code, organizationName: name, isActive: g('o_active') !== '0', updatedAt: now });
      UI.toast(`組織「${name}」を更新しました`, 'ok');
    } else {
      const next = (Store.db.organizations || []).reduce((m, o) => Math.max(m, Number(o.id) || 0), 0) + 1;
      Store.db.organizations.push({ id: next, organizationCode: code, organizationName: name, isActive: g('o_active') !== '0', createdAt: now, updatedAt: now });
      UI.toast(`組織「${name}」を登録しました（ID ${next}）`, 'ok');
    }
    Store.save(); UI.closeModal(); App.repaint();
  },
  toggleOrganization(id) {
    if (!Tenant.isSystemAdmin()) return UI.toast('組織マスタはシステム管理者のみ操作できます', 'err');
    const o = Tenant.org(id); if (!o) return;
    if (Number(o.id) === Tenant.id()) return UI.toast('ログイン中の組織は停止できません', 'err');
    if (o.isActive !== false && (Store.db.organizations || []).filter(x => x.isActive !== false).length <= 1)
      return UI.toast('有効な組織が1つのため停止できません', 'err');
    o.isActive = o.isActive === false; o.updatedAt = new Date().toISOString();
    Store.save(); App.repaint();
    UI.toast(`組織「${o.organizationName}」を${o.isActive ? '有効化' : '停止'}しました`, 'ok');
  },

  userForm(id) {
    const u = id ? Store.user(id) : null;
    UI.modal(u ? 'ユーザー編集' : 'ユーザー登録', u ? `ログインID ${u.loginId}` : '初期パスワード Temp1234! で登録します（初回ログイン時に変更必須）', `
      <div class="form-grid c2">
        <div class="field"><label>ユーザーID *</label><input class="inp" id="u_login" value="${esc(u ? u.loginId : '')}" placeholder="例：shipping2"></div>
        <div class="field"><label>氏名 *</label><input class="inp" id="u_name" value="${esc(u ? u.name : '')}"></div>
        <div class="field"><label>メールアドレス</label><input class="inp" id="u_mail" value="${esc(u ? u.email : '')}"></div>
        <div class="field"><label>電話番号</label><input class="inp" id="u_tel" value="${esc(u ? u.tel || '' : '')}"></div>
        <div class="field"><label>所属組織 *</label><select class="inp" id="u_org"${Tenant.isSystemAdmin() ? '' : ' disabled'}>
          ${(Tenant.all()).map(o => `<option value="${esc(o.id)}"${Number(u ? (u.organizationId || 1) : Tenant.id()) === Number(o.id) ? ' selected' : ''}>${esc(o.organizationName)}（${esc(o.organizationCode)}）</option>`).join('')}</select></div>
        <div class="field"><label>ロール *</label><select class="inp" id="u_role">
          ${Object.entries(ROLES).map(([k, r]) => `<option value="${k}"${u && u.role === k ? ' selected' : ''}>${r.label} — ${r.desc}</option>`).join('')}</select></div>
        <div class="field"><label>有効／無効</label><select class="inp" id="u_enabled">
          <option value="1"${!u || u.enabled ? ' selected' : ''}>有効</option>
          <option value="0"${u && !u.enabled ? ' selected' : ''}>無効</option></select></div>
      </div>
      ${u ? '' : `<div class="note green mt12">${ico('check', 15)} 新規ユーザーの初期パスワードは <b>Temp1234!</b> です。初回ログイン時にパスワード変更が必須になります。</div>`}`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.saveUser('${id || ''}')">${ico('check', 15)} 保存</button>`);
  },
  saveUser(id) {
    const g = n => (document.getElementById(n) || {}).value || '';
    const loginId = g('u_login').trim(), name = g('u_name').trim(), role = g('u_role');
    if (!loginId || !name) return UI.toast('ユーザーIDと氏名は必須です', 'err');
    if (!/^[A-Za-z0-9._-]+$/.test(loginId)) return UI.toast('ユーザーIDは半角英数字と . _ - のみ使用できます', 'err');
    if (Store.db.users.some(x => String(x.loginId).toLowerCase() === loginId.toLowerCase() && x.id !== id)) return UI.toast('そのユーザーIDは既に使われています', 'err');
    const enabled = g('u_enabled') !== '0';
    /* マルチテナント: 所属組織。システム管理者以外は自組織に固定（他組織へは作成不可） */
    const orgId = Tenant.isSystemAdmin() && g('u_org') ? Number(g('u_org')) : Tenant.id();
    if (!Tenant.all().some(o => Number(o.id) === orgId)) return UI.toast('所属組織が不正です', 'err');
    if (id) {
      const u = Store.user(id);
      /* 最後の有効管理者のロール変更・無効化は不可 */
      if (u.role === 'admin' && u.enabled && (!enabled || role !== 'admin')
        && !Store.db.users.some(x => x.id !== id && x.role === 'admin' && x.enabled))
        return UI.toast('有効な管理者がいなくなるため変更できません', 'err');
      Object.assign(u, { loginId, name, email: g('u_mail'), tel: g('u_tel'), role, enabled, organizationId: orgId, updatedAt: new Date().toISOString() });
      UI.toast(`ユーザー ${loginId} を更新しました`, 'ok');
    } else {
      Store.db.users.push({
        id: uid(), loginId, name, email: g('u_mail'), tel: g('u_tel'), role, organizationId: orgId,
        forcePasswordChange: true, enabled: true,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      });
      if (typeof SB !== 'undefined' && SB.ready) {
        SB.setPassword(loginId, Security.TEMP, true);   /* サーバー側でbcrypt化・初回変更必須 */
      } else {
        Store.db.users[Store.db.users.length - 1].passwordHash = TEMP_PASSWORD_HASH;
      }
      UI.toast(`ユーザー ${loginId} を登録しました（初期パスワード Temp1234!）`, 'ok');
    }
    Store.save(); UI.closeModal(); App.renderNav(); App.repaint();
  },
  /* パスワード変更（管理者が任意のユーザーのパスワードを変更） */
  userPasswordForm(id) {
    const u = Store.user(id);
    if (!u) return;
    UI.modal('パスワード変更', `${u.name}（${u.loginId}）のパスワードを変更します`, `
      <div class="field"><label>新しいパスワード *</label><input class="inp" type="password" id="up_pw" autocomplete="new-password" oninput="Auth.updatePwMeter('up', this.value)">${Auth.pwMeterHtml('up')}</div>
      <div class="field mt12"><label>新しいパスワード（確認） *</label><input class="inp" type="password" id="up_pw2" autocomplete="new-password"></div>
      <div class="note amber mt12">強度基準：8文字以上・大文字／小文字／数字／記号をすべて含める</div>`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.saveUserPassword('${id}')">${ico('check', 15)} 変更する</button>`, 'slim');
  },
  async saveUserPassword(id) {
    const u = Store.user(id);
    if (!u) return;
    const g = n => (document.getElementById(n) || {}).value || '';
    if (g('up_pw') !== g('up_pw2')) return UI.toast('パスワードが確認入力と一致しません', 'err');
    const issues = Security.pwIssues(g('up_pw'));
    if (issues.length) return UI.toast('強度基準を満たしていません：' + issues.join('・'), 'err');
    if (typeof SB !== 'undefined' && SB.ready) {
      const r = await SB.setPassword(u.loginId, g('up_pw'), false);
      if (!r.ok) { UI.toast(r.message || 'パスワードを変更できませんでした', 'err'); return; }
    } else {
      u.passwordHash = await Security.hashPassword(g('up_pw'));
    }
    u.forcePasswordChange = false;
    u.updatedAt = new Date().toISOString();
    delete Store.db.loginSecurity[String(u.loginId).toLowerCase()];
    Store.save(); UI.closeModal(); App.repaint();
    UI.toast(`${u.name} のパスワードを変更しました`, 'ok');
  },
  /* 初期パスワード再発行（Temp1234! に戻し、初回ログイン扱いにする） */
  reissueUserPassword(id) {
    const u = Store.user(id);
    if (!u) return;
    UI.confirm('初期パスワード再発行', `${u.name}（${u.loginId}）のパスワードを初期パスワード Temp1234! に戻します。次回ログイン時にパスワード変更が必須になります。`, () => {
      if (typeof SB !== 'undefined' && SB.ready) SB.setPassword(u.loginId, Security.TEMP, true);
      else u.passwordHash = TEMP_PASSWORD_HASH;
      u.forcePasswordChange = true;
      u.updatedAt = new Date().toISOString();
      delete Store.db.loginSecurity[String(u.loginId).toLowerCase()];
      Store.save(); App.repaint();
      UI.toast(`${u.name} のパスワードを再発行しました（Temp1234!）`, 'ok');
    }, '再発行する');
  },
  /* パスワードリセット（管理者専用）：ランダムな仮パスワードを発行し、次回ログイン時に変更を必須化する */
  resetUserPassword(id) {
    if (!Auth.user || Auth.user.role !== 'admin') return UI.toast('この操作は管理者のみ利用できます', 'err');
    const u = Store.user(id);
    if (!u) return;
    UI.modal('パスワードリセット', '', `<div class="note amber" style="white-space:pre-line">ユーザー：${esc(u.name)}（${esc(u.loginId)}）
仮パスワードを発行します。
続行しますか？</div>`,
      `<button class="btn" onclick="UI.closeModal()">キャンセル</button><button class="btn primary" onclick="Actions.doResetUserPassword('${u.id}')">実行</button>`, 'slim');
  },
  async doResetUserPassword(id) {
    if (!Auth.user || Auth.user.role !== 'admin') return UI.toast('この操作は管理者のみ利用できます', 'err');
    const u = Store.user(id);
    if (!u) return;
    const temp = Security.genTempPassword();
    let ip = null;
    if (typeof SB !== 'undefined' && SB.ready) {
      /* 既存RPC app_set_password（p_login_id / p_new / p_force_change=true）を呼び出し、戻り値を確認 */
      const [r, gotIp] = await Promise.all([SB.setPassword(u.loginId, temp, true), Audit.fetchIp()]);
      if (!r || !r.ok) { UI.toast((r && r.message) || 'パスワードをリセットできませんでした', 'err'); return; }
      ip = gotIp;
    } else {
      /* Supabase未接続時の暫定動作（セッション内のみ） */
      ip = await Audit.fetchIp();
      u.passwordHash = await Security.hashPassword(temp);
    }
    u.forcePasswordChange = true;
    u.updatedAt = new Date().toISOString();
    delete Store.db.loginSecurity[String(u.loginId).toLowerCase()];
    Audit.add('password_reset', u, ip);   /* 監査ログ（仮パスワード自体は記録しない） */
    Store.save(); App.repaint();
    UI.modal('パスワードをリセットしました', '', `
      <div class="note green">${ico('check', 15)} パスワードをリセットしました。</div>
      <div class="field mt12"><label>ログインID</label><div class="mono strong">${esc(u.loginId)}</div></div>
      <div class="field mt12"><label>仮パスワード</label>
        <div class="hstack" style="gap:8px"><input class="inp mono" id="tmpPw" readonly value="${esc(temp)}" style="max-width:240px" onclick="this.select()"><button class="btn" onclick="Actions.copyTempPw()">${ico('clipboard', 14)} コピー</button></div></div>
      <div class="note amber mt12">次回ログイン時にパスワード変更が必要です。仮パスワードはこの画面を閉じると再表示できませんので、コピーして対象ユーザーへ安全に伝えてください。</div>`,
      `<button class="btn primary" onclick="UI.closeModal()">閉じる</button>`, 'slim');
  },
  copyTempPw() {
    const el = document.getElementById('tmpPw');
    if (!el) return;
    UI.copyText(el.value, '仮パスワードをコピーしました');
  },
  /* 有効／無効切替 */
  toggleUserEnabled(id) {
    const u = Store.user(id);
    if (!u) return;
    if (Auth.user && u.id === Auth.user.id) return UI.toast('自分のアカウントは無効化できません', 'err');
    if (u.enabled && u.role === 'admin' && !Store.db.users.some(x => x.id !== id && x.role === 'admin' && x.enabled))
      return UI.toast('有効な管理者がいなくなるため無効化できません', 'err');
    UI.confirm(u.enabled ? 'ユーザーの無効化' : 'ユーザーの有効化',
      `${u.name}（${u.loginId}）を${u.enabled ? '無効化します。無効化されたユーザーはログインできなくなります' : '有効化します'}。`, () => {
      u.enabled = !u.enabled;
      u.updatedAt = new Date().toISOString();
      if (!u.enabled) delete Store.db.loginSecurity[String(u.loginId).toLowerCase()];
      Store.save(); App.repaint();
      UI.toast(`${u.name} を${u.enabled ? '有効化' : '無効化'}しました`, u.enabled ? 'ok' : 'warn');
    });
  },
  /* ユーザー削除 */
  deleteUser(id) {
    const u = Store.user(id);
    if (!u) return;
    if (Auth.user && u.id === Auth.user.id) return UI.toast('自分のアカウントは削除できません', 'err');
    if (u.role === 'admin' && u.enabled && !Store.db.users.some(x => x.id !== id && x.role === 'admin' && x.enabled))
      return UI.toast('有効な管理者がいなくなるため削除できません', 'err');
    UI.confirm('ユーザー削除', `${u.name}（${u.loginId}）を削除します。よろしいですか？`, () => {
      Store.db.users = Store.db.users.filter(x => x.id !== id);
      Store.save(); App.repaint(); UI.toast('削除しました', 'ok');
    }, '削除する', 'danger');
  },

  /* ------------------------- 設定・エクスポート ------------------------- */
  /* 緊急管理者ログインの有効／無効（管理者のみ） */
  saveEmergencyAdmin() {
    if (!Auth.user || Auth.user.role !== 'admin') return UI.toast('この操作は管理者のみ利用できます', 'err');
    const el = document.getElementById('emgEnabled');
    const on = !!(el && el.checked);
    if (!EMERGENCY.setEnabled(on)) return UI.toast('設定を保存できませんでした（データ未初期化）', 'err');
    if (!on && Auth.isEmergency()) {
      UI.toast('緊急管理者ログインを無効化しました。次回ログインから適用されます', 'warn');
    } else {
      UI.toast(on ? '緊急管理者ログインを有効化しました' : '緊急管理者ログインを無効化しました', on ? 'ok' : 'warn');
    }
    App.repaint();
  },
  /* 単一会社設定は廃止。会社・拠点マスタ（複数会社）へ誘導する */
  saveCompany() {
    UI.toast('発行元は「会社・拠点マスタ」で管理します', 'warn');
    App.go('companies');
  },
  exportJSON() {
    const blob = new Blob([JSON.stringify(Store.db, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `agri-erp-backup-${TODAY}.json`;
    a.click(); URL.revokeObjectURL(a.href);
    UI.toast('データを書き出しました', 'ok');
  },
  exportCSV() {
    const head = ['コード', '区分', '品名', 'カテゴリ', '規格', '単位', '現在庫', '発注点', '安全在庫', '販売単価', '仕入単価', '保管場所'];
    const rows = Store.db.items.map(i => [i.code, i.kind === 'product' ? '商品' : '資材', i.name, i.category, i.spec, i.unit, i.stock, i.reorderPoint, i.safetyStock, i.salePrice, i.costPrice, i.location]);
    const csv = '\uFEFF' + [head, ...rows].map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `agri-erp-inventory-${TODAY}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
    UI.toast('在庫CSVを書き出しました（Excelで開けます）', 'ok');
  },
  exportShipCSV() { shipExportCsv(); },
  resetData() {
    UI.confirm('データの初期化', 'すべてのデータをデモ初期状態に戻します。この操作は取り消せません。', () => {
      Store.reset(); App.renderNav(); App.go('dashboard'); UI.toast('デモデータを初期化しました', 'ok');
    }, '初期化する', 'danger');
  }
};

/* ------------------------------ 起動 ------------------------------
   手順: 1) Supabase接続（失敗しても停止しない） 2) データ初期化 3) ログイン画面の初期化
   Supabase に接続できない場合は「オフラインモード」（このセッション内のみ保持）で起動し、
   ログイン画面をクラッシュさせない。緊急管理者ログインは接続状態に依らず利用できる。 */
(async function boot() {
  const $ = id => document.getElementById(id);
  const err = $('loginErr');
  const warn = $('sbWarn');
  /* 1) Supabase 接続（接続情報はアプリ内部固定・FIXED_URL / FIXED_KEY） */
  let sb = { ok: false, message: '' };
  try {
    sb = await SB.init();
  } catch (e) {
    sb = { ok: false, message: 'Supabaseに接続できませんでした：' + String((e && e.message) || e).slice(0, 160) };
  }
  /* 2) データ初期化（接続可否に関わらず必ず実行し、Store.db を null にしない） */
  try {
    Store.load({ offline: !sb.ok });
    Store.migrateIssuerMasters();
  } catch (e) {
    console.error('data init failed', e);
    if (err) { err.textContent = 'データの初期化に失敗しました：' + String((e && e.message) || e).slice(0, 160); err.style.display = 'block'; }
  }
  /* 3) 接続失敗は警告として表示（ログインは継続できる） */
  if (!sb.ok) {
    const msg = (sb.message || 'Supabaseに接続できませんでした') + '／オフラインモードで起動しています（データはこのセッション内のみ保持されます）';
    if (warn) { warn.textContent = msg; warn.style.display = 'block'; }
    const off = $('offBar');
    if (off) off.style.display = 'flex';
    console.warn('[boot]', msg);
  }
  try {
    Auth.init();
    /* セッション復元（ページ再読み込み後もログイン状態を維持） */
    const restored = Auth.restore();
    if (restored) Auth.enterApp(restored);
  } catch (e) {
    console.error('auth init failed', e);
    if (err) { err.textContent = 'ログイン画面の初期化に失敗しました：' + String((e && e.message) || e).slice(0, 160); err.style.display = 'block'; }
  }
  window.addEventListener('resize', () => { if (window.innerWidth > 1024) UI.closeSidebar(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') UI.closeModal(); });
})();
