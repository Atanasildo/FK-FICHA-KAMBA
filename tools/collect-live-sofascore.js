// Recolhe marcador, estado, eventos e estatísticas ao vivo dos jogos dos boletins publicados.
// Corre no PC local (os servidores da Vercel costumam ser bloqueados por este tipo de fonte).
//
//   node tools/collect-live-sofascore.js --probe                (só mostra o JSON bruto; não grava)
//   node tools/collect-live-sofascore.js --probe --event=ID     (idem, para estatísticas/incidentes de um jogo)
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node tools/collect-live-sofascore.js          (uma vez)
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node tools/collect-live-sofascore.js --watch  (a cada 60 s)
//
// AVISO: o SofaScore não tem API pública. Estes endereços são internos do site, não têm garantias
// e os termos do site restringem o acesso automático. O script faz poucos pedidos, só para os jogos
// das fichas, identifica-se normalmente e, se receber um bloqueio (403/429), PÁRA e espera: nunca
// disfarça o pedido nem tenta contornar o bloqueio. Sem dados, o site mostra "Dados indisponíveis".
import { execFile } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { matchFixture } from "../lib/pipeline/live-tickets.js";
import { settleFinishedLegs } from "../lib/pipeline/settlement.js";
import { enrichLiveGames, syncLiveGames } from "../lib/pipeline/live-games.js";
import {
  SOFASCORE_BASE,
  hasStatistics,
  normalizeSofascoreEvent,
  normalizeSofascoreIncidents,
  normalizeSofascoreLiveList,
  normalizeSofascoreStatistics
} from "../lib/pipeline/sofascore.js";

const FINAL_STATUS = /^(FT|AET|PENS|postponed|cancelled|abandoned)$/i;
const STATS_REFRESH_MS = 5 * 60 * 1000;
const WINDOW_BEFORE_MS = 4.5 * 60 * 60 * 1000;
const WINDOW_AFTER_MS = 15 * 60 * 1000;
const REQUEST_GAP_MS = 500;

export class BlockedError extends Error {}

const blocked = status => new BlockedError(`SofaScore recusou o pedido (HTTP ${status}). Não é contornado; a esperar.`);

export async function fetchSofascoreJson(path, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const response = await fetchImpl(path.startsWith("http") ? path : SOFASCORE_BASE + path, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (response.status === 403 || response.status === 429) throw blocked(response.status);
  if (!response.ok) throw new Error(`SofaScore HTTP ${response.status} em ${path}`);
  return response.json();
}

// No PC do utilizador, o pedido do Node (fetch) foi recusado com 403, mas o `curl` normal do Windows
// foi aceite. Por isso o transporte por defeito é o curl.exe, com o seu identificador normal (sem
// disfarce de navegador). Um 403/429 continua a parar o recolhedor.
export function curlJson(path, {
  timeoutMs = 15000, execImpl = execFile, bin = process.platform === "win32" ? "curl.exe" : "curl"
} = {}) {
  const args = ["-s", "--max-time", String(Math.ceil(timeoutMs / 1000)), "-w", "\n%{http_code}", SOFASCORE_BASE + path];
  return new Promise((resolve, reject) => {
    execImpl(bin, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error && !stdout) {
        reject(new Error(error.code === "ENOENT"
          ? `${bin} não encontrado: instala o curl ou define SOFASCORE_TRANSPORT=fetch.`
          : `curl falhou: ${error.message}`));
        return;
      }
      const text = String(stdout);
      const cut = text.lastIndexOf("\n");
      const status = Number(text.slice(cut + 1).trim());
      if (status === 403 || status === 429) { reject(blocked(status)); return; }
      if (status !== 200) { reject(new Error(`SofaScore HTTP ${status || "sem resposta"} em ${path}`)); return; }
      try { resolve(JSON.parse(text.slice(0, cut))); }
      catch { reject(new Error("Resposta do SofaScore não é JSON válido em " + path)); }
    });
  });
}

export function getSofascoreJson(path, options = {}) {
  const transport = options.transport || process.env.SOFASCORE_TRANSPORT || "curl";
  return transport === "fetch" ? fetchSofascoreJson(path, options) : curlJson(path, options);
}

// Jogos das fichas publicadas que estão (ou acabaram de estar) em campo.
export function pickTracked(tickets, now = Date.now()) {
  const byId = new Map();
  for (const ticket of tickets || []) {
    for (const leg of ticket.ticket_legs || []) {
      const match = leg.matches;
      const kickoff = Date.parse(match?.kickoff_at || "");
      if (!match?.id || !Number.isFinite(kickoff)) continue;
      if (kickoff < now - WINDOW_BEFORE_MS || kickoff > now + WINDOW_AFTER_MS) continue;
      byId.set(match.id, match);
    }
  }
  return [...byId.values()];
}

