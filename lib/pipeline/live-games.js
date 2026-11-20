import { normalizeSofascoreEvent } from "./sofascore.js";

const FINAL = /^(FT|AET|PENS)$/i;
const MAX_FINALIZE_PER_CYCLE = 10;
const KEEP_MS = 36 * 60 * 60 * 1000;
const GAP_MS = 500;

const toRow = (fixture, now) => ({
  sofascore_id: String(fixture.id),
  home_team: fixture.home_team,
  away_team: fixture.away_team,
  competition: fixture.competition ?? null,
  country: fixture.country ?? null,
  status: fixture.status,
  home_score: fixture.home_score,
  away_score: fixture.away_score,
  minute: fixture.minute,
  kickoff_at: fixture.kickoff_at,
  finished_at: FINAL.test(fixture.status) ? new Date(now).toISOString() : null,
  updated_at: new Date(now).toISOString()
});

// Mantém a tabela live_games: todos os jogos em directo agora + os que acabaram (últimas 36 h).
// Um jogo que sai da lista ao vivo é confirmado uma vez em /event/{id} para obter o resultado final.
export async function syncLiveGames({
  db, liveList, getJson, now = Date.now(), log = () => {},
  pause = ms => new Promise(resolve => setTimeout(resolve, ms))
}) {
  const summary = { live: 0, finalized: 0, failed: 0 };
  const live = (liveList || []).filter(game => !FINAL.test(game.status));
  if (live.length) {
    const { error } = await db.from("live_games").upsert(live.map(game => toRow(game, now)), { onConflict: "sofascore_id" });
    if (error) throw new Error("Não foi possível gravar os jogos ao vivo: " + error.message);
  }
  summary.live = live.length;

  const liveIds = new Set(live.map(game => String(game.id)));
  const { data: open, error: openError } = await db.from("live_games").select("sofascore_id,home_team,away_team")
    .is("finished_at", null);
  if (openError) throw new Error("Não foi possível ler os jogos abertos: " + openError.message);
  const gone = (open || []).filter(row => !liveIds.has(row.sofascore_id)).slice(0, MAX_FINALIZE_PER_CYCLE);

  for (const row of gone) {
    try {
      await pause(GAP_MS);
      const payload = await getJson(`/event/${encodeURIComponent(row.sofascore_id)}`);
      const fixture = normalizeSofascoreEvent(payload?.event, now);
      if (!fixture) continue;
      const { error } = await db.from("live_games").upsert(toRow(fixture, now), { onConflict: "sofascore_id" });
      if (error) throw new Error(error.message);
      if (FINAL.test(fixture.status)) {
        summary.finalized++;
        log(`TERMINADO ${row.home_team} - ${row.away_team} · ${fixture.home_score ?? "-"}-${fixture.away_score ?? "-"}`);
      }
    } catch (e) {
      if (e?.name === "BlockedError" || /recusou o pedido/.test(String(e?.message))) throw e;
      log(`Falha ao confirmar ${row.home_team} - ${row.away_team}: ${e.message}`);
      summary.failed++;
    }
  }

  const { error: purgeError } = await db.from("live_games").delete().lt("kickoff_at", new Date(now - KEEP_MS).toISOString());
  if (purgeError) log("Não foi possível limpar jogos antigos: " + purgeError.message);
  return summary;
}
