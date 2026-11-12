import discoverFixtures from "../lib/pipeline/discover-fixtures.js";
import collectContext from "../lib/pipeline/collect-context.js";
import { createClient } from "@supabase/supabase-js";

async function validateMatches(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return res.status(503).json({ error: "Configuração segura do Supabase incompleta." });

  try {
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: matches, error } = await admin.from("matches")
      .select("id,external_id,home_team,away_team,competition,kickoff_at,status")
      .eq("source", "SportAPI");
    if (error) throw error;
    const rows = matches || [];
    const ids = rows.map(row => row.id);
    const externalIds = rows.map(row => row.external_id).filter(Boolean);
    const duplicates = externalIds.length - new Set(externalIds).size;
    const complete = rows.filter(row => row.external_id && row.home_team && row.away_team && row.kickoff_at && row.competition).length;
    let statisticsCount = 0;
    let analysesCount = 0;
    if (ids.length) {
      const [stats, analyses] = await Promise.all([
        admin.from("match_statistics").select("id", { count: "exact", head: true }).in("match_id", ids),
        admin.from("match_analyses").select("id", { count: "exact", head: true }).in("match_id", ids)
      ]);
      if (stats.error) throw stats.error;
      if (analyses.error) throw analyses.error;
      statisticsCount = stats.count || 0;
      analysesCount = analyses.count || 0;
    }
    return res.status(200).json({
      ok: true,
      matchesCount: rows.length,
      completeMatches: complete,
      incompleteMatches: rows.length - complete,
      duplicateExternalIds: duplicates,
      statisticsCount,
      analysesCount,
      sample: rows.slice(0, 5).map(({ external_id, home_team, away_team, competition, kickoff_at, status }) =>
        ({ external_id, home_team, away_team, competition, kickoff_at, status }))
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao validar os jogos no Supabase.", detail: error.message });
  }
}


async function auditContext(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return res.status(503).json({ error: "Configuração segura do Supabase incompleta." });

  try {
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: records, error: statsError } = await admin.from("match_statistics")
      .select("match_id,payload,collected_at")
      .eq("source", "SportAPI")
      .order("collected_at", { ascending: true })
      .limit(5);
    if (statsError) throw statsError;
    const rows = records || [];
    const ids = rows.map(row => row.match_id).filter(Boolean);
    const { data: matches, error: matchesError } = ids.length
      ? await admin.from("matches").select("id,external_id,home_team,away_team,competition,kickoff_at").in("id", ids)
      : { data: [], error: null };
    if (matchesError) throw matchesError;
    const byId = new Map((matches || []).map(match => [match.id, match]));
    const hasContent = value => {
      if (value === null || value === undefined || value === "") return false;
      if (typeof value === "number" || typeof value === "boolean") return true;
      if (Array.isArray(value)) return value.some(hasContent);
      if (typeof value === "object") return Object.values(value).some(hasContent);
      return true;
    };
    const countRows = value => Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : 0;
    const audited = rows.map(record => {
      const p = record.payload || {};
      const homeRecent = p.homeTeam?.recentResults || [];
      const awayRecent = p.awayTeam?.recentResults || [];
      const h2h = p.headToHead;
      const events = p.events;
      const lineups = p.lineups;
      const stats = p.matchStats;
      const homeStanding = p.standings?.home;
      const awayStanding = p.standings?.away;
      const sections = {
        matchStats: { present: hasContent(stats), items: countRows(stats) },
        standings: {
          present: hasContent(p.standings),
          homeFound: Boolean(homeStanding),
          awayFound: Boolean(awayStanding),
          homeFormCount: Array.isArray(homeStanding?.form) ? homeStanding.form.length : 0,
          awayFormCount: Array.isArray(awayStanding?.form) ? awayStanding.form.length : 0
        },
        headToHead: { present: hasContent(h2h), count: Array.isArray(h2h) ? h2h.length : 0 },
        homeRecent: { present: hasContent(homeRecent), count: Array.isArray(homeRecent) ? homeRecent.length : 0 },
        awayRecent: { present: hasContent(awayRecent), count: Array.isArray(awayRecent) ? awayRecent.length : 0 },
        events: { present: hasContent(events), count: Array.isArray(events) ? events.length : 0 },
        lineups: { present: hasContent(lineups), count: countRows(lineups) }
      };
      const usefulSections = Object.values(sections).filter(section => section.present).length;
      const match = byId.get(record.match_id) || {};
      return {
        fixtureId: match.external_id || p.fixture?.id || null,
        home: match.home_team || p.fixture?.home || null,
        away: match.away_team || p.fixture?.away || null,
        competition: match.competition || p.fixture?.competition || null,
        collectedAt: record.collected_at,
        transportAvailable: Object.values(p.availability || {}).filter(Boolean).length,
        transportSections: 7,
        usefulSections,
        contentSections: 7,
        sections,
        sourceErrors: Array.isArray(p.sourceErrors) ? p.sourceErrors.length : 0
      };
    });
    return res.status(200).json({
      ok: true,
      audited: audited.length,
      usefulRecords: audited.filter(row => row.usefulSections > 0).length,
      emptyRecords: audited.filter(row => row.usefulSections === 0).length,
      results: audited,
      note: "Auditoria apenas de leitura. Mede conteúdo não vazio nos registos guardados; estatísticas e eventos podem estar naturalmente vazios antes do início dos jogos."
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha ao auditar o contexto guardado.", detail: error.message });
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // Esta ferramenta temporária só pode executar em deployments Preview.
  if (process.env.VERCEL_ENV !== "preview") {
    return res.status(404).json({ error: "Rota disponível apenas no Preview." });
  }

  const action = typeof req.query?.action === "string" ? req.query.action : "";
  if (action === "validate") return validateMatches(req, res);
  if (action === "context-audit") return auditContext(req, res);
  if (action === "context") {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Método não permitido." });
    }
    req.headers.authorization = `Bearer ${process.env.CRON_SECRET || ""}`;
    req.body = { limit: 5, offset: 0 };
    return collectContext(req, res);
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  // O segredo permanece no servidor e nunca é enviado ao navegador.
  req.headers.authorization = `Bearer ${process.env.CRON_SECRET || ""}`;
  req.body = { days: 2 };
  return discoverFixtures(req, res);
}
