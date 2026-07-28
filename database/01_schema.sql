-- بوصلة رياضيات ١ — مخطط قاعدة البيانات التشغيلية
-- نفّذي هذا الملف كاملًا مرة واحدة داخل Supabase SQL Editor.

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('member','supervisor','admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.request_status as enum ('open','in_progress','resolved');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'عضو',
  email text,
  role public.app_role not null default 'member',
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.skills (
  id text primary key,
  name text not null unique,
  sort_order integer not null default 0,
  active boolean not null default true
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  skill_id text not null references public.skills(id),
  title text not null,
  question_text text not null,
  options jsonb not null check (jsonb_typeof(options)='array' and jsonb_array_length(options)>=2),
  correct_index integer not null check (correct_index>=0),
  explanation text not null,
  trap text,
  quick_method text,
  difficulty text not null default 'متوسط' check (difficulty in ('متوسط','متقدم')),
  is_diagnostic boolean not null default false,
  priority integer not null default 50 check (priority between 1 and 100),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.diagnostic_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_ids uuid[] not null,
  correct_count integer,
  total_count integer,
  readiness integer check (readiness between 0 and 100),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.diagnostic_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.diagnostic_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id uuid not null references public.questions(id),
  selected_index integer not null,
  is_correct boolean not null,
  response_seconds integer not null default 0,
  created_at timestamptz not null default now(),
  unique(session_id,question_id)
);

create table if not exists public.practice_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id uuid not null references public.questions(id),
  skill_id text not null references public.skills(id),
  selected_index integer not null,
  is_correct boolean not null,
  response_seconds integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.user_skill_stats (
  user_id uuid not null references public.profiles(id) on delete cascade,
  skill_id text not null references public.skills(id),
  correct_count integer not null default 0,
  total_count integer not null default 0,
  score_percent integer not null default 0 check (score_percent between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key(user_id,skill_id)
);

create table if not exists public.need_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  need_type text not null,
  skill_id text references public.skills(id),
  details text not null check (char_length(details) between 3 and 700),
  status public.request_status not null default 'open',
  staff_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  provider text,
  trainer text,
  skill_id text references public.skills(id),
  level text,
  description text not null,
  url text,
  telegram_url text,
  featured boolean not null default false,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  rating integer check (rating between 1 and 5),
  pre_score integer check (pre_score between 0 and 100),
  post_score integer check (post_score between 0 and 100),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,course_id)
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_questions_skill_active on public.questions(skill_id,active,is_diagnostic);
create index if not exists idx_diag_sessions_user on public.diagnostic_sessions(user_id,completed_at desc);
create index if not exists idx_diag_answers_user on public.diagnostic_answers(user_id,created_at desc);
create index if not exists idx_practice_user_created on public.practice_attempts(user_id,created_at desc);
create index if not exists idx_practice_skill on public.practice_attempts(skill_id,created_at desc);
create index if not exists idx_needs_status_created on public.need_requests(status,created_at desc);
create index if not exists idx_needs_user on public.need_requests(user_id,created_at desc);

create or replace function public.is_staff()
returns boolean
language sql stable security definer
set search_path=public
as $$ select exists(select 1 from public.profiles where id=(select auth.uid()) and role in ('supervisor','admin') and active) $$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path=public
as $$ select exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin' and active) $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path=public
as $$
begin
  insert into public.profiles(id,full_name,email)
  values(new.id,coalesce(nullif(new.raw_user_meta_data->>'full_name',''),'عضو'),new.email)
  on conflict(id) do update set email=excluded.email;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.protect_profile_role()
returns trigger
language plpgsql security definer
set search_path=public
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then new.role:=old.role; end if;
  new.updated_at:=now();
  return new;
end; $$;

drop trigger if exists protect_profile_role_trigger on public.profiles;
create trigger protect_profile_role_trigger before update on public.profiles for each row execute function public.protect_profile_role();

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at:=now(); return new; end; $$;

do $$
declare t text;
begin
  foreach t in array array['questions','need_requests','courses','course_feedback','announcements'] loop
    execute format('drop trigger if exists set_updated_at_trigger on public.%I',t);
    execute format('create trigger set_updated_at_trigger before update on public.%I for each row execute function public.set_updated_at()',t);
  end loop;
end $$;

-- صلاحيات الوصول العامة؛ تبقى كل عملية مقيدة بسياسات RLS أدناه
grant usage on schema public to authenticated;
grant usage on type public.app_role, public.request_status to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;

-- تفعيل RLS
alter table public.profiles enable row level security;
alter table public.skills enable row level security;
alter table public.questions enable row level security;
alter table public.diagnostic_sessions enable row level security;
alter table public.diagnostic_answers enable row level security;
alter table public.practice_attempts enable row level security;
alter table public.user_skill_stats enable row level security;
alter table public.need_requests enable row level security;
alter table public.courses enable row level security;
alter table public.course_feedback enable row level security;
alter table public.announcements enable row level security;

-- حذف السياسات القديمة لتسهيل إعادة التنفيذ
DO $$
DECLARE r record;
BEGIN
  FOR r IN select schemaname,tablename,policyname from pg_policies where schemaname='public' and tablename in ('profiles','skills','questions','diagnostic_sessions','diagnostic_answers','practice_attempts','user_skill_stats','need_requests','courses','course_feedback','announcements') LOOP
    EXECUTE format('drop policy if exists %I on %I.%I',r.policyname,r.schemaname,r.tablename);
  END LOOP;
END $$;

create policy profiles_select on public.profiles for select to authenticated using ((select auth.uid())=id or public.is_staff());
create policy profiles_update_own on public.profiles for update to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);
create policy profiles_admin_update on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy skills_read on public.skills for select to authenticated using (active or public.is_staff());
create policy skills_staff_all on public.skills for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy questions_staff_all on public.questions for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy diag_sessions_own_select on public.diagnostic_sessions for select to authenticated using ((select auth.uid())=user_id or public.is_staff());
create policy diag_sessions_own_insert on public.diagnostic_sessions for insert to authenticated with check ((select auth.uid())=user_id);
create policy diag_sessions_own_update on public.diagnostic_sessions for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create policy diag_answers_own_select on public.diagnostic_answers for select to authenticated using ((select auth.uid())=user_id or public.is_staff());
create policy diag_answers_own_insert on public.diagnostic_answers for insert to authenticated with check ((select auth.uid())=user_id);
create policy diag_answers_own_update on public.diagnostic_answers for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create policy practice_own_select on public.practice_attempts for select to authenticated using ((select auth.uid())=user_id or public.is_staff());
create policy practice_own_insert on public.practice_attempts for insert to authenticated with check ((select auth.uid())=user_id);

