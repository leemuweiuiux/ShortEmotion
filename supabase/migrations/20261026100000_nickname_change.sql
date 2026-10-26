-- 换昵称（2026-10-26 与产品确认）：编辑页「换一个」随机出候选昵称（只是预览），按「保存」才生效。
-- 规则：候选只能来自系统词库（用户不能自己打字，合规前提不变）；每 30 天可以换一次（注册时分配的那个不算一次）；免费。
-- 换名后：已发布观点的作者一并换成新昵称（同一个人全站只有一个名字）；邀请卡片等读昵称的地方自动跟着变；
-- 历史积分流水的邀请备注保留原样。每次换名记进 public.nickname_changes（原昵称、新昵称、时间），不对外显示，供合规追溯。
--
-- 需要先执行 20261026080000_nicknames.sql。在 Supabase → SQL Editor 执行一次（可重复执行）。

-- 词库改成两个函数，生成昵称与检查候选共用一份
create or replace function public._nickname_adjs()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    '沉静','从容','笃定','清朗','明澈','敏锐','温润','坚毅','豁达','淡定',
    '安然','恬淡','澄澈','舒朗','爽朗','稳健','谦和','沉稳','机敏','灵动',
    '悠然','静谧','清逸','朴素','端方','和煦','坦荡','磊落','睿智','通透',
    '专注','耐心','勤勉','务实','果敢','自在','洒脱','清醒','冷静','宁静',
    '平和','温和','坚韧','刚健','隽永','简约','质朴','明朗','晴朗','开阔',
    '辽远','深邃','澹然','清雅','素雅','闲适','安稳','踏实','恒久','执着',
    '细致','缜密','周全','清和','温厚','宽厚','敦厚','谨慎','审慎','明达',
    '旷达','静好','端庄','文雅','清新','轻快','疏朗','温良','朗润','恬静']::text[];
$$;

create or replace function public._nickname_nouns()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    '松柏','白鹭','远山','云雀','晨星','青竹','海燕','溪流','灯塔','帆影',
    '山岚','晚风','朝露','湖光','星河','明月','清泉','松涛','竹影','梧桐',
    '银杏','白杨','雪松','苍鹰','海鸥','鸿雁','仙鹤','麋鹿','骏马','海豚',
    '江鸥','春雨','秋水','冬雪','晨曦','暮云','山峦','峰峦','原野','草原',
    '森林','林海','湖泊','河川','星辰','朗月','晴空','云海','雪峰','冰川',
    '沙洲','礁石','浪花','潮汐','归帆','轻舟','书卷','墨竹','古琴','茶香',
    '风铃','纸鸢','灯火','萤火','松鼠','白鹤','黄鹂','翠鸟','海棠','木棉',
    '玉兰','芦苇','青苔','晨钟','山泉','竹林','稻田','麦浪','云杉','桂树']::text[];
$$;

-- 随机组一个还没被用过的昵称（与 20261026080000 相同，改用上面两个函数）
create or replace function public._nickname_new()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  adjs constant text[] := public._nickname_adjs();
  nouns constant text[] := public._nickname_nouns();
  candidate text;
  i integer;
begin
  for i in 1..60 loop
    candidate := adjs[1 + floor(random() * array_length(adjs, 1))::int]
              || nouns[1 + floor(random() * array_length(nouns, 1))::int]
              || case when i > 40 then lpad(floor(random() * 100)::int::text, 2, '0') else '' end;
    if not exists (select 1 from public.profiles where nickname = candidate) then
      return candidate;
    end if;
  end loop;
  raise exception 'nickname generation failed';
end;
$$;

-- 是不是词库组出来的昵称（形容词 + 名词，组合用完时可能带两位数字）
create or replace function public._nickname_valid(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null
    and char_length(p) in (4, 6)
    and substr(p, 1, 2) = any (public._nickname_adjs())
    and substr(p, 3, 2) = any (public._nickname_nouns())
    and (char_length(p) = 4 or substr(p, 5) ~ '^[0-9]{2}$');
$$;

create table if not exists public.nickname_changes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  old_nickname text not null,
  new_nickname text not null,
  created_at timestamptz not null default now()
);
create index if not exists nickname_changes_user_idx on public.nickname_changes (user_id, created_at desc);
alter table public.nickname_changes enable row level security;
revoke all on table public.nickname_changes from public, anon, authenticated;

-- 下次可以换昵称的时间；现在就能换时返回 null
create or replace function public._nickname_next_change(uid uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case when max(created_at) + interval '30 days' > now() then max(created_at) + interval '30 days' end
  from public.nickname_changes where user_id = uid;
$$;

-- 本人读取：昵称、下次可更换时间（null = 现在就能换）
create or replace function public.profile_me()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  return jsonb_build_object('nickname', public._profile_ensure(uid), 'nextChangeAt', public._nickname_next_change(uid));
end;
$$;

-- 「换一个」：给一个随机候选（不保存）
create or replace function public.nickname_candidate()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  return jsonb_build_object('nickname', public._nickname_new());
end;
$$;

-- 「保存」：换成候选昵称
create or replace function public.nickname_change(p_nickname text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_new text := btrim(coalesce(p_nickname, ''));
  v_old text;
  v_next timestamptz;
begin
  if uid is null then raise exception 'login required' using errcode = '28000'; end if;
  perform public._profile_ensure(uid);
  select nickname into v_old from public.profiles where user_id = uid for update;  -- 同一个人的并发请求排队
  if v_new = v_old then
    return jsonb_build_object('ok', true, 'nickname', v_old, 'nextChangeAt', public._nickname_next_change(uid));
  end if;
  v_next := public._nickname_next_change(uid);
  if v_next is not null then
    return jsonb_build_object('ok', false, 'reason', 'too_soon', 'nickname', v_old, 'nextChangeAt', v_next);
  end if;
  if not public._nickname_valid(v_new) then
    return jsonb_build_object('ok', false, 'reason', 'invalid', 'nickname', v_old, 'nextChangeAt', null);
  end if;
  begin
    update public.profiles set nickname = v_new where user_id = uid;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'taken', 'nickname', v_old, 'nextChangeAt', null);
  end;
  insert into public.nickname_changes (user_id, old_nickname, new_nickname) values (uid, v_old, v_new);
  update public.kandian_views set author = v_new where user_id = uid;
  return jsonb_build_object('ok', true, 'nickname', v_new, 'nextChangeAt', now() + interval '30 days');
end;
$$;

revoke all on function public._nickname_adjs(), public._nickname_nouns(), public._nickname_valid(text), public._nickname_next_change(uuid), public._nickname_new() from public, anon, authenticated;
revoke all on function public.profile_me(), public.nickname_candidate(), public.nickname_change(text) from public, anon;
grant execute on function public.profile_me(), public.nickname_candidate(), public.nickname_change(text) to authenticated;
