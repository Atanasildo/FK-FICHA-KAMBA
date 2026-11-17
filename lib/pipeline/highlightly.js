const BASE_URL = "https://soccer.highlightly.net";

const clean = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function scorePair(value) {
  const match = String(value || "").match(/(\d+)\s*[-–:]\s*(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : [null, null];
}

function normalizeStatus(value) {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("finished after penalties")) return "PENS";
  if (raw.includes("finished after extra time")) return "AET";
  if (raw === "finished" || raw.includes("full time")) return "FT";
  if (raw.includes("penalt")) return "PENS";
  if (raw.includes("postpon")) return "postponed";
  if (raw.includes("cancel")) return "cancelled";
  if (raw.includes("abandon")) return "abandoned";
  if (raw.includes("suspend")) return "suspended";
  if (raw.includes("interrupted")) return "interrupted";
  if (raw.includes("extra time")) return "ET";
  if (raw.includes("half time")) return "HT";
  if (raw.includes("second half")) return "2H";
  if (raw.includes("first half") || raw.includes("in progress")) return "1H";
  if (raw.includes("not started") || raw.includes("to be announced") || raw.includes("unknown")) return "NS";
  return raw || "NS";
}

function unwrap(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.data && typeof payload.data === "object") return [payload.data];
  if (payload && typeof payload === "object") return [payload];
  return [];
}

function normalizeEvent(event) {
  const raw = clean(event?.type || event?.event || event?.name || "");
  let eventType = raw.replace(/\s+/g, "_");
  if (/own_goal|goal/.test(eventType)) eventType = "goal";
  else if (/missed_penalty/.test(eventType)) eventType = "missed_penalty";
  else if (/second_yellow/.test(eventType)) eventType = "second_yellow";
  else if (/red_card/.test(eventType)) eventType = "red_card";
  else if (/yellow_card/.test(eventType)) eventType = "yellow_card";
  else if (/substitution/.test(eventType)) eventType = "substitution";
  else if (/penalty/.test(eventType)) eventType = "penalty";
  return {
    event_type: eventType || "event",
    player_name: event?.player || event?.playerName || null,
    related_player_name: event?.assist || event?.assistingPlayer || event?.substituted || null,
    minute: event?.time ?? event?.minute ?? null,
    team_side: null
  };
}

function normalizeStatistics(payload) {
  const result = { home: {}, away: {} };
  const aliases = [
    [/shots on target/, "shots_on_target"], [/shots off target/, "shots_off_target"],
    [/total shots|shots total|shots/, "shots"], [/yellow cards?/, "yellow_cards"],
    [/red cards?/, "red_cards"], [/total passes|passes/, "total_passes"],
    [/accurate passes/, "accurate_passes"], [/pass accuracy/, "pass_accuracy"],
    [/fouls/, "fouls"], [/tackles/, "tackles"], [/saves/, "saves"], [/corners/, "corners"]
  ];
  for (const item of unwrap(payload)) {
    const name = item?.team?.name || item?.teamName || item?.name || "";
    const side = clean(name) === clean(payload?.homeTeam?.name) ? "home"
      : clean(name) === clean(payload?.awayTeam?.name) ? "away"
      : item?.side === "home" || item?.side === "away" ? item.side : null;
    if (!side) continue;
    for (const stat of item.statistics || item.stats || []) {
      const label = clean(stat.displayName || stat.name || stat.type || "");
      const alias = aliases.find(([pattern]) => pattern.test(label));
      const value = Number(String(stat.value ?? "").replace("%", "").replace(",", "."));
      if (alias && Number.isFinite(value)) result[side][alias[1]] = value;
    }
  }
  for (const side of ["home", "away"]) {
    if (result[side].pass_accuracy == null && result[side].total_passes > 0 && Number.isFinite(result[side].accurate_passes)) {
      result[side].pass_accuracy = result[side].accurate_passes / result[side].total_passes * 100;
    }
  }
  return result;
}

export function normalizeHighlightlyFixture(match) {
  const home = match?.homeTeam?.name || match?.home_team?.name || match?.homeTeamName || "";
  const away = match?.awayTeam?.name || match?.away_team?.name || match?.awayTeamName || "";
  if (!match?.id || !home || !away) return null;
  const state = match?.state || {};
  const [homeScore, awayScore] = scorePair(state?.score?.current || match?.score?.current || "");
  const penalties = scorePair(state?.score?.penalties || "");
  return {
    id: match.id,
    home_team: home,
    away_team: away,
    kickoff_at: match.date || match.startingAt || match.kickoff || null,
    updated_at: match.updatedAt || match.updated_at || null,
    status: normalizeStatus(state.description || match.status),
    home_score: homeScore,
    away_score: awayScore,
    penalties_home_score: penalties[0],
    penalties_away_score: penalties[1],
    minute: Number.isFinite(Number(state.clock)) ? Number(state.clock) : null,
    events: [],
    statistics: { home: {}, away: {} },
    provider: "highlightly"
  };
}

async function request(path, key, fetchImpl) {
  const response = await fetchImpl(BASE_URL + path, {
    headers: { "x-rapidapi-key": key, Accept: "application/json" },
    signal: AbortSignal.timeout(12000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.message || payload?.error || `Highlightly HTTP ${response.status}`;
    throw new Error(message);
  }
  if (payload?.error) throw new Error(String(payload.error));
  return payload;
}

export async function fetchHighlightlyFixtures(date, key, fetchImpl = fetch) {
  if (!key) throw new Error("HIGHLIGHTLY_API_KEY não configurado.");
  const params = new URLSearchParams({ date, timezone: "Africa/Luanda", limit: "100", offset: "0" });
  const payload = await request(`/matches?${params}`, key, fetchImpl);
  const rows = unwrap(payload);
  const fixtures = rows.map(normalizeHighlightlyFixture).filter(Boolean);
  const total = Number(payload?.pagination?.totalCount || fixtures.length);
  if (total > fixtures.length && fixtures.length < 500) {
    for (let offset = fixtures.length; offset < Math.min(total, 500); offset += 100) {
      const page = await request(`/matches?${new URLSearchParams({ date, timezone: "Africa/Luanda", limit: "100", offset: String(offset) })}`, key, fetchImpl);
      fixtures.push(...unwrap(page).map(normalizeHighlightlyFixture).filter(Boolean));
    }
  }
  return fixtures;
}

export async function fetchHighlightlyDetails(matchId, key, fetchImpl = fetch) {
  if (!key) throw new Error("HIGHLIGHTLY_API_KEY não configurado.");
  const [eventsPayload, statsPayload] = await Promise.all([
    request(`/events/${encodeURIComponent(matchId)}`, key, fetchImpl),
    request(`/statistics/${encodeURIComponent(matchId)}`, key, fetchImpl)
  ]);
  return {
    events: unwrap(eventsPayload).map(normalizeEvent),
    statistics: normalizeStatistics(statsPayload)
  };
}