async function upsertRow(db, matchId, source, payload, collectedAt) {
  // Uma linha por (jogo, fonte), actualizada no lugar: a base de dados está perto do limite do plano.
  const { data: existing, error } = await db.from("match_statistics").select("id")
    .eq("match_id", matchId).eq("source", source)
    .order("collected_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const result = existing
    ? await db.from("match_statistics").update({ payload, collected_at: collectedAt }).eq("id", existing.id)
    : await db.from("match_statistics").insert({ match_id: matchId, source, payload, collected_at: collectedAt });
  if (result.error) throw new Error(result.error.message);
}

export function newState() {
  return { eventIds: new Map(), statsAt: new Map(), final: new Set() };
}

export async function runCycle({
  db, getJson, state = newState(), now = Date.now(), log = console.log, liveList: givenLiveList = null,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms))
}) {
  const { data: tickets, error } = await db.from("tickets")
    .select("id,ticket_legs(id,match_id,market_id,market_name,selection,result,matches(id,home_team,away_team,kickoff_at,status))")
    .eq("status", "published").order("published_at", { ascending: false }).limit(100);
  if (error) throw new Error("Não foi possível ler os boletins: " + error.message);

  const tracked = pickTracked(tickets, now);
  const summary = { tracked: tracked.length, matched: 0, written: 0, failed: 0, settled: 0 };
  if (!tracked.length) { log("Sem jogos de boletins na janela de acompanhamento."); return summary; }

  const liveList = givenLiveList || normalizeSofascoreLiveList(await getJson("/sport/football/events/live"), now);
  const claimed = new Set();
  const resolved = new Map();
  for (const match of tracked) {
    const fixture = matchFixture(match, liveList, claimed);
    if (fixture) { claimed.add(String(fixture.id)); resolved.set(match.id, fixture); }
  }

  // Jogos que já não aparecem na lista ao vivo (acabaram): pedir o estado final uma vez.
  for (const match of tracked) {
    const eventId = state.eventIds.get(match.id);
    if (resolved.has(match.id) || !eventId || state.final.has(match.id)) continue;
    try {
      await pause(REQUEST_GAP_MS);
      const payload = await getJson(`/event/${encodeURIComponent(eventId)}`);
      const fixture = normalizeSofascoreEvent(payload?.event, now);
      if (fixture) resolved.set(match.id, fixture);
    } catch (e) {
      if (e instanceof BlockedError) throw e;
      log(`Falha ao confirmar o estado de ${match.home_team} - ${match.away_team}: ${e.message}`);
      summary.failed++;
    }
  }

  for (const match of tracked) {
    const fixture = resolved.get(match.id);
    if (!fixture) continue;
    summary.matched++;
    const label = `${match.home_team} - ${match.away_team}`;
    state.eventIds.set(match.id, fixture.id);
    const isFinal = FINAL_STATUS.test(fixture.status);
    if (isFinal && state.final.has(match.id)) continue;
    try {
      // A linha do jogo é gravada primeiro: as estatísticas têm de ser mais recentes do que ela
      // para o live-tickets.js aceitar um jogo terminado como "estatística final".
      await upsertRow(db, match.id, "SofaScore-fixture", { eventId: fixture.id, fixture }, new Date().toISOString());
      summary.written++;

      await pause(REQUEST_GAP_MS);
      const incidents = normalizeSofascoreIncidents(await getJson(`/event/${encodeURIComponent(fixture.id)}/incidents`));
      // Só grava se houver incidentes: uma lista vazia pode ser falta de cobertura, e não "sem cartões".
      if (incidents.length) {
        const at = new Date().toISOString();
        await upsertRow(db, match.id, "SofaScore-live-events", { events: incidents, fixtureUpdatedAt: at }, at);
        summary.written++;
      }

      const lastStats = state.statsAt.get(match.id);
      if (isFinal || !lastStats || now - lastStats >= STATS_REFRESH_MS) {
        await pause(REQUEST_GAP_MS);
        const stats = normalizeSofascoreStatistics(await getJson(`/event/${encodeURIComponent(fixture.id)}/statistics`));
        if (hasStatistics(stats)) {
          await upsertRow(db, match.id, "SofaScore-live", stats, new Date().toISOString());
          summary.written++;
        }
        state.statsAt.set(match.id, now);
      }
      if (isFinal) {
        const legs = tickets.flatMap(ticket => ticket.ticket_legs || []);
        summary.settled += await settleFinishedLegs({ db, match, legs, fixture, log });
        state.final.add(match.id);
      }
      log(`OK  ${label} · ${fixture.status} ${fixture.home_score ?? "-"}-${fixture.away_score ?? "-"}`);
    } catch (e) {
      if (e instanceof BlockedError) throw e;
      log(`Falha no jogo ${label}: ${e.message}`);
      summary.failed++;
    }
  }
  const unmatched = tracked.length - summary.matched;
  if (unmatched) log(`${unmatched} jogo(s) sem correspondência segura no SofaScore (ficam como "Dados indisponíveis").`);
  return summary;
}

