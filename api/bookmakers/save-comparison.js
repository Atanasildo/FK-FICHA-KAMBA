import { createClient } from "@supabase/supabase-js";
import { handleSwarmIngest } from "../../lib/bookmakers/ingest-swarm-handler.js";

const json = (res, status, body) => res.status(status).json(body);
const slug = (value) => String(value || "")
  .normalize("NFD").replace(/[\\u0300-\\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  .slice(0, 100);

export default async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization === "Bearer " + process.env.CRON_SECRET) {
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Método não permitido." }); }
    return handleSwarmIngest(req, res);
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Método não permitido." });
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !anonKey || !serviceKey) {
    return json(res, 503, { error: "A ligação segura à base de dados ainda não está configurada no servidor." });
  }

  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return json(res, 401, { error: "Inicia sessão para guardar esta comparação." });

  const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData?.user) return json(res, 401, { error: "Sessão inválida ou expirada. Inicia sessão novamente." });

  const { fixtures, comparison } = req.body || {};
  if (!Array.isArray(fixtures) || fixtures.length !== 2 || !comparison || !Array.isArray(comparison.events)) {
    return json(res, 400, { error: "Dados de comparação incompletos." });
  }
  const allowed = new Set(["BantuBet", "ElephantBet"]);
  if (new Set(fixtures.map(f => f?.bookmaker)).size !== 2 ||
      fixtures.some(f => !allowed.has(f?.bookmaker) || !f.home || !f.away || !Array.isArray(f.markets) || f.markets.length > 12000)) {
    return json(res, 400, { error: "As duas recolhas devem ser válidas e pertencer à BantuBet e à ElephantBet." });
  }
  const first = fixtures[0];
  if (fixtures.some(f => slug(f.home) !== slug(first.home) || slug(f.away) !== slug(first.away))) {
    return json(res, 400, { error: "As duas recolhas têm de corresponder ao mesmo jogo." });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const matchKey = [slug(first.home), slug(first.away), slug(first.kickoff || "sem-data")].join("-");
  const { data: match, error: matchError } = await admin.from("matches").upsert({
    source: "fk-manual-import",
    external_id: matchKey,
    home_team: first.home,
    away_team: first.away,
    competition: first.competition || null,
    kickoff_at: first.kickoff || null,
    status: "scheduled",
    updated_at: new Date().toISOString()
  }, { onConflict: "source,external_id" }).select("id").single();
  if (matchError) return json(res, 500, { error: "Não foi possível guardar o jogo.", detail: matchError.message });

  let insertedMarkets = 0;
  for (const fixture of fixtures) {
    const code = fixture.bookmaker.toLowerCase();
    const { data: bookmaker, error: bookmakerError } = await admin.from("bookmakers").upsert({
      code,
      name: fixture.bookmaker,
      website_url: fixture.sourceUrl || null,
      active: true
    }, { onConflict: "code" }).select("id").single();
    if (bookmakerError) return json(res, 500, { error: "Não foi possível registar a casa de apostas.", detail: bookmakerError.message });

    const rows = fixture.markets.map(m => ({
      match_id: match.id,
      bookmaker_id: bookmaker.id,
      market_name: String(m.market || "Mercado").slice(0, 250),
      market_key: [slug(m.market), slug(m.period || "full-time"), slug(m.line || ""), slug(m.marketType || ""), m.marketBase == null ? "" : String(m.marketBase)].filter(Boolean).join(":"),
      period: String(m.period || "full_time").slice(0, 40),
      line: m.line == null ? null : String(m.line).slice(0, 80),
      selection: String(m.selection || "").slice(0, 250),
      odd: Number(m.odds),
      source_url: m.sourceUrl || fixture.sourceUrl || null,
      collected_at: m.collectedAt || fixture.collectedAt || new Date().toISOString()
    })).filter(m => m.selection && Number.isFinite(m.odd) && m.odd > 1 && m.odd <= 10000);

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from("markets").insert(rows.slice(i, i + 500));
      if (error) return json(res, 500, { error: "O jogo foi registado, mas houve um erro ao guardar as odds.", detail: error.message });
      insertedMarkets += Math.min(500, rows.length - i);
    }
  }

  const { error: comparisonError } = await admin.from("odds_comparisons").insert({
    match_id: match.id,
    comparison,
    best_prices: comparison.events.flatMap(group => (group.comparisons || []).map(item => ({
      market: item.market, selection: item.selection, bestBookmaker: item.bestBookmaker, bestOdds: item.bestOdds
    })))
  });
  if (comparisonError) return json(res, 500, { error: "As odds foram guardadas, mas não foi possível guardar o resumo da comparação.", detail: comparisonError.message });

  res.setHeader("Cache-Control", "no-store");
  return json(res, 200, { ok: true, matchId: match.id, insertedMarkets, userId: authData.user.id });
}
