import { normalizeBookmakerMarkets } from "./normalize.js";

/** Adaptador ElephantBet: mesma estrutura de categorias/mercados da BantuBet. */
export function normalizeElephantBetPayload(payload, event = null) {
  const categories = Array.isArray(payload) ? payload
    : Array.isArray(payload?.categorias) ? payload.categorias
    : Array.isArray(payload?.categories) ? payload.categories : [];
  const resolvedEvent = event || payload?.evento || payload?.event || null;
  if (!categories.length) return {
    bookmaker: "ElephantBet", event: resolvedEvent, markets: [],
    warning: "Não foram encontradas categorias/mercados no payload recebido."
  };
  const markets = normalizeBookmakerMarkets(categories, { bookmaker: "ElephantBet", event: resolvedEvent });
  return {
    bookmaker: "ElephantBet", event: resolvedEvent, categoriesRead: categories.length,
    marketCount: markets.length,
    usableMarketCount: markets.filter(m => m.status === "ok" && m.selections.length > 0).length,
    reviewMarketCount: markets.filter(m => m.status !== "ok").length, markets
  };
}
export { normalizeBookmakerMarkets as normalizeElephantBetMarkets };
