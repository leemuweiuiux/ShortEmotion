-- 随机昵称（2026-10-26 与产品确认）：每个账号注册时由数据库分配一个「形容词 + 名词」的中文昵称（例如「沉静松柏」），
-- 用户不能修改（合规）。昵称存在 public.profiles，表不对 anon / authenticated 开放读写，只能经下面的函数读取；
-- 不放在 Supabase 的 user_metadata，因为用户拿自己的登录凭证就能改 user_metadata。
--
-- 用到昵称的地方：个人中心、看点观点的作者（发布时写入 kandian_views.author）、邀请卡片「XX 邀请你」、
-- 邀请人看到的好友名单、邀请奖励的积分流水备注。原来的「姓名」（user_metadata.full_name）不再读写。
--
-- 词库：形容词 80 个、名词 80 个，各 2 个字，约 6,400 种组合，全站不重复。
-- 避开暗示涨跌或收益的字（牛、熊、红、绿、涨、跌、赚、亏、盈、损、龙）、政治宗教、人名地名。
--
-- 在 Supabase → SQL Editor 执行一次（可重复执行）。

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null unique check (char_length(nickname) between 2 and 12),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on table public.profiles from public, anon, authenticated;

-- 随机组一个还没被用过的昵称；组合几乎用完时（极少见）在后面加两位数字
create or replace function public._nickname_new()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  adjs constant text[] := array[
    '沉静','从容','笃定','清朗','明澈','敏锐','温润','坚毅','豁达','淡定',
    '安然','恬淡','澄澈','舒朗','爽朗','稳健','谦和','沉稳','机敏','灵动',
    '悠然','静谧','清逸','朴素','端方','和煦','坦荡','磊落','睿智','通透',
    '专注','耐心','勤勉','务实','果敢','自在','洒脱','清醒','冷静','宁静',
    '平和','温和','坚韧','刚健','隽永','简约','质朴','明朗','晴朗','开阔',
    '辽远','深邃','澹然','清雅','素雅','闲适','安稳','踏实','恒久','执着',
    '细致','缜密','周全','清和','温厚','宽厚','敦厚','谨慎','审慎','明达',
    '旷达','静好','端庄','文雅','清新','轻快','疏朗','温良','朗润','恬静'];
  nouns constant text[] := array[
    '松柏','白鹭','远山','云雀','晨星','青竹','海燕','溪流','灯塔','帆影',
    '山岚','晚风','朝露','湖光','星河','明月','清泉','松涛','竹影','梧桐',
    '银杏','白杨','雪松','苍鹰','海鸥','鸿雁','仙鹤','麋鹿','骏马','海豚',
    '江鸥','春雨','秋水','冬雪','晨曦','暮云','山峦','峰峦','原野','草原',
    '森林','林海','湖泊','河川','星辰','朗月','晴空','云海','雪峰','冰川',
    '沙洲','礁石','浪花','潮汐','归帆','轻舟','书卷','墨竹','古琴','茶香',
    '风铃','纸鸢','灯火','萤火','松鼠','白鹤','黄鹂','翠鸟','海棠','木棉',
    '玉兰','芦苇','青苔','晨钟','山泉','竹林','稻田','麦浪','云杉','桂树'];
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

