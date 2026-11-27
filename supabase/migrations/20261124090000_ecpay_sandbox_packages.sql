-- 积分包改为两档（2026-11-24）：50 元 500 积分、100 元 1200 积分。
-- 旧的沙盒订单保留不动，新约束只检查之后写入的订单（not valid）。
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.ecpay_sandbox_orders'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%price_cny%'
  loop
    execute format('alter table public.ecpay_sandbox_orders drop constraint %I', c);
  end loop;
end $$;

alter table public.ecpay_sandbox_orders
  add constraint ecpay_sandbox_orders_package_check
  check ((points, price_cny, charge_twd) in ((500, 50, 225), (1200, 100, 450))) not valid;
