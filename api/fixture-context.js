const API_BASE = "https://sportapi.ai/api";

async function getJson(path, key) {
  try {
    const response = await fetch(API_BASE + path, { headers: { "X-Api-Key": key, Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      return { available: false, status: response.status, error: payload.error || payload.message || "Fonte indisponível." };
    }
    return { available: true, data: payload };
  } catch (error) {
    return { available: false, error: error.message };
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Não autorizado." });
  }
  const key = process.env.SPORTAPI_KEY;
  if (!key) return res.status(503).json({ error: "SPORTAPI_KEY não configurada." });

  const fixtureId = String(req.query.fixtureId || "");
  if (!/^\d{1,12}$/.test(fixtureId)) {
    return res.status(400).json({ error: "Indica um fixtureId numérico válido da SportAPI." });
  }

  const fixtureResult = await getJson(`/fixtures/${fixtureId}`, key);
  if (!fixtureResult.available || !fixtureResult.data.fixture) {
    return res.status(502).json({ error: "Não foi possível obter os detalhes do jogo.", detail: fixtureResult.error || "Fixture ausente." });
  }
  const fixture = fixtureResult.data.fixture;
  const homeId = Number(fixture.home_id);
  const awayId = Number(fixture.away_id);
  const leagueId = fixture.league_id;

  const requests = await Promise.all([
    getJson(`/fixtures/${fixtureId}/stats`, key),
    getJson(`/fixtures/${fixtureId}/events`, key),
    getJson(`/fixtures/${fixtureId}/lineups`, key),
    homeId && awayId ? getJson(`/fixtures/h2h/${homeId}/${awayId}`, key) : Promise.resolve({ available: false, error: "IDs das equipas indisponíveis." }),
    leagueId ? getJson(`/standings/${encodeURIComponent(String(leagueId))}`, key) : Promise.resolve({ available: false, error: "ID da competição indisponível." }),
    homeId ? getJson(`/teams/${homeId}`, key) : Promise.resolve({ available: false, error: "ID da equipa da casa indisponível." }),
    awayId ? getJson(`/teams/${awayId}`, key) : Promise.resolve({ available: false, error: "ID da equipa visitante indisponível." })
  ]);

  const [matchStats, events, lineups, h2h, standings, homeTeam, awayTeam] = requests;
  const table = standings.available && Array.isArray(standings.data.data) ? standings.data.data : [];
  const homeStanding = table.find(row => Number(row.team?.id) === homeId) || null;
  const awayStanding = table.find(row => Number(row.team?.id) === awayId) || null;
  const teamSummary = result => {
    if (!result.available) return null;
    const team = result.data.team || result.data;
    const recent = Array.isArray(result.data.matches)
      ? result.data.matches.filter(match => /^(FT|AET|PENS)$/i.test(String(match.status || ""))).slice(-8)
      : [];
    return {
      id: team.id || null, name: team.name || team.full_name || null,
      coach: team.coach_name || null, stadium: team.stadium_name || null,
      recentResults: recent
    };
  };
  const stats = {
    source: "SportAPI",
    collectedAt: new Date().toISOString(),
    fixture: {
      id: fixture.id,
      home: fixture.home_team,
      away: fixture.away_team,
      competition: fixture.league_name,
      kickoffUtc: fixture.kickoff_utc || null,
      status: fixture.status,
      minute: fixture.minute ?? null,
      homeScore: fixture.home_score ?? null,
      awayScore: fixture.away_score ?? null
    },
    matchStats: matchStats.available ? matchStats.data.data || null : null,
    standings: standings.available ? {
      league: standings.data.league || null,
      season: standings.data.season || null,
      home: homeStanding ? { ...homeStanding, form: (homeStanding.form || []).slice(-6) } : null,
      away: awayStanding ? { ...awayStanding, form: (awayStanding.form || []).slice(-6) } : null
    } : null,
    headToHead: h2h.available ? (h2h.data.data || []).slice(-10) : null,
    homeTeam: teamSummary(homeTeam),
    awayTeam: teamSummary(awayTeam),
    events: events.available ? (events.data.data || []).slice(-40) : null,
    lineups: lineups.available ? lineups.data.data || null : null,
    absences: {
      available: false,
      reason: "A documentação da SportAPI consultada não apresenta endpoint de lesões/ausências; este dado não será inferido."
    },
    availability: {
      matchStats: matchStats.available && matchStats.data.available !== false,
      events: events.available,
      lineups: lineups.available && lineups.data.available !== false,
      headToHead: h2h.available,
      standings: standings.available,
      homeTeam: homeTeam.available,
      awayTeam: awayTeam.available
    },
    sourceErrors: requests.map((item, index) => item.available ? null : ({
      source: ["matchStats", "events", "lineups", "headToHead", "standings", "homeTeam", "awayTeam"][index],
      error: item.error || "Dados indisponíveis."
    })).filter(Boolean)
  };

  const hasContext = Boolean(stats.standings || stats.headToHead?.length || stats.homeTeam || stats.awayTeam || stats.matchStats);
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    fixtureId,
    status: hasContext ? "context_available" : "insufficient_context",
    stats,
    note: "Cada secção identifica a sua disponibilidade. Lesões/ausências não são inventadas quando a fonte não as fornece."
  });
}
