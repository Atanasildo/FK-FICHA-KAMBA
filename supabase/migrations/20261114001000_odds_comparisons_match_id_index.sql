-- Speed up pipeline lookups by canonical match_id and newest comparison.
create index if not exists odds_comparisons_match_id_created_at_idx
  on public.odds_comparisons (match_id, created_at desc);
