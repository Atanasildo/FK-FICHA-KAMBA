import { createClient } from "@supabase/supabase-js";
import { evaluateLiveMarket } from "../tickets/live-market.js";
import { fetchSportmonksFixtures } from "./sportmonks.js";
import { fetchHighlightlyFixtures, fetchHighlightlyDetails } from "./highlightly.js";
import { getAllLiveGames } from "../bookmakers/live-stats.js";

const API_BASE = "https://sportapi.ai/api";
const API_TZ = "Europe/Berlin";
const DISPLAY_TZ = "Africa/Luanda";
const LIVE_STATS_MAX_AGE = 15 * 60 * 1000;
const LIVE_STATS_BATCH = 2;
const ACTIVE_STATUSES = /^(live|in_play|paused|1h|2h|ht|half_time|first_half|second_half|1st_half|2nd_half|extra_time|et|ft|finished|full_time|aet|after_extra_time|pens|penalty_shootout)$/i;
const FINISHED_STATUSES = /^(ft|finished|full_time|aet|after_extra_time|pens|penalty_shootout)$/i;
const STAT_MARKET_PATTERN = /cart[oõ]es?\s+amarelos?|yellow.?cards?|remates?|shots|faltas|fouls|desarmes|tackles|defesas|saves|passes|precis[aã]o.*passe|pass.?accuracy|tackle.?success|taxa.*desarme/i;
const EVENT_MARKET_PATTERN = /cart[oõ]es?\s+vermelhos?|red.?cards?/i;

