export function selectCommonSwarmGames(bantuGames = [], elephantGames = [], {
  nowSeconds = Math.floor(Date.now() / 1000),
  maxGames = 30,
  horizonSeconds = 72 * 60 * 60
} = {}) {
  const elephantById = new Map(elephantGames.map(game => [String(game.id), game]));

  return bantuGames
    .filter(game => {
      const other = elephantById.get(String(game.id));
      if (!other || game.is_live || other.is_live) return false;

      const bantuKickoff = Number(game.start_ts);
      const elephantKickoff = Number(other.start_ts);
      if (!Number.isFinite(bantuKickoff) || !Number.isFinite(elephantKickoff) ||
          bantuKickoff <= 0 || elephantKickoff <= 0) return false;

      // The same event ID must also have a compatible kickoff in both bookmakers.
      if (Math.abs(bantuKickoff - elephantKickoff) > 3 * 60 * 60) return false;

      return bantuKickoff > nowSeconds &&
        bantuKickoff <= nowSeconds + horizonSeconds &&
        elephantKickoff > nowSeconds &&
        elephantKickoff <= nowSeconds + horizonSeconds;
    })
    .sort((a, b) => Number(a.start_ts) - Number(b.start_ts))
    .slice(0, maxGames)
    .map(game => String(game.id));
}
