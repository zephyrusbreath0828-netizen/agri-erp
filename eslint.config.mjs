/* ESLint 設定
   本プロジェクトは src/*.js を build/assemble.py で単一HTMLへ結合する構成のため、
   個別ファイルではなく「結合後バンドル（build/bundle.check.js = 配布物と同一のJS）」を検査する。
   個別ファイルを検査すると、ファイル間で共有しているグローバルが no-redeclare で二重に報告される。 */
const BROWSER = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly',
  sessionStorage: 'readonly', localStorage: 'readonly', crypto: 'readonly',
  fetch: 'readonly', console: 'readonly', alert: 'readonly', confirm: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', Blob: 'readonly', AbortController: 'readonly',
  TextEncoder: 'readonly', Uint8Array: 'readonly', Uint32Array: 'readonly', Image: 'readonly'
};
export default [{
  files: ['build/bundle.check.js'],
  languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: BROWSER },
  rules: {
    'no-undef': 'error',
    'no-redeclare': 'error',
    'no-dupe-keys': 'error',
    'no-dupe-args': 'error',
    'no-dupe-else-if': 'error',
    'no-unreachable': 'error',
    'no-fallthrough': 'error',
    'no-obj-calls': 'error',
    'no-self-assign': 'error',
    'no-cond-assign': ['error', 'except-parens'],
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-control-regex': 'off',
    'no-useless-escape': 'error',
    'no-unused-vars': 'off'
  }
}];
