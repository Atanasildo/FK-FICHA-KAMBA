import { normalizeBantuBetPayload } from "./bantubet.js";
import { normalizeElephantBetPayload } from "./elephantbet.js";
import { compareFixtures } from "./comparison.js";

const PROVIDERS = {
  bantubet: { label: "BantuBet", normalize: normalizeBantuBetPayload },
  elephantbet: { label: "ElephantBet", normalize: normalizeElephantBetPayload }
};

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function safeSourceUrl(value) {
  if (!nonEmpty(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Prepara duas recolhas locais para comparação. Não usa endpoints nem segredos:
 * os ficheiros são processados no servidor de build/browser através dos módulos partilhados.
 */
export function prepareOddsComparison({ bantubet, elephantbet, event }) {
  if (!bantubet || !elephantbet) throw new Error("Importa os dois ficheiros JSON antes de comparar.");
  if (!event || !nonEmpty(event.home) || !nonEmpty(event.away)) {
    throw new Error("Indica os nomes exactos da equipa da casa e da equipa visitante.");
  }

  const normalizedFixtures = [];
  const diagnostics = [];

  for (const [key, rawPayload] of [["bantubet", bantubet], ["elephantbet", elephantbet]]) {
    const provider = PROVIDERS[key];
    const payload = rawPayload?.payload && typeof rawPayload.payload === "object"
      ? rawPayload.payload
      : rawPayload;
    if (!payload || typeof payload !== "object" || !(Array.isArray(payload) || Array.isArray(payload.categorias) || Array.isArray(payload.categories))) {
      throw new Error(`O ficheiro ${provider.label} não contém a lista de categorias esperada (categorias).`);
    }
    if (payload.bookmaker) {
      const declared = String(payload.bookmaker).toLowerCase();
      const matchesProvider = key === "bantubet"
        ? declared.includes("bantu")
        : declared.includes("elephant");
      if (!matchesProvider) {
        throw new Error(`O ficheiro seleccionado para ${provider.label} declara outra casa: ${payload.bookmaker}.`);
      }
    }

    const metadata = {
      id: String(payload.eventId || payload.eventoId || payload.id || provider.label),
      home: event.home.trim(),
      away: event.away.trim(),
      competition: nonEmpty(event.competition) ? event.competition.trim() : null,
      kickoff: nonEmpty(event.kickoff) ? event.kickoff : null
    };
    const normalized = provider.normalize(payload, metadata);
    const usable = (normalized.markets || []).filter(m =>
      m.status === "ok" && Array.isArray(m.selections) && m.selections.length > 0
    );
    const excluded = (normalized.markets || []).filter(m => m.status !== "ok" || !m.selections?.length);
    const markets = usable.flatMap(market => market.selections
      .filter(selection => nonEmpty(selection.selection) && Number.isFinite(Number(selection.odd)) && Number(selection.odd) > 1 && Number(selection.odd) <= 10000)
      .map(selection => ({
        market: market.market,
        selection: selection.selection,
        odds: Number(selection.odd),
        bookmaker: provider.label,
        category: market.category,
        line: selection.line ?? null,
        side: selection.side ?? null,
        team: selection.team ?? null,
        sourceUrl: safeSourceUrl(payload.urlPagina),
        collectedAt: nonEmpty(payload.recolhidoEm) ? payload.recolhidoEm : null
      })));

    normalizedFixtures.push({
      ...metadata,
      bookmaker: provider.label,
      sourceUrl: safeSourceUrl(payload.urlPagina),
      collectedAt: nonEmpty(payload.recolhidoEm) ? payload.recolhidoEm : null,
      markets
    });
    diagnostics.push({
      bookmaker: provider.label,
      categoriesRead: normalized.categoriesRead || 0,
      rawMarketCount: normalized.marketCount || 0,
      usableMarketCount: usable.length,
      excludedMarketCount: excluded.length,
      selectionCount: markets.length,
      excludedMarkets: excluded.map(m => ({ market: m.market, warning: m.warning || "Mercado sem associação completa." }))
    });
  }

  if (!normalizedFixtures.some(f => f.markets.length)) {
    throw new Error("Nenhum mercado válido foi encontrado nos ficheiros importados.");
  }

  return {
    result: compareFixtures(normalizedFixtures),
    diagnostics,
    fixtures: normalizedFixtures
  };
}
