import { createClient } from "@supabase/supabase-js";

const API_BASE = "https://sportapi.ai/api";
const TZ = "Africa/Luanda";
const MAX_CONTEXT_AGE_MS = 12 * 60 * 60 * 1000;

async function getJson(path, key) {
  try {
    const response = await fetch(API_BASE + path, {
      headers: { "X-Api-Key": key, Accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      return { available: false, error: payload.error || payload.message || `HTTP ${response.status}` };
    }
    return { available: true, data: payload };
  } catch (error) {
    return { available: false, error: error.message || "Falha de comunicação." };
  }
}

function recentMatches(result) {
  if (!result.available) return [];
  const rows = Array.isArray(result.data.matches) ? result.data.matches : [];
  return rows
    .filter(match => /^(FT|AET|PENS)$/i.test(String(match.status || "")))
    .sort((a, b) => {
      const dateA = Date.parse(a.kickoff_utc || a.datetime || a.date || "") || 0;
      const dateB = Date.parse(b.kickoff_utc || b.datetime || b.date || "") || 0;
      return dateB - dateA;
    })
    .slice(0, 8)
    .reverse();
}

function flattenStandingRows(value, rows = []) {
  if (!value) return rows;
  if (Array.isArray(value)) { for (const item of value) flattenStandingRows(item, rows); return rows; }
  if (typeof value !== "object") return rows;
  if (value.team || value.team_id || value.team_name || value.teamId) rows.push(value);
  for (const key of ["standings", "groups", "table", "data", "teams", "rows"]) {
    if (value[key]) flattenStandingRows(value[key], rows);
  }
  return rows;
}

function standingTeamId(row) { return Number(row?.team?.id ?? row?.team_id ?? row?.teamId ?? row?.id); }
function standingTeamName(row) { return String(row?.team?.name ?? row?.team_name ?? row?.teamName ?? "").trim().toLowerCase(); }

export default async function collectContext(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  const apiKey = process.env.SPORTAPI_KEY;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!apiKey) return res.status(503).json({ error: "SPORTAPI_KEY não configurada." });
  if (!url || !serviceKey) return res.status(503).json({ error: "Configuração segura do Supabase incompleta." });

  const limit = Math.min(10, Math.max(1, Number(req.body?.limit) || 5));
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    const now = new Date().toISOString();
    const { data: matches, error: listError } = await admin.from("matches")
      .select("id,external_id,home_team,away_team,competition,kickoff_at,status")
      .eq("source", "SportAPI")
      .eq("status", "scheduled")
      .gte("kickoff_at", now)
      .order("kickoff_at", { ascending: true });
    if (listError) throw listError;

    const requestedIds = Array.isArray(req.body?.matchIds)
      ? new Set(req.body.matchIds.map(value => String(value)))
      : null;
    const candidates = (matches || []).filter(match =>
      !requestedIds || requestedIds.has(String(match.id))
    );
    const candidateIds = candidates.map(match => match.id).filter(Boolean);
    let collectedIds = new Set();
    if (candidateIds.length) {
      const { data: collected, error: collectedError } = await admin.from("match_statistics")
        .select("match_id,payload,collected_at")
        .eq("source", "SportAPI")
        .in("match_id", candidateIds);
      if (collectedError) throw collectedError;
      collectedIds = new Set((collected || [])
        .filter(row => {
          const collectedAt = Date.parse(row.collected_at || row.payload?.collectedAt || "");
          return row.payload?.matchStats && typeof row.payload.matchStats === "object" &&
            Object.keys(row.payload.matchStats).length > 0 &&
            Number.isFinite(collectedAt) && Date.now() - collectedAt <= MAX_CONTEXT_AGE_MS;
        })
        .map(row => row.match_id));
    }
    const pendingMatches = candidates.filter(match => !collectedIds.has(match.id)).slice(0, limit);

    const results = [];
    for (const match of pendingMatches) {
      const fixtureResult = await getJson(`/fixtures/${encodeURIComponent(match.external_id)}`, apiKey);
      if (!fixtureResult.available || !fixtureResult.data.fixture) {
        results.push({ fixtureId: match.external_id, saved: false, error: fixtureResult.error || "Detalhes do jogo indisponíveis." });
        continue;
      }

      const fixture = fixtureResult.data.fixture;
      const homeId = Number(fixture.home_id);
      const awayId = Number(fixture.away_id);
      const leagueId = fixture.league_id;
      const requests = await Promise.all([
        getJson(`/fixtures/${encodeURIComponent(match.external_id)}/stats`, apiKey),
        homeId && awayId ? getJson(`/fixtures/h2h/${homeId}/${awayId}`, apiKey) : Promise.resolve({ available: false, error: "IDs das equipas indisponíveis." }),
        leagueId ? getJson(`/standings/${encodeURIComponent(String(leagueId))}`, apiKey) : Promise.resolve({ available: false, error: "ID da competição indisponível." }),
        homeId ? getJson(`/teams/${homeId}`, apiKey) : Promise.resolve({ available: false, error: "ID da equipa da casa indisponível." }),
        awayId ? getJson(`/teams/${awayId}`, apiKey) : Promise.resolve({ available: false, error: "ID da equipa visitante indisponível." })
      ]);
      const [matchStats, h2h, standings, homeTeam, awayTeam] = requests;
      const events = { available: Array.isArray(fixture.events), data: { data: fixture.events || [] } };
      const lineups = { available: false, data: null };
      const standingsData = standings.available ? standings.data : null;
      const table = standingsData ? flattenStandingRows([standingsData.standings, standingsData.groups, standingsData.data]) : [];
      const findStanding = (teamId, teamName) => table.find(row =>
        (teamId && standingTeamId(row) === teamId) ||
        (teamName && standingTeamName(row) === String(teamName).trim().toLowerCase())
      ) || null;
      const homeStanding = findStanding(homeId, fixture.home_team || match.home_team);
      const awayStanding = findStanding(awayId, fixture.away_team || match.away_team);
      const hasTable = table.length > 0;
      const cupWithoutGroups = String(standingsData?.format || "").toLowerCase() === "cup" && !hasTable;
      const standingsStatus = !standings.available ? "unavailable"
        : homeStanding || awayStanding ? "available"
        : cupWithoutGroups ? "not_applicable"
        : hasTable ? "team_not_found"
        : "empty";
      const teamData = result => {
        if (!result.available) return null;
        const team = result.data.team || result.data;
        return {
          id: team.id || null,
          name: team.name || team.full_name || null,
          recentResults: recentMatches(result)
        };
      };

      const payload = {
        source: "SportAPI",
        collectedAt: new Date().toISOString(),
        timezone: TZ,
        fixture: {
          id: String(fixture.id || match.external_id),
          home: fixture.home_team || match.home_team,
          away: fixture.away_team || match.away_team,
          competition: fixture.league_name || match.competition,
          kickoffUtc: fixture.kickoff_utc || match.kickoff_at,
          status: fixture.status || match.status
        },
        matchStats: matchStats.available ? (matchStats.data.data || null) : null,
        standings: standings.available ? {
          status: standingsStatus,
          format: standingsData.format || null,
          league: standingsData.league || standingsData.data?.league || null,
          season: standingsData.season || standingsData.data?.season || null,
          home: homeStanding ? { ...homeStanding, form: Array.isArray(homeStanding.form) ? homeStanding.form.slice(-6) : [] } : null,
          away: awayStanding ? { ...awayStanding, form: Array.isArray(awayStanding.form) ? awayStanding.form.slice(-6) : [] } : null
        } : { status: "unavailable", home: null, away: null },
        headToHead: h2h.available && Array.isArray(h2h.data.data) ? h2h.data.data.slice(0, 10) : null,
        homeTeam: teamData(homeTeam),
        awayTeam: teamData(awayTeam),
        events: events.available && Array.isArray(events.data.data) ? events.data.data.slice(0, 40) : null,
        lineups: null,
        absences: {
          available: false,
          reason: "Lesões e suspensões não são inferidas; só serão registadas quando existir uma fonte confirmada."
        },
        availability: {
          matchStats: matchStats.available,
          events: events.available,
          lineups: false,
          headToHead: h2h.available,
          standings: standings.available,
          homeTeam: homeTeam.available,
          awayTeam: awayTeam.available
        },
        sourceErrors: requests.map((item, index) => item.available ? null : ({
          source: ["matchStats", "headToHead", "standings", "homeTeam", "awayTeam"][index],
          error: item.error || "Dados indisponíveis."
        })).filter(Boolean)
      };

      const { data: existing, error: lookupError } = await admin.from("match_statistics")
        .select("id")
        .eq("match_id", match.id)
        .eq("source", "SportAPI")
        .order("collected_at", { ascending: false })
        .limit(1);
      if (lookupError) {
        results.push({ fixtureId: match.external_id, saved: false, error: lookupError.message });
        continue;
      }

      const record = {
        match_id: match.id,
        source: "SportAPI",
        payload,
        collected_at: payload.collectedAt
      };
      const write = existing?.length
        ? await admin.from("match_statistics").update(record).eq("id", existing[0].id)
        : await admin.from("match_statistics").insert(record);
      if (write.error) {
        results.push({ fixtureId: match.external_id, saved: false, error: write.error.message });
        continue;
      }

      const availableSections = Object.values(payload.availability).filter(Boolean).length;
      results.push({
        fixtureId: match.external_id,
        home: payload.fixture.home,
        away: payload.fixture.away,
        saved: true,
        availableSections,
        totalSections: 7,
        sourceErrors: payload.sourceErrors
      });
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      source: "SportAPI",
      timezone: TZ,
      requested: limit,
      processed: results.length,
      saved: results.filter(item => item.saved).length,
      failed: results.filter(item => !item.saved).length,
      results,
      note: "Apenas contexto desportivo foi recolhido e guardado. Não foram consultadas odds, executada a Groq, criados boletins ou efectuadas reservas."
    });
  } catch (error) {
    return res.status(500).json({ error: "Falha na recolha de contexto desportivo.", detail: error.message });
  }
}
