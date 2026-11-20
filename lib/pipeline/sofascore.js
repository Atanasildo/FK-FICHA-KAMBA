// Conversão das respostas NÃO OFICIAIS do SofaScore para o formato interno do FK.
//
// O SofaScore não tem API pública documentada: estes endereços são internos do site, podem mudar
// ou ser bloqueados a qualquer momento, e os termos do site restringem o acesso automático.
// Por isso este módulo só converte dados e é defensivo: qualquer campo em falta fica `null`
// (nunca é inventado) e o site mostra "Dados indisponíveis".
//
// Os formatos abaixo foram escritos a partir do que se conhece do site, e NÃO foram confirmados
// contra uma resposta real. Corre `node tools/collect-live-sofascore.js --probe` para ver o JSON
// bruto e ajustar este ficheiro se algum campo for diferente.

export const SOFASCORE_BASE = "https://www.sofascore.com/api/v1";

const clean = value => String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const finite = value => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

// Devolve os estados que o live-tickets.js já entende (FT, 1H, HT, 2H, ET, AET, PENS, NS, ...).
export function sofascoreStatus(status) {
  const type = clean(status?.type);
  const text = clean(status?.description);
  if (/after penalties|penalties/.test(text)) return "PENS";
  if (/after extra time|aet/.test(text)) return "AET";
  if (/postpon/.test(text) || /postpon/.test(type)) return "postponed";
  if (/cancel/.test(text) || /cancel/.test(type)) return "cancelled";
  if (/abandon/.test(text)) return "abandoned";
  if (/suspend/.test(text)) return "suspended";
  if (/interrupt/.test(text) || type === "interrupted") return "interrupted";
  if (text === "ended" || text === "finished" || type === "finished") return "FT";
  if (/halftime|half time/.test(text)) return "HT";
  if (/1st half|first half/.test(text)) return "1H";
  if (/2nd half|second half/.test(text)) return "2H";
  if (/extra time|1st extra|2nd extra|overtime/.test(text)) return "ET";
  if (type === "inprogress") return "1H";
  if (type === "notstarted" || /not started|to be defined/.test(text)) return "NS";
  return "NS";
}

// O minuto é calculado a partir do início do período actual. É uma aproximação: o tempo de
// compensação é truncado em 45' (1.ª parte) e 90' (2.ª parte). Sem dados fiáveis fica null.
function liveMinute(event, status, now) {
  const started = finite(event?.time?.currentPeriodStartTimestamp);
  if (started == null || (status !== "1H" && status !== "2H")) return null;
  const elapsed = Math.floor((now / 1000 - started) / 60) + 1;
  if (!Number.isFinite(elapsed) || elapsed < 1 || elapsed > 70) return null;
  return status === "1H" ? Math.min(elapsed, 45) : Math.min(45 + elapsed, 90);
}

export function normalizeSofascoreEvent(event, now = Date.now()) {
  const home = event?.homeTeam?.name;
  const away = event?.awayTeam?.name;
  const start = finite(event?.startTimestamp);
  if (event?.id == null || !home || !away || start == null) return null;
  const status = sofascoreStatus(event.status);
  return {
    id: String(event.id),
    home_team: String(home),
    away_team: String(away),
    kickoff_at: new Date(start * 1000).toISOString(),
    status,
    home_score: finite(event.homeScore?.current ?? event.homeScore?.display),
    away_score: finite(event.awayScore?.current ?? event.awayScore?.display),
    penalties_home_score: finite(event.homeScore?.penalties),
    penalties_away_score: finite(event.awayScore?.penalties),
    minute: liveMinute(event, status, now),
    competition: event.tournament?.name || null,
    country: event.tournament?.category?.name || null,
    provider: "sofascore"
  };
}

export function normalizeSofascoreLiveList(payload, now = Date.now()) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  return events.map(event => normalizeSofascoreEvent(event, now)).filter(Boolean);
}

const STAT_ALIASES = [
  [/^ball possession$/, "possession"],
  [/^(total shots|shots)$/, "shots"],
  [/^shots on target$/, "shots_on_target"],
  [/^shots off target$/, "shots_off_target"],
  [/^corner kicks?$|^corners$/, "corners"],
  [/^fouls$/, "fouls"],
  [/^yellow cards?$/, "yellow_cards"],
  [/^red cards?$/, "red_cards"],
  [/^(goalkeeper saves|saves)$/, "saves"],
  [/^tackles$/, "tackles"],
  [/^(passes|total passes)$/, "total_passes"],
  [/^accurate passes$/, "accurate_passes"]
];

function statValue(numeric, text) {
  const direct = finite(numeric);
  if (direct != null) return direct;
  const match = String(text ?? "").match(/-?\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(",", ".")) : null;
}

// Resposta de /event/{id}/statistics -> { home: {...}, away: {...} }. Usa o período "ALL".
export function normalizeSofascoreStatistics(payload) {
  const result = { home: {}, away: {} };
  const periods = Array.isArray(payload?.statistics) ? payload.statistics : [];
  const all = periods.find(period => String(period?.period || "").toUpperCase() === "ALL") || periods[0];
  for (const group of all?.groups || []) {
    for (const item of group?.statisticsItems || []) {
      const alias = STAT_ALIASES.find(([pattern]) => pattern.test(clean(item?.name)));
      if (!alias) continue;
      const home = statValue(item.homeValue, item.home);
      const away = statValue(item.awayValue, item.away);
      if (home != null) result.home[alias[1]] = home;
      if (away != null) result.away[alias[1]] = away;
    }
  }
  for (const side of ["home", "away"]) {
    const stats = result[side];
    if (stats.pass_accuracy == null && stats.total_passes > 0 && Number.isFinite(stats.accurate_passes)) {
      stats.pass_accuracy = stats.accurate_passes / stats.total_passes * 100;
    }
  }
  return result;
}

export function hasStatistics(stats) {
  return Object.keys(stats?.home || {}).length > 0 || Object.keys(stats?.away || {}).length > 0;
}

// Resposta de /event/{id}/incidents -> lista do mais antigo para o mais recente.
export function normalizeSofascoreIncidents(payload) {
  const incidents = Array.isArray(payload?.incidents) ? payload.incidents : [];
  const events = [];
  for (const item of incidents) {
    const kind = clean(item?.incidentType);
    const cls = clean(item?.incidentClass);
    let eventType = null;
    if (kind === "goal") eventType = "goal";
    else if (kind === "card") {
      eventType = cls === "red" ? "red_card" : cls === "yellowred" || cls === "yellow red" ? "second_yellow" : "yellow_card";
    } else if (kind === "substitution") eventType = "substitution";
    if (!eventType) continue;
    const minute = finite(item.time);
    events.push({
      event_type: eventType,
      player_name: item.player?.name || item.playerName || item.playerIn?.name || null,
      related_player_name: item.assist1?.name || item.playerOut?.name || null,
      minute: minute == null ? null : minute + (finite(item.addedTime) || 0),
      team_side: item.isHome === true ? "home" : item.isHome === false ? "away" : null
    });
  }
  // O SofaScore devolve os incidentes do mais recente para o mais antigo.
  return events.reverse().sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0));
}
