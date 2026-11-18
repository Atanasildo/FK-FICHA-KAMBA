import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import buildTickets from "../lib/pipeline/build-tickets.js";

const SCOPES = ["read:fixtures", "write:analysis", "publish:tickets"];
const json = (res, status, body) => {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
};
const text = value => String(value ?? "").trim();
const sha256 = value => createHash("sha256").update(value).digest("hex");
const sameSecret = (a, b) => {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
};
const luandaDate = value => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Luanda", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date(value));

function database() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Configuração privada do Supabase incompleta.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function authenticate(db, req, requiredScope) {
  const authorization = text(req.headers.authorization);
  if (!/^Bearer\s+fkai_[A-Za-z0-9_-]{40,}$/.test(authorization)) {
    return { error: "Credencial da IA inválida.", status: 401 };
  }
  const token = authorization.replace(/^Bearer\s+/i, "");
  const { data, error } = await db.from("ai_agent_keys")
    .select("id,name,key_prefix,key_hash,scopes,revoked_at")
    .eq("key_hash", sha256(token)).maybeSingle();
  if (error) return { error: "Não foi possível validar a credencial.", status: 503 };
  if (!data || data.revoked_at) return { error: "Credencial inválida ou revogada.", status: 401 };
  if (!Array.isArray(data.scopes) || !data.scopes.includes(requiredScope)) {
    return { error: "Esta credencial não tem permissão para esta operação.", status: 403 };
  }
  await db.from("ai_agent_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { agent: data };
}

async function audit(db, agent, action, resourceType = null, resourceId = null, metadata = {}) {
  await db.from("ai_agent_audit").insert({
    agent_key_id: agent.id, agent_name: agent.name, action,
    resource_type: resourceType, resource_id: resourceId, metadata
  });
}

async function adminAction(db, req, res, body) {
  const expected = process.env.FK_AI_KEY_ADMIN_SECRET;
  if (!expected || !sameSecret(req.headers["x-fk-ai-admin-secret"], expected)) {
    return json(res, 401, { error: "Autorização administrativa inválida." });
  }
  if (body.action === "issue-key") {
    const name = text(body.name).slice(0, 80);
    if (!name) return json(res, 400, { error: "Indica o nome da IA." });
    const token = "fkai_" + randomBytes(32).toString("base64url");
    const prefix = token.slice(0, 13);
    const { data, error } = await db.from("ai_agent_keys").insert({
      name, key_prefix: prefix, key_hash: sha256(token), scopes: SCOPES
    }).select("id,name,key_prefix,scopes,created_at").single();
    if (error) return json(res, 500, { error: "Não foi possível emitir a credencial.", detail: error.message });
    await db.from("ai_agent_audit").insert({
      agent_key_id: data.id, agent_name: name, action: "issue-key",
      resource_type: "ai_agent_key", resource_id: data.id,
      metadata: { scopes: SCOPES }
    });
    return json(res, 201, {
      ok: true, agent: data, apiKey: token,
      warning: "Esta chave é apresentada uma única vez. Guarda-a num gestor de segredos; não a envies em conversas."
    });
  }
  if (body.action === "revoke-key") {
    const id = text(body.keyId);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(res, 400, { error: "keyId inválido." });
    const { data, error } = await db.from("ai_agent_keys")
      .update({ revoked_at: new Date().toISOString() }).eq("id", id).is("revoked_at", null)
      .select("id,name,revoked_at").maybeSingle();
    if (error) return json(res, 500, { error: "Não foi possível revogar a credencial.", detail: error.message });
    if (!data) return json(res, 404, { error: "Credencial não encontrada ou já revogada." });
    await db.from("ai_agent_audit").insert({
      agent_key_id: data.id, agent_name: data.name, action: "revoke-key",
      resource_type: "ai_agent_key", resource_id: data.id
    });
    return json(res, 200, { ok: true, revoked: data });
  }
  return json(res, 400, { error: "Acção administrativa desconhecida." });
}

async function readFixtures(db, req, res, agent) {
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query?.limit, 10) || 25));
  const offset = Math.max(0, Number.parseInt(req.query?.offset, 10) || 0);
  const now = new Date();
  const { data: matches, error } = await db.from("matches")
    .select("id,external_id,home_team,away_team,competition,kickoff_at,status,source")
    .eq("source", "swarm").gt("kickoff_at", now.toISOString())
    .order("kickoff_at", { ascending: true }).range(offset, offset + limit - 1);
  if (error) return json(res, 500, { error: "Falha ao consultar jogos.", detail: error.message });

  const eligible = (matches || []).filter(match =>
    match.kickoff_at && luandaDate(match.kickoff_at) === luandaDate(now)
  );
  const fixtures = await Promise.all(eligible.map(async match => {
    const [comparisonResult, statsResult, analysisResult] = await Promise.all([
      db.from("odds_comparisons").select("id,comparison,best_prices,created_at")
        .eq("match_id", match.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("match_statistics").select("source,payload,collected_at")
        .eq("match_id", match.id).order("collected_at", { ascending: false }).limit(10),
      db.from("match_analyses").select("id,provider,model,status,summary,analysis,generated_at")
        .eq("match_id", match.id).order("generated_at", { ascending: false }).limit(5)
    ]);
    return {
      ...match,
      latestComparison: comparisonResult.data || null,
      statistics: statsResult.data || [],
      previousAnalyses: analysisResult.data || []
    };
  }));
  await audit(db, agent, "read-fixtures", "match", null, { returned: fixtures.length, limit, offset });
  return json(res, 200, { ok: true, timezone: "Africa/Luanda", count: fixtures.length, limit, offset, fixtures });
}

