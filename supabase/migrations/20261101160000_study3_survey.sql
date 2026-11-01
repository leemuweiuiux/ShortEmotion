-- Study 3：加入基础问卷（03–15）与每轮的触发形式题（16）。
-- sessions.survey 存基础问卷原始作答；rounds.trigger_answer 存受测者自报的触发形式（操纵检查）。
alter table study_private.sessions add column if not exists survey jsonb check (pg_column_size(survey) <= 4000);
alter table study_private.rounds add column if not exists trigger_answer text check (trigger_answer in ('单击', '双击', '连击'));

create or replace function study_private.submit(p_session jsonb, p_round jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare sid uuid; q smallint[];
begin
  sid := (p_session->>'id')::uuid;
  if sid is null then return false; end if;
  -- 防滥用：全站每分钟最多新建 60 个会话
  if not exists (select 1 from study_private.sessions where id = sid)
     and (select count(*) from study_private.sessions where created_at > now() - interval '1 minute') >= 60 then
    return false;
  end if;
  insert into study_private.sessions (id, participant, grp, trigger_order, started_at, ended_at, completed, user_agent, screen, survey)
  values (sid, p_session->>'participant', p_session->>'grp',
          array(select jsonb_array_elements_text(p_session->'trigger_order')),
          (p_session->>'started_at')::timestamptz, (p_session->>'ended_at')::timestamptz,
          coalesce((p_session->>'completed')::boolean, false),
          left(p_session->>'user_agent', 500), p_session->'screen', p_session->'survey')
  on conflict (id) do update set
    ended_at = coalesce(excluded.ended_at, study_private.sessions.ended_at),
    completed = study_private.sessions.completed or excluded.completed,
    survey = coalesce(study_private.sessions.survey, excluded.survey),
    updated_at = now();
  if p_round is null then return true; end if;
  q := array(select (jsonb_array_elements_text(p_round->'q'))::smallint);
  insert into study_private.rounds (session_id, round_index, trigger, need_taps, skipped,
    first_tap_latency_ms, like_latency_ms, like_press_ms, like_ioi_ms, taps_before_like, gesture_fails, extra_taps,
    pad_prompt_after_like_ms, pad_time_ms, q, pad_changes, raw, trigger_answer)
  values (sid, (p_round->>'round_index')::smallint, p_round->>'trigger', (p_round->>'need_taps')::smallint,
    coalesce((p_round->>'skipped')::boolean, false),
    (p_round->>'first_tap_latency_ms')::numeric, (p_round->>'like_latency_ms')::numeric,
    array(select (jsonb_array_elements_text(coalesce(p_round->'like_press_ms', '[]')))::numeric),
    array(select (jsonb_array_elements_text(coalesce(p_round->'like_ioi_ms', '[]')))::numeric),
    (p_round->>'taps_before_like')::integer, (p_round->>'gesture_fails')::integer, (p_round->>'extra_taps')::integer,
    (p_round->>'pad_prompt_after_like_ms')::numeric, (p_round->>'pad_time_ms')::numeric,
    q, (p_round->>'pad_changes')::integer, p_round->'raw', p_round->>'trigger_answer')
  on conflict (session_id, round_index) do nothing;
  return true;
end $$;
revoke all on function study_private.submit(jsonb, jsonb) from public;
grant execute on function study_private.submit(jsonb, jsonb) to anon, authenticated;

-- 导出视图：在原有列之后追加触发形式题与基础问卷
create or replace view study_private.study3_export as
select s.participant, s.grp, array_to_string(s.trigger_order, '>') as trigger_order, s.completed,
  r.round_index, r.trigger, r.need_taps, r.skipped,
  r.first_tap_latency_ms, r.like_latency_ms,
  array_to_string(r.like_press_ms, ';') as like_press_ms, array_to_string(r.like_ioi_ms, ';') as like_ioi_ms,
  r.taps_before_like, r.gesture_fails, r.extra_taps, r.pad_prompt_after_like_ms, r.pad_time_ms,
  r.p, r.a, r.d,
  r.q[1] as q1, r.q[2] as q2, r.q[3] as q3, r.q[4] as q4, r.q[5] as q5, r.q[6] as q6,
  r.q[7] as q7, r.q[8] as q8, r.q[9] as q9, r.q[10] as q10, r.q[11] as q11, r.q[12] as q12,
  r.pad_changes, r.straightline, s.started_at, s.ended_at, r.received_at, s.id as session_id,
  r.trigger_answer,
  (r.trigger_answer = case r.trigger when 'single' then '单击' when 'double' then '双击' else '连击' end) as trigger_check,
  s.survey->>'age' as age, s.survey->>'gender' as gender, s.survey->>'hand' as hand,
  s.survey->>'phone_hours' as phone_hours,
  (select string_agg(x, ';') from jsonb_array_elements_text(s.survey->'apps') x) as apps,
  (s.survey->>'beq1')::int as beq1, (s.survey->>'beq2')::int as beq2, (s.survey->>'beq3')::int as beq3, (s.survey->>'beq4')::int as beq4,
  (s.survey->>'beq_pe')::numeric as beq_pe,
  (s.survey->>'srbai1')::int as srbai1, (s.survey->>'srbai2')::int as srbai2, (s.survey->>'srbai3')::int as srbai3, (s.survey->>'srbai4')::int as srbai4,
  (s.survey->>'srbai')::numeric as srbai
from study_private.sessions s join study_private.rounds r on r.session_id = s.id;
revoke all on study_private.study3_export from public, anon, authenticated;
