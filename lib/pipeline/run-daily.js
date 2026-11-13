import { createClient } from "@supabase/supabase-js";
import analyze from "../../api/ai-analyze.js";
import saveAnalysis from "./save-analysis.js";
import buildTickets from "./build-tickets.js";
import collectContext from "./collect-context.js";
import discoverFixtures from "./discover-fixtures.js";
import { hasUsableAnalysisContext, isFreshAnalysisContext } from "./context-quality.js";
import { selectCanonicalMatch } from "./match-linking.js";

const TZ = "Africa/Luanda";
const MAX_ODDS_AGE_MS = 30 * 60 * 1000;
const MAX_CONTEXT_AGE_MS = 12 * 60 * 60 * 1000;
const ANALYSIS_BATCH_SIZE = 5;
const MAX_CONTEXT_BATCHES = 1;

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

function luandaDayStart() {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
  return new Date(`${date}T00:00:00+01:00`).toISOString();
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
  const claimedCanonicalIds = new Set();
  for (const swarm of swarmResult.data || []) {
    const canonical = selectCanonicalMatch(swarm, sportResult.data || [], claimedCanonicalIds);
    if (!canonical) continue;
    claimedCanonicalIds.add(canonical.id);

    // Raw market history is large; only relink its fresh 30-minute window.
    // The analysis pipeline consumes odds_comparisons, while older market rows
    // remain archived under their original Swarm match to avoid long updates.
    const freshSince = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
    const [comparisonsUpdate, marketsUpdate] = await Promise.all([
      admin.from("odds_comparisons").update({ match_id: canonical.id }).eq("match_id", swarm.id),
      admin.from("markets").update({ match_id: canonical.id }).eq("match_id", swarm.id)
        .gte("collected_at", freshSince)
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
    const statsFresh = isFreshAnalysisContext(statsRow, now, MAX_CONTEXT_AGE_MS);
    if (!comparisonRow || !statsFresh || !hasUsableAnalysisContext(statsRow?.payload, now)) {
      rejected.push({ fixtureId: match.external_id, reason: "Falta comparação ou estatística real do jogo." });
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

async function markInsufficient(admin, matches, reason) {
  if (!matches.length) return;
  const generatedAt = new Date().toISOString();
  const rows = matches.map(match => ({
    match_id: match.id,
    provider: "FK",
    model: "pipeline-validation",
    status: "insufficient_data",
    summary: reason,
    analysis: { reason, fixtureId: match.external_id },
    generated_at: generatedAt
  }));
  const { error } = await admin.from("match_analyses").insert(rows);
  if (error) throw error;
}

function analysisIsCurrent(match, latestByMatch, comparisonByMatch, contextByMatch) {
  const analysis = latestByMatch.get(match.id);
  if (!analysis) return false;
  const analysisAt = Date.parse(analysis.generated_at || "");
  const comparisonAt = Date.parse(comparisonByMatch.get(match.id)?.created_at || "");
  const contextAt = Date.parse(contextByMatch.get(match.id)?.collected_at || "");
  if (!Number.isFinite(analysisAt)) return false;
  // A validation rejection is complete for the evidence available at that
  // time. Retry only when odds or statistical context has actually changed.
  return (!Number.isFinite(comparisonAt) || analysisAt >= comparisonAt) &&
    (!Number.isFinite(contextAt) || analysisAt >= contextAt);
}

async function latestAnalysesForDay(admin, matchIds, dayStart) {
  const { data, error } = await admin.from("match_analyses")
    .select("match_id,status,analysis,generated_at,provider,model")
    .in("match_id", matchIds)
    .gte("generated_at", dayStart)
    .order("generated_at", { ascending: false })
    .limit(5000);
  if (error) throw error;
  const latest = new Map();
  for (const row of data || []) if (!latest.has(row.match_id)) latest.set(row.match_id, row);
  return latest;
}

async function publishDailyBatch(admin, eligibleMatches, matchIds, dayStart, secret, res, meta) {
  const { data: existingTickets, error: ticketLookupError } = await admin.from("tickets")
    .select("id").eq("status", "published").gte("published_at", dayStart).limit(1);
  if (ticketLookupError) return res.status(500).json({ stage: "check-publication", error: ticketLookupError.message });
  if (existingTickets?.length) {
    return res.status(200).json({
      ok: true, stage: "already-published-today",
      publishedTicketsExist: true,
      ...meta,
      message: "Já existem bilhetes publicados hoje. Não foram criadas cópias."
    });
  }

  const latest = await latestAnalysesForDay(admin, matchIds, dayStart);
  const pool = [...latest.values()].flatMap(row => Array.isArray(row.analysis?.selections) ? row.analysis.selections : []);
  const now = Date.now();
  const freshPool = pool.filter(pick => {
    const quotes = Array.isArray(pick.quotes) ? pick.quotes : [];
    const bookmakers = new Set(quotes.map(quote => quote.bookmaker));
    return bookmakers.has("BantuBet") && bookmakers.has("ElephantBet") &&
      quotes.every(quote => {
        const collectedAt = Date.parse(quote.collectedAt || "");
        return Number.isFinite(collectedAt) && now - collectedAt <= MAX_ODDS_AGE_MS && collectedAt <= now + 60000;
      });
  });

  if (!freshPool.length) {
    return res.status(200).json({
      ok: true, stage: "no-valid-selections",
      analysedMatches: latest.size, candidateSelections: pool.length,
      message: "Não há selecções com odds das duas casas suficientemente recentes. Nenhum bilhete foi criado."
    });
  }

  const ticketResult = await invoke(buildTickets, {
    pool: freshPool,
    publishedAt: new Date().toISOString()
  }, secret);
  if (ticketResult.statusCode >= 400) {
    return res.status(ticketResult.statusCode).json({ stage: "build-tickets", result: ticketResult.body });
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ok: true,
    stage: ticketResult.body?.publicationStatus === "published" ? "published" : "batch-not-published",
    analysedMatches: latest.size,
    candidateSelections: pool.length,
    freshSelections: freshPool.length,
    ticketPipeline: ticketResult.body,
    ...meta
  });
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
  const dayStart = luandaDayStart();
  const discovery = req.body?.skipDiscovery
    ? { statusCode: 200, body: { fixturesDiscovered: Number(req.body.discovered || 0) } }
    : await invoke(discoverFixtures, { days: 4 }, secret);
  if (discovery.statusCode >= 400) {
    return res.status(discovery.statusCode).json({ stage: "discovery", result: discovery.body });
  }

  let linkedSwarmMatches = 0;
  try { linkedSwarmMatches = await linkSwarmMatches(admin); }
  catch (error) {
    return res.status(500).json({ stage: "match-linking", error: error.message });
  }

  const now = Date.now();
  const from = new Date(now + 3 * 60 * 60 * 1000).toISOString();
  const to = new Date(now + 4 * 24 * 60 * 60 * 1000).toISOString();
  const { data: matches, error: matchesError } = await admin.from("matches")
    .select("id,external_id,home_team,away_team,competition,kickoff_at,status")
    .eq("source", "SportAPI").eq("status", "scheduled")
    .gte("kickoff_at", from).lte("kickoff_at", to)
    .order("kickoff_at", { ascending: true }).limit(500);
  if (matchesError) return res.status(500).json({ stage: "load-matches", error: matchesError.message });

  const allMatches = matches || [];
  const allMatchIds = allMatches.map(match => match.id);
  if (!allMatchIds.length) {
    return res.status(200).json({
      ok: true, stage: "no-matches", discovered: discovery.body?.fixturesDiscovered || 0,
      linkedSwarmMatches, message: "Não há jogos futuros elegíveis para análise."
    });
  }

  const { data: comparisonRows, error: comparisonError } = await admin.from("odds_comparisons")
    .select("match_id,comparison,created_at").in("match_id", allMatchIds)
    .order("created_at", { ascending: false }).limit(5000);
  if (comparisonError) return res.status(500).json({ stage: "load-comparisons", error: comparisonError.message });

  const comparisonByMatch = new Map();
  for (const row of comparisonRows || []) {
    if (!comparisonByMatch.has(row.match_id) && row.comparison?.source === "Swarm") comparisonByMatch.set(row.match_id, row);
  }
  const eligibleMatches = allMatches.filter(match => comparisonByMatch.has(match.id));
  if (!eligibleMatches.length) {
    return res.status(200).json({
      ok: true, stage: "waiting-for-odds",
      discovered: discovery.body?.fixturesDiscovered || 0, linkedSwarmMatches,
      message: "As odds foram guardadas, mas ainda não há comparações Swarm associadas a jogos SportAPI."
    });
  }

  const eligibleIds = eligibleMatches.map(match => match.id);
  let latest = await latestAnalysesForDay(admin, eligibleIds, dayStart);
  const { data: allContextRows, error: allContextError } = await admin.from("match_statistics")
    .select("match_id,payload,collected_at").eq("source", "SportAPI")
    .in("match_id", eligibleIds).order("collected_at", { ascending: false }).limit(5000);
  if (allContextError) return res.status(500).json({ stage: "load-context-index", error: allContextError.message });
  const contextByMatch = new Map();
  for (const row of allContextRows || []) if (!contextByMatch.has(row.match_id)) contextByMatch.set(row.match_id, row);
  const pendingMatches = eligibleMatches.filter(match =>
    !analysisIsCurrent(match, latest, comparisonByMatch, contextByMatch)
  );
  if (!pendingMatches.length) {
    if (req.body?.dryRun === true) {
      const dryRunLatest = await latestAnalysesForDay(admin, eligibleIds, dayStart);
      const candidateSelections = [...dryRunLatest.values()]
        .reduce((sum, row) => sum + (Array.isArray(row.analysis?.selections) ? row.analysis.selections.length : 0), 0);
      return res.status(200).json({
        ok: true, stage: "analysis-dry-run-complete",
        analysedMatches: dryRunLatest.size, candidateSelections, linkedSwarmMatches,
        message: "Análise concluída em modo de teste. Nenhum bilhete, reserva ou publicação foi iniciado."
      });
    }
    return publishDailyBatch(admin, eligibleMatches, eligibleIds, dayStart, secret, res, {
      startedAt, finishedAt: new Date().toISOString(), timezone: TZ,
      discovered: discovery.body?.fixturesDiscovered || 0, linkedSwarmMatches,
      pendingMatches: 0
    });
  }

  const batchMatches = pendingMatches.slice(0, ANALYSIS_BATCH_SIZE);
  const batchIds = batchMatches.map(match => match.id);
  let latestStats = new Map(batchIds.map(id => [id, contextByMatch.get(id)]).filter(([, row]) => Boolean(row)));
  let pendingContext = batchIds.filter(id => {
    return !isFreshAnalysisContext(latestStats.get(id), Date.now(), MAX_CONTEXT_AGE_MS);
  });

  for (let i = 0; i < MAX_CONTEXT_BATCHES && pendingContext.length; i++) {
    const contextResult = await invoke(collectContext, { limit: 10, matchIds: pendingContext }, secret);
    if (contextResult.statusCode >= 400) {
      return res.status(contextResult.statusCode).json({ stage: "collect-context", result: contextResult.body });
    }
    const { data: refreshed, error } = await admin.from("match_statistics")
      .select("match_id,payload,collected_at").eq("source", "SportAPI")
      .in("match_id", batchIds).order("collected_at", { ascending: false }).limit(1000);
    if (error) return res.status(500).json({ stage: "reload-context", error: error.message });
    latestStats = new Map();
    for (const row of refreshed || []) if (!latestStats.has(row.match_id)) latestStats.set(row.match_id, row);
    for (const [id, row] of latestStats) contextByMatch.set(id, row);
    pendingContext = batchIds.filter(id => {
      return !isFreshAnalysisContext(latestStats.get(id), Date.now(), MAX_CONTEXT_AGE_MS);
    });
    if (!contextResult.body?.processed) break;
  }

  const batchComparisons = new Map(batchMatches.map(match => [match.id, comparisonByMatch.get(match.id)]));
  const built = buildProviderFixtures(batchMatches, batchComparisons, latestStats, Date.now());
  const includedIds = new Set(built.storedFixtures.map(fixture => String(fixture.id)));
  const excludedMatches = batchMatches.filter(match => !includedIds.has(String(match.external_id)));

  let analysis = {
    provider: "Groq", model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
    generatedAt: new Date().toISOString(), analysisStatus: "insufficient_data",
    summary: "Não foram encontrados dados estatísticos e odds recentes suficientes para todos os jogos deste lote.",
    selections: [], rejectedFixtureIds: excludedMatches.map(match => String(match.external_id))
  };

  if (built.fixtures.length) {
    const analysisResult = await invoke(analyze, { fixtures: built.fixtures }, secret);
    if (analysisResult.statusCode >= 400) {
      return res.status(analysisResult.statusCode).json({ stage: "analysis", result: analysisResult.body });
    }
    analysis = analysisResult.body || analysis;
    const saveResult = await invoke(saveAnalysis, { fixtures: built.storedFixtures, analysis }, secret);
    if (saveResult.statusCode >= 400) {
      return res.status(saveResult.statusCode).json({ stage: "save-analysis", result: saveResult.body });
    }
  }

  if (excludedMatches.length) {
    try {
      await markInsufficient(admin, excludedMatches, "Jogo excluído: estatísticas reais ou odds recentes das duas casas indisponíveis.");
    } catch (error) {
      return res.status(500).json({ stage: "mark-rejected", error: error.message });
    }
  }

  latest = await latestAnalysesForDay(admin, eligibleIds, dayStart);
  const remaining = eligibleMatches.filter(match =>
    !analysisIsCurrent(match, latest, comparisonByMatch, contextByMatch)
  ).length;
  if (remaining > 0) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true, stage: "analysis-batch-saved",
      batchAnalysed: batchMatches.length, pendingMatches: remaining,
      analysedToday: latest.size, selectedMarkets: analysis.selections?.length || 0,
      rejected: built.rejected,
      message: "Lote analisado e guardado. O recolhedor deve continuar para o próximo lote."
    });
  }

  if (req.body?.dryRun === true) {
    const dryRunLatest = await latestAnalysesForDay(admin, eligibleIds, dayStart);
    const candidateSelections = [...dryRunLatest.values()]
      .reduce((sum, row) => sum + (Array.isArray(row.analysis?.selections) ? row.analysis.selections.length : 0), 0);
    return res.status(200).json({
      ok: true, stage: "analysis-dry-run-complete",
      analysedMatches: dryRunLatest.size, candidateSelections, linkedSwarmMatches,
      rejected: built.rejected,
      message: "Análise concluída em modo de teste. Nenhum bilhete, reserva ou publicação foi iniciado."
    });
  }

  return publishDailyBatch(admin, eligibleMatches, eligibleIds, dayStart, secret, res, {
    startedAt, finishedAt: new Date().toISOString(), timezone: TZ,
    discovered: discovery.body?.fixturesDiscovered || 0, linkedSwarmMatches,
    analysedMatches: latest.size, selectedMarkets: analysis.selections?.length || 0,
    rejected: built.rejected
  });
}
