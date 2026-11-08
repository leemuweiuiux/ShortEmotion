-- The test receipt is the source of test credits. The live wallet and ledger are separate.
create table public.ecpay_sandbox_orders (
  order_no text primary key check (order_no ~ '^SE[A-F0-9]{18}$'),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  points integer not null,
  price_cny integer not null,
  charge_twd integer not null,
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  trade_no text unique,
  credited_at timestamptz,
  check ((points, price_cny, charge_twd) in ((30, 10, 45), (240, 50, 225), (500, 100, 450))),
  check ((trade_no is null) = (credited_at is null))
);
create index ecpay_sandbox_orders_user_created_idx on public.ecpay_sandbox_orders (user_id, created_at desc);
alter table public.ecpay_sandbox_orders enable row level security;

revoke all on public.ecpay_sandbox_orders from public, anon, authenticated, service_role;
grant select on public.ecpay_sandbox_orders to authenticated, service_role;
grant insert (order_no, points, price_cny, charge_twd) on public.ecpay_sandbox_orders to authenticated;
grant update (trade_no, credited_at, checked_at) on public.ecpay_sandbox_orders to service_role;

create policy "Read own test orders" on public.ecpay_sandbox_orders for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Create own pending test orders" on public.ecpay_sandbox_orders for insert to authenticated
  with check (user_id = (select auth.uid()) and trade_no is null and credited_at is null);
