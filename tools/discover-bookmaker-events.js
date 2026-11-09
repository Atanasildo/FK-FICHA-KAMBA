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
  const now = Date.now();
  const terminalOrLive = /live|in.?play|finished|full.?time|after.?extra|penalt|cancel|postpon|abandon|\b(ft|aet|pens|ht|1h|2h)\b/i;
  return list.map(item => ({
    id: String(item.id), home: item.home || item.home_team || "",
    away: item.away || item.away_team || "",
    competition: item.competition || item.league_name || null,
    kickoff: item.kickoff || item.sourceKickoffUtc || item.kickoff_utc || null,
    status: item.status || "TBD"
  })).filter(item => {
    const kickoffMs = Date.parse(item.kickoff || "");
    return item.id && item.home && item.away && !terminalOrLive.test(String(item.status)) &&
      Number.isFinite(kickoffMs) && kickoffMs > now;
  });
}

function safeUrl(value) {
  try { const u = new URL(value); return u.origin + u.pathname; }
  catch { return String(value || "").split("?")[0].split("#")[0]; }
}

function redact(value, depth = 0) {
  if (depth > 5) return "[depth-limit]";
  if (Array.isArray(value)) return value.slice(0, 8).map(v => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 80)) {
      out[key] = /token|secret|password|cookie|authorization|session|credential|api.?key/i.test(key)
        ? "[redacted]" : redact(item, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") return value
    .replace(/Bearer\s+[^\s"'<>]+/gi, "Bearer [redacted]")
    .replace(/([?&](?:token|key|secret|auth|session)=)[^&\s]+/gi, "$1[redacted]").slice(0, 500);
  return value;
}

async function collectPageDiagnostics(page, bookmaker, network, failures) {
  const dom = await page.evaluate(() => ({
    bodyText: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 12000),
    headings: [...document.querySelectorAll("h1,h2,h3,[role=heading]")].slice(0, 40)
      .map(e => (e.innerText || e.getAttribute("aria-label") || "").trim()).filter(Boolean),
    links: [...document.querySelectorAll("a[href]")].slice(0, 100).map(a => ({
      text: (a.innerText || a.getAttribute("aria-label") || "").trim().slice(0, 180),
      url: a.href.split("?")[0].split("#")[0]
    })),
    controls: [...document.querySelectorAll("input,button,[role=button],[role=tab],select")].slice(0, 100).map(e => ({
      tag: e.tagName.toLowerCase(), text: (e.innerText || "").trim().slice(0, 120),
      placeholder: e.getAttribute("placeholder"), ariaLabel: e.getAttribute("aria-label"),
      title: e.getAttribute("title")
    }))
  }));
  return {
    bookmaker, pageTitle: await page.title(), finalUrl: safeUrl(page.url()), dom,
    responseCount: network.length, network: network.slice(0, 80),
    requestFailures: failures.slice(0, 60)
  };
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
    const currentHost = location.hostname;
    const byUrl = new Map();
    for (const anchor of document.querySelectorAll("a[href]")) {
      const url = anchor.href;
      if (!/^https?:/.test(url)) continue;
      let parsed;
      try { parsed = new URL(url); } catch { continue; }
      if (parsed.hostname !== currentHost) continue;
      let node = anchor;
      let bestText = "";
      let cardText = "";
      for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
        const value = (node.innerText || "").replace(/\s+/g, " ").trim();
        if (value.length > bestText.length && value.length <= 1800) bestText = value;
        // Prefer the nearest compact event card; larger ancestors often contain
        // several matches and can create false associations between fixtures.
        if (!cardText && value.length >= 25 && value.length <= 700) cardText = value;
      }
      const anchorText = (anchor.innerText || anchor.getAttribute("aria-label") || "").trim();
      const text = cardText || bestText || anchorText;
      const path = parsed.pathname.toLowerCase();
      const looksLikeEvent = /event|match|fixture|game|evento|jogo|detail|\d{6,}/i.test(path);
      if (!looksLikeEvent || text.length < 8) continue;
      const previous = byUrl.get(url);
      if (!previous || text.length > previous.text.length) byUrl.set(url, { url, text });
    }
    return [...byUrl.values()].slice(0, 2500);
  });
}

