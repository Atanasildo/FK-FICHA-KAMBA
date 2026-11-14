import { createClient } from "@supabase/supabase-js";
import analyze from "./ai-analyze.js";

const TEST_MATCH_ID = "5dafd4a5-c442-4383-a80c-e85fa1307f40";
const ALLOWED_BOOKMAKERS = new Set(["BantuBet", "ElephantBet"]);

function mockResponse() {
  const result = { statusCode: 200, body: null, headers: {} };
  return {
    result,
    setHeader(name, value) { result.headers[name] = value; },
    status(code) { result.statusCode = code; return this; },
    json(body) { result.body = body; return this; }
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) {
    return res.status(503).json({ error: "Configuração segura do Supabase incompleta." });
  }

  try {
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const [matchResult, statsResult, comparisonResult] = await Promise.all([
      admin.from("matches")
        .select("id,external_id,home_team,away_team,competition,kickoff_at,status,source")
        .eq("id", TEST_MATCH_ID).maybeSingle(),
      admin.from("match_statistics")
        .select("payload,source,collected_at")
        .eq("match_id", TEST_MATCH_ID)
        .order("collected_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("odds_comparisons")
        .select("comparison,created_at")
        .eq("match_id", TEST_MATCH_ID)
        .order("created_at", { ascending: false }).limit(1).maybeSingle()
    ]);

    if (matchResult.error) throw matchResult.error;
    if (statsResult.error) throw statsResult.error;
    if (comparisonResult.error) throw comparisonResult.error;

    const match = matchResult.data;
    const stats = statsResult.data;
    const comparisonRow = comparisonResult.data;
    if (!match || !stats?.payload || !comparisonRow?.comparison) {
      return res.status(422).json({ error: "O jogo de teste não tem todos os dados necessários na base de dados." });
    }

    const events = Array.isArray(comparisonRow.comparison.events)
      ? comparisonRow.comparison.events : [];
    const rawMarkets = events.flatMap(event => Array.isArray(event.comparisons) ? event.comparisons : []);
    const usableMarkets = rawMarkets.filter(item => {
      const quotes = Array.isArray(item.quotes) ? item.quotes : [];
      const houses = new Set(quotes.map(quote => quote.bookmaker).filter(name => ALLOWED_BOOKMAKERS.has(name)));
      return houses.has("BantuBet") && houses.has("ElephantBet") &&
        typeof item.market === "string" && typeof item.selection === "string";
    }).slice(0, 30);

    if (!usableMarkets.length) {
      return res.status(422).json({ error: "Não foram encontradas selecções equivalentes das duas casas para o jogo de teste." });
    }

    const fixtures = [];
    for (const bookmaker of ALLOWED_BOOKMAKERS) {
      const markets = [];
      for (const item of usableMarkets) {
        for (const quote of item.quotes || []) {
          if (quote.bookmaker !== bookmaker) continue;
          markets.push({
            market: item.market,
            selection: item.selection,
            odds: Number(quote.odds),
            line: item.line ?? quote.line ?? null,
            marketType: item.marketType ?? quote.marketType ?? null,
            marketBase: item.marketBase ?? quote.marketBase ?? null,
            period: item.period || "full_time",
            bookmaker,
            collectedAt: quote.collectedAt || comparisonRow.created_at,
            sourceUrl: quote.sourceUrl || null
          });
        }
      }
      fixtures.push({
        id: String(match.external_id || match.id),
        home: match.home_team,
        away: match.away_team,
        competition: match.competition,
        kickoff: match.kickoff_at,
        status: match.status || "scheduled",
        stats: stats.payload,
        source: match.source || "stored-data-test",
        bookmaker,
        markets
      });
    }

    const mocked = mockResponse();
    await analyze({
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      body: { fixtures }
    }, mocked);

    res.setHeader("Cache-Control", "no-store");
    return res.status(mocked.result.statusCode).json({
      testOnly: true,
      writesPerformed: false,
      publicationAttempted: false,
      bookingAttempted: false,
      fixture: {
        id: match.external_id || match.id,
        home: match.home_team,
        away: match.away_team,
        competition: match.competition,
        kickoff: match.kickoff_at,
        statusInDatabase: match.status
      },
      input: {
        statisticsSource: stats.source,
        statisticsCollectedAt: stats.collected_at,
        oddsComparisonCreatedAt: comparisonRow.created_at,
        equivalentMarketsSent: usableMarkets.length,
        bookmakers: [...ALLOWED_BOOKMAKERS]
      },
      result: mocked.result.body
    });
  } catch (error) {
    console.error("[FK test-ai-existing] failed", {
      name: error?.name || "Error",
      message: String(error?.message || "Erro desconhecido").slice(0, 300)
    });
    return res.status(500).json({ error: "Falha no teste com os dados guardados." });
  }
}
