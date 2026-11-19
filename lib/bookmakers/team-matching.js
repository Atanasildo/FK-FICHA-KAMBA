const STOP = new Set([
  "fc", "cf", "sc", "ac", "club", "clube", "football", "futebol",
  "the", "and", "de", "da", "do", "dos", "das"
]);

const TOKEN_ALIASES = new Map([
  ["utd", "united"], ["munchen", "munich"], ["muenchen", "munich"],
  ["ath", "athletic"], ["athletico", "atletico"], ["st", "saint"],
  ["dep", "deportivo"], ["sport", "sporting"]
]);

const TEAM_ALIASES = new Map([
  ["sportingcp", "sporting portugal"],
  ["sportingclubeportugal", "sporting portugal"],
  ["sportinglisbon", "sporting portugal"],
  ["sportingportugal", "sporting portugal"],
  ["intermilan", "inter milan"],
  ["internazionale", "inter milan"],
  ["psg", "paris saint germain"],
  ["parissaintgermain", "paris saint germain"],
  ["manutd", "manchester united"],
  ["manunited", "manchester united"],
  ["manchesterutd", "manchester united"],
  ["mancity", "manchester city"],
  ["manchestercity", "manchester city"],
  ["spurs", "tottenham hotspur"],
  ["tottenham", "tottenham hotspur"],
  ["bayern", "bayern munich"],
  ["bayernmunchen", "bayern munich"],
  ["bayernmunich", "bayern munich"],
  ["barca", "barcelona"],
  ["atleticodemadrid", "atletico madrid"],
  ["atleticomadrid", "atletico madrid"],
  ["athleticbilbao", "athletic club"],
  ["athleticclubbilbao", "athletic club"],
  ["manchesterutd", "manchester united"],
  ["wolves", "wolverhampton"],
  ["wolverhamptonwanderers", "wolverhampton"],
  ["mocambique", "mozambique"],
  ["etiopia", "ethiopia"],
  ["paraguai", "paraguay"],
  ["ilhascomores", "comoros"],
  ["argentinajuniors", "argentinos juniors"]
]);

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function canonicalTokens(value) {
  const normalized = normalizeText(value);
  const compact = normalized.replace(/\s/g, "");
  const aliased = TEAM_ALIASES.get(compact);
  const raw = (aliased || normalized).split(" ").filter(Boolean);
  return raw
    .map(token => TOKEN_ALIASES.get(token) || token)
    .filter(token => !STOP.has(token));
}

function tokenSimilarity(a, b) {
  if (a === b) return 1;
  if (Math.min(a.length, b.length) >= 3 &&
      (a.startsWith(b) || b.startsWith(a)) &&
      Math.min(a.length, b.length) / Math.max(a.length, b.length) >= 0.68) {
    return 0.9;
  }
  const longest = Math.max(a.length, b.length);
  if (longest < 4) return 0;
  const score = 1 - levenshtein(a, b) / longest;
  return score >= 0.78 ? score : 0;
}

export function teamNameSimilarity(a, b) {
  const aa = canonicalTokens(a);
  const bb = canonicalTokens(b);
  if (!aa.length || !bb.length) return 0;

  const used = new Set();
  let matched = 0;
  for (const token of aa) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let i = 0; i < bb.length; i++) {
      if (used.has(i)) continue;
      const score = tokenSimilarity(token, bb[i]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0) {
      used.add(bestIndex);
      matched += bestScore;
    }
  }

  // Penaliza palavras adicionais, mas tolera abreviações e pequenas diferenças.
  return matched / Math.max(aa.length, bb.length);
}

export function teamsSameFixture(a, b, { threshold = 0.72 } = {}) {
  const score = teamNameSimilarity(a, b);
  const aa = canonicalTokens(a);
  const bb = canonicalTokens(b);
  // Nomes de uma só palavra exigem uma correspondência muito forte para
  // evitar confundir clubes diferentes com nomes genéricos semelhantes.
  const effectiveThreshold = Math.min(aa.length, bb.length) === 1
    ? Math.max(threshold, 0.88)
    : threshold;
  return score >= effectiveThreshold;
}

export function selectUniqueTeamFixture(home, away, kickoff, fixtures, {
  claimedIds = new Set(),
  maxDeltaMs = 90 * 60 * 1000,
  threshold = 0.72
} = {}) {
  const time = Date.parse(kickoff || "");
  if (!Number.isFinite(time)) return null;

  const ranked = (fixtures || [])
    .filter(fixture => !claimedIds.has(String(fixture.id)))
    .map(fixture => {
      const homeScore = teamNameSimilarity(home, fixture.home_team || fixture.home);
      const awayScore = teamNameSimilarity(away, fixture.away_team || fixture.away);
      const score = (homeScore + awayScore) / 2;
      const fixtureTime = Date.parse(fixture.kickoff_at || fixture.kickoff || "");
      const delta = Math.abs(fixtureTime - time);
      return { fixture, score, delta, homeScore, awayScore };
    })
    .filter(item =>
      Number.isFinite(item.delta) &&
      item.delta <= maxDeltaMs &&
      item.score >= threshold &&
      item.homeScore >= threshold &&
      item.awayScore >= threshold
    )
    .sort((a, b) => b.score - a.score || a.delta - b.delta);

  if (!ranked.length) return null;
  if (ranked.length > 1 &&
      Math.abs(ranked[0].score - ranked[1].score) < 0.035 &&
      Math.abs(ranked[0].delta - ranked[1].delta) < 10 * 60 * 1000) {
    return null;
  }
  return ranked[0].fixture;
}
