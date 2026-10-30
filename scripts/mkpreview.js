const fs=require('fs'); const {JSDOM}=require('jsdom');
const html=fs.readFileSync('/home/user/workspace/agri/agri-erp-supabase/build/agri-erp.html','utf8');
const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://example.test/'}); const w=dom.window,d=w.document;
w.print=()=>{}; w.fetch=()=>Promise.reject(new Error('x'));
const m=html.match(/<script>\n([\s\S]*?)\n<\/script>/);
w.eval(m[1]+'\n;window.__T={Store,Print,Issuer,buildSeed};');
const T=w.__T; T.Store.db=T.buildSeed(); T.Store.migrateIssuerMasters();
const o=T.Store.order('ord002'); o.companyId='co002'; o.branch1Id='br002'; o.branch2Id='br003';
T.Print.quote('ord002');
const sheet=d.getElementById('printRoot').innerHTML;
const style=(html.match(/<style>([\s\S]*?)<\/style>/)||[])[1]||'';
fs.writeFileSync('/home/user/workspace/agri/preview-quote.html',
 '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><style>'+style+'body{background:#e5e7eb;padding:20px}#printRoot{display:block!important}.sheet{margin:0 auto;box-shadow:0 8px 30px rgba(0,0,0,.2)}</style></head><body>'+sheet+'</body></html>');
console.log('preview written, sheet length', sheet.length);
