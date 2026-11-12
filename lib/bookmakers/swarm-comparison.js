import { compareFixtures } from "./comparison.js";

function validateCollection(value, label) {
  if (!value || !Array.isArray(value.games)) throw new Error(`Ficheiro ${label} inválido: campo games em falta.`);
}
function normalizeCollection(collection, bookmaker, games) {
  return games.map(game => ({
    id: String(game.id ?? ""),
    home: String(game.home ?? "").trim(),
    away: String(game.away ?? "").trim(),
    competition: game.competition || null,
    kickoff: game.start_ts ? new Date(Number(game.start_ts) * 1000).toISOString() : null,
    bookmaker,
    collectedAt: game.receivedAt || collection.collectedAt || null,
    markets: (game.markets || []).flatMap(market => (market.selections || []).map(selection => ({
      market: String(market.name || market.type || "Mercado").trim(),
      marketType: market.type || "",
      marketBase: market.base ?? null,
      marketId: market.id || null,
      selection: String(selection.name || "").trim(),
      selectionId: selection.id || null,
      odds: Number(selection.odd),
      sourceUrl: null,
      collectedAt: selection.receivedAt || market.receivedAt || game.receivedAt || collection.collectedAt || null
    })))
  })).filter(game => game.home && game.away && game.markets.length);
}
export function compareSwarmCollections({ bantu, elephant }) {
  validateCollection(bantu, "BantuBet");
  validateCollection(elephant, "ElephantBet");
  const bantuMap = new Map(bantu.games.map(game => [String(game.id), game]));
  const elephantMap = new Map(elephant.games.map(game => [String(game.id), game]));
  const commonIds = [...bantuMap.keys()].filter(id => elephantMap.has(id));
  const fixtures = [
    ...normalizeCollection(bantu, "BantuBet", commonIds.map(id => bantuMap.get(id))),
    ...normalizeCollection(elephant, "ElephantBet", commonIds.map(id => elephantMap.get(id)))
  ];
  const result = compareFixtures(fixtures);
  return {
    ...result,
    fixtures,
    source: "Swarm",
    collection: {
      bantu: { startedAt: bantu.collectionStartedAt || null, collectedAt: bantu.collectedAt || null, gamesReceived: bantu.received ?? bantu.games.length },
      elephant: { startedAt: elephant.collectionStartedAt || null, collectedAt: elephant.collectedAt || null, gamesReceived: elephant.received ?? elephant.games.length },
      commonGameCount: commonIds.length,
      commonGameIds: commonIds
    },
    note: "Comparação de odds recebidas via Swarm. type e base são preservados na identidade do mercado. Os resultados são preços observados, não garantia de disponibilidade ou arbitragem."
  };
}
