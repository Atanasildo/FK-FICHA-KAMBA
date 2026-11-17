import { createClient } from "@supabase/supabase-js";
import { evaluateLiveMarket } from "../tickets/live-market.js";

const API_BASE = "https://sportapi.ai/api";
const API_TZ = "Europe/Berlin";
const DISPLAY_TZ = "Africa/Luanda";
const LIVE_STATS_MAX_AGE = 15 * 60 * 1000;
const LIVE_STATS_BATCH = 2;
const ACTIVE_STATUSES = /^(live|in_play|paused|1h|2h|ht|half_time|first_half|second_half|ft|finished|full_time|aet|after_extra_time|pens|penalty_shootout)$/i;
const FINISHED_STATUSES = /^(ft|finished|full_time|aet|after_extra_time|pens|penalty_shootout)$/i;
const STAT_MARKET_PATTERN = /cart[oõ]es?\s+amarelos?|yellow.?cards?|remates?|shots|faltas|fouls|desarmes|tackles|defesas|saves|passes|precis[aã]o.*passe|pass.?accuracy|tackle.?success|taxa.*desarme/i;
const EVENT_MARKET_PATTERN = /cart[oõ]es?\s+vermelhos?|red.?cards?/i;

function dateInZone(value, timeZone = API_TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
function normalizeTeam(value) {
  return String(value || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ")
    .replace(/\\b(fc|cf|sc|ac|afc|club|football|futebol|sporting)\\b/g, " ")
    .replace(/\\s+/g, " ").trim();
}
function matchFixture(match, fixtures, claimed = new Set()) {
  const home = normalizeTeam(match.home_team), away = normalizeTeam(match.away_team);
  const kickoff = Date.parse(match.kickoff_at || "");
  if (!home || !away || !Number.isFinite(kickoff)) return null;
  const candidates = (fixtures || []).filter(fixture => {
    if (fixture?.id == null || claimed.has(String(fixture.id))) return false;
    if (normalizeTeam(fixture.home_team) !== home || normalizeTeam(fixture.away_team) !== away) return false;
    const fixtureKickoff = Date.parse(fixture.kickoff_at || fixture.date || "");
    return Number.isFinite(fixtureKickoff) && Math.abs(fixtureKickoff - kickoff) <= 4 * 60 * 60 * 1000;
  }).map(fixture => ({ fixture, delta: Math.abs(Date.parse(fixture.kickoff_at || fixture.date) - kickoff) }))
    .sort((a, b) => a.delta - b.delta);
  if (!candidates.length || (candidates[1] && candidates[1].delta - candidates[0].delta < 20 * 60 * 1000)) return null;
  return candidates[0].fixture;
}

function rotationSlice(ids) {
  const count = Math.max(1, Math.ceil(ids.length / LIVE_STATS_BATCH));
  const index = Math.floor(Date.now() / LIVE_STATS_MAX_AGE) % count;
  return ids.slice(index * LIVE_STATS_BATCH, (index + 1) * LIVE_STATS_BATCH);
}

async function getJson(path, key) {
  const response = await fetch(API_BASE + path, {
    headers: { "X-Api-Key": key, Accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || payload.message || `SportAPI HTTP ${response.status}`);
  }
  return payload;
}

function latestEventLabel(events) {
  if (!Array.isArray(events) || !events.length) return null;
  const event = events[events.length - 1];
  const labels = {
    goal: "Golo", yellow_card: "Cartão amarelo", red_card: "Cartão vermelho",
    substitution: "Substituição", penalty: "Penálti", second_yellow: "Segundo amarelo"
  };
  return [labels[event.event_type] || event.event_type, event.player_name, event.minute]
    .filter(Boolean).join(" · ");
}

function isAfterFinal(row, fixture, maxAge = 5 * 60 * 1000) {
  const collectedAt = Date.parse(row?.collected_at || "");
  if (!Number.isFinite(collectedAt)) return false;
  const fixtureUpdatedAt = Date.parse(fixture?.updated_at || "");
  if (Number.isFinite(fixtureUpdatedAt)) return collectedAt >= fixtureUpdatedAt;
  return Date.now() - collectedAt <= maxAge;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const apiKey = process.env.SPORTAPI_KEY;
  if (!url || !serviceKey || !apiKey) {
    return res.status(503).json({ error: "Acompanhamento ao vivo ainda não configurado no servidor." });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const { data: tickets, error: ticketsError } = await admin.from("tickets")
      .select("id,ticket_legs(id,match_id,market_name,selection,matches(id,external_id,source,home_team,away_team,kickoff_at,status))")
      .eq("status", "published").order("published_at", { ascending: false }).limit(100);
    if (ticketsError) throw ticketsError;

    const legs = (tickets || []).flatMap(ticket =>
      (ticket.ticket_legs || []).map(leg => ({ ...leg, ticketId: ticket.id }))
    );
    const matchIds = [...new Set(legs.map(leg => leg.match_id).filter(Boolean))];

    // A análise guardada é devolvida mesmo antes de os jogos começarem.
    const { data: analysisRows, error: analysisError } = matchIds.length
      ? await admin.from("match_analyses").select("match_id,analysis,summary,generated_at,status")
          .eq("status", "ready").in("match_id", matchIds)
          .order("generated_at", { ascending: false }).limit(5000)
      : { data: [], error: null };
    if (analysisError) throw analysisError;

    const latestAnalysis = new Map();
    for (const row of analysisRows || []) {
      if (!latestAnalysis.has(row.match_id)) latestAnalysis.set(row.match_id, row);
    }

    const analysisUpdates = {};
    const cleanText = value => String(value || "").normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

    for (const leg of legs) {
      const row = latestAnalysis.get(leg.match_id);
      const selections = Array.isArray(row?.analysis?.selections) ? row.analysis.selections : [];
      const marketName = cleanText(leg.market_name);
      const selection = selections.find(item =>
        item.selection === leg.selection &&
        marketName.startsWith(cleanText(item.market)) &&
        (!item.line || marketName.includes(cleanText(item.line)))
      ) || selections.find(item =>
        item.selection === leg.selection && marketName.startsWith(cleanText(item.market))
      );
      if (selection) {
        analysisUpdates[leg.id] = {
          rationale: selection.rationale || null,
          fairProbability: Number.isFinite(Number(selection.fairProbability)) ? Number(selection.fairProbability) : null,
          confidence: selection.confidence || null,
          analysisSummary: row.summary || null
        };
      }
    }

    const now = Date.now();
    // Swarm IDs are not SportAPI IDs. Match by ordered team names and kickoff time.
    const candidateMatches = [...new Map(legs
      .filter(leg => leg.matches?.id && Number.isFinite(Date.parse(leg.matches.kickoff_at || "")) &&
        Date.parse(leg.matches.kickoff_at) >= now - 36 * 60 * 60 * 1000 &&
        Date.parse(leg.matches.kickoff_at) <= now + 24 * 60 * 60 * 1000)
      .map(leg => [leg.matches.id, leg.matches])).values()];
    const fixtureDates = [...new Set([dateInZone(now), ...candidateMatches.map(match => dateInZone(match.kickoff_at))])];
    const fixturePayloads = await Promise.all(fixtureDates.map(date => getJson(`/fixtures/date/${date}`, apiKey)));
    const fixtures = fixturePayloads.flatMap(payload => Array.isArray(payload.data) ? payload.data : []);
    const claimedFixtureIds = new Set(), fixtureByMatchId = new Map();
    for (const match of candidateMatches) {
      const fixture = matchFixture(match, fixtures, claimedFixtureIds);
      if (fixture) { fixtureByMatchId.set(match.id, fixture); claimedFixtureIds.add(String(fixture.id)); }
    }
    const sportLegs = legs.filter(leg => fixtureByMatchId.has(leg.match_id));
    const unmatchedUpdates = {};
    for (const leg of legs) {
      if (fixtureByMatchId.has(leg.match_id)) continue;
      const kickoff = Date.parse(leg.matches?.kickoff_at || "");
      const finishedByStoredStatus = FINISHED_STATUSES.test(String(leg.matches?.status || ""));
      unmatchedUpdates[leg.id] = {
        ...(analysisUpdates[leg.id] || {}),
        matchStatus: leg.matches?.status || "SCHEDULED",
        marketStatus: finishedByStoredStatus ? "Resultado por confirmar" : Number.isFinite(kickoff) && kickoff > now ? "Por iniciar" : "Aguardando fonte de resultados",
        marketUpdate: "A SportAPI ainda não associou este jogo com segurança. O FK não inventa marcador nem liquida a selecção sem resultado confirmado."
      };
    }
    if (!sportLegs.length) {
      res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=60");
      return res.status(200).json({ ok: true, timezone: DISPLAY_TZ, updatedAt: new Date().toISOString(),
        fixturesUpdated: fixtures.length, matchedMatches: 0, legs: { ...analysisUpdates, ...unmatchedUpdates } });
    }
    const sportMatchIds = [...new Set(sportLegs.map(leg => leg.matches.id))];

    const [statsResult, eventsResult] = await Promise.all([
      admin.from("match_statistics").select("match_id,payload,collected_at")
        .eq("source", "SportAPI-live").in("match_id", sportMatchIds)
        .order("collected_at", { ascending: false }).limit(500),
      admin.from("match_statistics").select("match_id,payload,collected_at")
        .eq("source", "SportAPI-live-events").in("match_id", sportMatchIds)
        .order("collected_at", { ascending: false }).limit(500)
    ]);
    if (statsResult.error) throw statsResult.error;
    if (eventsResult.error) throw eventsResult.error;

    const statsByMatch = new Map();
    for (const row of statsResult.data || []) if (!statsByMatch.has(row.match_id)) statsByMatch.set(row.match_id, row);
    const eventsByMatch = new Map();
    for (const row of eventsResult.data || []) if (!eventsByMatch.has(row.match_id)) eventsByMatch.set(row.match_id, row);

    const activeMatchIds = [...new Set(sportLegs.filter(leg => {
      const fixture = fixtureByMatchId.get(leg.matches.id);
      return fixture && ACTIVE_STATUSES.test(String(fixture.status || ""));
    }).map(leg => leg.matches.id))];

    const statMatchIds = [...new Set(sportLegs.filter(leg => {
      const fixture = fixtureByMatchId.get(leg.matches.id);
      return fixture && ACTIVE_STATUSES.test(String(fixture.status || "")) &&
        STAT_MARKET_PATTERN.test(leg.market_name || "");
    }).map(leg => leg.matches.id))];

    const selectedEventIds = rotationSlice(activeMatchIds);
    const selectedStatsIds = rotationSlice(statMatchIds);

    await Promise.all(selectedEventIds.map(async matchId => {
      const previous = eventsByMatch.get(matchId);
      const collectedAt = Date.parse(previous?.collected_at || "");
      const leg = sportLegs.find(item => item.matches.id === matchId);
      const fixture = fixtureByMatchId.get(leg?.matches?.id);
      if (Number.isFinite(collectedAt) && Date.now() - collectedAt < LIVE_STATS_MAX_AGE) return;

      const fixtureId = String(fixture?.id || "");
      if (!fixtureId) return;
      try {
        const detailPayload = await getJson(`/fixtures/${fixtureId}`, apiKey);
        const detail = detailPayload.fixture || {};
        const timestamp = new Date().toISOString();
        const events = Array.isArray(detail.events) ? detail.events : [];
        const row = {
          match_id: matchId, source: "SportAPI-live-events",
          payload: { events, fixtureUpdatedAt: detail.updated_at || fixture?.updated_at || null },
          collected_at: timestamp
        };
        const { error } = await admin.from("match_statistics").insert(row);
        if (!error) eventsByMatch.set(matchId, row);
      } catch {
        // Mantém o último evento confirmado.
      }
    }));

    await Promise.all(selectedStatsIds.map(async matchId => {
      const previous = statsByMatch.get(matchId);
      const collectedAt = Date.parse(previous?.collected_at || "");
      const leg = sportLegs.find(item => item.matches.id === matchId);
      const fixture = fixtureByMatchId.get(leg?.matches?.id);
      if (Number.isFinite(collectedAt) && Date.now() - collectedAt < LIVE_STATS_MAX_AGE) return;

      const fixtureId = String(leg?.matches?.external_id || "");
      if (!fixtureId) return;
      try {
        const payload = await getJson(`/fixtures/${fixtureId}/stats`, apiKey);
        if (!payload.available || !payload.data) return;
        const row = {
          match_id: matchId, source: "SportAPI-live",
          payload: payload.data, collected_at: new Date().toISOString()
        };
        const { error } = await admin.from("match_statistics").insert(row);
        if (!error) statsByMatch.set(matchId, row);
      } catch {
        // Não substitui dados anteriores por uma falha transitória.
      }
    }));

    const updates = { ...analysisUpdates, ...unmatchedUpdates };
    for (const leg of sportLegs) {
      const match = leg.matches;
      const fixture = fixtureById.get(String(match.external_id));
      if (!fixture) {
        const storedStatus = String(match.status || "").toLowerCase();
        const kickoff = Date.parse(match.kickoff_at || "");
        const notStarted = Number.isFinite(kickoff) && kickoff > now;
        const postponed = /postponed|pst|suspended|susp/.test(storedStatus);
        const cancelled = /cancelled|canceled|abandoned|abd/.test(storedStatus);
        updates[leg.id] = {
          ...(analysisUpdates[leg.id] || {}),
          matchStatus: match.status || "SCHEDULED",
          marketStatus: cancelled ? "Jogo cancelado" : postponed ? "Jogo adiado" : notStarted ? "Por iniciar" : "Dados ao vivo indisponíveis",
          marketUpdate: cancelled
            ? "O calendário guardado indica que o jogo foi cancelado."
            : postponed
              ? "O calendário guardado indica que o jogo foi adiado ou suspenso."
              : notStarted
                ? "O jogo ainda não começou; o acompanhamento inicia quando a fonte o indicar em directo."
                : "A fonte ainda não devolveu actualização para este jogo."
        };
        continue;
      }

      const statsRow = statsByMatch.get(match.id);
      const eventsRow = eventsByMatch.get(match.id);
      const stats = {
        ...(statsRow?.payload || {}),
        events: eventsRow?.payload?.events || [],
        eventsAvailable: Boolean(eventsRow)
      };
      const finished = FINISHED_STATUSES.test(String(fixture.status || ""));
      const marketNeedsStats = STAT_MARKET_PATTERN.test(leg.market_name || "");
      const marketNeedsEvents = EVENT_MARKET_PATTERN.test(leg.market_name || "");
      const statsAfterFinal = !finished || isAfterFinal(statsRow, fixture);
      const eventsAfterFinal = !finished || isAfterFinal(eventsRow, fixture);

      const market = evaluateLiveMarket({
        market: leg.market_name,
        selection: leg.selection,
        home: match.home_team,
        away: match.away_team,
        homeScore: fixture.home_score ?? null,
        awayScore: fixture.away_score ?? null,
        status: fixture.status,
        stats
      });

      const finalStatsPending = finished &&
        ((marketNeedsStats && !statsAfterFinal) || (marketNeedsEvents && !eventsAfterFinal));
      const marketStatus = finalStatsPending ? "Aguardando estatística final" : market.marketStatus;
      const marketUpdate = finalStatsPending
        ? "O jogo terminou; o FK aguarda as estatísticas/eventos finais antes de confirmar esta selecção."
        : market.marketUpdate;

      if (finished && !finalStatsPending && market.supported &&
          ["Ganha", "Perdida", "Linha devolvida"].includes(marketStatus)) {
        const { error: settleError } = await admin.from("ticket_legs")
          .update({ result: marketStatus }).eq("id", leg.id);
        if (settleError) {
          // O estado permanece visível; a próxima consulta tenta guardar novamente.
        }
      }

      updates[leg.id] = {
        ...(analysisUpdates[leg.id] || {}),
        matchStatus: fixture.status || match.status,
        homeScore: fixture.home_score ?? null,
        awayScore: fixture.away_score ?? null,
        minute: fixture.minute ?? null,
        lastEvent: latestEventLabel(eventsRow?.payload?.events || fixture.events || []),
        marketStatus,
        marketUpdate,
        liveMetric: market.liveMetric,
        liveUpdatedAt: new Date().toISOString()
      };
    }

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=60");
    return res.status(200).json({
      ok: true,
      timezone: DISPLAY_TZ,
      updatedAt: new Date().toISOString(),
      fixturesUpdated: fixtures.length,\n      matchedMatches: fixtureByMatchId.size,
      legs: updates
    });
  } catch (error) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({
      ok: false,
      error: "Não foi possível actualizar o acompanhamento ao vivo.",
      detail: error.message
    });
  }
}