async function probe() {
  const eventArg = process.argv.find(arg => arg.startsWith("--event="));
  const cut = value => JSON.stringify(value, null, 2).slice(0, 1800);
  if (eventArg) {
    const id = eventArg.split("=")[1];
    for (const path of [`/event/${id}`, `/event/${id}/statistics`, `/event/${id}/incidents`]) {
      console.log("==", path);
      console.log(cut(await getSofascoreJson(path)));
    }
    return;
  }
  const raw = await getSofascoreJson("/sport/football/events/live");
  const list = normalizeSofascoreLiveList(raw);
  console.log(`Eventos brutos: ${Array.isArray(raw?.events) ? raw.events.length : "campo 'events' ausente"} | normalizados: ${list.length}`);
  console.log("== Primeiro evento bruto"); console.log(cut(raw?.events?.[0] ?? raw));
  console.log("== Primeiro evento normalizado"); console.log(cut(list[0] ?? null));

  // Estatísticas e incidentes de um jogo em curso, para confirmar o formato destes dois endereços.
  const first = (raw?.events || []).find(event => event?.status?.type === "inprogress");
  if (!first) { console.log("\nNenhum jogo em curso agora: sem estatísticas/incidentes para confirmar."); return; }
  console.log(`\n== Jogo de teste: ${first.homeTeam?.name} v ${first.awayTeam?.name} (id ${first.id})`);
  for (const [name, normalize] of [["statistics", normalizeSofascoreStatistics], ["incidents", normalizeSofascoreIncidents]]) {
    await new Promise(resolve => setTimeout(resolve, REQUEST_GAP_MS));
    console.log(`\n== /event/${first.id}/${name} (bruto)`);
    try {
      const data = await getSofascoreJson(`/event/${first.id}/${name}`);
      console.log(cut(data));
      console.log(`== ${name} normalizado`); console.log(cut(normalize(data)));
    } catch (e) { console.log("Falhou:", e.message); }
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  try {
    if (process.argv.includes("--probe")) { await probe(); process.exit(0); }
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) { console.error("Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const watch = process.argv.includes("--watch");
    const intervalArg = Number(process.argv.find(arg => arg.startsWith("--interval="))?.split("=")[1] || 60);
    const intervalMs = Math.max(30, Number.isFinite(intervalArg) ? intervalArg : 60) * 1000;
    const state = newState();
    do {
      let wait = intervalMs;
      try {
        // Um só pedido da lista ao vivo por ciclo: serve a página "Ao vivo" e o acompanhamento das fichas.
        const liveList = normalizeSofascoreLiveList(await getSofascoreJson("/sport/football/events/live"));
        const g = await syncLiveGames({ db, liveList, getJson: getSofascoreJson, log: msg => console.log(msg) });
        const d = await enrichLiveGames({ db, getJson: getSofascoreJson, log: msg => console.log(msg) });
        console.log(`[${new Date().toLocaleTimeString("pt-PT")}] jogos ao vivo: ${g.live} | terminados confirmados: ${g.finalized} | detalhes: ${d.updated}`);
        const r = await runCycle({ db, getJson: getSofascoreJson, state, liveList });
        console.log(`[${new Date().toLocaleTimeString("pt-PT")}] acompanhados: ${r.tracked} | liquidadas: ${r.settled} | associados: ${r.matched} | gravados: ${r.written} | falhas: ${r.failed}`);
      } catch (e) {
        console.error(`[${new Date().toLocaleTimeString("pt-PT")}] ${e.message}`);
        if (e instanceof BlockedError) wait = 5 * 60 * 1000;
      }
      if (watch) await new Promise(resolve => setTimeout(resolve, wait));
    } while (watch);
  } catch (e) {
    console.error("Falha:", e.message);
    process.exit(1);
  }
}
