-- Make each swarm ingestion batch safely replayable.
-- Historical rows receive independent UUIDs; new swarm rows share the request batch ID.
alter table public.markets
  add column if not exists ingest_batch_id uuid not null default gen_random_uuid();

alter table public.odds_comparisons
  add column if not exists ingest_batch_id uuid not null default gen_random_uuid();

create unique index if not exists markets_swarm_batch_dedupe_idx
  on public.markets (
    ingest_batch_id,
    match_id,
    bookmaker_id,
    market_key,
    period,
    line,
    selection
  ) nulls not distinct;

create unique index if not exists odds_comparisons_swarm_batch_dedupe_idx
  on public.odds_comparisons (ingest_batch_id, match_id);