create policy stats_own_select on public.user_skill_stats for select to authenticated using ((select auth.uid())=user_id or public.is_staff());
create policy stats_own_insert on public.user_skill_stats for insert to authenticated with check ((select auth.uid())=user_id);
create policy stats_own_update on public.user_skill_stats for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create policy needs_own_select on public.need_requests for select to authenticated using ((select auth.uid())=user_id or public.is_staff());
create policy needs_own_insert on public.need_requests for insert to authenticated with check ((select auth.uid())=user_id);
create policy needs_staff_update on public.need_requests for update to authenticated using (public.is_staff()) with check (public.is_staff());

create policy courses_read on public.courses for select to authenticated using (active or public.is_staff());
create policy courses_staff_all on public.courses for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy feedback_own_select on public.course_feedback for select to authenticated using ((select auth.uid())=user_id or public.is_staff());
create policy feedback_own_insert on public.course_feedback for insert to authenticated with check ((select auth.uid())=user_id);
create policy feedback_own_update on public.course_feedback for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create policy announcements_read on public.announcements for select to authenticated using (active or public.is_staff());
create policy announcements_staff_all on public.announcements for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- RPC: تحديث آخر نشاط
create or replace function public.touch_profile()
returns void language sql security definer set search_path=public
as $$ update public.profiles set last_seen_at=now() where id=(select auth.uid()) $$;

