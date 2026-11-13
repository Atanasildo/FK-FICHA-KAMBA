-- FK — rolling retention for bookmaker odds and comparison snapshots.
-- Keep the last 3 days of odds/comparisons. Historical analyses, tickets,
-- ticket legs/results, match statistics, and matches referenced by that history remain intact.

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create index if not exists odds_comparisons_created_at_idx
  on public.odds_comparisons (created_at);

create index if not exists ticket_legs_market_id_retention_idx
  on public.ticket_legs (market_id)
  where market_id is not null;

create index if not exists matches_retention_date_idx
  on public.matches ((coalesce(kickoff_at, created_at)));

create or replace function public.cleanup_fk_odds_retention()
returns table (
  deleted_markets bigint,
  deleted_comparisons bigint,
  deleted_matches bigint
)
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_cutoff timestamptz := now() - interval '3 days';
  v_rows bigint;
begin
  deleted_markets := 0;
  loop
    with batch as (
      select id
      from public.markets
      where collected_at < v_cutoff
      order by collected_at
      limit 10000
    )
    delete from public.markets as m
    using batch
    where m.id = batch.id;

    get diagnostics v_rows = row_count;
    deleted_markets := deleted_markets + v_rows;
    exit when v_rows = 0;
  end loop;

  deleted_comparisons := 0;
  loop
    with batch as (
      select id
      from public.odds_comparisons
      where created_at < v_cutoff
      order by created_at
      limit 2000
    )
    delete from public.odds_comparisons as c
    using batch
    where c.id = batch.id;

    get diagnostics v_rows = row_count;
    deleted_comparisons := deleted_comparisons + v_rows;
    exit when v_rows = 0;
  end loop;

  -- Remove only stale fixture shells with no odds or historical records.
  -- Matches linked to analyses, statistics, tickets/results, or recent data stay.
  delete from public.matches as m
  where coalesce(m.kickoff_at, m.created_at) < v_cutoff
    and not exists (select 1 from public.markets x where x.match_id = m.id)
    and not exists (select 1 from public.odds_comparisons x where x.match_id = m.id)
    and not exists (select 1 from public.match_statistics x where x.match_id = m.id)
    and not exists (select 1 from public.match_analyses x where x.match_id = m.id)
    and not exists (select 1 from public.ticket_legs x where x.match_id = m.id);

  get diagnostics deleted_matches = row_count;
  return next;
end;
$function$;

revoke all on function public.cleanup_fk_odds_retention() from public;
revoke all on function public.cleanup_fk_odds_retention() from anon, authenticated;
grant execute on function public.cleanup_fk_odds_retention() to postgres;

-- Run hourly (UTC); cleanup is independent of the user's PC and Vercel.
select cron.schedule(
  'fk-odds-retention-3-days',
  '0 * * * *',
  'select public.cleanup_fk_odds_retention();'
);

-- Apply the first cleanup immediately, using the same protected routine.
select * from public.cleanup_fk_odds_retention();