-- 取得某个账号的昵称；还没有就分配一个（并发时以先写入的为准）
create or replace function public._profile_ensure(uid uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v text;
  tries integer := 0;
begin
  if uid is null then return null; end if;
  select nickname into v from public.profiles where user_id = uid;
  while v is null loop
    tries := tries + 1;
    begin
      insert into public.profiles (user_id, nickname) values (uid, public._nickname_new())
      on conflict (user_id) do nothing
      returning nickname into v;
      if v is null then select nickname into v from public.profiles where user_id = uid; end if;
    exception when unique_violation then
      if tries >= 8 then raise; end if;  -- 昵称撞号：换一个再试
    end;
  end loop;
  return v;
end;
$$;

-- 注册时分配（新账号写入 auth.users 时触发）；万一失败不挡注册，之后打开个人中心时再补
create or replace function public._profile_on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public._profile_ensure(new.id);
  exception when others then
    raise warning 'nickname for % failed: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists profiles_on_signup on auth.users;
create trigger profiles_on_signup
  after insert on auth.users
  for each row execute function public._profile_on_signup();

-- 已有账号一次补发
do $$
declare r record;
begin
  for r in select u.id from auth.users u left join public.profiles p on p.user_id = u.id where p.user_id is null order by u.created_at loop
    perform public._profile_ensure(r.id);
  end loop;
end;
$$;

-- 本人读取：个人中心、编辑页（/api/auth?action=profile）
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
  return jsonb_build_object('nickname', public._profile_ensure(uid));
end;
$$;

revoke all on function public._nickname_new(), public._profile_ensure(uuid), public._profile_on_signup() from public, anon, authenticated;
revoke all on function public.profile_me() from public, anon;
grant execute on function public.profile_me() to authenticated;

-- 邀请：邀请卡片、登录页「XX 的邀请」、积分流水备注改用昵称（原来是用户自填的姓名）
create or replace function public._invite_name(uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.nickname from public.profiles p where p.user_id = uid;
$$;
revoke all on function public._invite_name(uuid) from public, anon, authenticated;

-- 看点观点：作者写入昵称（原来是「用户」+ 账号编号前 8 位）
create or replace function public.kandian_publish(p_view jsonb, p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid(); result public.kandian_views; qt timestamptz;
begin
  if uid is null or not exists(select 1 from private.kandian_writer where token_hash=encode(extensions.digest(p_token,'sha256'),'hex')) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  select * into result from public.kandian_views where user_id=uid and request_id=(p_view->>'request_id')::uuid;
  if found then return to_jsonb(result); end if;
  if (select count(*) from public.kandian_views where user_id=uid and created_at>now()-interval '1 day')>=30 then
    raise exception 'Publish limit reached' using errcode='K4001';
  end if;
  qt := (p_view->>'quote_at')::timestamptz;
  if qt < now()-interval '2 minutes' or qt > now()+interval '10 seconds' then raise exception 'Stale quote'; end if;
  insert into public.kandian_views(user_id,request_id,author,code,name,direction,horizon,tags,note,price,quote_at)
  values(uid,(p_view->>'request_id')::uuid,public._profile_ensure(uid),p_view->>'code',p_view->>'name',p_view->>'direction',
    (p_view->>'horizon')::integer,array(select jsonb_array_elements_text(p_view->'tags')),p_view->>'note',(p_view->>'price')::numeric,qt)
  returning * into result;
  return to_jsonb(result);
end $$;
revoke all on function public.kandian_publish(jsonb,text) from public,anon;
grant execute on function public.kandian_publish(jsonb,text) to authenticated;

-- 已发布的观点：作者统一换成昵称（2026-10-26 与产品确认）
update public.kandian_views v set author = p.nickname
from public.profiles p
where p.user_id = v.user_id and v.author is distinct from p.nickname;

-- 已发的邀请奖励：流水备注换成昵称（受邀奖励记邀请人，邀请奖励记好友；双方与 invites.rewarded_at 同一笔交易写入）
update public.point_ledger l set note = p.nickname
from public.invites i join public.profiles p on p.user_id = i.inviter_id
where l.kind = 'invite_bonus' and l.user_id = i.invitee_id and l.created_at = i.rewarded_at;

update public.point_ledger l set note = p.nickname
from public.invites i join public.profiles p on p.user_id = i.invitee_id
where l.kind = 'invite_reward' and l.user_id = i.inviter_id and l.created_at = i.rewarded_at;

-- （可选）清掉旧的「姓名」：页面已不再读写。确认不需要后，取消下面两行的注释再执行一次。
-- update auth.users set raw_user_meta_data = raw_user_meta_data - 'full_name' - 'display_name'
-- where raw_user_meta_data ?| array['full_name', 'display_name'];
