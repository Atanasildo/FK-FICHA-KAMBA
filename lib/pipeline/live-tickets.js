import { createClient } from "@supabase/supabase-js";
import { evaluateLiveMarket } from "../tickets/live-market.js";

const API_BASE = "https://sportapi.ai/api";
const TZ = "Africa/Luanda";
const LIVE_STATS_MAX_AGE = 15 * 60 * 1000;
const LIVE_STATS_BATCH = 2;

function localDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
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
      .select("id,ticket_legs(id,market_name,selection,matches(id,external_id,source,home_team,away_team,status))")
      .eq("status", "published").order("published_at", { ascending: false }).limit(100);
    if (ticketsError) throw ticketsError;

    const legs = (tickets || []).flatMap(ticket => (ticket.ticket_legs || []).map(leg => ({ ...leg, ticketId: ticket.id })));
    const sportLegs = legs.filter(leg => leg.matches?.source === "SportAPI" && /^\d+$/.test(String(leg.matches.external_id || "")));
    if (!sportLegs.length) {
      res.setHeader("Cache-Control", "public, s-maxage=180, stale-while-revalidate=60");
      return res.status(200).json({ ok: true, timezone: TZ, updatedAt: new Date().toISOString(), legs: {} });
    }

    const fixturesPayload = await getJson(`/fixtures/date/${localDate()}`, apiKey);
    const fixtureById = new Map((fixturesPayload.data || []).map(fixture => [String(fixture.id), fixture]));
    const matchIds = [...new Set(sportLegs.map(leg => leg.matches.id))];

    const { data: savedStats, error: statsError } = await admin.from("match_statistics")
      .select("match_id,payload,collected_at").eq("source", "SportAPI-live")
      .in("match_id", matchIds).order("collected_at", { ascending: false }).limit(500);
    if (statsError) throw statsError;
    const statsByMatch = new Map();
    for (const row of savedStats || []) if (!statsByMatch.has(row.match_id)) statsByMatch.set(row.match_id, row);

    const cardMatchIds = [...new Set(sportLegs.filter(leg =>
      /cart[oõ]es?\s+amarelos?|yellow.?cards?/i.test(leg.market_name || "")
    ).map(leg => leg.matches.id))];
    const rotationCount = Math.max(1, Math.ceil(statMatchIds.length / LIVE_STATS_BATCH));
    const rotation = Math.floor(Date.now() / LIVE_STATS_MAX_AGE) % rotationCount;
    const selectedStatsIds = statMatchIds.slice(rotation * LIVE_STATS_BATCH, (rotation + 1) * LIVE_STATS_BATCH);
    const eventRotationCount = Math.max(1, Math.ceil(activeMatchIds.length / LIVE_STATS_BATCH));
    const eventRotation = Math.floor(Date.now() / LIVE_STATS_MAX_AGE) % eventRotationCount;
    const selectedEventIds = activeMatchIds.slice(eventRotation * LIVE_STATS_BATCH, (eventRotation + 1) * LIVE_STATS_BATCH);
    const { data: savedEvents, error: eventsError } = await admin.from("match_statistics")
      .select("match_id,payload,collected_at").eq("source", "SportAPI-live-events")
      .in("match_id", matchIds).order("collected_at", { ascending: false }).limit(500);
    if (eventsError) throw eventsError;
    const eventsByMatch = new Map();
    for (const row of savedEvents || []) if (!eventsByMatch.has(row.match_id)) eventsByMatch.set(row.match_id, row);

    await Promise.all(selectedEventIds.map(async matchId => {
      const previous = eventsByMatch.get(matchId);
      const collectedAt = Date.parse(previous?.collected_at || "");
      if (Number.isFinite(collectedAt) && Date.now() - collectedAt < LIVE_STATS_MAX_AGE) return;
      const leg = sportLegs.find(item => item.matches.id === matchId);
      const fixtureId = String(leg?.matches?.external_id || "");
      if (!fixtureId) return;
      try {
        const payload = await getJson(`/fixtures/${fixtureId}`, apiKey);
        const fixture = payload.fixture || {};
        const timestamp = new Date().toISOString();
        const { error } = await admin.from("match_statistics").insert({
          match_id: matchId, source: "SportAPI-live-events",
          payload: { events: Array.isArray(fixture.events) ? fixture.events : [] },
          collected_at: timestamp
        });
        if (!error) eventsByMatch.set(matchId, {
          match_id: matchId, payload: { events: Array.isArray(fixture.events) ? fixture.events : [] }, collected_at: timestamp
        });
      } catch {
        // Mantém os dados anteriores se o detalhe/eventos estiver temporariamente indisponível.
      }
    }));

    await Promise.all(selectedStatsIds.map(async matchId => {
      const previous = statsByMatch.get(matchId);
      const collectedAt = Date.parse(previous?.collected_at || "");
      if (Number.isFinite(collectedAt) && Date.now() - collectedAt < LIVE_STATS_MAX_AGE) return;
      const leg = sportLegs.find(item => item.matches.id === matchId);
      const fixtureId = String(leg?.matches?.external_id || "");
      if (!fixtureId) return;
      try {
        const payload = await getJson(`/fixtures/${fixtureId}/stats`, apiKey);
        if (!payload.available || !payload.data) return;
        const timestamp = new Date().toISOString();
        const { error } = await admin.from("match_statistics").insert({
          match_id: matchId, source: "SportAPI-live",
          payload: payload.data, collected_at: timestamp
        });
        if (!error) statsByMatch.set(matchId, { match_id: matchId, payload: payload.data, collected_at: timestamp });
      } catch {
        // A falha estatística não invalida o marcador nem inventa o estado do mercado.
      }
    }));

    const updates = {};
    for (const leg of sportLegs) {
      const match = leg.matches;
      const fixture = fixtureById.get(String(match.external_id));
      if (!fixture) {
        updates[leg.id] = {
          matchStatus: match.status || "SCHEDULED",
          marketStatus: "Dados ao vivo indisponíveis",
          marketUpdate: "A fonte ainda não devolveu actualização para este jogo."
        };
        continue;
      }
      const homeScore = fixture.home_score ?? null;
      const awayScore = fixture.away_score ?? null;
      const stats = {
        ...(statsByMatch.get(match.id)?.payload || {}),
        events: eventsByMatch.get(match.id)?.payload?.events || []
      };
      const market = evaluateLiveMarket({
        market: leg.market_name,
        selection: leg.selection,
        home: match.home_team,
        away: match.away_team,
        homeScore,
        awayScore,
        status: fixture.status,
        stats
      });
      updates[leg.id] = {
        matchStatus: fixture.status || match.status,
        homeScore,
        awayScore,
        minute: fixture.minute ?? null,
        lastEvent: (() => {
          const events = eventsByMatch.get(match.id)?.payload?.events || fixture.events || [];
          if (!events.length) return null;
          const event = events[events.length - 1];
          const labels = {
            goal: "Golo", yellow_card: "Cartão amarelo", red_card: "Cartão vermelho",
            substitution: "Substituição", penalty: "Penálti"
          };
          return [labels[event.event_type] || event.event_type, event.player_name, event.minute]
            .filter(Boolean).join(" · ");
        })(),
        marketStatus: market.marketStatus,
        marketUpdate: market.marketUpdate,
        liveMetric: market.liveMetric,
        liveUpdatedAt: new Date().toISOString()
      };
    }

    res.setHeader("Cache-Control", "public, s-maxage=180, stale-while-revalidate=60");
    return res.status(200).json({
      ok: true,
      timezone: TZ,
      updatedAt: new Date().toISOString(),
      fixturesUpdated: fixtureById.size,
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
