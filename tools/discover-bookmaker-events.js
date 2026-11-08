/**
 * FK — Descoberta local dos URLs dos jogos nas casas.
 * Obtém fixtures da rota pública SportAPI do FK e procura cartões de eventos
 * nas páginas de futebol das duas casas. Não tenta contornar bloqueios.
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { selectUniqueEventLink } from "../lib/bookmakers/event-discovery.js";

const ROOT = process.cwd();
const CONFIG_OUT = path.join(ROOT, "tools", "events.local.json");
const PROFILE = path.join(ROOT, ".fk-browser-profile");
const OUTPUT = path.join(ROOT, "data", "collections");
const TZ = "Africa/Luanda";
const API_URL = process.env.FK_FIXTURES_API_URL || "https://fk-ficha-kamba.vercel.app/api/football-data";
const BOOKMAKERS = [
  { name: "BantuBet", url: process.env.FK_BANTUBET_SPORTS_URL || "https://m.bantubet.co.ao/pt/sports", key: "bantubetUrl" },
  { name: "ElephantBet", url: process.env.FK_ELEPHANTBET_SPORTS_URL || "https://www.elephantbet.co.ao/pt/sports", key: "elephantbetUrl" }
];

function localDate(offset = 0) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function findBrowser() {
  const env = process.env;
  const candidates = [
    env.FK_BROWSER_EXECUTABLE_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe")
  ].filter(Boolean);
  return candidates.find(existsSync);
}

function normalizeFixtures(payload) {
  const list = payload?.fixtures || payload?.data || [];
  if (!Array.isArray(list)) throw new Error("A resposta da SportAPI não contém uma lista de jogos.");
  return list.map(item => ({
    id: String(item.id),
    home: item.home || item.home_team || "",
    away: item.away || item.away_team || "",
    competition: item.competition || item.league_name || null,
    kickoff: item.kickoff || item.sourceKickoffUtc || item.kickoff_utc || null,
    status: item.status || "TBD"
  })).filter(item => item.id && item.home && item.away && !/live|finished|cancel|postpon|abandon/i.test(item.status));
}

async function fetchFixtures() {
  const dates = [localDate(0), localDate(1)];
  const responses = await Promise.all(dates.map(async date => {
    const response = await fetch(API_URL + "?date=" + encodeURIComponent(date), {
      headers: { Accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("SportAPI/FK (" + date + "): HTTP " + response.status + " — " + (payload.error || "sem detalhe"));
    return normalizeFixtures(payload);
  }));
  const unique = new Map();
  for (const fixture of responses.flat()) unique.set(fixture.id, fixture);
  return [...unique.values()];
}

async function readEventLinks(page) {
  return page.evaluate(() => {
    const selectors = "a[href]";
    return [...document.querySelectorAll(selectors)].map(anchor => {
      let node = anchor;
      let text = "";
      // Inclui o texto do cartão que envolve a ligação, mas limita a dimensão.
      for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
        const value = (node.innerText || "").trim();
        if (value.length > text.length && value.length <= 900) text = value;
      }
      return { url: anchor.href, text: text || anchor.innerText || "" };
    }).filter(item =>
      /^https?:/.test(item.url) &&
      /\\/(event|match|fixture)\\/|event|match/i.test(item.url) &&
      item.text.length > 0
    );
  });
}

async function main() {
  const fixtures = await fetchFixtures();
  if (!fixtures.length) throw new Error("A SportAPI não devolveu jogos futuros para hoje e amanhã.");
  const executablePath = findBrowser();
  if (!executablePath) throw new Error("Chrome/Edge não encontrado.");
  await mkdir(OUTPUT, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath, headless: false,
    viewport: { width: 1440, height: 1000 },
    locale: "pt-AO", timezoneId: TZ, args: ["--no-sandbox"]
  });
  const discoveries = new Map(fixtures.map(fixture => [fixture.id, { ...fixture }]));
  const report = [];

  try {
    for (const bookmaker of BOOKMAKERS) {
      const page = await context.newPage();
      try {
        console.log("A procurar eventos em " + bookmaker.name + ": " + bookmaker.url);
        const response = await page.goto(bookmaker.url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(12000);
        if (response?.status() === 403 || /cloudflare|captcha|access denied|attention required/i.test(await page.title())) {
          report.push({ bookmaker: bookmaker.name, status: "blocked", detail: "A casa bloqueou ou pediu verificação; não foi contornado." });
          continue;
        }
        const candidates = await readEventLinks(page);
        let found = 0;
        for (const fixture of fixtures) {
          const result = selectUniqueEventLink(fixture, candidates);
          const record = discoveries.get(fixture.id);
          if (result.status === "matched") {
            record[bookmaker.key] = result.candidate.url;
            found++;
          } else {
            (record.discovery || (record.discovery = {}))[bookmaker.name] = result.status;
          }
        }
        report.push({ bookmaker: bookmaker.name, status: "scanned", links: candidates.length, matches: found });
      } catch (error) {
        report.push({ bookmaker: bookmaker.name, status: "failed", detail: error.message });
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  const ready = [...discoveries.values()].filter(f => f.bantubetUrl && f.elephantbetUrl);
  await writeFile(CONFIG_OUT, JSON.stringify(ready.map(({ discovery, ...fixture }) => fixture), null, 2));
  const summary = {
    generatedAt: new Date().toISOString(),
    fixturesFromSportAPI: fixtures.length,
    fixturesWithBothBookmakers: ready.length,
    fixturesMissingAtLeastOneBookmaker: fixtures.length - ready.length,
    bookmakerScans: report,
    output: "tools/events.local.json"
  };
  await writeFile(path.join(OUTPUT, "event-discovery-latest.json"), JSON.stringify({ summary, fixtures: [...discoveries.values()] }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log("Só os jogos encontrados nas DUAS casas foram preparados para recolha.");
}

main().catch(error => {
  console.error("FK discovery:", error.message);
  process.exitCode = 1;
});
