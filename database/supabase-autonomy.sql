-- REVIEW ONLY: do not run automatically. Target: pablo-ventures.
-- Legacy database/*.sql belong to the separate Autonomy project. Do not run them here.
begin;
create schema if not exists autonomy_private;
revoke all on schema autonomy_private from public, anon;
grant usage on schema autonomy_private to authenticated;

create table public.autonomy_households (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 name text not null check(length(name) between 1 and 100), created_at timestamptz not null default now()
);
create table public.autonomy_members (
 household_id uuid not null references public.autonomy_households(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('owner','editor')), email text not null,
 primary key(household_id,user_id)
);
create index autonomy_members_user on public.autonomy_members(user_id);
create table public.autonomy_plans (
 household_id uuid primary key references public.autonomy_households(id) on delete cascade,
 data jsonb not null default '{}'::jsonb check(pg_column_size(data)<1800000),
 revision integer not null default 0 check(revision>=0), updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id)
);
-- Planning collections (income, bills, debts, goals, CSV transactions, settings)
-- are stored together in data, preserving the existing validated backup format.
create table public.autonomy_invites (
 household_id uuid primary key references public.autonomy_households(id) on delete cascade,
 code_hash text not null unique, expires_at timestamptz not null, used_at timestamptz
);
create function autonomy_private.is_member(h uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and exists (
 select 1 from public.autonomy_members where household_id=h and user_id=(select auth.uid()))
$$;
revoke all on function autonomy_private.is_member(uuid) from public,anon;
grant execute on function autonomy_private.is_member(uuid) to authenticated;
alter table public.autonomy_households enable row level security;
alter table public.autonomy_members enable row level security;
alter table public.autonomy_plans enable row level security;
alter table public.autonomy_invites enable row level security;
revoke all on public.autonomy_households,public.autonomy_members,public.autonomy_plans,public.autonomy_invites from anon,authenticated;
grant select on public.autonomy_households,public.autonomy_members,public.autonomy_plans to authenticated;
grant update(name) on public.autonomy_households to authenticated;
create policy autonomy_households_read on public.autonomy_households for select to authenticated using(autonomy_private.is_member(id));
create policy autonomy_households_update on public.autonomy_households for update to authenticated
 using(owner_id=(select auth.uid()) and autonomy_private.is_member(id))
 with check(owner_id=(select auth.uid()) and autonomy_private.is_member(id));
create policy autonomy_members_read on public.autonomy_members for select to authenticated using(autonomy_private.is_member(household_id));
create policy autonomy_plans_read on public.autonomy_plans for select to authenticated using(autonomy_private.is_member(household_id));
create function public.autonomy_is_live_session(p_session uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and exists(select 1 from auth.sessions
 where id=p_session and user_id=(select auth.uid()) and (not_after is null or not_after>now()))
$$;
revoke all on function public.autonomy_is_live_session(uuid) from public,anon;
grant execute on function public.autonomy_is_live_session(uuid) to authenticated;
-- All writes below are atomic, checked RPCs; membership/owner IDs cannot be reassigned via REST.
create function public.autonomy_create_household(p_name text,p_plan jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid:=(select auth.uid()); h uuid;
begin
 if u is null then raise exception 'Sign in first'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 100 then raise exception 'Enter a household name'; end if;
 perform 1 from auth.users where id=u for update;
 if (select count(*) from public.autonomy_members where user_id=u)>=10 then raise exception 'Household limit reached'; end if;
 insert into public.autonomy_households(owner_id,name) values(u,trim(p_name)) returning id into h;
 insert into public.autonomy_members values(h,u,'owner',coalesce((select email from auth.users where id=u),''));
 insert into public.autonomy_plans(household_id,data,updated_by) values(h,coalesce(p_plan,'{}'::jsonb),u);
 return h;
end $$;
create function public.autonomy_invite_partner(p_household uuid) returns text
language plpgsql security definer set search_path='' as $$
declare code text;
begin
 if not exists(select 1 from public.autonomy_households where id=p_household and owner_id=(select auth.uid())) then raise exception 'Owner access required'; end if;
 perform 1 from public.autonomy_households where id=p_household for update;
 if (select count(*) from public.autonomy_members where household_id=p_household)>=2 then raise exception 'Both partner slots are filled'; end if;
 code:=replace(gen_random_uuid()::text,'-','');
 insert into public.autonomy_invites(household_id,code_hash,expires_at)
 values(p_household,encode(sha256(convert_to(code,'UTF8')),'hex'),now()+interval '7 days')
 on conflict(household_id) do update set code_hash=excluded.code_hash,expires_at=excluded.expires_at,used_at=null;
 return code;
end $$;
create function public.autonomy_join_household(p_code text) returns uuid
language plpgsql security definer set search_path='' as $$
declare h uuid; u uuid:=(select auth.uid());
begin
 if u is null or p_code is null or p_code !~ '^[a-f0-9]{32}$' then raise exception 'Invalid join code'; end if;
 select household_id into h from public.autonomy_invites where code_hash=encode(sha256(convert_to(p_code,'UTF8')),'hex') and expires_at>now() and used_at is null;
 if h is null then raise exception 'Invalid or expired join code'; end if;
 perform 1 from public.autonomy_households where id=h for update;
 -- Recheck after obtaining the household lock to serialize joins and code rotation.
 if not exists(select 1 from public.autonomy_invites where household_id=h and code_hash=encode(sha256(convert_to(p_code,'UTF8')),'hex') and expires_at>now() and used_at is null) then raise exception 'Invalid or expired join code'; end if;
 if exists(select 1 from public.autonomy_members where household_id=h and user_id=u) then raise exception 'Already a household member'; end if;
 if (select count(*) from public.autonomy_members where household_id=h)>=2 then raise exception 'Both partner slots are filled'; end if;
 insert into public.autonomy_members values(h,u,'editor',coalesce((select email from auth.users where id=u),''));
 update public.autonomy_invites set used_at=now() where household_id=h;
 return h;
end $$;
create function public.autonomy_save_plan(p_household uuid,p_revision integer,p_data jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare rev integer;
begin
 -- Same lock as member removal: a revoked partner cannot race a plan write.
 perform 1 from public.autonomy_households where id=p_household for update;
 if not autonomy_private.is_member(p_household) then raise exception 'Household access denied'; end if;
 if p_revision is null or p_revision<0 or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Invalid plan'; end if;
 update public.autonomy_plans set data=p_data,revision=revision+1,updated_at=now(),updated_by=(select auth.uid())
 where household_id=p_household and revision=p_revision returning revision into rev;
 if rev is null then raise exception 'Another partner saved newer changes. Export your draft and refresh.' using errcode='40001'; end if;
 return rev;
end $$;
create function public.autonomy_remove_partner(p_household uuid,p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.autonomy_households where id=p_household for update;
 if not exists(select 1 from public.autonomy_households where id=p_household and owner_id=(select auth.uid()) and owner_id<>p_user) then raise exception 'Owner access required'; end if;
 delete from public.autonomy_members where household_id=p_household and user_id=p_user and role='editor';
 delete from public.autonomy_invites where household_id=p_household;
end $$;

-- Allow 'autonomy' in the shared usage registry and mirror DOOOD's self-only policies.
alter table public.app_users drop constraint app_users_app_check;
alter table public.app_users add constraint app_users_app_check
 check (app in ('janus','doood','flip_hub','dashboard','other','autonomy'));
create policy "autonomy user records self" on public.app_users for insert to authenticated
 with check (app = 'autonomy' and user_id = (select auth.uid())::text);
create policy "autonomy user reads self" on public.app_users for select to authenticated
 using (app = 'autonomy' and user_id = (select auth.uid())::text);
create policy "autonomy user touches self" on public.app_users for update to authenticated
 using (app = 'autonomy' and user_id = (select auth.uid())::text)
 with check (app = 'autonomy' and user_id = (select auth.uid())::text);
create policy "autonomy user logs session" on public.app_sessions for insert to authenticated
 with check (app = 'autonomy' and user_id = (select auth.uid())::text);

-- Invoker rights, so the policies above stay authoritative.
create function public.autonomy_record_usage() returns void
language sql security invoker set search_path='' as $$
 insert into public.app_users(app,user_id,email)
 values('autonomy',(select auth.uid())::text,coalesce((select auth.jwt())->>'email',''))
 on conflict (app,user_id) do update set last_seen_at=now();
$$;
-- No PUBLIC/anon execution on any of these security-definer endpoints.
revoke all on function public.autonomy_create_household(text,jsonb),public.autonomy_invite_partner(uuid),public.autonomy_join_household(text),public.autonomy_save_plan(uuid,integer,jsonb),public.autonomy_remove_partner(uuid,uuid),public.autonomy_record_usage() from public,anon;
grant execute on function public.autonomy_create_household(text,jsonb),public.autonomy_invite_partner(uuid),public.autonomy_join_household(text),public.autonomy_save_plan(uuid,integer,jsonb),public.autonomy_remove_partner(uuid,uuid),public.autonomy_record_usage() to authenticated;
commit;
