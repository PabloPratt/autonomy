create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create table public.households (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 name text not null check(char_length(name) between 1 and 100), created_at timestamptz not null default now()
);
create table public.household_members (
 household_id uuid references public.households(id) on delete cascade, user_id uuid references auth.users(id) on delete cascade,
 role text not null check(role in ('owner','editor','viewer')), email text not null,
 primary key(household_id,user_id)
);
create or replace function private.has_access(h uuid, editing boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.household_members m where m.household_id=h and m.user_id=auth.uid() and (not editing or m.role in ('owner','editor')))
$$;
revoke all on function private.has_access(uuid,boolean) from public;
grant execute on function private.has_access(uuid,boolean) to authenticated;
create table public.household_plans (
 household_id uuid primary key references public.households(id) on delete cascade,
 revision integer not null default 0, data jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now(), updated_by uuid references auth.users(id),
 check(pg_column_size(data)<2000000)
);
create table public.household_invites (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 email text not null, role text not null check(role in ('editor','viewer')),
 token_hash text not null unique, expires_at timestamptz not null default now()+interval '7 days', used_at timestamptz,
 created_by uuid not null references auth.users(id)
);
create table public.connections (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 user_id uuid not null references auth.users(id), provider text not null check(provider in ('plaid','argyle')),
 environment text not null check(environment in ('sandbox','production')), external_id text not null,
 label text not null default '', status text not null default 'pending', last_sync timestamptz,
 unique(provider,external_id)
);
create table public.provider_secrets (
 connection_id uuid primary key references public.connections(id) on delete cascade,
 ciphertext text not null, cursor text, updated_at timestamptz not null default now()
);
create table public.bank_accounts (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 connection_id uuid not null references public.connections(id) on delete cascade,
 external_id text not null unique, name text not null, mask text, type text not null, subtype text, balance numeric,
 currency text not null default 'USD', updated_at timestamptz not null default now()
);
create table public.bank_transactions (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 connection_id uuid not null references public.connections(id) on delete cascade,
 external_id text not null unique, account_external_id text not null, date date not null,
 name text not null, amount numeric not null, category text not null default 'Other',
 pending boolean not null default false, is_transfer boolean not null default false
);
create index transactions_household_date on public.bank_transactions(household_id,date);
create table public.paystubs (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 connection_id uuid not null references public.connections(id) on delete cascade,
 external_id text not null unique, employer text, pay_date date, net numeric, gross numeric, currency text default 'USD',
 updated_at timestamptz not null default now()
);
create table public.notifications (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id) on delete cascade,
 event_key text not null, event_date date not null, title text not null, body text not null,
 created_at timestamptz not null default now(), unique(household_id,event_key,event_date)
);
create table public.audit_events (
 id bigint generated always as identity primary key, household_id uuid references public.households(id) on delete cascade,
 actor_id uuid references auth.users(id), action text not null, created_at timestamptz not null default now()
);
create table private.settings(key text primary key, value text not null);
insert into private.settings values('cron_secret',encode(gen_random_bytes(32),'hex')) on conflict do nothing;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_plans enable row level security;
alter table public.household_invites enable row level security;
alter table public.connections enable row level security;
alter table public.provider_secrets enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.bank_transactions enable row level security;
alter table public.paystubs enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_events enable row level security;
revoke all on all tables in schema public from anon,authenticated;
grant select on public.households,public.household_members,public.household_plans,public.connections,public.bank_accounts,public.bank_transactions,public.paystubs,public.notifications,public.audit_events to authenticated;
create policy household_read on public.households for select to authenticated using(private.has_access(id));
create policy member_read on public.household_members for select to authenticated using(private.has_access(household_id));
create policy plan_read on public.household_plans for select to authenticated using(private.has_access(household_id));
create policy connection_read on public.connections for select to authenticated using(private.has_access(household_id));
create policy account_read on public.bank_accounts for select to authenticated using(private.has_access(household_id));
create policy transaction_read on public.bank_transactions for select to authenticated using(private.has_access(household_id));
create policy paystub_read on public.paystubs for select to authenticated using(private.has_access(household_id));
create policy notification_read on public.notifications for select to authenticated using(private.has_access(household_id));
create policy audit_read on public.audit_events for select to authenticated using(private.has_access(household_id));
-- Writes are performed by the authenticated backend after explicit role checks.
-- No authenticated or anonymous role can write memberships, provider data or secrets.
grant all on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;

create function public.get_worker_secret() returns text language sql security definer set search_path='' as $$
 select value from private.settings where key='cron_secret'
$$;
revoke all on function public.get_worker_secret() from public,anon,authenticated;
grant execute on function public.get_worker_secret() to service_role;
create function public.create_household(p_user uuid,p_email text,p_name text,p_plan jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare h uuid;
begin
 insert into public.households(owner_id,name) values(p_user,p_name) returning id into h;
 insert into public.household_members values(h,p_user,'owner',p_email);
 insert into public.household_plans(household_id,data,updated_by) values(h,p_plan,p_user);
 insert into public.audit_events(household_id,actor_id,action) values(h,p_user,'household_created');
 return h;
end $$;
revoke all on function public.create_household(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_household(uuid,text,text,jsonb) to service_role;
create function public.accept_household_invite(p_user uuid,p_email text,p_hash text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare inv public.household_invites;
begin
 select * into inv from public.household_invites where token_hash=p_hash and lower(email)=lower(p_email) and used_at is null and expires_at>now() for update;
 if not found then raise exception 'Invitation is invalid, expired, or belongs to a different email.'; end if;
 insert into public.household_members(household_id,user_id,role,email) values(inv.household_id,p_user,inv.role,p_email) on conflict do nothing;
 update public.household_invites set used_at=now() where id=inv.id;
 insert into public.audit_events(household_id,actor_id,action) values(inv.household_id,p_user,'invitation_accepted');
 return inv.household_id;
end $$;
revoke all on function public.accept_household_invite(uuid,text,text) from public,anon,authenticated;
grant execute on function public.accept_household_invite(uuid,text,text) to service_role;