function dateInZone(value, timeZone = API_TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
export function normalizeTeam(value) {
  const normalized = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(fc|cf|sc|ac|afc|club|football|futebol)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  const aliases = {
    "polonia": "poland", "suecia": "sweden", "pais de gales": "wales",
    "bosnia e herzegovina": "bosnia and herzegovina", "republica da irlanda": "republic of ireland",
    "ucrania": "ukraine", "dinamarca": "denmark", "noruega": "norway",
    "espanha": "spain", "alemanha": "germany", "franca": "france",
    "inglaterra": "england", "italia": "italy", "holanda": "netherlands",
    "turquia": "turkey", "grecia": "greece", "suica": "switzerland"
  };
  return aliases[normalized] || normalized;
}
export function matchFixture(match, fixtures, claimed = new Set()) {
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
    headers: { "X-Api-Key": key, Accept: "application/json" },
    signal: AbortSignal.timeout(9000)
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
  const sportmonksToken = process.env.SPORTMONKS_API_TOKEN;
  const highlightlyKey = process.env.HIGHLIGHTLY_API_KEY;
  if (!url || !serviceKey) {
    return res.status(503).json({ error: "Acompanhamento ao vivo ainda não configurado no servidor." });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const { data: tickets, error: ticketsError } = await admin.from("tickets")
      .select("id,ticket_legs(id,match_id,market_id,market_name,selection,matches(id,external_id,source,home_team,away_team,kickoff_at,status))")
      .eq("status", "published").order("published_at", { ascending: false }).limit(100);
    if (ticketsError) throw ticketsError;

    const legs = (tickets || []).flatMap(ticket =>
      (ticket.ticket_legs || []).map(leg => ({ ...leg, ticketId: ticket.id }))
    );
    const matchIds = [...new Set(legs.map(leg => leg.match_id).filter(Boolean))];
    const marketIds = [...new Set(legs.map(leg => leg.market_id).filter(Boolean))];
    const { data: marketRows, error: marketError } = marketIds.length
      ? await admin.from("markets").select("id,line").in("id", marketIds)
      : { data: [], error: null };
    if (marketError) throw marketError;
    const marketLineById = new Map((marketRows || []).map(row => [row.id, row.line]));

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
    const providerErrors = [];
    const fixturePayloads = await Promise.all(fixtureDates.map(async date => {
      const result = { highlightly: [], sportmonks: [], sportapi: [] };
      if (highlightlyKey) {
        try { result.highlightly = await fetchHighlightlyFixtures(date, highlightlyKey); }
        catch (error) { providerErrors.push(`Highlightly: ${error.message}`); }
      }
      if (sportmonksToken) {
        try { result.sportmonks = await fetchSportmonksFixtures(date, sportmonksToken); }
        catch (error) { providerErrors.push(`Sportmonks: ${error.message}`); }
      }
      if (apiKey) {
        try {
          const payload = await getJson(`/fixtures/date/${date}`, apiKey);
          result.sportapi = Array.isArray(payload.data) ? payload.data : [];
        } catch (error) { providerErrors.push(`SportAPI: ${error.message}`); }
      }
      return result;
    }));
    // Resolve providers separately so duplicate copies do not create false ambiguity.
    // Highlightly is primary, Sportmonks secondary and SportAPI tertiary fallback.
    const highlightlyFixtures = fixturePayloads.flatMap(payload => payload.highlightly);
    const sportmonksFixtures = fixturePayloads.flatMap(payload => payload.sportmonks);
    const sportapiFixtures = fixturePayloads.flatMap(payload => payload.sportapi);
    const allFixtures = [...highlightlyFixtures, ...sportmonksFixtures, ...sportapiFixtures];
    const claimedHighlightlyIds = new Set(), claimedSportmonksIds = new Set(), claimedSportApiIds = new Set(), fixtureByMatchId = new Map();
    for (const match of candidateMatches) {
      let fixture = matchFixture(match, highlightlyFixtures, claimedHighlightlyIds);
      if (fixture) claimedHighlightlyIds.add(String(fixture.id));
      if (!fixture) {
        fixture = matchFixture(match, sportmonksFixtures, claimedSportmonksIds);
        if (fixture) claimedSportmonksIds.add(String(fixture.id));
      }
      if (!fixture) {
        fixture = matchFixture(match, sportapiFixtures, claimedSportApiIds);
        if (fixture) claimedSportApiIds.add(String(fixture.id));
      }
      if (fixture) fixtureByMatchId.set(match.id, fixture);
    }
    // Fallback das próprias casas: só consulta o Swarm para jogos das fichas
    // que as APIs desportivas não conseguiram associar. Cada chamada é curta,
    // fecha o WebSocket após a resposta e não depende de sockets persistentes.
    // Consultar também quando uma API já associou o jogo: Swarm pode ter
    // o estado/minuto mais recente que o fornecedor estatístico externo.
    const swarmMatchIds = new Set();
    let swarmFeeds = { elephant: { games: [] }, bantu: { games: [] } };
    if (candidateMatches.length) {
      try {
        swarmFeeds = await getAllLiveGames({ timeoutMs: 7000 });
      } catch (error) {
        providerErrors.push(`Swarm: ${error.message}`);
      }
      for (const [bookmaker, feed] of Object.entries(swarmFeeds)) {
        if (feed?.error) {
          providerErrors.push(`Swarm ${bookmaker}: ${feed.error}`);
          continue;
        }
        const games = Array.isArray(feed?.games) ? feed.games : [];
        const claimed = new Set();
        for (const match of candidateMatches) {
          const game = matchFixture(match, games, claimed);
          if (!game) continue;
          claimed.add(String(game.id));
          const existingFixture = fixtureByMatchId.get(match.id);
          // Só substituir a API quando Swarm confirma que o jogo está live;
          // para jogos futuros/sem estado live, conservar o fornecedor primário.
          if (existingFixture && !game.is_live) continue;
          const fixture = {
            ...game,
            provider: `swarm-${bookmaker}`,
            status: game.is_live ? "live" : game.status || "scheduled",
            home_team: game.home_team || game.home,
            away_team: game.away_team || game.away,
            kickoff_at: game.kickoff_at || game.date,
            home_score: game.home_score,
            away_score: game.away_score,
            minute: game.minute,
            statistics: game.statistics,
            events: game.events || [],
            updated_at: game.updated_at || new Date().toISOString()
          };
          fixtureByMatchId.set(match.id, fixture);
          swarmMatchIds.add(match.id);
        }
      }
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
        marketUpdate: "Nenhuma das fontes de resultados associou este jogo com segurança. O FK não inventa marcador nem liquida a selecção sem resultado confirmado."
      };
    }
    if (!sportLegs.length) {
      res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=30");
      return res.status(200).json({ ok: true, timezone: DISPLAY_TZ, updatedAt: new Date().toISOString(),
        fixturesUpdated: allFixtures.length + swarmMatchIds.size, matchedMatches: 0,
        providers: { highlightly: Boolean(highlightlyKey), sportmonksFallback: Boolean(sportmonksToken), sportapiFallback: Boolean(apiKey), swarmFallback: true, swarmMatchedMatches: swarmMatchIds.size, warnings: providerErrors.slice(0, 5) },
        legs: { ...analysisUpdates, ...unmatchedUpdates } });
    }
    const sportMatchIds = [...new Set(sportLegs.map(leg => leg.matches.id))];

    const [statsResult, eventsResult] = await Promise.all([
      admin.from("match_statistics").select("match_id,payload,collected_at")
        .in("source", ["Highlightly-live", "SportAPI-live", "Sportmonks-live", "Swarm-live"]).in("match_id", sportMatchIds)
        .order("collected_at", { ascending: false }).limit(500),
      admin.from("match_statistics").select("match_id,payload,collected_at")
        .in("source", ["Highlightly-live-events", "SportAPI-live-events", "Sportmonks-live-events", "Swarm-live-events"]).in("match_id", sportMatchIds)
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
      return fixture && ACTIVE_STATUSES.test(String(fixture.status || ""));
    }).map(leg => leg.matches.id))];

    const selectedEventIds = rotationSlice(activeMatchIds);
    const selectedStatsIds = rotationSlice(statMatchIds);

    // Highlightly actualiza eventos a cada minuto e estatísticas a cada cinco minutos.
    for (const matchId of activeMatchIds.concat(sportMatchIds.filter(id => FINISHED_STATUSES.test(String(fixtureByMatchId.get(id)?.status || "")))).slice(0, 2)) {
      const leg = sportLegs.find(item => item.matches.id === matchId);
      const fixture = fixtureByMatchId.get(matchId);
      if (!leg || fixture?.provider !== "highlightly") continue;
      const finished = FINISHED_STATUSES.test(String(fixture.status || ""));
      const previousStats = statsByMatch.get(matchId);
      const previousEvents = eventsByMatch.get(matchId);
      const statsAge = Date.now() - Date.parse(previousStats?.collected_at || "");
      const eventsAge = Date.now() - Date.parse(previousEvents?.collected_at || "");
      const needsStats = !Number.isFinite(statsAge) || statsAge >= 5 * 60_000 || (finished && !isAfterFinal(previousStats, fixture));
      const needsEvents = !Number.isFinite(eventsAge) || eventsAge >= 60_000 || (finished && !isAfterFinal(previousEvents, fixture));
      if (!needsStats && !needsEvents) continue;
      try {
        const detail = await fetchHighlightlyDetails(fixture.id, highlightlyKey, fixture);
        const timestamp = new Date().toISOString();
        if (needsStats && (Object.keys(detail.statistics.home || {}).length || Object.keys(detail.statistics.away || {}).length)) {
          const row = { match_id: matchId, source: "Highlightly-live", payload: detail.statistics, collected_at: timestamp };
          const { error } = await admin.from("match_statistics").insert(row);
          if (!error) statsByMatch.set(matchId, row);
        }
        if (needsEvents) {
          const row = { match_id: matchId, source: "Highlightly-live-events", payload: { events: detail.events, fixtureUpdatedAt: fixture.updated_at || null }, collected_at: timestamp };
          const { error } = await admin.from("match_statistics").insert(row);
          if (!error) eventsByMatch.set(matchId, row);
        }
      } catch (error) {
        providerErrors.push(`Highlightly detail: ${error.message}`);
      }
    }

    // Sportmonks já devolve eventos e estatísticas no fixture enriquecido.
    // Guardamos snapshots no máximo uma vez por minuto, e sempre que chega o estado final.
    for (const matchId of activeMatchIds.concat(sportMatchIds.filter(id => FINISHED_STATUSES.test(String(fixtureByMatchId.get(id)?.status || ""))))) {
      const leg = sportLegs.find(item => item.matches.id === matchId);
      const fixture = fixtureByMatchId.get(matchId);
      if (!leg || fixture?.provider !== "sportmonks") continue;
      const finished = FINISHED_STATUSES.test(String(fixture.status || ""));
      const timestamp = new Date().toISOString();
      const previousStats = statsByMatch.get(matchId);
      const previousEvents = eventsByMatch.get(matchId);
      const statsAge = Date.now() - Date.parse(previousStats?.collected_at || "");
      const eventsAge = Date.now() - Date.parse(previousEvents?.collected_at || "");
      const hasStats = Object.keys(fixture.statistics?.home || {}).length || Object.keys(fixture.statistics?.away || {}).length;
      if (hasStats && (finished ? !isAfterFinal(previousStats, fixture) : !Number.isFinite(statsAge) || statsAge >= 60_000)) {
        const row = { match_id: matchId, source: "Sportmonks-live", payload: fixture.statistics, collected_at: timestamp };
        const { error } = await admin.from("match_statistics").insert(row);
        if (!error) statsByMatch.set(matchId, row);
      }
      if (Array.isArray(fixture.events) && (finished ? !isAfterFinal(previousEvents, fixture) : !Number.isFinite(eventsAge) || eventsAge >= 60_000)) {
        const row = { match_id: matchId, source: "Sportmonks-live-events", payload: { events: fixture.events, fixtureUpdatedAt: fixture.updated_at || null }, collected_at: timestamp };
        const { error } = await admin.from("match_statistics").insert(row);
        if (!error) eventsByMatch.set(matchId, row);
      }
    }

    await Promise.all(selectedEventIds.map(async matchId => {
      const previous = eventsByMatch.get(matchId);
      const collectedAt = Date.parse(previous?.collected_at || "");
      const leg = sportLegs.find(item => item.matches.id === matchId);
      const fixture = fixtureByMatchId.get(leg?.matches?.id);
      if (Number.isFinite(collectedAt) && Date.now() - collectedAt < LIVE_STATS_MAX_AGE) return;

      if (fixture?.provider === "sportmonks" || fixture?.provider === "highlightly") return;
      const fixtureId = String(fixture?.id || "");
      if (!fixtureId || !apiKey) return;
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

      if (fixture?.provider === "sportmonks") return;
      const fixtureId = String(fixture?.id || "");
      if (!fixtureId || !apiKey) return;
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

    // Persiste snapshots Swarm sem criar duplicados a cada refresh.
    // As estatísticas só alimentam mercados quando a resposta inclui valores
    // casa/visitante; os campos desconhecidos continuam disponíveis em raw.
    for (const matchId of swarmMatchIds) {
      const fixture = fixtureByMatchId.get(matchId);
      if (!fixture) continue;
      const timestamp = new Date().toISOString();
      const previousStats = statsByMatch.get(matchId);
      const previousEvents = eventsByMatch.get(matchId);
      const statsAge = Date.now() - Date.parse(previousStats?.collected_at || "");
      const eventsAge = Date.now() - Date.parse(previousEvents?.collected_at || "");
      const hasStats = fixture.statistics &&
        (Object.keys(fixture.statistics.home || {}).length || Object.keys(fixture.statistics.away || {}).length);
      if (hasStats && (!Number.isFinite(statsAge) || statsAge >= 60_000)) {
        const row = { match_id: matchId, source: "Swarm-live", payload: fixture.statistics, collected_at: timestamp };
        const { error } = await admin.from("match_statistics").insert(row);
        if (!error) statsByMatch.set(matchId, row);
        else providerErrors.push(`Swarm stats: ${error.message}`);
      }
      if ((Array.isArray(fixture.events) && fixture.events.length || fixture.last_event) &&
          (!Number.isFinite(eventsAge) || eventsAge >= 60_000)) {
        const row = {
          match_id: matchId,
          source: "Swarm-live-events",
          payload: { events: fixture.events || [], lastEvent: fixture.last_event || null },
          collected_at: timestamp
        };
        const { error } = await admin.from("match_statistics").insert(row);
        if (!error) eventsByMatch.set(matchId, row);
        else providerErrors.push(`Swarm events: ${error.message}`);
      }
    }

    const updates = { ...analysisUpdates, ...unmatchedUpdates };
    for (const leg of sportLegs) {
      const match = leg.matches;
      const fixture = fixtureByMatchId.get(match.id);
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
        line: marketLineById.get(leg.market_id) ?? null,
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
        liveStats: {
          home: stats?.home || null,
          away: stats?.away || null
        },
        liveUpdatedAt: new Date().toISOString()
      };
    }

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    return res.status(200).json({
      ok: true,
      timezone: DISPLAY_TZ,
      updatedAt: new Date().toISOString(),
      fixturesUpdated: allFixtures.length + swarmMatchIds.size,
      matchedMatches: fixtureByMatchId.size,
      providers: { highlightly: Boolean(highlightlyKey), sportmonksFallback: Boolean(sportmonksToken), sportapiFallback: Boolean(apiKey), swarmFallback: true, swarmMatchedMatches: swarmMatchIds.size, warnings: providerErrors.slice(0, 5) },
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
