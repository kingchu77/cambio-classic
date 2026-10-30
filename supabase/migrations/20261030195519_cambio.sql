-- Secret state has no client grants and no Realtime publication.
create table public.cambio_rooms (
  code text primary key check (code ~ '^[A-HJ-NP-Z2-9]{10}$'),
  creator uuid not null references auth.users(id) on delete cascade,
  create_request text not null,
  state jsonb not null,
  version bigint not null default 1,
  expires_at timestamptz not null default now() + interval '7 days',
  unique (creator, create_request)
);
create table public.cambio_receipts (
  room_code text not null references public.cambio_rooms(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null,
  created_at timestamptz not null default now(),
  primary key(room_code,user_id,request_id)
);
create table public.cambio_views (
  room_code text not null references public.cambio_rooms(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  expires_at timestamptz not null default now() + interval '7 days',
  primary key(room_code,user_id)
);
create table public.cambio_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  window_start bigint not null,
  count integer not null,
  primary key(user_id,bucket)
);
alter table public.cambio_rooms enable row level security;
alter table public.cambio_receipts enable row level security;
alter table public.cambio_views enable row level security;
alter table public.cambio_limits enable row level security;
revoke all on public.cambio_rooms,public.cambio_receipts,public.cambio_views,public.cambio_limits from anon,authenticated;
grant select on public.cambio_views to authenticated;
grant all on public.cambio_rooms,public.cambio_receipts,public.cambio_views,public.cambio_limits to service_role;
create policy "only your own live projection" on public.cambio_views for select to authenticated
  using ((select auth.uid()) = user_id and expires_at > now());

create function public.cambio_rate(p_uid uuid,p_bucket text,p_window bigint,p_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.cambio_limits(user_id,bucket,window_start,count) values(p_uid,p_bucket,p_window,1)
  on conflict(user_id,bucket) do update set
    window_start=excluded.window_start,
    count=case when cambio_limits.window_start=excluded.window_start then cambio_limits.count+1 else 1 end
  returning count into n;
  return n <= p_limit;
end; $$;

create function public.cambio_commit(p_code text,p_version bigint,p_state jsonb,p_uid uuid,p_request text,p_views jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare v bigint; item jsonb;
begin
  -- Row lock gives one canonical order to simultaneous actions/snaps.
  select version into v from public.cambio_rooms where code=p_code and expires_at>now() for update;
  if not found then return 'conflict'; end if;
  if exists(select 1 from public.cambio_receipts where room_code=p_code and user_id=p_uid and request_id=p_request) then return 'duplicate'; end if;
  if v<>p_version then return 'conflict'; end if;
  update public.cambio_rooms set state=p_state,version=v+1,expires_at=now()+interval '7 days' where code=p_code;
  insert into public.cambio_receipts(room_code,user_id,request_id) values(p_code,p_uid,p_request);
  for item in select * from jsonb_array_elements(p_views) loop
    insert into public.cambio_views(room_code,user_id,payload,expires_at)
      values(p_code,(item->>'uid')::uuid,item->'payload',now()+interval '7 days')
    on conflict(room_code,user_id) do update set payload=excluded.payload,expires_at=excluded.expires_at;
  end loop;
  return 'ok';
end; $$;

create function public.cambio_create(p_code text,p_uid uuid,p_request text,p_state jsonb,p_view jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare existing_code text;
begin
  select code into existing_code from public.cambio_rooms where creator=p_uid and create_request=p_request and expires_at>now();
  if found then return existing_code; end if;
  begin
    insert into public.cambio_rooms(code,creator,create_request,state) values(p_code,p_uid,p_request,p_state);
  exception when unique_violation then
    select code into existing_code from public.cambio_rooms where creator=p_uid and create_request=p_request;
    return existing_code;
  end;
  insert into public.cambio_views(room_code,user_id,payload) values(p_code,p_uid,p_view);
  return p_code;
end; $$;

-- Only the verified server can call these functions, including with guessed IDs.
revoke all on function public.cambio_commit(text,bigint,jsonb,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.cambio_create(text,uuid,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.cambio_rate(uuid,text,bigint,integer) from public,anon,authenticated;
grant execute on function public.cambio_commit(text,bigint,jsonb,uuid,text,jsonb) to service_role;
grant execute on function public.cambio_create(text,uuid,text,jsonb,jsonb) to service_role;
grant execute on function public.cambio_rate(uuid,text,bigint,integer) to service_role;

alter publication supabase_realtime add table public.cambio_views;
-- Optional periodic maintenance: delete from public.cambio_rooms where expires_at < now();
-- Cascades remove receipts and projections. No live room is affected.
