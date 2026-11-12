export function selectCommonSwarmGames(bantuGames = [], elephantGames = [], {
  nowSeconds = Math.floor(Date.now() / 1000),
  maxGames = 30,
  lookbackSeconds = 3 * 60 * 60,
  horizonSeconds = 72 * 60 * 60
} = {}) {
  const elephantById = new Map(elephantGames.map(game => [String(game.id), game]));
  return bantuGames
    .filter(game => {
      const other = elephantById.get(String(game.id));
      if (!other) return false;
      const kickoff = Number(game.start_ts || other.start_ts || 0);
      const live = Boolean(game.is_live || other.is_live);
      return live || (kickoff > 0 && kickoff >= nowSeconds - lookbackSeconds && kickoff <= nowSeconds + horizonSeconds);
    })
    .sort((a, b) => {
      const aLive = Boolean(a.is_live);
      const bLive = Boolean(b.is_live);
      if (aLive !== bLive) return aLive ? -1 : 1;
      return Number(a.start_ts || 0) - Number(b.start_ts || 0);
    })
    .slice(0, maxGames)
    .map(game => String(game.id));
}