async function submitAnalysis(db, req, res, agent) {
  const body = req.body || {};
  const matchId = text(body.matchId);
  const analysis = body.analysis;
  if (!/^[0-9a-f-]{36}$/i.test(matchId) || !analysis || typeof analysis !== "object" || Array.isArray(analysis)) {
    return json(res, 400, { error: "Envia matchId UUID e um objecto analysis." });
  }
  const { data: match, error: matchError } = await db.from("matches")
    .select("id,home_team,away_team,kickoff_at,status,source").eq("id", matchId).maybeSingle();
  if (matchError || !match) return json(res, 404, { error: "Jogo não encontrado." });
  if (match.source !== "swarm" || !match.kickoff_at || Date.parse(match.kickoff_at) <= Date.now()) {
    return json(res, 409, { error: "Só é permitido analisar jogos Swarm ainda não iniciados." });
  }
  if (text(analysis.fixture?.home) !== match.home_team || text(analysis.fixture?.away) !== match.away_team) {
    return json(res, 400, { error: "As equipas da análise não correspondem ao jogo seleccionado." });
  }
  if (!Array.isArray(analysis.selections) || analysis.selections.length > 100) {
    return json(res, 400, { error: "analysis.selections deve ser uma lista com até 100 selecções." });
  }
  const { data: latestComparison, error: comparisonError } = await db.from("odds_comparisons")
    .select("comparison,created_at").eq("match_id", matchId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (comparisonError || !latestComparison) {
    return json(res, 409, { error: "Não existe comparação de odds para validar esta análise." });
  }
  if (Date.now() - Date.parse(latestComparison.created_at) > 60 * 60 * 1000) {
    return json(res, 409, { error: "A comparação de odds tem mais de uma hora. Aguarda nova recolha antes de guardar a análise." });
  }

  const storedMarkets = (latestComparison.comparison?.events || []).flatMap(event => event.comparisons || []);
  const validatedSelections = [];
  for (const selection of analysis.selections) {
    const marketName = text(selection?.market);
    const selectionName = text(selection?.selection);
    const probability = Number(selection?.probability ?? selection?.fairProbability);
    if (!marketName || !selectionName || !Number.isFinite(probability) || probability <= 0 || probability >= 1 ||
        text(selection?.rationale).length < 12) {
      return json(res, 400, { error: "Cada selecção precisa de mercado, selecção, probabilidade entre 0 e 1 e fundamentação." });
    }
    const stored = storedMarkets.find(item =>
      text(item.market).toLocaleLowerCase() === marketName.toLocaleLowerCase() &&
      text(item.selection).toLocaleLowerCase() === selectionName.toLocaleLowerCase() &&
      String(item.line ?? "") === String(selection.line ?? "")
    );
    const quotes = stored?.quotes || [];
    const bantu = quotes.find(q => q.bookmaker === "BantuBet" && Number(q.odds) >= 1.4);
    const elephant = quotes.find(q => q.bookmaker === "ElephantBet" && Number(q.odds) >= 1.4);
    if (!bantu || !elephant) {
      return json(res, 400, { error: `A selecção "${marketName} — ${selectionName}" não existe com odds mínimas nas duas casas na comparação guardada.` });
    }
    const best = Number(bantu.odds) >= Number(elephant.odds) ? bantu : elephant;
    validatedSelections.push({
      ...selection,
      probability,
      bestOdds: Number(best.odds),
      bestBookmaker: best.bookmaker,
      quotes: [bantu, elephant].map(q => ({
        bookmaker: q.bookmaker, odds: Number(q.odds),
        line: q.line ?? null, collectedAt: q.collectedAt || latestComparison.created_at,
        sourceUrl: q.sourceUrl || null
      }))
    });
  }

  let researchRecord = null;
  if (body.research != null) {
    const research = body.research;
    const sources = Array.isArray(research.sources) ? research.sources : [];
    const facts = Array.isArray(research.facts) ? research.facts : [];
    const validSources = sources.filter(source => {
      try { return ["http:", "https:"].includes(new URL(source.url).protocol); }
      catch { return false; }
    });
    const sourceUrls = new Set(validSources.map(source => source.url));
    if (facts.length < 3 || sourceUrls.size < 2 ||
        facts.filter(fact => text(fact.claim).length >= 12 && sourceUrls.has(fact.sourceUrl)).length < 2) {
      return json(res, 400, { error: "A pesquisa externa precisa de pelo menos 3 factos e 2 fontes HTTP/HTTPS distintas, ligadas aos factos." });
    }
    researchRecord = {
      source: "InternetSearch", researchedBy: agent.name,
      collectedAt: new Date().toISOString(),
      fixture: { home: match.home_team, away: match.away_team, kickoff: match.kickoff_at },
      research: { ...research, sources: validSources, facts }
    };
    const { error: researchError } = await db.from("match_statistics").insert({
      match_id: matchId, source: "InternetSearch", payload: researchRecord,
      collected_at: new Date().toISOString()
    });
    if (researchError) return json(res, 500, { error: "Falha ao guardar a pesquisa externa.", detail: researchError.message });
  }

  const model = text(body.model).slice(0, 120) || "unspecified";
  const storedAnalysis = { ...analysis, selections: validatedSelections, agent: agent.name, model, submittedAt: new Date().toISOString() };
  const { data, error } = await db.from("match_analyses").insert({
    match_id: matchId, provider: agent.name, model, status: "ready",
    summary: text(analysis.verdict || analysis.summary).slice(0, 4000) || null,
    analysis: storedAnalysis, generated_at: new Date().toISOString()
  }).select("id,match_id,provider,model,status,generated_at").single();
  if (error) return json(res, 500, { error: "Falha ao guardar a análise.", detail: error.message });
  await audit(db, agent, "submit-analysis", "match_analysis", data.id, {
    matchId, selections: validatedSelections.length, researchSaved: Boolean(researchRecord)
  });
  return json(res, 201, { ok: true, analysis: data, researchSaved: Boolean(researchRecord) });
}

function createInternalResponse() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

async function validatePublishPool(db, pool) {
  const fixtureIds = [...new Set(pool.map(item => text(item?.fixtureId)).filter(Boolean))];
  if (!fixtureIds.length || fixtureIds.length !== new Set(pool.map(item => text(item?.fixtureId))).size) {
    throw new Error("O pool contém jogos sem fixtureId válido.");
  }
  const { data: matches, error } = await db.from("matches")
    .select("external_id,home_team,away_team,competition,kickoff_at,source")
    .eq("source", "swarm").in("external_id", fixtureIds);
  if (error) throw new Error("Não foi possível validar os jogos do boletim: " + error.message);
  const matchByExternalId = new Map((matches || []).map(match => [String(match.external_id), match]));
  const missing = fixtureIds.filter(id => !matchByExternalId.has(id));
  if (missing.length) throw new Error("O pool contém jogos que não pertencem à recolha Swarm: " + missing.join(", "));

  const comparisonByFixture = new Map();
  await Promise.all(fixtureIds.map(async fixtureId => {
    const match = matchByExternalId.get(fixtureId);
    if (!match.kickoff_at || Date.parse(match.kickoff_at) <= Date.now() ||
        luandaDate(match.kickoff_at) !== luandaDate(new Date())) {
      throw new Error("O jogo " + fixtureId + " já começou ou não pertence ao dia actual de Luanda.");
    }
    const { data: comparison, error: comparisonError } = await db.from("odds_comparisons")
      .select("comparison,created_at").eq("match_id", (await db.from("matches")
        .select("id").eq("source", "swarm").eq("external_id", fixtureId).single()).data?.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (comparisonError || !comparison ||
        Date.now() - Date.parse(comparison.created_at) > 60 * 60 * 1000) {
      throw new Error("A comparação de odds do jogo " + fixtureId + " está ausente ou desactualizada.");
    }
    comparisonByFixture.set(fixtureId, comparison.comparison);
  }));

  return pool.map(item => {
    const fixtureId = text(item.fixtureId);
    const match = matchByExternalId.get(fixtureId);
    const storedMarkets = (comparisonByFixture.get(fixtureId)?.events || []).flatMap(event => event.comparisons || []);
    const stored = storedMarkets.find(candidate =>
      text(candidate.market).toLocaleLowerCase() === text(item.market).toLocaleLowerCase() &&
      text(candidate.selection).toLocaleLowerCase() === text(item.selection).toLocaleLowerCase() &&
      String(candidate.line ?? "") === String(item.line ?? "")
    );
    const quotes = stored?.quotes || [];
    const bantu = quotes.find(q => q.bookmaker === "BantuBet" && Number(q.odds) >= 1.4);
    const elephant = quotes.find(q => q.bookmaker === "ElephantBet" && Number(q.odds) >= 1.4);
    if (!bantu || !elephant) {
      throw new Error("A selecção " + text(item.market) + " — " + text(item.selection) +
        " não tem odds válidas e correspondentes nas duas casas.");
    }
    const fairProbability = Number(item.fairProbability ?? item.fair_prob);
    if (!Number.isFinite(fairProbability) || fairProbability <= 0 || fairProbability >= 1 ||
        text(item.rationale).length < 12) {
      throw new Error("Cada selecção publicada precisa de probabilidade válida e fundamentação.");
    }
    return {
      ...item,
      fixtureId,
      home: match.home_team,
      away: match.away_team,
      competition: match.competition || item.competition || "Competição não identificada",
      kickoff: match.kickoff_at,
      fairProbability,
      quotes: [bantu, elephant].map(q => ({
        bookmaker: q.bookmaker, odds: Number(q.odds),
        line: q.line ?? null, collectedAt: q.collectedAt || new Date().toISOString()
      }))
    };
  });
}

async function publishTickets(db, req, res, agent) {
  const body = req.body || {};
  const idempotencyKey = text(req.headers["idempotency-key"] || body.idempotencyKey);
  if (idempotencyKey.length < 8 || idempotencyKey.length > 120) {
    return json(res, 400, { error: "Envia Idempotency-Key (8 a 120 caracteres) para evitar publicações duplicadas." });
  }
  if (!Array.isArray(body.pool) || body.pool.length < 1 || body.pool.length > 500) {
    return json(res, 400, { error: "Envia um pool entre 1 e 500 selecções." });
  }
  let validatedPool;
  try { validatedPool = await validatePublishPool(db, body.pool); }
  catch (error) { return json(res, 400, { error: error.message }); }
  const { data: claim, error: claimError } = await db.from("ai_agent_publications").insert({
    agent_key_id: agent.id, idempotency_key: idempotencyKey, status: "processing"
  }).select("id").single();
  if (claimError) {
    return json(res, 409, { error: "Esta chave de idempotência já foi usada. Consulta o estado antes de tentar novamente." });
  }

  const internalReq = {
    method: "POST",
    headers: { authorization: "Bearer " + process.env.CRON_SECRET },
    body: { pool: validatedPool, publishedAt: body.publishedAt },
    query: {}
  };
  const internalRes = createInternalResponse();
  try {
    if (!process.env.CRON_SECRET) throw new Error("Configuração interna de publicação indisponível.");
    await buildTickets(internalReq, internalRes);
    const result = internalRes.body || { error: "O publicador não devolveu resposta." };
    const status = internalRes.statusCode >= 500 ? "failed"
      : result.publicationStatus === "published" ? "published" : "not_published";
    await db.from("ai_agent_publications").update({
      status, response: result, updated_at: new Date().toISOString()
    }).eq("id", claim.id);
    await audit(db, agent, "publish-tickets", "publication", claim.id, {
      status, publishedTickets: Array.isArray(result.publishedTickets) ? result.publishedTickets.length : 0
    });
    return json(res, internalRes.statusCode, { ok: internalRes.statusCode < 400, publicationId: claim.id, ...result });
  } catch (error) {
    await db.from("ai_agent_publications").update({
      status: "failed", response: { error: error.message }, updated_at: new Date().toISOString()
    }).eq("id", claim.id);
    await audit(db, agent, "publish-tickets", "publication", claim.id, { status: "failed", error: error.message });
    return json(res, 500, { ok: false, publicationId: claim.id, error: error.message });
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { error: "Método não permitido." });
  }
  let db;
  try { db = database(); }
  catch (error) { return json(res, 503, { error: error.message }); }

  const body = req.body || {};
  const action = text(req.query?.op || body.action || (req.query?.action === "ai-access" ? "" : req.query?.action));
  if (action === "issue-key" || action === "revoke-key") {
    if (req.method !== "POST") return json(res, 405, { error: "Usa POST." });
    return adminAction(db, req, res, { ...body, action });
  }

  const scopeByAction = {
    fixtures: "read:fixtures",
    "submit-analysis": "write:analysis",
    publish: "publish:tickets",
    status: "read:fixtures"
  };
  const scope = scopeByAction[action];
  if (!scope) return json(res, 404, { error: "Acção desconhecida.", available: Object.keys(scopeByAction) });
  if (action === "fixtures" && req.method !== "GET") return json(res, 405, { error: "Usa GET." });
  if (action !== "fixtures" && req.method !== "POST") return json(res, 405, { error: "Usa POST." });

  const auth = await authenticate(db, req, scope);
  if (auth.error) return json(res, auth.status, { error: auth.error });
  const agent = auth.agent;

  if (action === "fixtures") return readFixtures(db, req, res, agent);
  if (action === "submit-analysis") return submitAnalysis(db, req, res, agent);
  if (action === "publish") return publishTickets(db, req, res, agent);
  if (action === "status") {
    const publicationId = text(body.publicationId);
    const { data, error } = await db.from("ai_agent_publications")
      .select("id,status,response,created_at,updated_at")
      .eq("id", publicationId).eq("agent_key_id", agent.id).maybeSingle();
    if (error) return json(res, 500, { error: "Falha ao consultar publicação." });
    if (!data) return json(res, 404, { error: "Publicação não encontrada para esta IA." });
    return json(res, 200, { ok: true, publication: data });
  }
}
