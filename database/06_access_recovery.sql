-- بوصلة رياضيات ١ — نظام فعلي لاستعادة رقم الدخول
-- شغّلي هذا الملف مرة واحدة في Supabase SQL Editor بعد ملفات قاعدة البيانات السابقة.

create extension if not exists pgcrypto;

create table if not exists public.access_recovery_requests (
  id uuid primary key default gen_random_uuid(),
  requested_name text not null check (char_length(trim(requested_name)) between 3 and 80),
  token_hash text not null unique,
  profile_id uuid references public.profiles(id) on delete set null,
  status text not null default 'open' check (status in ('open','approved','rejected','expired')),
  admin_note text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '48 hours'),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null
);

create index if not exists idx_access_recovery_status_created
  on public.access_recovery_requests(status, created_at desc);
create index if not exists idx_access_recovery_profile
  on public.access_recovery_requests(profile_id);

alter table public.access_recovery_requests enable row level security;

-- لا نسمح بالوصول المباشر إلى الجدول؛ جميع العمليات تمر عبر دوال محددة الصلاحية.
revoke all on table public.access_recovery_requests from anon, authenticated;

grant usage on schema public to anon, authenticated;

create or replace function public.normalize_recovery_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(
    lower(regexp_replace(trim(coalesce(p_name,'')), '[[:space:]]+', ' ', 'g')),
    'ًٌٍَُِّْـ',
    ''
  );
$$;

create or replace function public.hash_recovery_token(p_token text)
returns text
language sql
immutable
set search_path = pg_catalog, public, extensions
as $$
  select encode(digest(p_token, 'sha256'), 'hex');
$$;

