alter table public.api_rate_limits add column expires_at timestamptz not null default now()+interval '15 minutes';
create or replace function public.consume_rate_limit(p_bucket text,p_limit integer,p_window integer) returns boolean
language plpgsql security invoker set search_path='' as $$
declare n integer; w bigint:=floor(extract(epoch from now())/p_window);
begin
 insert into public.api_rate_limits(bucket,window_start,count,expires_at) values(p_bucket,w,1,now()+make_interval(secs=>p_window))
 on conflict(bucket,window_start) do update set count=public.api_rate_limits.count+1 returning count into n;
 delete from public.api_rate_limits where expires_at<now();
 return n<=p_limit;
end $$;
create policy server_only on public.household_invites for all to authenticated using(false) with check(false);
create policy server_only on public.provider_secrets for all to authenticated using(false) with check(false);
create policy server_only on public.reminder_deliveries for all to authenticated using(false) with check(false);
create policy server_only on public.api_rate_limits for all to authenticated using(false) with check(false);
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule('autonomy-daily-reminders','15 12 * * *',
  $job$select net.http_post(
   url:='https://mswszuvtffztattslfzg.supabase.co/functions/v1/autonomy/worker',
   headers:=jsonb_build_object('Content-Type','application/json','x-worker-secret',(select value from private.settings where key='cron_secret')),
   body:='{}'::jsonb,timeout_milliseconds:=60000
  );$job$
);
