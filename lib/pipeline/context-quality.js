const MAX_RECENT_RESULT_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const FINISHED = /^(FT|AET|PENS)$/i;

function validRecentResult(result, now) {
  if (!result || !FINISHED.test(String(result.status || ""))) return false;
  const date = Date.parse(result.date || result.datetime || "");
  if (!Number.isFinite(date) || date > now || now - date > MAX_RECENT_RESULT_AGE_MS) return false;
  return result.home_score != null && result.away_score != null &&
    Number.isFinite(Number(result.home_score)) && Number.isFinite(Number(result.away_score));
}

function hasRecentTeamForm(team, now) {
  return Array.isArray(team?.recentResults) &&
    team.recentResults.filter(result => validRecentResult(result, now)).length >= 3;
}

export function hasUsableAnalysisContext(payload, now = Date.now()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const stats = payload.matchStats;
  if (stats && typeof stats === "object" && Object.keys(stats).length > 0) return true;
  return hasRecentTeamForm(payload.homeTeam, now) && hasRecentTeamForm(payload.awayTeam, now);
}

export function isFreshAnalysisContext(row, now = Date.now(), maxAgeMs = 12 * 60 * 60 * 1000) {
  const collectedAt = Date.parse(row?.collected_at || row?.payload?.collectedAt || "");
  return Number.isFinite(collectedAt) && now - collectedAt >= 0 &&
    now - collectedAt <= maxAgeMs && hasUsableAnalysisContext(row?.payload, now);
}
