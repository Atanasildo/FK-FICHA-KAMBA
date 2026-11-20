import { sameFixturePair, teamNameSimilarity } from "./team-matching.js";

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

/**
 * Futebol virtual/simulado (ex.: "Groningen SRL", eSoccer, Cyber). Não são jogos reais:
 * ocupavam vagas do limite diário e gastavam espaço na base sem utilidade.
 */
export function isVirtualSwarmGame(game) {
  const text = [game?.home, game?.away, game?.competition].map(value => String(value || "")).join(" | ");
  return /\bSRL\b|\besoccer\b|\be-?football\b|\bcyber\b|\bvirtual\b|\(esports?\)/i.test(text);
}

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
    .filter(game => !game.is_live && !isVirtualSwarmGame(game) && Number.isFinite(Number(game.start_ts)) &&
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
        !isVirtualSwarmGame(elephant) &&
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

/**
 * Diagnóstico: mostra quantos jogos de hoje há em cada casa e quais ficam sem par,
 * com o candidato mais parecido da outra casa (para afinar nomes/aliases).
 */
export function describeUnmatchedSwarmGames(bantuGames = [], elephantGames = [], pairs = [], {
  nowSeconds = Math.floor(Date.now() / 1000),
  minKickoffLeadSeconds = 1 * 60 * 60,
  maxKickoffDifferenceSeconds = 90 * 60
} = {}) {
  const luandaDate = ts => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Luanda", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(ts * 1000));
  const today = luandaDate(nowSeconds);
  const earliest = nowSeconds + minKickoffLeadSeconds;
  const isToday = g => !g.is_live && !isVirtualSwarmGame(g) && Number.isFinite(Number(g.start_ts)) &&
    Number(g.start_ts) >= earliest && luandaDate(Number(g.start_ts)) === today;
  const bantuToday = bantuGames.filter(isToday);
  const elephantToday = elephantGames.filter(isToday);
  const usedB = new Set(pairs.map(p => String(p.bantuId)));
  const usedE = new Set(pairs.map(p => String(p.elephantId)));
  const nearest = (game, pool) => pool
    .filter(other => Math.abs(Number(other.start_ts) - Number(game.start_ts)) <= maxKickoffDifferenceSeconds)
    .map(other => ({
      other,
      score: (teamNameSimilarity(game.home, other.home) + teamNameSimilarity(game.away, other.away)) / 2
    }))
    .sort((a, b) => b.score - a.score)[0] || null;
  const describe = (game, pool, usedPool) => {
    const best = nearest(game, pool.filter(o => !usedPool.has(String(o.id))));
    return {
      jogo: game.home + " x " + game.away,
      hora: new Date(Number(game.start_ts) * 1000).toISOString(),
      candidato: best ? best.other.home + " x " + best.other.away : null,
      semelhanca: best ? Number(best.score.toFixed(2)) : 0
    };
  };
  return {
    bantuHoje: bantuToday.length,
    elephantHoje: elephantToday.length,
    emPar: pairs.length,
    soBantu: bantuToday.filter(g => !usedB.has(String(g.id))).map(g => describe(g, elephantToday, usedE)),
    soElephant: elephantToday.filter(g => !usedE.has(String(g.id))).map(g => describe(g, bantuToday, usedB))
  };
}
