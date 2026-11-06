-- 点赞研究 Study 2（demo.lfjmwl.com/study2）的实验数据：流程同 study3，但页面内没有每轮问卷（问卷另行纸本填写）。
-- 与 study3 分表存放。只记录受测编号（无姓名、手机号等身份信息）；浏览器只能经由 public.study2_submit 写入，不能读取。
-- 研究者在 Supabase SQL Editor 查询导出：select * from study_private.study2_export order by participant, round_index;
create schema if not exists study_private;
revoke all on schema study_private from public;
grant usage on schema study_private to anon, authenticated;

create table study_private.study2_sessions (
  id uuid primary key,
  participant text not null check (participant ~ '^[1-4][0-9]{2}$' and right(participant, 2) <> '00'),
  grp text not null check (grp in ('base', 'color', 'anim', 'text')),
  trigger_order text[] not null check (array_length(trigger_order, 1) = 3 and trigger_order <@ array['single', 'double', 'triple']),
  started_at timestamptz not null,
  ended_at timestamptz,
  completed boolean not null default false,
  user_agent text check (length(user_agent) <= 500),
  screen jsonb check (pg_column_size(screen) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((grp = 'base' and participant like '1%') or (grp = 'color' and participant like '2%')
      or (grp = 'anim' and participant like '3%') or (grp = 'text' and participant like '4%'))
);
create index study2_sessions_participant on study_private.study2_sessions(participant, started_at);

create table study_private.study2_rounds (
  session_id uuid not null references study_private.study2_sessions(id) on delete cascade,
  round_index smallint not null check (round_index between 1 and 3),
  trigger text not null check (trigger in ('single', 'double', 'triple')),
  need_taps smallint not null check (need_taps between 1 and 3),
  skipped boolean not null default false,
  first_tap_latency_ms numeric,
  like_latency_ms numeric,
  like_press_ms numeric[],
  like_ioi_ms numeric[],
  taps_before_like integer,
  gesture_fails integer,
  extra_taps integer,
  pad_prompt_after_like_ms numeric,   -- 点赞成功到出现「请填写问卷」的时间
  pad_time_ms numeric,                -- 出现「请填写问卷」到按「下一个」的时间（纸本问卷用时）
  raw jsonb check (pg_column_size(raw) <= 100000),
  received_at timestamptz not null default now(),
  primary key (session_id, round_index)
);

alter table study_private.study2_sessions enable row level security;
alter table study_private.study2_rounds enable row level security;
revoke all on study_private.study2_sessions, study_private.study2_rounds from public, anon, authenticated;

-- 写入：每轮按「下一个」时调用一次（p_round）；实验结束时再调用一次（p_round 为 null，只更新结束时间）。
-- 同一轮重复提交不会产生重复记录。
create function study_private.study2_submit(p_session jsonb, p_round jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  sid := (p_session->>'id')::uuid;
  if sid is null then return false; end if;
  -- 防滥用：每分钟最多新建 60 个会话
  if not exists (select 1 from study_private.study2_sessions where id = sid)
     and (select count(*) from study_private.study2_sessions where created_at > now() - interval '1 minute') >= 60 then
    return false;
  end if;
  insert into study_private.study2_sessions (id, participant, grp, trigger_order, started_at, ended_at, completed, user_agent, screen)
  values (sid, p_session->>'participant', p_session->>'grp',
          array(select jsonb_array_elements_text(p_session->'trigger_order')),
          (p_session->>'started_at')::timestamptz, (p_session->>'ended_at')::timestamptz,
          coalesce((p_session->>'completed')::boolean, false),
          left(p_session->>'user_agent', 500), p_session->'screen')
  on conflict (id) do update set
    ended_at = coalesce(excluded.ended_at, study_private.study2_sessions.ended_at),
    completed = study_private.study2_sessions.completed or excluded.completed,
    updated_at = now();
  if p_round is null then return true; end if;
  insert into study_private.study2_rounds (session_id, round_index, trigger, need_taps, skipped,
    first_tap_latency_ms, like_latency_ms, like_press_ms, like_ioi_ms, taps_before_like, gesture_fails, extra_taps,
    pad_prompt_after_like_ms, pad_time_ms, raw)
  values (sid, (p_round->>'round_index')::smallint, p_round->>'trigger', (p_round->>'need_taps')::smallint,
    coalesce((p_round->>'skipped')::boolean, false),
    (p_round->>'first_tap_latency_ms')::numeric, (p_round->>'like_latency_ms')::numeric,
    array(select (jsonb_array_elements_text(coalesce(p_round->'like_press_ms', '[]')))::numeric),
    array(select (jsonb_array_elements_text(coalesce(p_round->'like_ioi_ms', '[]')))::numeric),
    (p_round->>'taps_before_like')::integer, (p_round->>'gesture_fails')::integer, (p_round->>'extra_taps')::integer,
    (p_round->>'pad_prompt_after_like_ms')::numeric, (p_round->>'pad_time_ms')::numeric, p_round->'raw')
  on conflict (session_id, round_index) do nothing;
  return true;
end $$;
revoke all on function study_private.study2_submit(jsonb, jsonb) from public;
grant execute on function study_private.study2_submit(jsonb, jsonb) to anon, authenticated;

create function public.study2_submit(p_session jsonb, p_round jsonb default null)
returns boolean language sql security invoker set search_path = '' as $$
  select study_private.study2_submit(p_session, p_round);
$$;
revoke all on function public.study2_submit(jsonb, jsonb) from public;
grant execute on function public.study2_submit(jsonb, jsonb) to anon, authenticated;

-- 导出视图（每轮一行），只在 SQL Editor 中以管理员身份查询
create view study_private.study2_export as
select s.participant, s.grp, array_to_string(s.trigger_order, '>') as trigger_order, s.completed,
  r.round_index, r.trigger, r.need_taps, r.skipped,
  r.first_tap_latency_ms, r.like_latency_ms,
  array_to_string(r.like_press_ms, ';') as like_press_ms, array_to_string(r.like_ioi_ms, ';') as like_ioi_ms,
  r.taps_before_like, r.gesture_fails, r.extra_taps, r.pad_prompt_after_like_ms, r.pad_time_ms,
  s.started_at, s.ended_at, r.received_at, s.id as session_id
from study_private.study2_sessions s join study_private.study2_rounds r on r.session_id = s.id;
revoke all on study_private.study2_export from public, anon, authenticated;
