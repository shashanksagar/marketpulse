create table if not exists public.market_snapshots (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.paper_portfolios (
  id uuid primary key,
  user_key uuid not null unique,
  initial_capital numeric not null check (initial_capital >= 1000),
  cash_balance numeric not null,
  realized_pnl numeric not null default 0,
  created_at timestamptz not null default now(),
  revision integer not null default 0,
  last_evaluated_at timestamptz,
  processed_quotes jsonb not null default '{}'
);
create table if not exists public.algo_strategies (
  id uuid primary key,
  user_key uuid not null,
  name text not null,
  preset_type text not null check (preset_type in ('orb','oi-trend','ema','rsi','sector','squeeze','custom')),
  is_active boolean not null default false,
  capital_allocation_pct numeric not null check (capital_allocation_pct > 0 and capital_allocation_pct <= 100),
  stop_loss_pct numeric not null check (stop_loss_pct > 0 and stop_loss_pct < 100),
  target_pct numeric not null check (target_pct > 0 and target_pct < 100),
  trailing_sl_pct numeric not null default 0 check (trailing_sl_pct >= 0 and trailing_sl_pct < 100),
  params_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table if not exists public.paper_positions (
  id uuid primary key,
  portfolio_id uuid not null references public.paper_portfolios(id) on delete cascade,
  strategy_id uuid not null references public.algo_strategies(id),
  symbol text not null,
  side text not null check (side in ('LONG','SHORT')),
  qty integer not null check (qty > 0),
  avg_entry_price numeric not null check (avg_entry_price > 0),
  stop_loss_price numeric not null check (stop_loss_price > 0),
  target_price numeric not null check (target_price > 0),
  highest_price_seen numeric not null check (highest_price_seen > 0),
  entry_fees numeric not null check (entry_fees >= 0),
  last_observed_at timestamptz not null,
  opened_at timestamptz not null default now(),
  unique (portfolio_id, strategy_id, symbol)
);
create table if not exists public.paper_orders (
  id uuid primary key,
  portfolio_id uuid not null references public.paper_portfolios(id) on delete cascade,
  strategy_id uuid not null references public.algo_strategies(id),
  symbol text not null,
  side text not null check (side in ('LONG','SHORT')),
  order_type text not null check (order_type in ('ENTRY','EXIT')),
  qty integer not null check (qty > 0),
  executed_price numeric not null check (executed_price > 0),
  fees numeric not null check (fees >= 0),
  pnl numeric,
  reason text not null,
  executed_at timestamptz not null default now()
);
create index if not exists paper_orders_portfolio_time on public.paper_orders(portfolio_id, executed_at);
create index if not exists algo_strategies_user on public.algo_strategies(user_key);

-- Browser publishable keys have no table access. Identity and ownership are enforced
-- by the server's HttpOnly browser cookie; only service_role may execute these RPCs.
alter table public.market_snapshots enable row level security;
alter table public.paper_portfolios enable row level security;
alter table public.algo_strategies enable row level security;
alter table public.paper_positions enable row level security;
alter table public.paper_orders enable row level security;
revoke all on public.market_snapshots, public.paper_portfolios, public.algo_strategies, public.paper_positions, public.paper_orders from anon, authenticated;

create or replace function public.save_market_snapshot(snapshot jsonb)
returns void language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from jsonb_array_elements(snapshot->'stocks') q where (q->>'price')::numeric > 0) then
    raise exception 'Snapshot has no observed prices';
  end if;
  insert into market_snapshots(id,payload) values ('nse-latest',snapshot)
  on conflict (id) do update set payload=excluded.payload,updated_at=now()
  where (market_snapshots.payload->>'fetchedAt')::timestamptz <= (excluded.payload->>'fetchedAt')::timestamptz;
end;
$$;

create or replace function public.save_paper_state(owner_key uuid, expected_revision integer, state jsonb)
returns integer language plpgsql set search_path = public as $$
declare
  current_portfolio paper_portfolios;
  next_revision integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(owner_key::text,0));
  select * into current_portfolio from paper_portfolios where user_key=owner_key for update;
  if found then
    if current_portfolio.revision <> expected_revision then
      raise exception 'Paper state conflict; reload before saving' using errcode='40001';
    end if;
    delete from paper_orders where portfolio_id=current_portfolio.id;
    delete from paper_positions where portfolio_id=current_portfolio.id;
    delete from algo_strategies where user_key=owner_key;
    delete from paper_portfolios where id=current_portfolio.id;
  elsif expected_revision <> -1 then
    raise exception 'Paper portfolio missing; reload' using errcode='40001';
  end if;
  if (state->'portfolio'->>'user_key')::uuid <> owner_key
    or exists(select 1 from jsonb_array_elements(state->'strategies') s where (s->>'user_key')::uuid <> owner_key) then
    raise exception 'Invalid paper state owner';
  end if;
  next_revision := expected_revision+1;
  insert into paper_portfolios
    select p.id,p.user_key,p.initial_capital,p.cash_balance,p.realized_pnl,p.created_at,next_revision,(state->>'last_evaluated_at')::timestamptz,state->'processed_quotes'
    from jsonb_populate_record(null::paper_portfolios,state->'portfolio') p;
  insert into algo_strategies select * from jsonb_populate_recordset(null::algo_strategies,state->'strategies');
  insert into paper_positions select * from jsonb_populate_recordset(null::paper_positions,state->'positions');
  insert into paper_orders select * from jsonb_populate_recordset(null::paper_orders,state->'orders');
  return next_revision;
end;
$$;
revoke execute on function public.save_market_snapshot(jsonb) from public, anon, authenticated;
revoke execute on function public.save_paper_state(uuid,integer,jsonb) from public, anon, authenticated;
grant execute on function public.save_market_snapshot(jsonb) to service_role;
grant execute on function public.save_paper_state(uuid,integer,jsonb) to service_role;

create or replace function public.load_paper_state(owner_key uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'portfolio',to_jsonb(p)-'revision'-'last_evaluated_at'-'processed_quotes',
    'revision',p.revision,'last_evaluated_at',p.last_evaluated_at,'processed_quotes',p.processed_quotes,
    'strategies',coalesce((select jsonb_agg(s order by s.created_at,s.id) from algo_strategies s where s.user_key=owner_key),'[]'::jsonb),
    'positions',coalesce((select jsonb_agg(pos order by pos.opened_at,pos.id) from paper_positions pos where pos.portfolio_id=p.id),'[]'::jsonb),
    'orders',coalesce((select jsonb_agg(o order by o.executed_at,o.id) from paper_orders o where o.portfolio_id=p.id),'[]'::jsonb)
  ) from paper_portfolios p where p.user_key=owner_key;
$$;
revoke execute on function public.load_paper_state(uuid) from public, anon, authenticated;
grant execute on function public.load_paper_state(uuid) to service_role;
