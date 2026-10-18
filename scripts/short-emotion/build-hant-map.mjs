// 生成介绍页、登录页、个人资料页「繁体」切换用的简→繁字表（public/short-emotion/hant-map.js）。
// 页面文字改动后重新运行：npm install --no-save opencc-js@1.0.5 && node scripts/short-emotion/build-hant-map.mjs
import { readFile, writeFile } from "node:fs/promises";
import * as OpenCC from "opencc-js";

const sources = [
  "public/about/index.html",
  "public/about/about.js",
  "public/login/index.html",
  "public/login/login.js",
  "public/account/index.html",
  "public/account/account.js",
  "api/auth.js",
  "api/_lib/session.js"
];
const text = (await Promise.all(sources.map((file) => readFile(file, "utf8")))).join("");
const chars = [...new Set(text.match(/[一-鿿]/g))].sort();
const convert = OpenCC.Converter({ from: "cn", to: "tw" });
const map = {};
for (const char of chars) {
  const traditional = convert(char);
  if (traditional !== char && traditional.length === 1) map[char] = traditional;
}
const output = `// 自动生成：scripts/short-emotion/build-hant-map.mjs（opencc-js cn→tw，逐字），请勿手改。
// 介绍页、登录页、个人资料页切换到「繁体」时用它逐字转换（public/shared/lang.js）。
export const HANT = ${JSON.stringify(map)};

// 日常写法用「台」，以及台湾用语。
export const HANT_FIXES = [
  [/臺/g, "台"], [/拉昇/g, "拉升"], [/軟件/g, "軟體"], [/網絡/g, "網路"], [/鍾/g, "鐘"],
  // 登录界面：台湾用语
  [/退出登錄/g, "登出"], [/登錄/g, "登入"], [/賬號/g, "帳號"], [/郵箱/g, "信箱"], [/注冊/g, "註冊"], [/接口/g, "介面"], [/聯系/g, "聯繫"]
];
`;
await writeFile("public/short-emotion/hant-map.js", output);
console.log(`hant-map.js: ${Object.keys(map).length} chars`);
