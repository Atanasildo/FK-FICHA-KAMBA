import { createClient } from "@supabase/supabase-js";
import analyze from "../../api/ai-analyze.js";
import saveAnalysis from "./save-analysis.js";
import buildTickets from "./build-tickets.js";
import collectContext from "./collect-context.js";
import discoverFixtures from "./discover-fixtures.js";

const TZ = "Africa/Luanda";
const MAX_ODDS_AGE_MS = 30 * 60 * 1000;
const MAX_CONTEXT_BATCHES = 5;

function responseMock() {
  const result = { statusCode: 200, body: null, headers: {} };
  return {
    result,
    setHeader(name, value) { result.headers[name] = value; },
    status(code) { result.statusCode = code; return this; },
    json(body) { result.body = body; return this; }
  };
}

async function invoke(handler, body, secret) {
  const mock = responseMock();
  await handler({
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    body,
    query: {}
  }, mock);
  return mock.result;
}

function normalizeTeam(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function linkSwarmMatches(admin) {
  const now = new Date();
  const from = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString();
  const [swarmResult, sportResult] = await Promise.all([
    admin.from("matches").select("id,external_id,home_team,away_team,kickoff_at")
      .eq("source", "swarm").gte("kickoff_at", from).lte("kickoff_at", to).limit(500),
    admin.from("matches").select("id,external_id,home_team,away_team,kickoff_at")
      .eq("source", "SportAPI").gte("kickoff_at", from).lte("kickoff_at", to).limit(1000)
  ]);
  if (swarmResult.error) throw swarmResult.error;
  if (sportResult.error) throw sportResult.error;

  let linked = 0;
  for (const swarm of swarmResult.data || []) {
    const home = normalizeTeam(swarm.home_team);
    const away = normalizeTeam(swarm.away_team);
    const kickoff = Date.parse(swarm.kickoff_at || "");
    if (!home || !away || !Number.isFinite(kickoff)) continue;

    const candidates = (sportResult.data || []).filter(match =>
      normalizeTeam(match.home_team) === home &&
      normalizeTeam(match.away_team) === away &&
      Number.isFinite(Date.parse(match.kickoff_at || "")) &&
      Math.abs(Date.parse(match.kickoff_at) - kickoff) <= 4 * 60 * 60 * 1000
    ).sort((a, b) =>
      Math.abs(Date.parse(a.kickoff_at) - kickoff) - Math.abs(Date.parse(b.kickoff_at) - kickoff)
    );
    const canonical = candidates[0];
    if (!canonical) continue;

    const [comparisonsUpdate, marketsUpdate] = await Promise.all([
      admin.from("odds_comparisons").update({ match_id: canonical.id }).eq("match_id", swarm.id),
      admin.from("markets").update({ match_id: canonical.id }).eq("match_id", swarm.id)
    ]);
    if (comparisonsUpdate.error) throw comparisonsUpdate.error;
    if (marketsUpdate.error) throw marketsUpdate.error;
    linked++;
  }
  return linked;
}

function buildProviderFixtures(matches, comparisonByMatch, statsByMatch, now) {
  const fixtures = [];
  const storedFixtures = [];
  const rejected = [];

  for (const match of matches) {
    const comparisonRow = comparisonByMatch.get(match.id);
    const statsRow = statsByMatch.get(match.id);
    if (!comparisonRow || !statsRow?.payload || typeof statsRow.payload !== "object") {
      rejected.push({ fixtureId: match.external_id, reason: "Falta comparação ou contexto estatístico guardado." });
      continue;
    }

    const comparisons = (comparisonRow.comparison?.events || [])
      .flatMap(event => event.comparisons || []);
    const byBookmaker = new Map([["BantuBet", []], ["ElephantBet", []]]);
    for (const item of comparisons) {
      for (const quote of item.quotes || []) {
        if (!byBookmaker.has(quote.bookmaker)) continue;
        const collectedAt = Date.parse(quote.collectedAt || comparisonRow.created_at || "");
        if (!Number.isFinite(collectedAt) || now - collectedAt > MAX_ODDS_AGE_MS || collectedAt > now + 60000) continue;
        if (!Number.isFinite(Number(quote.odds)) || Number(quote.odds) < 1.4) continue;
        byBookmaker.get(quote.bookmaker).push({
          market: item.market,
          selection: item.selection,
          odds: Number(quote.odds),
          line: item.line ?? quote.line ?? null,
          marketType: item.marketType ?? quote.marketType ?? null,
          marketBase: item.marketBase ?? quote.marketBase ?? null,
          period: item.period || "full_time",
          bookmaker: quote.bookmaker,
          collectedAt: quote.collectedAt || comparisonRow.created_at,
          sourceUrl: quote.sourceUrl || null
        });
      }
    }

    let included = false;
    for (const [bookmaker, markets] of byBookmaker) {
      if (!markets.length) continue;
      fixtures.push({
        id: String(match.external_id),
        home: match.home_team,
        away: match.away_team,
        competition: match.competition,
        kickoff: match.kickoff_at,
        status: match.status,
        stats: statsRow.payload,
        bookmaker,
        markets
      });
      included = true;
    }
    if (included) {
      storedFixtures.push({
        id: String(match.external_id),
        home: match.home_team,
        away: match.away_team,
        competition: match.competition,
        kickoff: match.kickoff_at,
        status: match.status,
        stats: statsRow.payload
      });
    } else {
      rejected.push({ fixtureId: match.external_id, reason: "As cotações comparáveis estão ausentes ou têm mais de 30 minutos." });
    }
  }
  return { fixtures, storedFixtures, rejected };
}

export default async function runDaily(req, res) {
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
  if (!url || !serviceKey || !process.env.SPORTAPI_KEY || !process.env.GROQ_API_KEY) {
    return res.status(503).json({ error: "Falta configurar Supabase, SPORTAPI_KEY ou GROQ_API_KEY no servidor." });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const startedAt = new Date().toISOString();
  const discovery = await invoke(discoverFixtures, { days: 4 }, secret);
  if (discovery.statusCode >= 400) {
    return res.status(discovery.statusCode).json({ stage: "discovery", result: discovery.body });
  }

  let linkedSwarmMatches = 0;
  try { linkedSwarmMatches = await linkSwarmMatches(admin); }
  catch (error) {
    return res.status(500).json({ stage: "match-linking", error: error.message });
  }

  const now = Date.now();
  const from = new Date(now + 6 * 60 * 60 * 1000).toISOString();
  const to = new Date(now + 4 * 24 * 60 * 60 * 1000).toISOString();
  const { data: matches, error: matchesError } = await admin.from("matches")
    .select("id,external_id,home_team,away_team,competition,kickoff_at,status")
    .eq("source", "SportAPI").eq("status", "scheduled")
    .gte("kickoff_at", from).lte("kickoff_at", to)
    .order("kickoff_at", { ascending: true }).limit(500);
  if (matchesError) return res.status(500).json({ stage: "load-matches", error: matchesError.message });

  const matchIds = (matches || []).map(match => match.id);
  if (!matchIds.length) {
    return res.status(200).json({
      ok: true, stage: "no-matches", discovered: discovery.body?.fixturesDiscovered || 0,
      linkedSwarmMatches, message: "Não há jogos futuros elegíveis para análise."
    });
  }

  const { data: comparisonRows, error: comparisonError } = await admin.from("odds_comparisons")
    .select("match_id,comparison,created_at").in("match_id", matchIds)
    .order("created_at", { ascending: false }).limit(5000);
  if (comparisonError) return res.status(500).json({ stage: "load-comparisons", error: comparisonError.message });

  const comparisonByMatch = new Map();
  for (const row of comparisonRows || []) {
    if (!comparisonByMatch.has(row.match_id) && row.comparison?.source === "Swarm") comparisonByMatch.set(row.match_id, row);
  }
  const eligibleMatches = (matches || []).filter(match => comparisonByMatch.has(match.id));
  if (!eligibleMatches.length) {
    return res.status(200).json({
      ok: true, stage: "waiting-for-odds",
      discovered: discovery.body?.fixturesDiscovered || 0, linkedSwarmMatches,
      message: "As odds foram guardadas, mas ainda não há comparações Swarm associadas a jogos SportAPI."
    });
  }

  const eligibleIds = eligibleMatches.map(match => match.id);
  let { data: statisticsRows, error: statisticsError } = await admin.from("match_statistics")
    .select("match_id,payload,collected_at").eq("source", "SportAPI")
    .in("match_id", eligibleIds).order("collected_at", { ascending: false }).limit(2000);
  if (statisticsError) return res.status(500).json({ stage: "load-context", error: statisticsError.message });

  const latestStats = new Map();
  for (const row of statisticsRows || []) if (!latestStats.has(row.match_id)) latestStats.set(row.match_id, row);
  let pendingContext = eligibleIds.filter(id => !latestStats.has(id));

  for (let i = 0; i < MAX_CONTEXT_BATCHES && pendingContext.length; i++) {
    const batch = pendingContext.slice(0, 10);
    const contextResult = await invoke(collectContext, { limit: 10, matchIds: batch }, secret);
    if (contextResult.statusCode >= 400) {
      return res.status(contextResult.statusCode).json({ stage: "collect-context", result: contextResult.body });
    }
    const { data: refreshed, error } = await admin.from("match_statistics")
      .select("match_id,payload,collected_at").eq("source", "SportAPI")
      .in("match_id", eligibleIds).order("collected_at", { ascending: false }).limit(2000);
    if (error) return res.status(500).json({ stage: "reload-context", error: error.message });
    statisticsRows = refreshed || [];
    latestStats.clear();
    for (const row of statisticsRows) if (!latestStats.has(row.match_id)) latestStats.set(row.match_id, row);
    pendingContext = eligibleIds.filter(id => !latestStats.has(id));
    if (!contextResult.body?.processed) break;
  }

  const built = buildProviderFixtures(eligibleMatches, comparisonByMatch, latestStats, Date.now());
  if (!built.fixtures.length) {
    return res.status(200).json({
      ok: true, stage: "waiting-for-context-or-fresh-odds",
      linkedSwarmMatches, eligibleMatches: eligibleMatches.length,
      contextAvailable: latestStats.size, rejected: built.rejected
    });
  }

  const analysisResult = await invoke(analyze, { fixtures: built.fixtures }, secret);
  if (analysisResult.statusCode >= 400) {
    return res.status(analysisResult.statusCode).json({ stage: "analysis", result: analysisResult.body });
  }
  const analysis = analysisResult.body || {};
  if (!Array.isArray(analysis.selections) || !analysis.selections.length) {
    return res.status(200).json({
      ok: true, stage: "analysis-complete-no-selections",
      linkedSwarmMatches, analysedFixtures: built.fixtures.length,
      summary: analysis.summary || null, rejected: built.rejected,
      analysis
    });
  }

  const saveResult = await invoke(saveAnalysis, { fixtures: built.storedFixtures, analysis }, secret);
  if (saveResult.statusCode >= 400) {
    return res.status(saveResult.statusCode).json({ stage: "save-analysis", result: saveResult.body });
  }

  const ticketResult = await invoke(buildTickets, {
    pool: analysis.selections,
    publishedAt: new Date().toISOString()
  }, secret);
  if (ticketResult.statusCode >= 400) {
    return res.status(ticketResult.statusCode).json({
      stage: "build-tickets", analysisSelections: analysis.selections.length,
      save: saveResult.body, result: ticketResult.body
    });
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    timezone: TZ,
    discovery: discovery.body,
    linkedSwarmMatches,
    analysedFixtures: built.fixtures.length,
    contextAvailable: latestStats.size,
    selectedMarkets: analysis.selections.length,
    savedAnalysis: saveResult.body,
    ticketPipeline: ticketResult.body,
    rejected: built.rejected
  });
}
