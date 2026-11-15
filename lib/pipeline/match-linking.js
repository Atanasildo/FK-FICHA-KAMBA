import { selectUniqueTeamFixture } from "../bookmakers/team-matching.js";

export function normalizeTeamName(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function selectCanonicalMatch(swarm, sportMatches, claimedIds = new Set()) {
  return selectUniqueTeamFixture(
    swarm?.home_team,
    swarm?.away_team,
    swarm?.kickoff_at,
    sportMatches,
    { claimedIds, maxDeltaMs: 90 * 60 * 1000, threshold: 0.8 }
  );
}
