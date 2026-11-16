-- Retain each day's Swarm fixtures for the full Angola calendar day.
-- The scheduled job runs every 10 minutes; on the next Luanda date it
-- removes prior-day fixtures and their odds/comparison data.
-- Ticket legs keep their historical rows (match_id is ON DELETE SET NULL).
-- Analyses and statistics follow the match FK cascade.

CREATE OR REPLACE FUNCTION private.cleanup_expired_swarm_matches()
RETURNS TABLE(deleted_matches bigint, deleted_comparisons bigint)
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_activated_at timestamptz;
  v_activation_day date;
  v_today_luanda date;
  v_match_ids uuid[];
  v_deleted_matches bigint := 0;
  v_deleted_comparisons bigint := 0;
BEGIN
  SELECT activated_at
    INTO v_activated_at
  FROM private.retention_policy
  WHERE policy_name = 'swarm_matches_10h';

  IF v_activated_at IS NULL THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint;
    RETURN;
  END IF;

  v_activation_day := (v_activated_at AT TIME ZONE 'Africa/Luanda')::date;
  v_today_luanda := (clock_timestamp() AT TIME ZONE 'Africa/Luanda')::date;

  SELECT COALESCE(array_agg(expired.id), ARRAY[]::uuid[])
    INTO v_match_ids
  FROM (
    SELECT m.id
    FROM public.matches AS m
    WHERE m.source = 'swarm'
      AND m.kickoff_at IS NOT NULL
      AND (m.kickoff_at AT TIME ZONE 'Africa/Luanda')::date >= v_activation_day
      AND (m.kickoff_at AT TIME ZONE 'Africa/Luanda')::date < v_today_luanda
    FOR UPDATE SKIP LOCKED
  ) AS expired;

  IF cardinality(v_match_ids) = 0 THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint;
    RETURN;
  END IF;

  DELETE FROM public.odds_comparisons AS oc
  WHERE oc.match_id = ANY(v_match_ids);
  GET DIAGNOSTICS v_deleted_comparisons = ROW_COUNT;

  DELETE FROM public.matches AS m
  WHERE m.id = ANY(v_match_ids);
  GET DIAGNOSTICS v_deleted_matches = ROW_COUNT;

  RETURN QUERY SELECT v_deleted_matches, v_deleted_comparisons;
END;
$function$;
