-- Consolidate the report dashboard into one network round trip.

create or replace function public.report_dashboard(
  p_start_date date default null,
  p_end_date date default null,
  p_status text default null,
  p_payment_method text default null,
  p_table_number int default null,
  p_waiter_name text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'summary', coalesce((
      select to_jsonb(summary_row)
      from public.report_sales_summary(
        p_start_date, p_end_date, p_status, p_payment_method, p_table_number, p_waiter_name
      ) summary_row
      limit 1
    ), '{}'::jsonb),
    'by_day', coalesce((
      select jsonb_agg(to_jsonb(day_row) order by day_row.business_date)
      from public.report_sales_by_day(
        p_start_date, p_end_date, p_status, p_payment_method, p_table_number, p_waiter_name
      ) day_row
    ), '[]'::jsonb),
    'top_products', coalesce((
      select jsonb_agg(to_jsonb(product_row))
      from public.report_top_products(
        p_start_date, p_end_date, p_status, p_payment_method, p_table_number, p_waiter_name
      ) product_row
    ), '[]'::jsonb),
    'profit', coalesce((
      select to_jsonb(profit_row)
      from public.report_profit_loss(p_start_date, p_end_date) profit_row
      limit 1
    ), '{}'::jsonb)
  );
$$;

