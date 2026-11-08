/**
 * FK — diagnóstico local das casas de apostas.
 *
 * Executar num computador em Angola:
 *   npm install
 *   npx playwright install chromium
 *   node tools/local-bookmaker-check.js
 *
 * Abre Chromium local (não um IP de datacenter). Se surgir uma verificação
 * anti-bot, permite resolução manual no próprio navegador; nunca tenta
 * contornar CAPTCHA, autenticação ou restrições da casa.
 */
import { chromium } from "playwright";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const targets = [
  { bookmaker: "BantuBet", url: "https://m.bantubet.co.ao/pt/sports" },
  { bookmaker: "ElephantBet", url: "https://www.elephantbet.co.ao/pt/sports" },
];

const browser = await chromium.launch({
  headless: false,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "pt-AO",
  timezoneId: "Africa/Luanda",
});
const rl = readline.createInterface({ input, output });

try {
  const ipPage = await context.newPage();
  let ip = null;
  try {
    await ipPage.goto("https://ipinfo.io/json", { waitUntil: "domcontentloaded", timeout: 25000 });
    ip = await ipPage.evaluate(() => {
      try {
        const d = JSON.parse(document.body.innerText);
        return { country: d.country, region: d.region, city: d.city };
      } catch {
        return { response: document.body.innerText.slice(0, 300) };
      }
    });
  } catch (error) {
    ip = { error: error.message };
  }
  await ipPage.close();
  console.log("\nFK — diagnóstico local");
  console.log("IP de saída:", ip);

  const results = [];
  for (const target of targets) {
    const page = await context.newPage();
    console.log("\nA abrir " + target.bookmaker + ": " + target.url);
    let status = null;
    let errorText = null;
    try {
      const response = await page.goto(target.url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      status = response?.status() ?? null;
      await page.waitForTimeout(8000);

      let snapshot = await page.evaluate(() => ({
        title: document.title,
        url: location.href,
        bodyText: (document.body?.innerText || "").slice(0, 1800),
        marketTabs: document.querySelectorAll(".horizontal-sl-tab-bc").length,
        marketGroups: document.querySelectorAll(".sgm-market-g").length,
        eventLinks: [...document.querySelectorAll('a[href*="event"]')]
          .slice(0, 15)
          .map(a => ({ text: a.innerText.trim().slice(0, 120), href: a.href })),
      }));

      const blocked = status === 403 ||
        /cloudflare|attention required|acesso restrito|access denied|captcha/i.test(snapshot.title + " " + snapshot.bodyText);
      if (blocked) {
        console.log("\nA casa apresentou um bloqueio/verificação. Se aparecer uma verificação normal no navegador, resolve-a manualmente.");
        await rl.question("Depois de concluir (ou se continuar bloqueado), carrega ENTER para continuar...");
        await page.waitForTimeout(5000);
        status = await page.evaluate(() => performance.getEntriesByType("navigation")[0]?.responseStatus || null);
        snapshot = await page.evaluate(() => ({
          title: document.title,
          url: location.href,
          bodyText: (document.body?.innerText || "").slice(0, 1800),
          marketTabs: document.querySelectorAll(".horizontal-sl-tab-bc").length,
          marketGroups: document.querySelectorAll(".sgm-market-g").length,
          eventLinks: [...document.querySelectorAll('a[href*="event"]')]
            .slice(0, 15)
            .map(a => ({ text: a.innerText.trim().slice(0, 120), href: a.href })),
        }));
      }

      const accessible = snapshot.marketTabs > 0 || snapshot.eventLinks.length > 0;
      results.push({ bookmaker: target.bookmaker, httpStatus: status, accessible, ...snapshot });
      console.log(JSON.stringify(results.at(-1), null, 2));
    } catch (error) {
      errorText = error.message;
      results.push({ bookmaker: target.bookmaker, httpStatus: status, accessible: false, error: errorText });
      console.error(errorText);
    }
  }

  const report = {
    checkedAt: new Date().toISOString(),
    timezone: "Africa/Luanda",
    exitIp: ip,
    results,
  };
  const fs = await import("node:fs/promises");
  await fs.writeFile("fk-local-browser-check.json", JSON.stringify(report, null, 2));
  console.log("\nRelatório guardado em fk-local-browser-check.json");
  console.log("Não foram feitas apostas nem contornados controlos de acesso.");
} finally {
  await rl.close();
  await browser.close();
}
