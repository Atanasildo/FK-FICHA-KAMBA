// Descobre que sites de previsões abrem a partir do PC (curl normal, sem disfarce) e se trazem
// listas por dia. Não grava nada.   node tools\probe-prediction-sites.js
import { execFile } from "node:child_process";
const day = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Luanda" });
const [y, m, d] = day.split("-");
const urls = [
  "https://www.mybets.today/soccer-predictions/",
  `https://www.foresportia.com/pronostic/?date=${day}`,
  "https://www.foresportia.com/en/predictions/",
  "https://footballpredictions.com/",
  `https://footballpredictions.com/footballpredictions/predictions-${d}-${m}-${y}/`,
  "https://footballpredictions.ai/football-predictions/",
  "https://www.sportsmole.co.uk/football/predictions.html",
  "https://www.sportsmole.co.uk/football/champions-league/predictions.html",
  "https://forzafootball.com/gb/play/betting-tips",
  "https://www.forebet.com/en/football-predictions",
  "https://www.predictz.com/predictions/today/",
  "https://www.windrawwin.com/predictions/today/",
  "https://www.soccervista.com/",
  "https://www.statarea.com/predictions",
  "https://www.vitibet.com/index.php?clanek=quicktips&sekce=fotbal&lang=en",
  "https://www.footystats.org/predictions",
  "https://www.betstudy.com/predictions/",
  "https://www.betexplorer.com/next-matches/football/",
  "https://www.oddsportal.com/matches/soccer/"
];
const run = url => new Promise(resolve => execFile(process.platform === "win32" ? "curl.exe" : "curl",
  ["-sL", "--max-time", "20", "-A", "curl/8", "-w", "\n%{http_code}", url], { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  (e, out) => {
    const t = String(out || ""), i = t.lastIndexOf("\n"), status = t.slice(i + 1).trim() || "sem resposta", body = t.slice(0, i);
    const title = (body.match(/<title[^>]*>([^<]{0,90})/i) || [])[1]?.replace(/\s+/g, " ").trim() || "";
    const teams = (body.match(/vs\.?\s|\bv\s/gi) || []).length;
    resolve(`${status}  ${String(Math.round(body.length / 1024)).padStart(5)} KB  jogos~${String(teams).padStart(3)}  ${url}  ${title ? "| " + title : ""}`);
  }));
for (const u of urls) { console.log(await run(u)); await new Promise(r => setTimeout(r, 1500)); }
