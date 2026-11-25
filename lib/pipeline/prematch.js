// Pré-jogo (SofaScore, só a partir do PC): palpite do público, forma recente e confrontos directos
// de cada jogo de hoje/amanhã que já tem odds. Grava UMA linha por jogo em match_statistics
// (source = "sofascore-prematch"), para a análise ler tudo com uma única consulta à base.

export const PREMATCH_SOURCE = "sofascore-prematch";
const PRIORITY = /(premier league|championship|la ?liga|segunda divisi|bundesliga|serie [ab]|ligue [12]|eredivisie|liga portugal|primeira liga|s[eé]rie a|pro league|super lig|mls|superliga|eliteserien|allsvenskan|ekstraklasa|libertadores|sudamericana|champions|europa|conference)/i;
const SKIP = /(\bsrl\b|women|feminin|femenin|\bwom\b|u-?1\d|u-?2\d|juvenil|youth|reserves|\bii\b|amateur|virtual)/i;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// O endereço da lista por dia respondeu 404 no PC; tenta alternativas e lembra a primeira que funcionar.
export const LIST_URLS = [
  d => `/sport/football/scheduled-events/${d}`,
  d => `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${d}`,
  d => `https://api.sofascore.app/api/v1/sport/football/scheduled-events/${d}`,
  d => `https://www.sofascore.com/api/v1/sport/football/scheduled-events/${d}`
];
let workingList = null;
export async function scheduledEvents(getJson, day, log = () => {}) {
  const order = workingList == null ? LIST_URLS.map((_, i) => i) : [workingList];
  let last;
  for (const i of order) {
    try { const data = await getJson(LIST_URLS[i](day)); workingList = i; return data; }
    catch (e) { last = e; if (e?.constructor?.name === "BlockedError") throw e; log(`lista ${i + 1}: ${e.message}`); }
  }
  throw last;
}

export function toPrematchPayload({ event, votes, form, h2h, collectedAt }) {
  const v = votes?.vote || null;
  const total = v ? (v.vote1 || 0) + (v.voteX || 0) + (v.vote2 || 0) : 0;
  const side = x => form?.[x] ? {
    forma: form[x].form || null, posicao: form[x].position ?? null,
    pontos: form[x].value ?? null, nota: form[x].avgRating ?? null
  } : null;
  const duel = h2h?.teamDuel || null;
  return {
    sofascoreEventId: event.id,
    torneio: event.tournament?.name || null,
    pais: event.tournament?.category?.name || null,
    publico: total ? {
      casa: Math.round(1000 * v.vote1 / total) / 10,
      empate: Math.round(1000 * v.voteX / total) / 10,
      fora: Math.round(1000 * v.vote2 / total) / 10, votos: total
    } : null,
    casa: side("homeTeam"), fora: side("awayTeam"),
    confrontos: duel ? { vitoriasCasa: duel.homeWins ?? 0, empates: duel.draws ?? 0, vitoriasFora: duel.awayWins ?? 0 } : null,
    recolhidoEm: collectedAt
  };
}

export async function collectPrematch({ db, getJson, now = new Date(), log = () => {}, max = 150, pauseMs = 1200 }) {
  const { normalizeTeamName } = await import("./match-linking.js");
  const from = new Date(now.getTime() + 20 * 60000).toISOString();
  const to = new Date(now.getTime() + 36 * 3600000).toISOString();
  const { data: matches, error } = await db.from("matches").select("id,home_team,away_team,kickoff_at")
    .gte("kickoff_at", from).lte("kickoff_at", to).order("kickoff_at").limit(1500);
  if (error) throw new Error(error.message);
  const candidates = (matches || []).filter(m => !SKIP.test(`${m.home_team} ${m.away_team}`));
  const { data: done } = await db.from("match_statistics").select("match_id,collected_at").eq("source", PREMATCH_SOURCE)
    .in("match_id", candidates.map(m => m.id));
  const fresh = new Map((done || []).map(r => [r.match_id, Date.parse(r.collected_at)]));
  const todo = candidates.filter(m => now.getTime() - (fresh.get(m.id) || 0) >= 6 * 3600000).slice(0, max);
  let linked = 0, saved = 0, failed = 0;
  const claimed = new Set();
  for (const match of todo) {
    let event = null;
    try {
      const found = await getJson(`/search/events?q=${encodeURIComponent(match.home_team)}&page=0`);
      const kickoff = Date.parse(match.kickoff_at);
      const home = normalizeTeamName(match.home_team), away = normalizeTeamName(match.away_team);
      event = (found?.results || []).map(r => r.entity || r).find(e => e?.id != null && !claimed.has(String(e.id))
        && normalizeTeamName(e.homeTeam?.name) === home && normalizeTeamName(e.awayTeam?.name) === away
        && Math.abs(e.startTimestamp * 1000 - kickoff) <= 4 * 3600000) || null;
    } catch (e) { if (e?.constructor?.name === "BlockedError") throw e; failed++; log(`pré-jogo pesquisa: ${e.message}`); }
    await pause(pauseMs);
    if (!event) continue;
    if (SKIP.test(`${event.tournament?.name || ""} ${event.tournament?.category?.name || ""}`)) continue;
    claimed.add(String(event.id)); linked++;
    const got = {};
    for (const [key, path] of [["votes", "votes"], ["form", "pregame-form"], ["h2h", "h2h"]]) {
      try { got[key] = await getJson(`/event/${event.id}/${path}`); } catch (e) { if (e?.constructor?.name === "BlockedError") throw e; got[key] = null; }
      await pause(pauseMs);
    }
    if (!got.votes && !got.form && !got.h2h) { failed++; continue; }
    const collectedAt = new Date().toISOString();
    const payload = toPrematchPayload({ event, ...got, collectedAt });
    const { data: ex } = await db.from("match_statistics").select("id").eq("match_id", match.id).eq("source", PREMATCH_SOURCE).limit(1).maybeSingle();
    const r = ex ? await db.from("match_statistics").update({ payload, collected_at: collectedAt }).eq("id", ex.id)
                 : await db.from("match_statistics").insert({ match_id: match.id, source: PREMATCH_SOURCE, payload, collected_at: collectedAt });
    if (r.error) { failed++; log(`pré-jogo: ${r.error.message}`); } else { saved++; log(`pré-jogo: ${match.home_team} - ${match.away_team} gravado`); }
  }
  log(`pré-jogo: ${todo.length} pesquisados, ${linked} associados, ${saved} gravados, ${failed} falhas`);
  return { searched: todo.length, linked, saved, failed };
}
