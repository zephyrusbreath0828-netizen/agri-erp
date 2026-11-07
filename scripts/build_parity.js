/* build/assemble.py と build/assemble.js が同一の HTML を生成することを検証 */
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'build', 'agri-erp.html');
const env = Object.assign({}, process.env);
delete env.NEXT_PUBLIC_SUPABASE_URL; delete env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
delete env.SUPABASE_URL; delete env.SUPABASE_ANON_KEY;

execFileSync('python3', [path.join(ROOT, 'build', 'assemble.py')], { cwd: ROOT, env, stdio: 'pipe' });
const py = fs.readFileSync(OUT, 'utf8');
execFileSync('node', [path.join(ROOT, 'build', 'assemble.js')], { cwd: ROOT, env, stdio: 'pipe' });
const js = fs.readFileSync(OUT, 'utf8');

if (py !== js) {
  console.error('PARITY FAILED: assemble.py と assemble.js の出力が一致しません');
  for (let i = 0; i < Math.min(py.length, js.length); i++) {
    if (py[i] !== js[i]) { console.error('first diff at', i, JSON.stringify(py.slice(i - 60, i + 60)), '!=', JSON.stringify(js.slice(i - 60, i + 60))); break; }
  }
  process.exit(1);
}
console.log('PARITY OK (' + Buffer.byteLength(py) + ' bytes)');
