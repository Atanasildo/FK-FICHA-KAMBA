const TEAM_ALIASES = new Map([
  ["mocambique", "mozambique"],
  ["mozambique", "mozambique"],
  ["etiopia", "ethiopia"],
  ["ethiopia", "ethiopia"],
  ["paraguai", "paraguay"],
  ["paraguay", "paraguay"],
  ["ilhascomores", "comoros"],
  ["comoros", "comoros"],
  ["bosniaandherzegovina", "bosniaherzegovina"],
  ["bosniaherzegovina", "bosniaherzegovina"]
]);

export function normalizeTeamName(value) {
  const normalized = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
  return TEAM_ALIASES.get(normalized) || normalized;
}

export function selectCanonicalMatch(swarm, sportMatches, claimedIds = new Set()) {
  const home = normalizeTeamName(swarm?.home_team);
  const away = normalizeTeamName(swarm?.away_team);
  const kickoff = Date.parse(swarm?.kickoff_at || "");
  if (!home || !away || !Number.isFinite(kickoff)) return null;

  const candidates = (sportMatches || [])
    .filter(match => !claimedIds.has(match.id) &&
      normalizeTeamName(match.home_team) === home &&
      normalizeTeamName(match.away_team) === away &&
      Number.isFinite(Date.parse(match.kickoff_at || "")))
    .map(match => ({ match, delta: Math.abs(Date.parse(match.kickoff_at) - kickoff) }))
    .filter(item => item.delta <= 90 * 60 * 1000)
    .sort((a, b) => a.delta - b.delta);

  if (!candidates.length) return null;
  if (candidates.length > 1 &&
      candidates[1].delta - candidates[0].delta < 15 * 60 * 1000) return null;
  return candidates[0].match;
}
