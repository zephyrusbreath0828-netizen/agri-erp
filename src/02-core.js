/* ==========================================================================
   アグリERP — 認証・権限・UI 基盤・ルーティング
   ========================================================================== */
const ROLES = {
  admin:    { label: '管理者',   desc: 'すべての機能を利用できます', color: 'green',  icon: 'shield', av: 'linear-gradient(140deg,#34d399,#0ea5e9)' },
  office:   { label: '事務担当', desc: '受注・発注・在庫・帳票を担当', color: 'sky',    icon: 'clipboard', av: 'linear-gradient(140deg,#38bdf8,#8b5cf6)' },
  shipping: { label: '出荷担当', desc: '出荷指示・確定・帳票印刷を担当', color: 'amber',  icon: 'truck', av: 'linear-gradient(140deg,#fbbf24,#f97316)' }
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
      emergency: true, createdAt: now, updatedAt: now
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
    for (const g of MENU) { const it = g.items.find(x => x.id === id); if (it) return it.roles.includes(r); }
    return true;
  }
};
