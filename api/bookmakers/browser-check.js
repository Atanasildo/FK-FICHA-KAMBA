import { Browserbase } from "@browserbasehq/sdk";
import { chromium } from "playwright-core";

const TARGETS = [
  { bookmaker: "BantuBet", url: "https://m.bantubet.co.ao/pt/sports" },
  { bookmaker: "ElephantBet", url: "https://www.elephantbet.co.ao/pt/sports" },
];

function send(res, status, body) {
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed" });
  }

  const secret = process.env.CRON_SECRET;
  const supplied = (req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
  if (!secret || supplied !== secret) {
    return send(res, 401, { error: "Unauthorized" });
  }

  if (!process.env.BROWSERBASE_API_KEY) {
    return send(res, 503, { error: "BROWSERBASE_API_KEY não configurada" });
  }

  let browser;
  let sessionId;
  try {
    const browserbase = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });
    const session = await browserbase.sessions.create(
      process.env.BROWSERBASE_PROJECT_ID
        ? { projectId: process.env.BROWSERBASE_PROJECT_ID }
        : {},
    );
    sessionId = session.id;
    browser = await chromium.connectOverCDP(session.connectUrl);

    const context = browser.contexts()[0] || await browser.newContext();
    const results = [];
    for (const target of TARGETS) {
      const page = await context.newPage();
      try {
        const response = await page.goto(target.url, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        await page.waitForTimeout(5000);
        const data = await page.evaluate(() => ({
          title: document.title,
          url: location.href,
          bodyText: (document.body?.innerText || "").slice(0, 1200),
          marketTabs: document.querySelectorAll(".horizontal-sl-tab-bc").length,
          marketGroups: document.querySelectorAll(".sgm-market-g").length,
        }));
        results.push({
          bookmaker: target.bookmaker,
          httpStatus: response?.status() ?? null,
          ...data,
          accessible: Boolean(response && response.status() < 400 && data.marketTabs > 0),
        });
      } catch (error) {
        results.push({ bookmaker: target.bookmaker, error: error.message, accessible: false });
      } finally {
        await page.close().catch(() => {});
      }
    }

    const accessible = results.filter((item) => item.accessible).length;
    return send(res, accessible === TARGETS.length ? 200 : 207, {
      ok: accessible === TARGETS.length,
      sessionId,
      checkedAt: new Date().toISOString(),
      results,
      note: "Diagnóstico de acesso. A recolha de odds só será activada depois de validar os seletores e a correspondência dos mesmos jogos nas duas casas.",
    });
  } catch (error) {
    return send(res, 502, {
      error: "Falha ao iniciar ou controlar o navegador remoto",
      detail: error.message,
      sessionId: sessionId || null,
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