async function waitForEventLinks(page, timeoutMs = 60000) {
  const started = Date.now();
  let links = [];
  while (Date.now() - started < timeoutMs) {
    links = await readEventLinks(page);
    if (links.length >= 10) return links;
    await page.waitForTimeout(3000);
  }
  return links;
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
      const network = [];
      const failures = [];
      page.on("response", async response => {
        try {
          const req = response.request();
          if (!["xhr", "fetch"].includes(req.resourceType())) return;
          const headers = response.headers();
          const item = { method: req.method(), resourceType: req.resourceType(),
            status: response.status(), url: safeUrl(response.url()),
            contentType: headers["content-type"] || "" };
          if (/json|javascript|text\/plain/i.test(item.contentType)) {
            const raw = await response.text().catch(() => "");
            if (raw && raw.length <= 1500000) {
              try {
                const body = redact(JSON.parse(raw));
                item.bodyKeys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body).slice(0,60) : [];
                item.bodyPreview = JSON.stringify(body).slice(0,5000);
              } catch {
                item.bodyPreview = raw.replace(/Bearer\s+[^\s"'<>]+/gi,"Bearer [redacted]").slice(0,1200);
              }
            } else item.bodyPreview = raw ? "[body over 1.5 MB]" : "";
          }
          network.push(item);
        } catch (error) { network.push({ captureError: error.message }); }
      });
      page.on("requestfailed", req => {
        if (["xhr","fetch"].includes(req.resourceType())) failures.push({
          method:req.method(), url:safeUrl(req.url()), error:req.failure()?.errorText || "request failed"
        });
      });
      try {
        console.log("A diagnosticar " + bookmaker.name + ": " + bookmaker.url);
        const response = await page.goto(bookmaker.url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(25000);
        if (response?.status() === 403 || /cloudflare|captcha|access denied|attention required/i.test(await page.title())) {
          report.push({ bookmaker:bookmaker.name, status:"blocked",
            detail:"A casa bloqueou ou pediu verificação; não foi contornado.",
            pageTitle:await page.title(), finalUrl:safeUrl(page.url()) });
        } else {
          const candidates = await readEventLinks(page);
          let found = 0;
          for (const fixture of fixtures) {
            const result = selectUniqueEventLink(fixture, candidates);
            const record = discoveries.get(fixture.id);
            if (result.status === "matched") { record[bookmaker.key] = result.candidate.url; found++; }
            else (record.discovery || (record.discovery = {}))[bookmaker.name] = result.status;
          }
          report.push({ bookmaker:bookmaker.name, status:"scanned",
            pageTitle:await page.title(), finalUrl:safeUrl(page.url()),
            links:candidates.length, matches:found,
            sampleCandidates:candidates.slice(0,8).map(x=>({url:safeUrl(x.url),text:x.text.slice(0,220)})) });
        }
      } catch (error) {
        report.push({ bookmaker:bookmaker.name, status:"failed", detail:error.message });
      } finally {
        const diagnostic = await collectPageDiagnostics(page, bookmaker.name, network, failures);
        await writeFile(path.join(OUTPUT, bookmaker.name.toLowerCase()+"-diagnostics.json"), JSON.stringify(diagnostic,null,2));
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
  await writeFile(path.join(OUTPUT, "bookmaker-diagnostics-latest.json"), JSON.stringify({
    generatedAt:new Date().toISOString(),
    note:"Diagnóstico local DOM e XHR/fetch; URLs sem query string e campos sensíveis redigidos.",
    files:BOOKMAKERS.map(x=>"data/collections/"+x.name.toLowerCase()+"-diagnostics.json"),
    scans:report.map(x=>({bookmaker:x.bookmaker,status:x.status,pageTitle:x.pageTitle,finalUrl:x.finalUrl,links:x.links,matches:x.matches,detail:x.detail}))
  },null,2));
  console.log("Diagnósticos guardados em data/collections/bookmaker-diagnostics-latest.json.");
}

main().catch(error => {
  console.error("FK discovery:", error.message);
  process.exitCode = 1;
});