-- RPC: إحضار أسئلة التدريب دون كشف الإجابة
create or replace function public.get_practice_questions(p_skill_id text default null,p_difficulty text default null,p_limit integer default 100)
returns table(id uuid,skill_id text,skill_name text,difficulty text,title text,question_text text,options jsonb,priority integer)
language sql security definer set search_path=public
as $$
  select q.id,q.skill_id,s.name,q.difficulty,q.title,q.question_text,q.options,q.priority
  from public.questions q join public.skills s on s.id=q.skill_id
  where (select auth.uid()) is not null and q.active and not q.is_diagnostic
    and (p_skill_id is null or q.skill_id=p_skill_id)
    and (p_difficulty is null or q.difficulty=p_difficulty)
  order by q.priority desc,q.created_at desc
  limit least(greatest(p_limit,1),100);
$$;

create or replace function public.submit_practice_answer(p_question_id uuid,p_selected_index integer,p_response_seconds integer default 0)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare q public.questions%rowtype; v_uid uuid:=(select auth.uid()); v_correct boolean;
begin
  if v_uid is null then raise exception 'يلزم تسجيل الدخول'; end if;
  select * into q from public.questions where id=p_question_id and active and not is_diagnostic;
  if not found then raise exception 'السؤال غير متاح'; end if;
  v_correct:=p_selected_index=q.correct_index;
  insert into public.practice_attempts(user_id,question_id,skill_id,selected_index,is_correct,response_seconds)
  values(v_uid,q.id,q.skill_id,p_selected_index,v_correct,greatest(coalesce(p_response_seconds,0),0));
  return jsonb_build_object('is_correct',v_correct,'correct_index',q.correct_index,'explanation',q.explanation,'trap',q.trap,'quick_method',q.quick_method);
end $$;

create or replace function public.start_diagnostic()
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_uid uuid:=(select auth.uid()); v_ids uuid[]; v_session uuid; v_questions jsonb;
begin
  if v_uid is null then raise exception 'يلزم تسجيل الدخول'; end if;
  select array_agg(id) into v_ids from (
    select id from public.questions where active and is_diagnostic order by priority desc,created_at limit 10
  ) x;
  if coalesce(array_length(v_ids,1),0)<5 then raise exception 'لا يوجد عدد كافٍ من الأسئلة التشخيصية'; end if;
  insert into public.diagnostic_sessions(user_id,question_ids,total_count) values(v_uid,v_ids,array_length(v_ids,1)) returning id into v_session;
  select jsonb_agg(jsonb_build_object('id',q.id,'skill_id',q.skill_id,'skill_name',s.name,'difficulty',q.difficulty,'title',q.title,'question_text',q.question_text,'options',q.options) order by array_position(v_ids,q.id))
    into v_questions from public.questions q join public.skills s on s.id=q.skill_id where q.id=any(v_ids);
  return jsonb_build_object('session_id',v_session,'questions',coalesce(v_questions,'[]'::jsonb));
end $$;

create or replace function public.submit_diagnostic_answer(p_session_id uuid,p_question_id uuid,p_selected_index integer,p_response_seconds integer default 0)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_uid uuid:=(select auth.uid()); sess public.diagnostic_sessions%rowtype; q public.questions%rowtype; v_correct boolean;
begin
  select * into sess from public.diagnostic_sessions where id=p_session_id and user_id=v_uid and completed_at is null;
  if not found then raise exception 'جلسة التشخيص غير متاحة'; end if;
  if not (p_question_id=any(sess.question_ids)) then raise exception 'السؤال لا ينتمي إلى الجلسة'; end if;
  select * into q from public.questions where id=p_question_id;
  v_correct:=p_selected_index=q.correct_index;
  insert into public.diagnostic_answers(session_id,user_id,question_id,selected_index,is_correct,response_seconds)
  values(sess.id,v_uid,q.id,p_selected_index,v_correct,greatest(coalesce(p_response_seconds,0),0))
  on conflict(session_id,question_id) do update set selected_index=excluded.selected_index,is_correct=excluded.is_correct,response_seconds=excluded.response_seconds,created_at=now();
  return jsonb_build_object('is_correct',v_correct,'correct_index',q.correct_index,'explanation',q.explanation,'trap',q.trap,'quick_method',q.quick_method);
