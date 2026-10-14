// GET /api/auth-config — 页面读取登录设置（Supabase 地址与 Publishable key，均为公开值）。
// 未设置 SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY 时返回 { enabled: false }，页面不显示登录。
import { authConfig } from "./_lib/auth.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }
  const config = authConfig();
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300");
  res.status(200).json(config ? { enabled: true, supabaseUrl: config.url, supabaseKey: config.key } : { enabled: false });
}
