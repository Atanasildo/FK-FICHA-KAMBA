const API_BASE = "https://v3.football.api-sports.io";

function luandaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Luanda",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function validDate(value) {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function apiGet(path, key) {
  const response = await fetch(API_BASE + path, {
    method: "GET",
    headers: { "x-apisports-key": key }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (payload.errors && Object.keys(payload.errors).length)) {
    const message = payload.errors
      ? Object.entries(payload.errors).map(([k, v]) => k + ": " + v).join("; ")
      : "Resposta HTTP " + response.status;
    throw new Error(message);
  }
  return payload;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    return res.status(503).json({
      error: "API-Football ainda não configurada.",
      detail: "Adiciona API_FOOTBALL_KEY nas variáveis de ambiente da Vercel."
    });
  }

  const date = typeof req.query.date === "string" ? req.query.date : luandaDate();
  if (!validDate(date)) {
    return res.status(400).json({ error: "Data inválida. Usa YYYY-MM-DD." });
  }

  try {
    const [fixturesPayload, oddsPayload] = await Promise.all([
      apiGet("/fixtures?date=" + encodeURIComponent(date) + "&timezone=Africa%2FLuanda", key),
      apiGet("/odds?date=" + encodeURIComponent(date) + "&timezone=Africa%2FLuanda&page=1", key)
    ]);

    const oddsByFixture = new Map();
    for (const item of oddsPayload.response || []) {
      const fixtureId = item.fixture?.id;
      if (!fixtureId) continue;
      const markets = [];
      for (const bookmaker of item.bookmakers || []) {
        for (const bet of bookmaker.bets || []) {
          for (const value of bet.values || []) {
            const odd = Number(value.odd);
            if (!Number.isFinite(odd) || odd <= 1) continue;
            markets.push({
              market: bet.name,
              selection: value.value,
              odds: odd,
              bookmaker: bookmaker.name
            });
          }
        }
      }
      oddsByFixture.set(String(fixtureId), markets);
    }

    const fixtures = (fixturesPayload.response || []).map(item => {
      const fixture = item.fixture || {};
      const teams = item.teams || {};
      const goals = item.goals || {};
      const markets = oddsByFixture.get(String(fixture.id)) || [];
      return {
        id: String(fixture.id),
        provider: "API-Football",
        kickoff: fixture.date || null,
        timestamp: fixture.timestamp || null,
        status: fixture.status?.short || "TBD",
        elapsed: fixture.status?.elapsed ?? null,
        competition: item.league?.name || null,
        leagueId: item.league?.id || null,
        season: item.league?.season || null,
        home: teams.home?.name || "Equipa da casa",
        away: teams.away?.name || "Equipa visitante",
        homeScore: goals.home ?? null,
        awayScore: goals.away ?? null,
        markets
      };
    });

    res.setHeader("Cache-Control", "s-maxage=180, stale-while-revalidate=300");
    return res.status(200).json({
      provider: "API-Football",
      date,
      timezone: "Africa/Luanda",
      fetchedAt: new Date().toISOString(),
      fixtureCount: fixtures.length,
      fixturesWithOdds: fixtures.filter(f => f.markets.length > 0).length,
      fixtures
    });
  } catch (error) {
    return res.status(502).json({
      error: "Não foi possível obter os jogos e odds da API-Football.",
      detail: error.message
    });
  }
}
