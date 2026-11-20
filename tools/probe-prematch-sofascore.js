// Sonda de fontes PRÉ-JOGO do SofaScore (corre no PC, como o recolhedor ao vivo).
// Não grava nada: mostra o que cada endereço devolve para 3 jogos de hoje, para eu ligar só o que existir.
//   node tools/probe-prematch-sofascore.js
import { getSofascoreJson, BlockedError } from "./collect-live-sofascore.js";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const cut = (value, n = 700) => JSON.stringify(value, null, 1)?.slice(0, n);
const day = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Luanda" });

try {
  const list = await getSofascoreJson(`/sport/football/scheduled-events/${day}`);
  const events = (list?.events || []).filter(e => e?.status?.type === "notstarted").slice(0, 3);
  console.log(`Jogos por começar em ${day}: ${(list?.events || []).length} no total; a sondar ${events.length}.`);
  for (const event of events) {
    console.log(`\n######## ${event.homeTeam?.name} v ${event.awayTeam?.name} (id ${event.id}, torneio ${event.tournament?.uniqueTournament?.id ?? "?"}, época ${event.season?.id ?? "?"})`);
    const paths = [
      `/event/${event.id}/h2h`,
      `/event/${event.id}/pregame-form`,
      `/event/${event.id}/lineups`,
      `/event/${event.id}/odds/1/all`,
      `/event/${event.id}/votes`,
      `/team/${event.homeTeam?.id}/events/last/0`,
      `/team/${event.awayTeam?.id}/events/last/0`,
      event.tournament?.uniqueTournament?.id && event.season?.id
        ? `/unique-tournament/${event.tournament.uniqueTournament.id}/season/${event.season.id}/standings/total` : null
    ].filter(Boolean);
    for (const path of paths) {
      await pause(1500);
      try {
        const data = await getSofascoreJson(path);
        console.log(`\n== ${path}\nchaves: ${Object.keys(data || {}).join(", ") || "(vazio)"}\n${cut(data)}`);
      } catch (e) {
        if (e instanceof BlockedError) throw e;
        console.log(`\n== ${path}\nFALHOU: ${e.message}`);
      }
    }
  }
} catch (e) {
  console.error("Parou:", e.message);
  process.exit(1);
}
