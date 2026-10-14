// ShortEmotion 的 Supabase 项目（只放公开值：项目地址与 Publishable key）。
//
// Publishable key 本来就会发给每个访问者的浏览器，可以放进公开仓库；
// secret key（sb_secret_…）或 service_role key 绝对不能放这里（auth.js 也会拒绝使用）。
// 写在这里之后，Vercel 不需要再设置环境变量；如需临时换项目，可用环境变量
// SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY 覆盖。publishableKey 为空时登录关闭。
export const SUPABASE_PUBLIC = {
  url: "https://awrpzbxdhrwbweskgipj.supabase.co",
  // Supabase → Project Settings → API Keys → Publishable key（sb_publishable_ 开头）
  publishableKey: "sb_publishable_qrJ5pPfwyGVpWtqd6SdlHg_DtzOg2hB"
};
