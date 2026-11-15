import { selectUniqueTeamFixture } from "../bookmakers/team-matching.js";

export function normalizeTeamName(value) {
  const normalized = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases = new Map([["mocambique","mozambique"],["etiopia","ethiopia"],["paraguai","paraguay"],["ilhascomores","comoros"]]);
  return aliases.get(normalized) || normalized;
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
