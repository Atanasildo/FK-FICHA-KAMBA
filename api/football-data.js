const API_BASE = "https://sportapi.ai/api";

function luandaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Luanda",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const key = process.env.SPORTAPI_KEY;
  if (!key) {
    return res.status(503).json({
      error: "SportAPI ainda não configurada.",
      detail: "Adiciona SPORTAPI_KEY nas variáveis de ambiente da Vercel."
    });
  }

  const date = typeof req.query.date === "string" ? req.query.date : luandaDate();
  if (!validDate(date)) {
    return res.status(400).json({ error: "Data inválida. Usa YYYY-MM-DD." });
  }

  try {
    const response = await fetch(
      API_BASE + "/fixtures/date/" + encodeURIComponent(date),
      {
        method: "GET",
        headers: { "X-Api-Key": key }
      }
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false || !Array.isArray(payload.data)) {
      const message = payload.error || payload.message || "Resposta inesperada da SportAPI (HTTP " + response.status + ").";
      return res.status(response.status === 429 ? 429 : 502).json({
        error: "Não foi possível obter os jogos da SportAPI.",
        detail: message
      });
    }

    const fixtures = (payload.data || []).map(item => ({
      id: String(item.id),
      provider: "SportAPI",
      kickoff: item.datetime || item.date || null,
      status: item.status || "TBD",
      elapsed: item.minute ?? item.elapsed ?? null,
      competition: item.league_name || item.competition_name || null,
      leagueId: item.league_id ?? null,
      home: item.home_team || item.home?.name || "Equipa da casa",
      away: item.away_team || item.away?.name || "Equipa visitante",
      homeScore: item.home_score ?? item.score?.home ?? null,
      awayScore: item.away_score ?? item.score?.away ?? null,
      markets: [],
      oddsAvailable: false
    }));

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({
      provider: "SportAPI",
      date,
      timezone: "Africa/Luanda",
      fetchedAt: new Date().toISOString(),
      fixtureCount: fixtures.length,
      fixturesWithOdds: 0,
      oddsProvider: null,
      note: "A SportAPI fornece dados de jogos e resultados, mas não fornece odds de apostas.",
      fixtures
    });
  } catch (error) {
    return res.status(502).json({
      error: "Falha de comunicação com a SportAPI.",
      detail: error.message
    });
  }
}
