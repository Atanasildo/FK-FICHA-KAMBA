import { normalizeElephantBetPayload } from "./elephantbet.js";

function isText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: "CRON_SECRET não está disponível no runtime." });
  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("Bearer ") || authorization.slice(7) !== secret) {
    return res.status(401).json({ error: "Não autorizado." });
  }
  const payload = req.body?.payload;
  const event = req.body?.event;
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.categorias)) {
    return res.status(400).json({ error: "Payload ElephantBet inválido.", detail: "Envia o objecto copiado pelo recolhedor no campo payload." });
  }
  if (!event || !isText(String(event.id ?? "")) || !isText(event.home) || !isText(event.away)) {
    return res.status(400).json({ error: "Dados do jogo incompletos.", detail: "Envia event com id, home e away reais." });
  }
  if (payload.bookmaker && !/elephantbet/i.test(payload.bookmaker)) {
    return res.status(400).json({ error: "Esta rota aceita apenas recolhas da ElephantBet." });
  }
  const normalized = normalizeElephantBetPayload(payload, {
    id: String(event.id), home: event.home.trim(), away: event.away.trim(),
    competition: isText(event.competition) ? event.competition.trim() : null,
    kickoff: isText(event.kickoff) ? event.kickoff.trim() : null
  });
  const usableMarkets = normalized.markets.filter(m => m.status === "ok" && Array.isArray(m.selections) && m.selections.length);
  const sourceUrl = isText(payload.urlPagina) ? payload.urlPagina : null;
  const collectedAt = isText(payload.recolhidoEm) ? payload.recolhidoEm : null;
  const markets = usableMarkets.flatMap(m => m.selections
    .filter(s => isText(s.selection) && Number.isFinite(Number(s.odd)) && Number(s.odd) > 1 && Number(s.odd) <= 10000)
    .map(s => ({
      market: m.market, selection: s.selection, odds: Number(s.odd),
      bookmaker: "ElephantBet", category: m.category,
      line: s.line ?? null, side: s.side ?? null, team: s.team ?? null,
      sourceUrl, collectedAt
    })));
  const fixture = {
    id: String(event.id), home: event.home.trim(), away: event.away.trim(),
    competition: isText(event.competition) ? event.competition.trim() : null,
    kickoff: isText(event.kickoff) ? event.kickoff.trim() : null,
    bookmaker: "ElephantBet", sourceUrl, collectedAt, markets
  };
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    status: markets.length ? "ready_for_analysis" : "no_usable_markets",
    provider: "ElephantBet", sourceUrl, collectedAt,
    categoriesRead: normalized.categoriesRead || 0,
    rawMarketCount: normalized.marketCount || 0,
    usableMarketCount: usableMarkets.length,
    excludedMarketCount: (normalized.markets || []).length - usableMarkets.length,
    selectionCount: markets.length, fixture,
    note: "Apenas mercados com associação completa foram preparados. Mercados incompletos foram excluídos; este endpoint não publica bilhetes nem cria reservas."
  });
}
