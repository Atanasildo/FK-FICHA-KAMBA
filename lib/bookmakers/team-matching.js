const STOP = new Set(["fc","cf","sc","ac","club","clube","de","da","do","the","football","futebol"]);
const TOKEN_ALIASES = new Map([
  ["utd","united"],
  ["munchen","munich"],
  ["muenchen","munich"],
  ["ath","athletic"],
  ["athletico","atletico"]
]);
const ALIASES = new Map([
  ["sportingcp","sporting lisbon"],
  ["intermilan","inter milan"],
  ["internazionale","inter milan"],
  ["psg","paris saint germain"],
  ["manutd","manchester united"],
  ["manunited","manchester united"],
  ["mancity","manchester city"],
  ["spurs","tottenham hotspur"],
  ["bayern","bayern munich"],
  ["bayernmunchen","bayern munich"],
  ["bayernmunich","bayern munich"],
  ["barca","barcelona"],
  ["mocambique","mozambique"],
  ["etiopia","ethiopia"],
  ["paraguai","paraguay"],
  ["ilhascomores","comoros"]
]);

function norm(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value) {
  const raw = norm(value).split(/\s+/).filter(Boolean);
  const alias = ALIASES.get(raw.join(""));
  const expanded = alias ? alias.split(" ") : raw.map(token => TOKEN_ALIASES.get(token) || token);
  return expanded.filter(token => !STOP.has(token));
}

export function teamNameSimilarity(a, b) {
  const aa = tokens(a);
  const bb = tokens(b);
  if (!aa.length || !bb.length) return 0;

  const used = new Set();
  let matched = 0;
  for (const token of aa) {
    const index = bb.findIndex((candidate, i) => !used.has(i) && candidate === token);
    if (index >= 0) {
      used.add(index);
      matched++;
    }
  }
  return matched / Math.max(aa.length, bb.length);
}

export function teamsSameFixture(a, b, { threshold = 0.8 } = {}) {
  return teamNameSimilarity(a, b) >= threshold;
}

export function selectUniqueTeamFixture(home, away, kickoff, fixtures, {
  claimedIds = new Set(),
  maxDeltaMs = 90 * 60 * 1000,
  threshold = 0.8
} = {}) {
  const time = Date.parse(kickoff || "");
  if (!Number.isFinite(time)) return null;

  const ranked = (fixtures || [])
    .filter(fixture => !claimedIds.has(String(fixture.id)))
    .map(fixture => {
      const homeScore = teamNameSimilarity(home, fixture.home_team || fixture.home);
      const awayScore = teamNameSimilarity(away, fixture.away_team || fixture.away);
      const score = (homeScore + awayScore) / 2;
      const delta = Math.abs(Date.parse(fixture.kickoff_at || fixture.kickoff || "") - time);
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
      Math.abs(ranked[0].score - ranked[1].score) < 0.04 &&
      Math.abs(ranked[0].delta - ranked[1].delta) < 15 * 60 * 1000) {
    return null;
  }
  return ranked[0].fixture;
}
