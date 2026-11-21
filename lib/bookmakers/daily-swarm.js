import { sameFixturePair, teamNameSimilarity } from "./team-matching.js";

// Nível 0 — principais competições. Nível 1 — fortes/secundárias. Nível 2 — restantes. Nível 3 — feminino/jovens/reservas.
const TIER0_PATTERNS = [
  /champions league|uefa champions|europa league|conference league|libertadores|sudamericana|world cup|copa do mundo|club world cup|nations league|euro(\s|$)|copa america|afcon|africa cup of nations|copa africana|asian cup|gold cup|qualif/i,
  /(^|\s)(premier league|la liga|laliga|serie a|bundesliga|ligue 1|primeira liga|liga portugal|eredivisie|super lig|scottish premiership|jupiler|pro league)(\s|$)/i,
  /brasileirao|brasileir[aã]o|serie a brazil|liga profesional|primera division argentina|argentina.*primera|mls|major league soccer|saudi pro league|liga mx|girabola/i
];
const TIER1_PATTERNS = [
  /championship|2\.? ?bundesliga|serie b|ligue 2|la liga 2|segunda division|primeira liga 2|liga portugal 2|serie b brazil|brasileir[aã]o b|eerste divisie/i,
  /premier liga|russian premier|ekstraklasa|allsvenskan|eliteserien|superliga|super league|bundesliga austria|first division|1\. liga|first league|fortuna liga|liga i\b|hnl|prva liga|super liga/i,
  /j1? ?league|k league|a-league|chinese super league|csl|indian super league|isl\b|stars league|persian gulf|pro league qatar/i,
  /fa cup|copa del rey|dfb pokal|coppa italia|coupe de france|taca de portugal|knvb|league cup|copa do brasil|copa argentina|caf champions|caf confederation|afc champions|concacaf|friendl|amistos|international/i
];
const LOWEST_PATTERNS = /women|feminin|femenin|femmes|\(w\)|\bw\b|u-?\d{2}\b|under ?\d{2}|youth|junior|reserve|\bres\b|\bii\b|\biii\b|academy|amateur/i;

function normalizeCompetitionText(game) {
  return [game?.region, game?.competition || game?.league || game?.tournament]
    .map(value => String(value || ""))
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_·\-–]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Futebol virtual/simulado (ex.: "Groningen SRL", eSoccer, Cyber). Não são jogos reais:
 * ocupavam vagas do limite diário e gastavam espaço na base sem utilidade.
 */
export function isVirtualSwarmGame(game) {
  const text = [game?.home, game?.away, game?.competition].map(value => String(value || "")).join(" | ");
  return /\bSRL\b|\besoccer\b|\be-?football\b|\bcyber\b|\bvirtual\b|\(esports?\)/i.test(text);
}

export function competitionPriority(game) {
  const text = normalizeCompetitionText(game);
  const own = normalizeCompetitionText({ competition: game?.competition || game?.league || game?.tournament });
  // Sem competição conhecida: nível 2 (nem sobe nem desce em relação aos outros).
  if (!own) return 2;
  if (LOWEST_PATTERNS.test(text) || LOWEST_PATTERNS.test(String(game?.home || "") + " " + String(game?.away || ""))) return 3;
  if (TIER0_PATTERNS.some(pattern => pattern.test(text))) return 0;
  if (TIER1_PATTERNS.some(pattern => pattern.test(text))) return 1;
  return 2;
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

  // Pré-filtro único das ElephantBet e índice por hora: cada jogo só é comparado com os que começam
  // dentro da janela (±maxKickoffDifferenceSeconds), em vez de com as ~1700 ElephantBet.
  const elephantPool = elephantGames
    .filter(elephant => !elephant.is_live && !isVirtualSwarmGame(elephant) && Number.isFinite(Number(elephant.start_ts)) &&
      Number(elephant.start_ts) >= earliestKickoff && Number(elephant.start_ts) <= latestKickoff &&
      (!onlyToday || luandaDate(Number(elephant.start_ts)) === today))
    .sort((a, b) => Number(a.start_ts) - Number(b.start_ts));
  const firstInWindow = ts => {
    let low = 0, high = elephantPool.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (Number(elephantPool[mid].start_ts) < ts) low = mid + 1; else high = mid;
    }
    return low;
  };

  for (const bantu of candidates) {
    if (!String(bantu.home || "").trim() || !String(bantu.away || "").trim()) continue;

    const bantuStart = Number(bantu.start_ts);
    const matches = [];
    for (let i = firstInWindow(bantuStart - maxKickoffDifferenceSeconds); i < elephantPool.length; i++) {
      const elephant = elephantPool[i];
      const delta = Math.abs(Number(elephant.start_ts) - bantuStart);
      if (Number(elephant.start_ts) > bantuStart + maxKickoffDifferenceSeconds) break;
      if (usedElephantIds.has(String(elephant.id))) continue;
      if (delta > maxKickoffDifferenceSeconds) continue;
      if (!sameFixturePair(bantu, elephant, { deltaSeconds: delta })) continue;
      matches.push({ elephant, delta });
    }
    matches.sort((a, b) => a.delta - b.delta);

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
      competition: bantu.competition || elephant.competition || null,
      bantuKickoff: bantuStart,
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
