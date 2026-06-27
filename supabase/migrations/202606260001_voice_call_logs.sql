-- Logs every voice-agent call (transcript + basic metadata), not just the ones
-- that end in an order. Today a customer who calls and hangs up without
-- ordering leaves no trace anywhere -- this is the only place that call ever
-- existed. Mirrors the voice_create_order / voice_get_menu pattern: the voice
-- agent authenticates with the restaurant's own voice api_key, not a Supabase
-- session, since it has none.

create table public.voice_call_logs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  call_sid text not null,
  customer_phone text,
  transcript jsonb not null default '[]'::jsonb,
  order_id uuid references public.orders(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index idx_voice_call_logs_call_sid on public.voice_call_logs (call_sid);
create index idx_voice_call_logs_restaurant on public.voice_call_logs (restaurant_id, created_at desc);

alter table public.voice_call_logs enable row level security;

create policy voice_call_logs_select on public.voice_call_logs
  for select using (restaurant_id = public.current_restaurant_id());

-- Voice-agent-facing function (same auth model as voice_create_order): called
-- once per call, when it ends, with the full transcript collected client-side.
-- Upserts on call_sid so a retried webhook never duplicates the log, and
-- attaches the resulting order automatically if one was placed on this call.
create or replace function public.voice_log_call(
  p_api_key text,
  p_call_sid text,
  p_customer_phone text,
  p_transcript jsonb,
  p_started_at timestamptz,
  p_ended_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id uuid;
  linked_order_id uuid;
begin
  if p_api_key is null or trim(p_api_key) = '' then
    raise exception 'Falta la API key del restaurante.';
  end if;

  select v.restaurant_id into target_restaurant_id
  from public.restaurant_voice_settings v
  where v.api_key = p_api_key and v.is_enabled = true;

  if target_restaurant_id is null then
    raise exception 'API key invalida o bot de voz no habilitado para este restaurante.';
  end if;

  if p_call_sid is null or trim(p_call_sid) = '' then
    raise exception 'Falta el call_sid de la llamada.';
  end if;

  select id into linked_order_id from public.orders where call_sid = p_call_sid;

  insert into public.voice_call_logs (
    restaurant_id, call_sid, customer_phone, transcript, order_id, started_at, ended_at
  )
  values (
    target_restaurant_id, p_call_sid, p_customer_phone, coalesce(p_transcript, '[]'::jsonb),
    linked_order_id, coalesce(p_started_at, now()), p_ended_at
  )
  on conflict (call_sid) do update set
    customer_phone = excluded.customer_phone,
    transcript = excluded.transcript,
    order_id = coalesce(excluded.order_id, public.voice_call_logs.order_id),
    ended_at = excluded.ended_at;

  return jsonb_build_object('logged', true);
end;
$$;

revoke all on function public.voice_log_call(text, text, text, jsonb, timestamptz, timestamptz) from public;
grant execute on function public.voice_log_call(text, text, text, jsonb, timestamptz, timestamptz) to anon, authenticated;
