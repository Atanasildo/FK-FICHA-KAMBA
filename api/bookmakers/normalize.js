import { normalizeBantuBetPayload } from "../../lib/bookmakers/bantubet.js";
import { normalizeElephantBetPayload } from "../../lib/bookmakers/elephantbet.js";

function isText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function unauthorized(req, res) {
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers.authorization || "";
  return !secret || !authorization.startsWith("Bearer ") || authorization.slice(7) !== secret;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }
  if (unauthorized(req, res)) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  const provider = String(req.query?.provider || "").toLowerCase();
  const isBantu = provider === "bantu";
  const isElephant = provider === "elephant";
  if (!isBantu && !isElephant) {
    return res.status(400).json({ error: "Indica um fornecedor válido." });
  }

  const payload = req.body?.payload;
  const event = req.body?.event;
  const providerName = isBantu ? "BantuBet" : "ElephantBet";
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.categorias)) {
    return res.status(400).json({
      error: `Payload ${providerName} inválido.`,
      detail: "Envia o objecto copiado pelo recolhedor no campo payload."
    });
  }
  if (!event || !isText(String(event.id ?? "")) || !isText(event.home) || !isText(event.away)) {
    return res.status(400).json({
      error: "Dados do jogo incompletos.",
      detail: "Envia event com id, home e away reais."
    });
  }
  if (payload.bookmaker && !(isBantu ? /bantubet/i : /elephantbet/i).test(payload.bookmaker)) {
    return res.status(400).json({ error: `Esta rota aceita apenas recolhas da ${providerName}.` });
  }

  const normalize = isBantu ? normalizeBantuBetPayload : normalizeElephantBetPayload;
  const normalized = normalize(payload, {
    id: String(event.id),
    home: event.home.trim(),
    away: event.away.trim(),
    competition: isText(event.competition) ? event.competition.trim() : null,
    kickoff: isText(event.kickoff) ? event.kickoff.trim() : null
  });
  const usableMarkets = normalized.markets.filter(m =>
    m.status === "ok" && Array.isArray(m.selections) && m.selections.length > 0
  );
  const sourceUrl = isText(payload.urlPagina) ? payload.urlPagina : null;
  const collectedAt = isText(payload.recolhidoEm) ? payload.recolhidoEm : null;
  const markets = usableMarkets.flatMap(market =>
    market.selections
      .filter(selection =>
        isText(selection.selection) &&
        Number.isFinite(Number(selection.odd)) &&
        Number(selection.odd) > 1 &&
        Number(selection.odd) <= 10000
      )
      .map(selection => ({
        market: market.market,
        selection: selection.selection,
        odds: Number(selection.odd),
        bookmaker: providerName,
        category: market.category,
        line: selection.line ?? null,
        side: selection.side ?? null,
        team: selection.team ?? null,
        sourceUrl,
        collectedAt
      }))
  );
  const fixture = {
    id: String(event.id),
    home: event.home.trim(),
    away: event.away.trim(),
    competition: isText(event.competition) ? event.competition.trim() : null,
    kickoff: isText(event.kickoff) ? event.kickoff.trim() : null,
    bookmaker: providerName,
    sourceUrl,
    collectedAt,
    markets
  };
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    status: markets.length ? "ready_for_analysis" : "no_usable_markets",
    provider: providerName,
    sourceUrl,
    collectedAt,
    categoriesRead: normalized.categoriesRead || 0,
    rawMarketCount: normalized.marketCount || 0,
    usableMarketCount: usableMarkets.length,
    excludedMarketCount: (normalized.markets || []).length - usableMarkets.length,
    selectionCount: markets.length,
    fixture,
    note: "Apenas mercados com associação completa foram preparados. Mercados incompletos foram excluídos; este endpoint não publica bilhetes nem cria reservas."
  });
}
