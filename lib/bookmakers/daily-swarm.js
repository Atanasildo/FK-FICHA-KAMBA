import { sameFixturePair } from "./team-matching.js";

const MAJOR_COMPETITION_PATTERNS = [
  // Grandes competições internacionais
  /champions league|uefa champions|europa league|conference league|world cup|copa do mundo|euro(\s|$)|uefa nations|copa america|copa libertadores|copa sudamericana|club world cup/i,
  // Principais ligas europeias
  /premier league|la liga|laliga|serie a|bundesliga|ligue 1|primeira liga|liga portugal|eredivisie|super lig|superliga|pro league|scottish premiership|liga mx|j league|j1 league|girabola|campeonato nacional.*angola/i,
  // Outras ligas nacionais de grande dimensão
  /brasileirao|brasileir[aã]o|serie a brazil|argentina.*primera|liga profesional|mls|major league soccer|saudi pro league/i,
  // Competições de selecções e torneios continentais relevantes
  /afcon|copa africana|africa cup of nations|asian cup|gold cup|concacaf|afc champions|caf champions/i
];

function competitionPriority(game) {
  const name = String(game?.competition || game?.league || game?.tournament || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!name) return 1;
  return MAJOR_COMPETITION_PATTERNS.some(pattern => pattern.test(name)) ? 0 : 1;
}

export function selectCommonSwarmGames(bantuGames = [], elephantGames = [], {
  nowSeconds = Math.floor(Date.now() / 1000),
  maxGames = 30,
  minKickoffLeadSeconds = 1 * 60 * 60,
  horizonSeconds = 72 * 60 * 60,
  maxKickoffDifferenceSeconds = 90 * 60,
  onlyToday = false
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
    .filter(game => !game.is_live && Number.isFinite(Number(game.start_ts)) &&
      Number(game.start_ts) >= earliestKickoff &&
      Number(game.start_ts) <= latestKickoff &&
      (!onlyToday || luandaDate(Number(game.start_ts)) === today))
    .sort((a, b) => {
      const priorityA = competitionPriority(a);
      const priorityB = competitionPriority(b);
      return priorityA - priorityB || Number(a.start_ts) - Number(b.start_ts);
    });

  for (const bantu of candidates) {
    if (!String(bantu.home || "").trim() || !String(bantu.away || "").trim()) continue;

    const matches = elephantGames
      .filter(elephant => !usedElephantIds.has(String(elephant.id)) &&
        !elephant.is_live &&
        Number.isFinite(Number(elephant.start_ts)) &&
        sameFixturePair(bantu, elephant, { deltaSeconds: Math.abs(Number(elephant.start_ts) - Number(bantu.start_ts)) }) &&
        Number(elephant.start_ts) >= earliestKickoff &&
        Number(elephant.start_ts) <= latestKickoff &&
        (!onlyToday || luandaDate(Number(elephant.start_ts)) === today))
      .map(elephant => ({
        elephant,
        delta: Math.abs(Number(elephant.start_ts) - Number(bantu.start_ts))
      }))
      .filter(item => item.delta <= maxKickoffDifferenceSeconds)
      .sort((a, b) => a.delta - b.delta);

    // If two ElephantBet fixtures are similarly close, do not guess.
    if (!matches.length) continue;
    if (matches.length > 1 && matches[1].delta - matches[0].delta < 15 * 60) continue;

    const elephant = matches[0].elephant;
    usedElephantIds.add(String(elephant.id));
    pairs.push({
      bantuId: String(bantu.id),
      elephantId: String(elephant.id),
      home: bantu.home,
      away: bantu.away,
      bantuKickoff: Number(bantu.start_ts),
      elephantKickoff: Number(elephant.start_ts)
    });
    if (pairs.length >= maxGames) break;
  }

  return pairs;
}
