-- Save large Swarm comparison JSON with a scoped statement timeout.
-- The function runs with the caller's privileges; only service_role may execute it.
create or replace function public.save_swarm_comparison(
  p_batch_id uuid,
  p_match_id uuid,
  p_comparison jsonb,
  p_best_prices jsonb
)
returns void
language plpgsql
set statement_timeout = '60s'
as $$
begin
  insert into public.odds_comparisons (
    ingest_batch_id,
    match_id,
    comparison,
    best_prices
  )
  values (
    p_batch_id,
    p_match_id,
    p_comparison,
    coalesce(p_best_prices, '[]'::jsonb)
  )
  on conflict (ingest_batch_id, match_id)
  do update set
    comparison = excluded.comparison,
    best_prices = excluded.best_prices;
end;
$$;

revoke all on function public.save_swarm_comparison(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_swarm_comparison(uuid, uuid, jsonb, jsonb)
  to service_role;

notify pgrst, 'reload schema';
