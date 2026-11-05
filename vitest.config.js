import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // 页面模块用网站绝对路径互相引用（例如 /shared/redeem-code.js?v=1）：测试时对应到 public/ 下的文件，并去掉版本号
  publicDir: false,
  resolve: {
    alias: [{ find: /^\/(shared|admin|account|redeem|login|short-emotion)\/([^?]+)(\?.*)?$/, replacement: `${path.resolve("public")}/$1/$2` }]
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.js"],
    // 默认关闭登录（否则会用 api/_lib/supabase-public.js 里的真实 Supabase 项目）；登录相关测试自己打开。
    env: { SHORT_EMOTION_AUTH: "off" },
  },
});
