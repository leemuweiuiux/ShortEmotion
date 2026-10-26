// 随机昵称（supabase/migrations/20261026080000_nicknames.sql）：词库规则、只能经函数读取、注册时分配、看点作者与邀请改用昵称。
// 数据库行为（补发、触发器、并发撞号、权限）已在本地 Postgres 上跑过；这里守住迁移文件本身不被改坏。
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const sql = readFileSync(new URL("../supabase/migrations/20261026080000_nicknames.sql", import.meta.url), "utf8");
const words = (name) => [...sql.match(new RegExp(`${name} constant text\\[\\] := array\\[([^\\]]+)\\]`))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

describe("随机昵称", () => {
  const adjs = words("adjs");
  const nouns = words("nouns");

  it("形容词、名词各 80 个，每个 2 个字，不重复", () => {
    for (const list of [adjs, nouns]) {
      expect(list).toHaveLength(80);
      expect(new Set(list).size).toBe(list.length);
      for (const word of list) expect([...word], word).toHaveLength(2);
    }
  });

  it("不出现暗示涨跌或收益的字", () => {
    for (const word of [...adjs, ...nouns]) expect(word).not.toMatch(/[牛熊红绿涨跌赚亏盈损龙]/);
  });

  it("昵称表不对访客与登录用户开放读写，只能经 profile_me 读取本人昵称", () => {
    expect(sql).toContain("revoke all on table public.profiles from public, anon, authenticated;");
    expect(sql).not.toMatch(/grant [^;]* on (table )?public\.profiles/i);
    expect(sql).toContain("grant execute on function public.profile_me() to authenticated;");
    expect(sql).toMatch(/revoke all on function public\._nickname_new\(\), public\._profile_ensure\(uuid\), public\._profile_on_signup\(\) from public, anon, authenticated;/);
  });

  it("注册时分配，已有账号补发；昵称全站唯一", () => {
    expect(sql).toMatch(/create trigger profiles_on_signup\s+after insert on auth\.users/);
    expect(sql).toContain("nickname text not null unique");
    expect(sql).toMatch(/left join public\.profiles p on p\.user_id = u\.id where p\.user_id is null/);
  });

  it("看点作者、邀请名称改用昵称；已发布的观点一并换掉", () => {
    expect(sql).toContain("public._profile_ensure(uid),p_view->>'code'");
    expect(sql).not.toContain("'用户'||");
    expect(sql).toMatch(/_invite_name\(uid uuid\)[\s\S]*select p\.nickname from public\.profiles p where p\.user_id = uid;/);
    expect(sql).toMatch(/update public\.kandian_views v set author = p\.nickname/);
  });
});