create or replace function public.create_access_recovery(
  p_full_name text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_normalized text;
  v_profile_id uuid;
  v_matches integer;
  v_request_id uuid;
  v_expires_at timestamptz := now() + interval '48 hours';
begin
  v_name := regexp_replace(trim(coalesce(p_full_name,'')), '[[:space:]]+', ' ', 'g');
  v_normalized := public.normalize_recovery_name(v_name);

  if char_length(v_name) < 3 then
    raise exception 'اكتب الاسم الكامل كما سُجّل في المنصة.';
  end if;

  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{24,100}$' then
    raise exception 'رمز المتابعة غير صالح.';
  end if;

  update public.access_recovery_requests
  set status = 'expired'
  where status = 'open' and expires_at <= now();

  if (
    select count(*)
    from public.access_recovery_requests r
    where public.normalize_recovery_name(r.requested_name) = v_normalized
      and r.created_at > now() - interval '1 hour'
  ) >= 3 then
    raise exception 'تم إرسال عدة طلبات لهذا الاسم. انتظر ساعة ثم حاول مجددًا.';
  end if;

  select count(*), (array_agg(p.id))[1]
  into v_matches, v_profile_id
  from public.profiles p
  where p.active
    and public.normalize_recovery_name(p.full_name) = v_normalized;

  if v_matches <> 1 then
    v_profile_id := null;
  end if;

  insert into public.access_recovery_requests(
    requested_name, token_hash, profile_id, expires_at
  )
  values(
    v_name,
    public.hash_recovery_token(p_token),
    v_profile_id,
    v_expires_at
  )
  returning id into v_request_id;

  return jsonb_build_object(
    'request_id', v_request_id,
    'status', 'open',
    'expires_at', v_expires_at
  );
end;
$$;

create or replace function public.get_access_recovery_result(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.access_recovery_requests%rowtype;
  v_profile public.profiles%rowtype;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{24,100}$' then
    return jsonb_build_object('status','invalid');
  end if;

  select * into v_request
  from public.access_recovery_requests r
  where r.token_hash = public.hash_recovery_token(p_token)
  order by r.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('status','invalid');
  end if;

  if v_request.expires_at <= now() and v_request.status = 'open' then
    update public.access_recovery_requests
    set status = 'expired'
    where id = v_request.id;
    v_request.status := 'expired';
  end if;

  if v_request.status = 'approved' and v_request.profile_id is not null then
    select * into v_profile
    from public.profiles p
    where p.id = v_request.profile_id and p.active;

    if found then
      return jsonb_build_object(
        'status', 'approved',
        'full_name', v_profile.full_name,
        'membership_number', v_profile.membership_number,
        'resolved_at', v_request.resolved_at
      );
    end if;
  end if;

  return jsonb_build_object(
    'status', v_request.status,
    'created_at', v_request.created_at,
    'expires_at', v_request.expires_at,
    'admin_note', v_request.admin_note
  );
end;
$$;

create or replace function public.admin_list_access_recovery()
returns table(
  id uuid,
  requested_name text,
  status text,
  created_at timestamptz,
  expires_at timestamptz,
  resolved_at timestamptz,
  profile_id uuid,
  matched_name text,
  membership_number text,
  admin_note text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'غير مصرح بعرض طلبات الاستعادة.';
  end if;

  update public.access_recovery_requests
  set status = 'expired'
  where status = 'open' and expires_at <= now();

  return query
  select
    r.id,
    r.requested_name,
    r.status,
    r.created_at,
    r.expires_at,
    r.resolved_at,
    r.profile_id,
    p.full_name,
    p.membership_number,
    r.admin_note
  from public.access_recovery_requests r
  left join public.profiles p on p.id = r.profile_id
  order by
    case r.status when 'open' then 0 else 1 end,
    r.created_at desc;
end;
$$;

create or replace function public.resolve_access_recovery(
  p_request_id uuid,
  p_profile_id uuid,
  p_action text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.access_recovery_requests%rowtype;
  v_profile public.profiles%rowtype;
begin
  if not public.is_admin() then
    raise exception 'غير مصرح بمعالجة طلبات الاستعادة.';
  end if;

  if p_action not in ('approved','rejected') then
    raise exception 'الإجراء غير صالح.';
  end if;

  if p_action = 'approved' then
    if p_profile_id is null then
      raise exception 'اختر حساب العضو قبل الموافقة.';
    end if;

    select * into v_profile
    from public.profiles p
    where p.id = p_profile_id and p.active;

    if not found then
      raise exception 'الحساب المختار غير موجود أو غير نشط.';
    end if;
  end if;

  update public.access_recovery_requests
  set
    status = p_action,
    profile_id = case when p_action = 'approved' then p_profile_id else profile_id end,
    admin_note = nullif(trim(coalesce(p_note,'')),''),
    resolved_at = now(),
    resolved_by = auth.uid()
  where id = p_request_id
    and status = 'open'
    and expires_at > now()
  returning * into v_request;

  if not found then
    raise exception 'الطلب غير موجود، أو تمت معالجته، أو انتهت صلاحيته.';
  end if;

  return jsonb_build_object(
    'id', v_request.id,
    'status', v_request.status,
    'resolved_at', v_request.resolved_at
  );
end;
$$;

-- تقييد تنفيذ الدوال ومنح أقل صلاحية لازمة فقط.
revoke execute on function public.normalize_recovery_name(text) from public, anon, authenticated;
revoke execute on function public.hash_recovery_token(text) from public, anon, authenticated;
revoke execute on function public.create_access_recovery(text,text) from public, anon, authenticated;
revoke execute on function public.get_access_recovery_result(text) from public, anon, authenticated;
revoke execute on function public.admin_list_access_recovery() from public, anon, authenticated;
revoke execute on function public.resolve_access_recovery(uuid,uuid,text,text) from public, anon, authenticated;

grant execute on function public.create_access_recovery(text,text) to anon, authenticated;
grant execute on function public.get_access_recovery_result(text) to anon, authenticated;
grant execute on function public.admin_list_access_recovery() to authenticated;
grant execute on function public.resolve_access_recovery(uuid,uuid,text,text) to authenticated;

notify pgrst, 'reload schema';
