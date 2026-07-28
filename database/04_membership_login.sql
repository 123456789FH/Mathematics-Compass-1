-- بوصلة رياضيات ١ — تحديث الدخول بالاسم ورقم العضوية
-- شغّلي هذا الملف مرة واحدة داخل Supabase SQL Editor بعد 01_schema.sql و02_seed.sql.

alter table public.profiles
  add column if not exists membership_number text;

create unique index if not exists profiles_membership_number_unique
  on public.profiles(membership_number)
  where membership_number is not null;

do $$ begin
  alter table public.profiles
    add constraint profiles_membership_number_format
    check (membership_number is null or membership_number ~ '^[0-9]{5,12}$');
exception when duplicate_object then null;
end $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path=public
as $$
declare
  v_membership text := nullif(new.raw_user_meta_data->>'membership_number','');
begin
  insert into public.profiles(id,full_name,email,membership_number)
  values(
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name',''),'عضو'),
    case when v_membership is null then new.email else null end,
    v_membership
  )
  on conflict(id) do update set
    email=excluded.email,
    full_name=excluded.full_name,
    membership_number=coalesce(public.profiles.membership_number,excluded.membership_number);
  return new;
end; $$;

create or replace function public.protect_profile_role()
returns trigger
language plpgsql security definer
set search_path=public
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then new.role:=old.role; end if;
  if new.membership_number is distinct from old.membership_number and not public.is_admin() then new.membership_number:=old.membership_number; end if;
  new.updated_at:=now();
  return new;
end; $$;

-- يعيد تحميل مخطط PostgREST بعد إضافة العمود.
notify pgrst, 'reload schema';
