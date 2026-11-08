/**
 * FK — recolha local assistida das odds públicas.
 * Reutiliza Chrome/Edge já instalado e os recolhedores existentes.
 *
 * Configura tools/events.local.json com os jogos e URLs das duas casas.
 * Executa: npm run collect:local
 *
 * O browser mantém um perfil local (cookies/sessão), mas não contorna CAPTCHA,
 * autenticação, bloqueios geográficos nem qualquer controlo do fornecedor.
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { normalizeBantuBetPayload } from "../lib/bookmakers/bantubet.js";
import { normalizeElephantBetPayload } from "../lib/bookmakers/elephantbet.js";
import { compareFixtures } from "../lib/bookmakers/comparison.js";

const ROOT = process.cwd();
const CONFIG = path.join(ROOT, "tools", "events.local.json");
const OUTPUT = path.join(ROOT, "data", "collections");
const PROFILE = path.join(ROOT, ".fk-browser-profile");
const collectors = {
  BantuBet: path.join(ROOT, "tools", "bantubet-console-collector.js"),
  ElephantBet: path.join(ROOT, "tools", "elephantbet-console-collector.js")
};

function findBrowser() {
  const env = process.env;
  const candidates = [
    env.FK_BROWSER_EXECUTABLE_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    env["PROGRAMFILES(X86)"] && path.join(env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe")
  ].filter(Boolean);
  return candidates.find(existsSync);
}

function safeName(value) {
  return String(value).normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 70);
}

function isBlocked(status, title, body) {
  return status === 403 || /cloudflare|attention required|access denied|captcha|acesso restrito/i.test(
    String(title) + " " + String(body).slice(0, 1200)
  );
}

const config = JSON.parse(await readFile(CONFIG, "utf8"));
if (!Array.isArray(config) || !config.length) {
  throw new Error("O ficheiro tools/events.local.json deve conter pelo menos um jogo.");
}
for (const [index, event] of config.entries()) {
  if (!event.id || !event.home || !event.away || !event.bantubetUrl || !event.elephantbetUrl) {
    throw new Error(`Jogo ${index + 1}: exige id, home, away, bantubetUrl e elephantbetUrl.`);
  }
}

const executablePath = findBrowser();
if (!executablePath) {
  throw new Error("Chrome/Edge não encontrado. Define FK_BROWSER_EXECUTABLE_PATH com o caminho do browser instalado.");
}
await mkdir(OUTPUT, { recursive: true });
console.log("FK — recolha local");
console.log("Browser:", executablePath);
console.log("Jogos configurados:", config.length);
console.log("Os dados ficam em data/collections; não são enviados para terceiros.");

const context = await chromium.launchPersistentContext(PROFILE, {
  executablePath,
  headless: false,
  viewport: { width: 1440, height: 1000 },
  locale: "pt-AO",
  timezoneId: "Africa/Luanda",
  args: ["--no-sandbox"]
});
const rl = readline.createInterface({ input, output });
const allFixtures = [];
const report = { startedAt: new Date().toISOString(), timezone: "Africa/Luanda", events: [] };

try {
  for (const event of config) {
    const eventResult = { id: String(event.id), home: event.home, away: event.away, bookmakers: [] };
    for (const [bookmaker, url] of [
      ["BantuBet", event.bantubetUrl],
      ["ElephantBet", event.elephantbetUrl]
    ]) {
      const page = await context.newPage();
      console.log(`\nA abrir ${bookmaker}: ${event.home} — ${event.away}`);
      try {
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        // As casas podem demorar cerca de 30 segundos a carregar os mercados.
        // Espera activa até 90 segundos, em vez de verificar apenas no primeiro instante.
        const marketDeadline = Date.now() + 90000;
        let snapshot = await page.evaluate(() => ({
          title: document.title,
          body: document.body?.innerText || "",
          tabs: document.querySelectorAll(".horizontal-sl-tab-bc").length,
          groups: document.querySelectorAll(".sgm-market-g").length
        }));
        while (!snapshot.tabs && !snapshot.groups && Date.now() < marketDeadline) {
          await page.waitForTimeout(1500);
          snapshot = await page.evaluate(() => ({
            title: document.title,
            body: document.body?.innerText || "",
            tabs: document.querySelectorAll(".horizontal-sl-tab-bc").length,
            groups: document.querySelectorAll(".sgm-market-g").length
          }));
        }
        if (isBlocked(response?.status(), snapshot.title, snapshot.body)) {
          console.log(`${bookmaker}: foi apresentado um bloqueio/verificação. Não será contornado.`);
          await rl.question("Se for uma verificação normal apresentada pelo site, resolve-a manualmente e carrega ENTER. Para ignorar, carrega ENTER sem resolver: ");
          await page.waitForTimeout(5000);
          snapshot = await page.evaluate(() => ({
            title: document.title,
            body: document.body?.innerText || "",
            tabs: document.querySelectorAll(".horizontal-sl-tab-bc").length,
            groups: document.querySelectorAll(".sgm-market-g").length
          }));
        }
        if (!snapshot.tabs && !snapshot.groups) {
          throw new Error("A página abriu, mas não apresentou categorias/mercados reconhecíveis. Recolha ignorada.");
        }

        await page.evaluate(() => { delete window.__FK_COLLECTOR_RESULT__; });
        await page.addScriptTag({ path: collectors[bookmaker] });
        await page.waitForFunction(() => Boolean(window.__FK_COLLECTOR_RESULT__), null, { timeout: 180000 });
        const payload = await page.evaluate(() => window.__FK_COLLECTOR_RESULT__);
        const eventMeta = {
          id: String(event.id), home: event.home, away: event.away,
          competition: event.competition || null, kickoff: event.kickoff || null
        };
        const normalizer = bookmaker === "BantuBet" ? normalizeBantuBetPayload : normalizeElephantBetPayload;
        const normalized = normalizer(payload, eventMeta);
        const fixture = {
          ...eventMeta,
          bookmaker,
          sourceUrl: payload.urlPagina,
          collectedAt: payload.recolhidoEm,
          markets: normalized.markets.flatMap(market => market.status === "ok"
            ? market.selections.map(selection => ({
                market: market.market, selection: selection.selection, odds: selection.odd,
                line: selection.line ?? null, side: selection.side ?? null, team: selection.team ?? null,
                sourceUrl: payload.urlPagina, collectedAt: payload.recolhidoEm
              }))
            : [])
        };
        const prefix = `${safeName(event.id)}-${bookmaker.toLowerCase()}`;
        await writeFile(path.join(OUTPUT, `${prefix}-raw.json`), JSON.stringify(payload, null, 2));
        await writeFile(path.join(OUTPUT, `${prefix}-normalized.json`), JSON.stringify({ ...normalized, fixture }, null, 2));
        allFixtures.push(fixture);
        eventResult.bookmakers.push({
          bookmaker, status: fixture.markets.length ? "collected" : "no_usable_markets",
          categories: payload.categoriasLidas, markets: normalized.marketCount || 0,
          usableMarkets: normalized.usableMarketCount || 0, selections: fixture.markets.length,
          rawFile: `${prefix}-raw.json`, normalizedFile: `${prefix}-normalized.json`
        });
        console.log(`${bookmaker}: ${payload.categoriasLidas} categorias, ${normalized.usableMarketCount || 0} mercados utilizáveis, ${fixture.markets.length} selecções.`);
      } catch (error) {
        eventResult.bookmakers.push({ bookmaker, status: "failed", error: error.message });
        console.error(`${bookmaker}: ${error.message}`);
      } finally {
        await page.close();
      }
    }
    const eventFixtures = allFixtures.filter(f => f.id === String(event.id));
    const comparison = compareFixtures(eventFixtures);
    const result = { event: eventResult, comparison };
    await writeFile(path.join(OUTPUT, `${safeName(event.id)}-comparison.json`), JSON.stringify(result, null, 2));
    report.events.push(eventResult);
  }
  report.finishedAt = new Date().toISOString();
  report.comparison = compareFixtures(allFixtures);
  report.fixtureCollections = allFixtures.length;
  report.outputDirectory = "data/collections";
  await writeFile(path.join(OUTPUT, "latest-run.json"), JSON.stringify({ report, comparison: report.comparison }, null, 2));
  console.log("\nRecolha concluída.");
  console.log(JSON.stringify({
    jogos: report.events.length,
    recolhas: report.fixtureCollections,
    eventosComparáveis: report.comparison.eventCount,
    comparações: report.comparison.comparisonCount,
    pasta: "data/collections"
  }, null, 2));
  console.log("Nota: esta execução recolhe e compara odds; ainda não analisa jogos com Groq nem publica bilhetes.");
} finally {
  await rl.close();
  await context.close();
}
