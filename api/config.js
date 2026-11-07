/* Vercel サーバーレス関数: Supabase の接続情報を環境変数から返す
   ・NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY（Vercel の環境変数）
   ・Anon Key は公開前提のキー。Service Role Key は絶対に返さない。
   ・未設定の場合は configured:false を返し、アプリはオフラインモードへフォールバックする。 */
module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.SUPABASE_ANON_KEY || '';

  res.status(200).json({
    configured: !!(url && key),
    supabaseUrl: url,
    supabaseAnonKey: key,
    source: 'vercel-env',
    requiredEnv: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']
  });
};
