export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) {
    return res.status(503).json({
      error: "Fonte desportiva não configurada.",
      detail: "Cria uma conta gratuita em football-data.org e adiciona FOOTBALL_DATA_TOKEN nas variáveis de ambiente da Vercel."
    });
  }
  const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : new Date().toISOString().slice(0, 10);
  const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : dateFrom;
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
  if (!validDate(dateFrom) || !validDate(dateTo) || dateTo < dateFrom) {
    return res.status(400).json({ error: "Intervalo de datas inválido. Usa YYYY-MM-DD." });
  }
  const span = (Date.parse(dateTo) - Date.parse(dateFrom)) / 86400000;
  if (span > 7) return res.status(400).json({ error: "O intervalo máximo por consulta é de 7 dias." });
  try {
    const url = new URL("https://api.football-data.org/v4/matches");
    url.searchParams.set("dateFrom", dateFrom);
    url.searchParams.set("dateTo", dateTo);
    const response = await fetch(url, { headers: { "X-Auth-Token": token, "Accept": "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status === 429 ? 429 : 502).json({
        error: "O fornecedor não conseguiu responder ao pedido.",
        detail: payload.message || payload.error || ("Resposta HTTP " + response.status + ".")
      });
    }
    const matches = (payload.matches || []).map(match => ({
      provider: "football-data.org",
      providerId: match.id,
      utcDate: match.utcDate,
      status: match.status,
      minute: match.minute ?? null,
      competition: match.competition?.name || "Competição não indicada",
      home: match.homeTeam?.name || "Equipa da casa",
      away: match.awayTeam?.name || "Equipa visitante",
      homeScore: match.score?.fullTime?.home ?? match.score?.halfTime?.home ?? null,
      awayScore: match.score?.fullTime?.away ?? match.score?.halfTime?.away ?? null,
      lastUpdated: match.lastUpdated || null
    }));
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ source: "football-data.org", dateFrom, dateTo, fetchedAt: new Date().toISOString(), count: matches.length, matches });
  } catch (error) {
    return res.status(502).json({ error: "Não foi possível contactar o fornecedor de jogos." });
  }
}