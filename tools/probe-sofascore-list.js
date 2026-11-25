// Descobre qual endereço do SofaScore lista jogos futuros. Não grava nada.
//   node tools\probe-sofascore-list.js
import { getSofascoreJson } from "./collect-live-sofascore.js";
const day = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Luanda" });
const paths = [
  `/sport/football/scheduled-events/${day}`,
  `/sport/football/scheduled-events/${day}/inverse`,
  `/sport/football/events/${day}`,
  `/unique-tournament/17/scheduled-events/${day}`,
  `/unique-tournament/17/season/61627/events/next/0`,
  `/search/events?q=arsenal&page=0`,
  `/search/all?q=arsenal`,
  `/sport/football/categories`,
  `/sport/1/scheduled-events/${day}`,
  `/sport/football/events/live`
];
for (const p of paths) {
  try {
    const d = await getSofascoreJson(p);
    const n = d?.events?.length ?? d?.results?.length ?? Object.keys(d || {}).length;
    console.log(`OK    ${p}  -> ${n} itens; chaves: ${Object.keys(d || {}).join(",").slice(0, 80)}`);
  } catch (e) { console.log(`FALHA ${p}  -> ${e.message.slice(0, 70)}`); }
  await new Promise(r => setTimeout(r, 1200));
}
