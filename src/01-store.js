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
const SEED_USERS = [
  ['usr001', 'admin',    '山田 太郎', 'admin@agri-erp.local',    '090-1111-2222', 'admin',    TEMP_PASSWORD_HASH],
  ['usr002', 'office',   '佐藤 花子', 'office@agri-erp.local',   '090-3333-4444', 'office',   TEMP_HASH_OFFICE],
  ['usr003', 'shipping', '鈴木 一郎', 'shipping@agri-erp.local', '090-5555-6666', 'shipping', TEMP_HASH_SHIPPING],
  /* 営業担当（得意先担当）: 権限は事務担当。検索条件の「営業担当者」に使用 */
  ['usr004', 'sales1',   '田中 健二', 'sales1@agri-erp.local',   '090-7777-8888', 'office',   TEMP_HASH_OFFICE],
  ['usr005', 'sales2',   '中村 美咲', 'sales2@agri-erp.local',   '090-9999-0000', 'office',   TEMP_HASH_OFFICE]
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
  SEED_USERS.forEach(a => db.users.push({
    id: a[0], loginId: a[1], name: a[2], email: a[3], tel: a[4], role: a[5],
    passwordHash: a[6], forcePasswordChange: true, enabled: true, createdAt: nowIso, updatedAt: nowIso
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
  syncSeq(db.receipts, 'receiptNo'); syncSeq(db.shipments, 'shipmentNo');
  return db;
}

/* ------------------------------ Store ------------------------------ */
const Store = {
  db: null,
  /* Store.db が用意できているか（未初期化時に例外を出さないための判定） */
  isReady() { return !!(this.db && typeof this.db === 'object'); },
  /* opt.offline=true のときは Supabase へ書き戻さない（接続不可時のセッション内動作） */
  load(opt) {
    opt = opt || {};
    /* Supabase版: SB.init() が Store.db を設定済み。未設定時のみデモシードを生成 */
    if (this.db) { this.migrateIssuerMasters(); return this.db; }
    this.db = buildSeed();
    this.migrateIssuerMasters();
    this.offline = !!opt.offline;
    if (!opt.offline && typeof SB !== 'undefined' && SB.ready) SB.requestSync();
    return this.db;
  },
  /* 旧バージョン（単一会社設定 settings.company）→ 会社マスタ（companies）への自動移行。
     会社マスタが空のときだけ実行し、既存伝票の表示内容には影響しない。
     帳票テンプレートが未登録のときは標準テンプレートを投入する。 */
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
    const key = prefix + '-' + d;
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
