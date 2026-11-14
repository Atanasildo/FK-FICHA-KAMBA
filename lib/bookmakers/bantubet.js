import { normalizeBookmakerMarkets } from "./normalize.js";

/**
 * Recebe a estrutura recolhida nas categorias visíveis da BantuBet.
 * Aceita directamente o array de categorias ou um objecto { categorias, evento }.
 * Não recolhe odds por si: normaliza apenas dados já obtidos de forma pública.
 */
export function normalizeBantuBetPayload(payload, event = null) {
  const categories = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.categorias)
      ? payload.categorias
      : Array.isArray(payload?.categories)
        ? payload.categories
        : [];

  if (!categories.length) {
    return {
      bookmaker: "BantuBet",
      event: event || payload?.evento || payload?.event || null,
      markets: [],
      warning: "Não foram encontradas categorias/mercados no payload recebido."
    };
  }

  const resolvedEvent = event || payload?.evento || payload?.event || null;
  const markets = normalizeBookmakerMarkets(categories, {
    bookmaker: "BantuBet",
    event: resolvedEvent
  });

  return {
    bookmaker: "BantuBet",
    event: resolvedEvent,
    categoriesRead: categories.length,
    marketCount: markets.length,
    usableMarketCount: markets.filter(m => m.status === "ok" && m.selections.length > 0).length,
    reviewMarketCount: markets.filter(m => m.status !== "ok").length,
    markets
  };
}

export { normalizeBookmakerMarkets as normalizeBantuBetMarkets };
