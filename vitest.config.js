import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.js"],
    // 默认关闭登录（否则会用 api/_lib/supabase-public.js 里的真实 Supabase 项目）；登录相关测试自己打开。
    env: { SHORT_EMOTION_AUTH: "off" },
  },
});
