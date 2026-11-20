export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }
  const key = process.env.HIGHLIGHTLY_API_KEY;
  if (!key) return res.status(503).json({ ok: false, error: "HIGHLIGHTLY_API_KEY não configurada." });
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Luanda", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
  try {
    const params = new URLSearchParams({ date, timezone: "Africa/Luanda", limit: "100", offset: "0" });
    const response = await fetch(`https://soccer.highlightly.net/matches?${params}`, {
      headers: { "x-rapidapi-key": key, Accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(502).json({
      ok: false, status: response.status, message: payload?.message || payload?.error || "Highlightly request failed"
    });
    const matches = Array.isArray(payload?.data) ? payload.data : [];
    const leagues = [...new Set(matches.map(match => match?.league?.name).filter(Boolean))];
    return res.status(200).json({
      ok: true, provider: "Highlightly", date, tier: payload?.plan?.tier || null,
      planMessage: payload?.plan?.message || null,
      fixturesReturned: matches.length, totalCount: payload?.pagination?.totalCount ?? null,
      leaguesReturned: leagues.slice(0, 30)
    });
  } catch (error) {
    return res.status(502).json({ ok: false, message: error.message });
  }
}
