create function public.is_live_session(p_session uuid) returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from auth.sessions where id=p_session and (not_after is null or not_after>now()))
$$;
revoke all on function public.is_live_session(uuid) from public,anon,authenticated;
grant execute on function public.is_live_session(uuid) to service_role;
create table public.reminder_deliveries (
 notification_id uuid references public.notifications(id) on delete cascade, recipient_id uuid references auth.users(id) on delete cascade,
 status text not null default 'pending', attempts integer not null default 0, sent_at timestamptz,
 primary key(notification_id,recipient_id)
);
alter table public.reminder_deliveries enable row level security;
revoke all on public.reminder_deliveries from public,anon,authenticated;
grant all on public.reminder_deliveries to service_role;
