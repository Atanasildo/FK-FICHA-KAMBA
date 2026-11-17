const BASE_URL = "https://api.sportmonks.com/v3/football";

const clean = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function sideOf(participant, participants) {
  const location = String(participant?.meta?.location || participant?.location || "").toLowerCase();
  if (location === "home" || location === "away") return location;
  const index = participants.indexOf(participant);
  return index === 0 ? "home" : index === 1 ? "away" : null;
}

function scoreFor(fixture, participantId) {
  const scores = Array.isArray(fixture?.scores) ? fixture.scores : [];
  const candidates = scores.filter(item => String(item?.score?.participant ?? item?.participant_id ?? "") === String(participantId));
  const selected = candidates.find(item => /current/i.test(item.description || item.type?.description || "")) ||
    candidates.find(item => /2nd half|full time|ft/i.test(item.description || item.type?.description || "")) ||
    candidates[candidates.length - 1];
  const value = selected?.score?.goals ?? selected?.score?.score ?? selected?.goals;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedStatus(fixture) {
  const raw = String(fixture?.state?.short_name || fixture?.state?.developer_name || fixture?.state?.name || fixture?.status || "NS").toUpperCase();
  if (/FT|FINISHED|FULL.?TIME/.test(raw)) return "FT";
  if (/AET|AFTER.?EXTRA/.test(raw)) return "AET";
  if (/PEN|PENALT/.test(raw)) return "PENS";
  if (/POSTP/.test(raw)) return "postponed";
  if (/CANC|ABAND/.test(raw)) return "cancelled";
  if (/SUSP/.test(raw)) return "suspended";
  if (/HT|HALF.?TIME/.test(raw)) return "HT";
  if (/2H|SECOND.?HALF|INPLAY_2ND/.test(raw)) return "2H";
  if (/1H|FIRST.?HALF|INPLAY_1ST|LIVE|INPLAY/.test(raw)) return "1H";
  if (/ET|EXTRA.?TIME/.test(raw)) return "ET";
  return raw === "NS" || /NOT.?STARTED|SCHEDULED|TIMED/.test(raw) ? "NS" : raw.toLowerCase();
}

function normalizeEvents(fixture, participants) {
  return (Array.isArray(fixture?.events) ? fixture.events : []).map(event => {
    const type = clean(event?.type?.name || event?.type?.developer_name || event?.type?.code || "");
    const player = event?.player_name || event?.player?.name || null;
    const related = event?.related_player_name || event?.relatedPlayer?.name || null;
    const participant = participants.find(item => String(item.id) === String(event?.participant_id));
    let eventType = type.replace(/\s+/g, "_");
    if (/goal|own_goal/.test(eventType)) eventType = "goal";
    else if (/yellow.*red|second_yellow/.test(eventType)) eventType = "second_yellow";
    else if (/red/.test(eventType)) eventType = "red_card";
    else if (/yellow/.test(eventType)) eventType = "yellow_card";
    else if (/substitution/.test(eventType)) eventType = "substitution";
    else if (/penalty/.test(eventType)) eventType = "penalty";
    return {
      event_type: eventType || "event",
      player_name: player,
      related_player_name: related,
      minute: event?.minute ?? event?.extra_minute ?? null,
      result: event?.addition || event?.info || event?.result || null,
      team_side: participant ? sideOf(participant, participants) : null
    };
  });
}

function normalizeStatistics(fixture, participants) {
  const result = { home: {}, away: {} };
  const rows = Array.isArray(fixture?.statistics) ? fixture.statistics : [];
  const aliases = [
    [/shots on target/, "shots_on_target"],
    [/shots off target/, "shots_off_target"],
    [/shots total|total shots|shots/, "shots"],
    [/yellow cards|yellowcard/, "yellow_cards"],
    [/red cards|redcard/, "red_cards"],
    [/total passes|passes/, "total_passes"],
    [/accurate passes|passes accurate/, "accurate_passes"],
    [/pass accuracy/, "pass_accuracy"],
    [/fouls/, "fouls"],
    [/tackles/, "tackles"],
    [/saves/, "saves"],
    [/corners/, "corners"]
  ];
  for (const row of rows) {
    const participant = participants.find(item => String(item.id) === String(row?.participant_id));
    const side = participant ? sideOf(participant, participants) : null;
    if (!side) continue;
    const label = clean(row?.type?.name || row?.type?.developer_name || row?.type?.code || "");
    const value = row?.data?.value ?? row?.value ?? null;
    const number = typeof value === "number" ? value : Number(String(value ?? "").replace("%", "").replace(",", "."));
    if (!Number.isFinite(number)) continue;
    const alias = aliases.find(([pattern]) => pattern.test(label));
    if (alias) result[side][alias[1]] = number;
  }
  for (const side of ["home", "away"]) {
    if (result[side].pass_accuracy == null && Number.isFinite(result[side].accurate_passes) && Number.isFinite(result[side].total_passes) && result[side].total_passes > 0) {
      result[side].pass_accuracy = result[side].accurate_passes / result[side].total_passes * 100;
    }
  }
  return result;
}

export function normalizeSportmonksFixture(fixture) {
  const participants = Array.isArray(fixture?.participants) ? fixture.participants : [];
  const home = participants.find(item => sideOf(item, participants) === "home");
  const away = participants.find(item => sideOf(item, participants) === "away");
  if (!home || !away) return null;
  const periods = Array.isArray(fixture?.periods) ? fixture.periods : [];
  const activePeriod = periods.find(period => period?.ticking) || periods[periods.length - 1];
  const minute = activePeriod?.minutes ?? activePeriod?.minute ?? null;
  return {
    id: fixture.id,
    home_team: home.name || home.short_code || "",
    away_team: away.name || away.short_code || "",
    kickoff_at: fixture.starting_at || fixture.starting_at_timestamp || null,
    updated_at: fixture.updated_at || fixture.last_processed_at || null,
    status: normalizedStatus(fixture),
    home_score: scoreFor(fixture, home.id),
    away_score: scoreFor(fixture, away.id),
    minute: Number.isFinite(Number(minute)) ? Number(minute) : null,
    events: normalizeEvents(fixture, participants),
    statistics: normalizeStatistics(fixture, participants),
    provider: "sportmonks"
  };
}

export async function fetchSportmonksFixtures(date, token, fetchImpl = fetch) {
  if (!token) throw new Error("SPORTMONKS_API_TOKEN não configurado.");
  const url = new URL(`${BASE_URL}/fixtures/date/${encodeURIComponent(date)}`);
  url.searchParams.set("include", "participants;scores;state;events.type;statistics.type;periods");
  const response = await fetchImpl(url, {
    headers: { Authorization: token, Accept: "application/json" },
    signal: AbortSignal.timeout(12000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.errors?.length) {
    const message = payload?.message || payload?.errors?.[0]?.message || `Sportmonks HTTP ${response.status}`;
    throw new Error(message);
  }
  return (Array.isArray(payload?.data) ? payload.data : [])
    .map(normalizeSportmonksFixture).filter(Boolean);
}
