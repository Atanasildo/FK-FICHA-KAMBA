import { teamNameSimilarity, teamsSameFixture } from "./team-matching.js";

const MAJOR_COMPETITION_PATTERNS = [
  /champions league|uefa champions|europa league|conference league|world cup|copa do mundo|euro(\s|$)|uefa nations|copa america|copa libertadores|copa sudamericana|club world cup/i,
  /premier league|la liga|laliga|serie a|bundesliga|ligue 1|primeira liga|liga portugal|eredivisie|super lig|superliga|pro league|scottish premiership|liga mx|j league|j1 league|girabola|campeonato nacional.*angola/i,
  /brasileirao|brasileir[aã]o|serie a brazil|argentina.*primera|liga profesional|mls|major league soccer|saudi pro league/i,
  /afcon|copa africana|africa cup of nations|asian cup|gold cup|concacaf|afc champions|caf champions/i
];

function competitionPriority(game) {
  const name = String(game?.competition || game?.league || game?.tournament || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!name) return 1;
  return MAJOR_COMPETITION_PATTERNS.some(pattern => pattern.test(name)) ? 0 : 1;
}

function validKickoff(game) {
  return Number.isFinite(Number(game?.start_ts)) && Number(game.start_ts) > 0;
}

function eligibleByTime(game, earliest, latest) {
  return !game.is_live && validKickoff(game) &&
    Number(game.start_ts) >= earliest && Number(game.start_ts) <= latest;
}

export function getSwarmMatchingDiagnostics(bantuGames = [], elephantGames = [], {
  nowSeconds = Math.floor(Date.now() / 1000),
  minKickoffLeadSeconds = 60 * 60,
  horizonSeconds = 72 * 60 * 60
} = {}) {
  const earliest = nowSeconds + minKickoffLeadSeconds;
  const latest = nowSeconds + horizonSeconds;
  const count = games => ({
    discovered: games.length,
    missingNames: games.filter(game => !String(game.home || "").trim() || !String(game.away || "").trim()).length,
    missingKickoff: games.filter(game => !validKickoff(game)).length,
    live: games.filter(game => game.is_live).length,
    alreadyStartedOrTooSoon: games.filter(game => validKickoff(game) && Number(game.start_ts) < earliest && !game.is_live).length,
    beyond72Hours: games.filter(game => validKickoff(game) && Number(game.start_ts) > latest).length,
    eligible: games.filter(game => eligibleByTime(game, earliest, latest) &&
      String(game.home || "").trim() && String(game.away || "").trim()).length
  });
  return { bantu: count(bantuGames), elephant: count(elephantGames) };
}

export function selectCommonSwarmGames(bantuGames = [], elephantGames = [], {
  nowSeconds = Math.floor(Date.now() / 1000),
  maxGames = 30,
  minKickoffLeadSeconds = 60 * 60,
  horizonSeconds = 72 * 60 * 60,
  maxKickoffDifferenceSeconds = 3 * 60 * 60,
  onlyToday = false,
  teamThreshold = 0.72,
  ambiguityScoreGap = 0.045,
  ambiguityTimeGapSeconds = 15 * 60
} = {}) {
  const earliestKickoff = nowSeconds + minKickoffLeadSeconds;
  const latestKickoff = nowSeconds + horizonSeconds;
  const luandaDate = timestamp => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Luanda", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(timestamp * 1000));
  const today = luandaDate(nowSeconds);
  const usedElephantIds = new Set();
  const pairs = [];

  const candidates = bantuGames
    .filter(game => eligibleByTime(game, earliestKickoff, latestKickoff) &&
      String(game.home || "").trim() && String(game.away || "").trim() &&
      (!onlyToday || luandaDate(Number(game.start_ts)) === today))
    .sort((a, b) => competitionPriority(a) - competitionPriority(b) ||
      Number(a.start_ts) - Number(b.start_ts));

  for (const bantu of candidates) {
    const matches = elephantGames
      .filter(elephant => !usedElephantIds.has(String(elephant.id)) &&
        eligibleByTime(elephant, earliestKickoff, latestKickoff) &&
        (!onlyToday || luandaDate(Number(elephant.start_ts)) === today))
      .map(elephant => {
        const homeScore = teamNameSimilarity(bantu.home, elephant.home);
        const awayScore = teamNameSimilarity(bantu.away, elephant.away);
        const delta = Math.abs(Number(elephant.start_ts) - Number(bantu.start_ts));
        return { elephant, homeScore, awayScore, delta, score: (homeScore + awayScore) / 2 };
      })
      .filter(item =>
        item.delta <= maxKickoffDifferenceSeconds &&
        teamsSameFixture(bantu.home, item.elephant.home, { threshold: teamThreshold }) &&
        teamsSameFixture(bantu.away, item.elephant.away, { threshold: teamThreshold })
      )
      .sort((a, b) => b.score - a.score || a.delta - b.delta);

    if (!matches.length) continue;
    const best = matches[0];
    const runnerUp = matches[1];
    if (runnerUp &&
        Math.abs(best.score - runnerUp.score) < ambiguityScoreGap &&
        Math.abs(best.delta - runnerUp.delta) < ambiguityTimeGapSeconds) continue;

    usedElephantIds.add(String(best.elephant.id));
    pairs.push({
      bantuId: String(bantu.id),
      elephantId: String(best.elephant.id),
      home: bantu.home,
      away: bantu.away,
      bantuKickoff: Number(bantu.start_ts),
      elephantKickoff: Number(best.elephant.start_ts),
      matchingScore: Number(best.score.toFixed(3)),
      kickoffDifferenceSeconds: best.delta
    });
    if (pairs.length >= maxGames) break;
  }

  return pairs;
}
