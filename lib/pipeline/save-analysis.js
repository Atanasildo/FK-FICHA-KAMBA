import { createClient } from "@supabase/supabase-js";

const MIN_ODDS = 1.4;
const allowedBookmakers = new Set(["BantuBet", "ElephantBet"]);
const send = (res, status, body) => res.status(status).json(body);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Método não permitido." });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return send(res, 401, { error: "Não autorizado." });
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) {
    return send(res, 503, { error: "Configuração segura do Supabase incompleta." });
  }

  const { fixtures, analysis } = req.body || {};
  if (!Array.isArray(fixtures) || !fixtures.length || fixtures.length > 50 ||
      !analysis || !Array.isArray(analysis.selections)) {
    return send(res, 400, { error: "Envia fixtures e o resultado validado da análise Groq." });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const saved = [];
  for (const fixture of fixtures) {
    if (!fixture || !String(fixture.id || "").trim() || !fixture.home || !fixture.away ||
        !fixture.stats || typeof fixture.stats !== "object") {
      return send(res, 400, { error: "Cada jogo precisa de ID SportAPI, equipas e estatísticas com origem." });
    }
    const picks = analysis.selections.filter(p => p.fixtureId === String(fixture.id));
    const validPicks = picks.filter(p =>
      p && typeof p.market === "string" && typeof p.selection === "string" &&
      Number(p.bestOdds) >= MIN_ODDS && allowedBookmakers.has(p.bestBookmaker) &&
      Array.isArray(p.quotes) && p.quotes.filter(q =>
        allowedBookmakers.has(q.bookmaker) && Number(q.odds) >= MIN_ODDS
      ).length >= 2
    );

    const { data: match, error: matchError } = await admin.from("matches").upsert({
      source: "SportAPI",
      external_id: String(fixture.id),
      home_team: fixture.home,
      away_team: fixture.away,
      competition: fixture.competition || null,
      kickoff_at: fixture.kickoff || null,
      status: fixture.status || "scheduled",
      updated_at: new Date().toISOString()
    }, { onConflict: "source,external_id" }).select("id").single();
    if (matchError) return send(res, 500, { error: "Falha ao guardar o jogo.", detail: matchError.message });

    const { error: statsError } = await admin.from("match_statistics").insert({
      match_id: match.id,
      source: String(fixture.stats.source || "SportAPI"),
      payload: fixture.stats,
      collected_at: fixture.stats.collectedAt || new Date().toISOString()
    });
    if (statsError) return send(res, 500, { error: "Falha ao guardar as estatísticas.", detail: statsError.message });

    const { error: analysisError } = await admin.from("match_analyses").insert({
      match_id: match.id,
      provider: analysis.provider || "Groq",
      model: analysis.model || null,
      status: validPicks.length ? "ready" : "insufficient_data",
      summary: analysis.summary || null,
      analysis: { ...analysis, selections: validPicks },
      generated_at: analysis.generatedAt || new Date().toISOString()
    });
    if (analysisError) return send(res, 500, { error: "Falha ao guardar a análise.", detail: analysisError.message });

    const bookmakerIds = new Map();
    const marketRows = [];
    for (const pick of validPicks) {
      for (const quote of pick.quotes) {
        if (!allowedBookmakers.has(quote.bookmaker) || !Number.isFinite(Number(quote.odds)) ||
            Number(quote.odds) < MIN_ODDS || Number(quote.odds) > 10000) continue;
        if (!bookmakerIds.has(quote.bookmaker)) {
          const code = quote.bookmaker.toLowerCase();
          const { data: bookmaker, error } = await admin.from("bookmakers").upsert({
            code, name: quote.bookmaker, active: true
          }, { onConflict: "code" }).select("id").single();
          if (error) return send(res, 500, { error: "Falha ao registar casa de apostas.", detail: error.message });
          bookmakerIds.set(quote.bookmaker, bookmaker.id);
        }
        marketRows.push({
          match_id: match.id,
          bookmaker_id: bookmakerIds.get(quote.bookmaker),
          market_name: pick.market.slice(0, 250),
          market_key: [pick.market, pick.selection].join(":").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9:+.-]+/g, "-").slice(0, 220),
          period: pick.period === "1H" ? "first_half" : pick.period === "2H" ? "second_half" : "full_time",
          line: quote.line == null ? (pick.line == null ? null : String(pick.line)) : String(quote.line),
          selection: pick.selection.slice(0, 250),
          odd: Number(quote.odds),
          source_url: quote.sourceUrl || null,
          collected_at: quote.collectedAt || new Date().toISOString()
        });
      }
    }
    if (marketRows.length) {
      const { error: marketError } = await admin.from("markets").insert(marketRows);
      if (marketError) return send(res, 500, { error: "Falha ao guardar odds seleccionadas.", detail: marketError.message });
    }

    const { error: comparisonError } = await admin.from("odds_comparisons").insert({
      match_id: match.id,
      comparison: { selections: validPicks },
      best_prices: validPicks.map(p => ({
        market: p.market, selection: p.selection,
        bestBookmaker: p.bestBookmaker, bestOdds: p.bestOdds
      }))
    });
    if (comparisonError) return send(res, 500, { error: "Falha ao guardar comparação de odds.", detail: comparisonError.message });

    saved.push({ fixtureId: String(fixture.id), matchId: match.id, savedSelections: validPicks.length, savedQuotes: marketRows.length });
  }

  res.setHeader("Cache-Control", "no-store");
  return send(res, 200, {
    ok: true,
    saved,
    publishedTickets: 0,
    note: "Jogos, estatísticas, análises e odds seleccionadas guardados. Nenhum bilhete foi publicado automaticamente por esta rota."
  });
}
