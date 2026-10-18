create table public.api_rate_limits (
 bucket text not null, window_start bigint not null, count integer not null default 1,
 primary key(bucket,window_start)
);
alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from public,anon,authenticated;
grant all on public.api_rate_limits to service_role;
create function public.consume_rate_limit(p_bucket text,p_limit integer,p_window integer) returns boolean
language plpgsql security invoker set search_path='' as $$
declare n integer; w bigint:=floor(extract(epoch from now())/p_window);
begin
 insert into public.api_rate_limits(bucket,window_start,count) values(p_bucket,w,1)
 on conflict(bucket,window_start) do update set count=public.api_rate_limits.count+1 returning count into n;
 delete from public.api_rate_limits where window_start<w-1000;
 return n<=p_limit;
end $$;
revoke all on function public.consume_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_rate_limit(text,integer,integer) to service_role;