end $$;

create or replace function public.finish_diagnostic(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_uid uuid:=(select auth.uid()); sess public.diagnostic_sessions%rowtype; v_correct int; v_total int; v_readiness int; v_stats jsonb;
begin
  select * into sess from public.diagnostic_sessions where id=p_session_id and user_id=v_uid;
  if not found then raise exception 'الجلسة غير موجودة'; end if;
  v_total:=array_length(sess.question_ids,1);
  select count(*) filter(where is_correct) into v_correct from public.diagnostic_answers where session_id=sess.id;
  v_readiness:=round(100.0*v_correct/nullif(v_total,0));
  update public.diagnostic_sessions set correct_count=v_correct,total_count=v_total,readiness=v_readiness,completed_at=coalesce(completed_at,now()) where id=sess.id;

  insert into public.user_skill_stats(user_id,skill_id,correct_count,total_count,score_percent,updated_at)
  select v_uid,q.skill_id,count(*) filter(where coalesce(a.is_correct,false)),count(*),round(100.0*count(*) filter(where coalesce(a.is_correct,false))/nullif(count(*),0))::int,now()
  from unnest(sess.question_ids) qid
  join public.questions q on q.id=qid
  left join public.diagnostic_answers a on a.session_id=sess.id and a.question_id=q.id
  group by q.skill_id
  on conflict(user_id,skill_id) do update set correct_count=excluded.correct_count,total_count=excluded.total_count,score_percent=excluded.score_percent,updated_at=now();

  select jsonb_agg(jsonb_build_object('skill_id',x.skill_id,'skill_name',x.name,'correct',x.correct_count,'total',x.total_count,'score',x.score_percent) order by x.sort_order)
  into v_stats from (
    select st.skill_id,s.name,st.correct_count,st.total_count,st.score_percent,s.sort_order
    from public.user_skill_stats st join public.skills s on s.id=st.skill_id where st.user_id=v_uid
  ) x;
  return jsonb_build_object('readiness',v_readiness,'correct',v_correct,'total',v_total,'skill_stats',coalesce(v_stats,'[]'::jsonb));
end $$;

create or replace function public.get_my_dashboard()
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_uid uuid:=(select auth.uid()); v_readiness int:=0; v_last timestamptz; v_count int:=0; v_accuracy int:=0; v_open int:=0; v_weak text:='لم يحدد'; v_stats jsonb;
begin
  if v_uid is null then raise exception 'يلزم تسجيل الدخول'; end if;
  select coalesce(readiness,0),completed_at into v_readiness,v_last from public.diagnostic_sessions where user_id=v_uid and completed_at is not null order by completed_at desc limit 1;
  select count(*),coalesce(round(100.0*count(*) filter(where is_correct)/nullif(count(*),0)),0)::int into v_count,v_accuracy from public.practice_attempts where user_id=v_uid;
  select count(*) into v_open from public.need_requests where user_id=v_uid and status<>'resolved';
  select s.name into v_weak from public.user_skill_stats st join public.skills s on s.id=st.skill_id where st.user_id=v_uid order by st.score_percent asc,s.sort_order limit 1;
  select jsonb_agg(jsonb_build_object('skill_id',s.id,'skill_name',s.name,'score',coalesce(st.score_percent,0),'correct',coalesce(st.correct_count,0),'total',coalesce(st.total_count,0)) order by s.sort_order)
  into v_stats from public.skills s left join public.user_skill_stats st on st.skill_id=s.id and st.user_id=v_uid where s.active;
  return jsonb_build_object('readiness',coalesce(v_readiness,0),'last_diagnostic_at',v_last,'practice_count',v_count,'practice_accuracy',v_accuracy,'open_needs',v_open,'weakest_skill',coalesce(v_weak,'لم يحدد'),'skill_stats',coalesce(v_stats,'[]'::jsonb));
end $$;

create or replace function public.get_supervisor_dashboard()
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_members int; v_open int; v_attempts int; v_avg int; v_weak jsonb; v_needs jsonb;
begin
  if not public.is_staff() then raise exception 'ليس لديك صلاحية المشرف'; end if;
  select count(*) into v_members from public.profiles where role='member' and active;
  select count(*) into v_open from public.need_requests where status<>'resolved';
  select (select count(*) from public.practice_attempts where created_at>=now()-interval '7 days')+(select count(*) from public.diagnostic_answers where created_at>=now()-interval '7 days') into v_attempts;
  select coalesce(round(avg(readiness)),0)::int into v_avg from public.diagnostic_sessions where completed_at is not null;
  with all_results as (
    select q.skill_id,p.is_correct from public.practice_attempts p join public.questions q on q.id=p.question_id
    union all
    select q.skill_id,a.is_correct from public.diagnostic_answers a join public.questions q on q.id=a.question_id
  ), agg as (
    select s.id,s.name,s.sort_order,count(r.is_correct) total,count(r.is_correct) filter(where not r.is_correct) wrong,
      coalesce(round(100.0*count(r.is_correct) filter(where not r.is_correct)/nullif(count(r.is_correct),0)),0)::int error_rate
    from public.skills s left join all_results r on r.skill_id=s.id where s.active group by s.id,s.name,s.sort_order
  ) select jsonb_agg(jsonb_build_object('skill_id',id,'skill_name',name,'total',total,'wrong',wrong,'error_rate',error_rate) order by error_rate desc,sort_order) into v_weak from agg;
  select jsonb_agg(jsonb_build_object('need_type',need_type,'count',cnt) order by cnt desc) into v_needs from (select need_type,count(*) cnt from public.need_requests group by need_type) x;
  return jsonb_build_object('members_count',v_members,'open_needs',v_open,'attempts_7d',v_attempts,'average_readiness',v_avg,'weak_skills',coalesce(v_weak,'[]'::jsonb),'needs_summary',coalesce(v_needs,'[]'::jsonb));
end $$;

revoke all on function public.is_staff() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.touch_profile() from public;
revoke all on function public.get_practice_questions(text,text,integer) from public;
revoke all on function public.submit_practice_answer(uuid,integer,integer) from public;
revoke all on function public.start_diagnostic() from public;
revoke all on function public.submit_diagnostic_answer(uuid,uuid,integer,integer) from public;
revoke all on function public.finish_diagnostic(uuid) from public;
revoke all on function public.get_my_dashboard() from public;
revoke all on function public.get_supervisor_dashboard() from public;

grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.touch_profile() to authenticated;
grant execute on function public.get_practice_questions(text,text,integer) to authenticated;
grant execute on function public.submit_practice_answer(uuid,integer,integer) to authenticated;
grant execute on function public.start_diagnostic() to authenticated;
grant execute on function public.submit_diagnostic_answer(uuid,uuid,integer,integer) to authenticated;
grant execute on function public.finish_diagnostic(uuid) to authenticated;
grant execute on function public.get_my_dashboard() to authenticated;
grant execute on function public.get_supervisor_dashboard() to authenticated;

-- التحديث اللحظي للوحة المشرف
DO $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='need_requests') then alter publication supabase_realtime add table public.need_requests; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='practice_attempts') then alter publication supabase_realtime add table public.practice_attempts; end if;
end $$;
