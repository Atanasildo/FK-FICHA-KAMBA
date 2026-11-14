const IGNORED = new Set(["fc", "cf", "sc", "afc", "cp", "club", "football", "clube", "de", "da", "do", "the", "u19", "u20", "u21", "u23"]);

export function normalizeTeamName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(token => token && !IGNORED.has(token));
}

function coverage(teamTokens, candidateTokens) {
  if (!teamTokens.length) return 0;
  const available = new Set(candidateTokens);
  return teamTokens.filter(token => available.has(token)).length / teamTokens.length;
}

export function matchEventLink(fixture, candidate) {
  const home = normalizeTeamName(fixture.home);
  const away = normalizeTeamName(fixture.away);
  const text = normalizeTeamName(candidate.text);
  const homeScore = coverage(home, text);
  const awayScore = coverage(away, text);
  // Requer pelo menos 70% dos termos distintivos de cada equipa.
  // Evita associar eventos apenas por competição, cidade ou um nome comum.
  return homeScore >= 0.7 && awayScore >= 0.7
    ? { matched: true, score: Math.round((homeScore + awayScore) * 50) }
    : { matched: false, score: 0 };
}

export function selectUniqueEventLink(fixture, candidates) {
  const matches = candidates
    .map(candidate => ({ candidate, ...matchEventLink(fixture, candidate) }))
    .filter(item => item.matched)
    .sort((a, b) => b.score - a.score);

  if (!matches.length) return { status: "not_found", candidates: [] };
  if (matches.length > 1 && matches[0].score === matches[1].score &&
      matches[0].candidate.url !== matches[1].candidate.url) {
    return { status: "ambiguous", candidates: matches.slice(0, 5).map(x => x.candidate) };
  }
  return { status: "matched", candidate: matches[0].candidate, score: matches[0].score };
}
