function normalizeTeam(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function selectCommonSwarmGames(bantuGames = [], elephantGames = [], {
  nowSeconds = Math.floor(Date.now() / 1000),
  maxGames = 30,
  minKickoffLeadSeconds = 1 * 60 * 60,
  horizonSeconds = 72 * 60 * 60,
  maxKickoffDifferenceSeconds = 90 * 60
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
      luandaDate(Number(game.start_ts)) === today)
    .sort((a, b) => Number(a.start_ts) - Number(b.start_ts));

  for (const bantu of candidates) {
    const home = normalizeTeam(bantu.home);
    const away = normalizeTeam(bantu.away);
    if (!home || !away) continue;

    const matches = elephantGames
      .filter(elephant => !usedElephantIds.has(String(elephant.id)) &&
        !elephant.is_live &&
        normalizeTeam(elephant.home) === home &&
        normalizeTeam(elephant.away) === away &&
        Number.isFinite(Number(elephant.start_ts)) &&
        Number(elephant.start_ts) >= earliestKickoff &&
        Number(elephant.start_ts) <= latestKickoff &&
        luandaDate(Number(elephant.start_ts)) === today)
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
