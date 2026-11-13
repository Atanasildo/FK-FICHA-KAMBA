import { randomUUID } from "node:crypto";
import {
  collectSwarm,
  discoverSwarmGames,
  SWARM_BOOKMAKERS
} from "../lib/bookmakers/swarm.js";
import { selectCommonSwarmGames } from "../lib/bookmakers/daily-swarm.js";

const baseUrl = (process.env.FK_API_URL || "https://fk-ficha-kamba.vercel.app").replace(/\/$/, "");
const ingestUrl = process.env.FK_INGEST_URL || baseUrl + "/api/bookmakers/save-comparison";
const secret = process.env.CRON_SECRET;
const vercelBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (!secret) {
  console.error("Falta definir a variável CRON_SECRET no ambiente deste computador.");
  process.exit(1);
}
if (!vercelBypass) {
  console.error("Falta definir VERCEL_AUTOMATION_BYPASS_SECRET para aceder à Preview protegida da Vercel.");
  process.exit(1);
}

const requestHeaders = {
  "content-type": "application/json",
  authorization: "Bearer " + secret,
  "x-vercel-protection-bypass": vercelBypass
};

async function post(path, body, timeout = 90000) {
  const response = await fetch(baseUrl.replace(/\/$/, "") + path, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    const summary = result.error || result.message || `HTTP ${response.status}`;
    const detail = result.detail ? ` | Detalhe: ${result.detail}` : "";
    const code = result.code ? ` | Código: ${result.code}` : "";
    const retry = result.retry_after || result.retryAfter ? ` | Tentar novamente em: ${result.retry_after || result.retryAfter}` : "";
    throw new Error(`${summary} (HTTP ${response.status})${detail}${code}${retry}`);
  }
  return result;
}

const dryRun = process.argv.includes("--dry-run");
if (dryRun) console.log("MODO DE TESTE: as odds serão actualizadas, mas nenhum bilhete será publicado.");

const providers = ["bantu", "elephant"];
const discovered = {};

for (const name of providers) {
  console.log("A descobrir jogos na " + (name === "bantu" ? "BantuBet" : "ElephantBet") + "...");
  discovered[name] = await discoverSwarmGames({
    ...SWARM_BOOKMAKERS[name],
    sportId: 1,
    timeoutMs: 45000
  });
  console.log(name + ": " + discovered[name].gamesFound + " jogos encontrados.");
}

const gameIds = selectCommonSwarmGames(
  discovered.bantu.games,
  discovered.elephant.games,
  { maxGames: 50 }
);

if (!gameIds.length) {
  console.error("Não foram encontrados jogos comuns dentro da janela de recolha.");
  process.exit(1);
}

// Regista primeiro o calendário SportAPI para permitir associar os IDs Swarm
// aos jogos canónicos antes de analisar as odds.
let sportApiDiscovered = 0;
let sportApiDiscoveryOk = false;
try {
  const discovery = await post("/api/pipeline/discover-fixtures", { days: 4 });
  sportApiDiscovered = Number(discovery.fixturesDiscovered || 0);
  sportApiDiscoveryOk = true;
  console.log("Calendário SportAPI:", sportApiDiscovered, "jogos encontrados.");
} catch (error) {
  console.warn("Aviso: não foi possível actualizar o calendário SportAPI:", error.message);
  console.warn("As odds serão guardadas; a análise só poderá usar jogos que já estejam associados.");
}

const batchSize = 10;
let totalSavedGames = 0;
let totalSavedComparisons = 0;
let totalSavedSelections = 0;
let totalSavedRawMarkets = 0;
let failedBatches = 0;

console.log("A recolher " + gameIds.length + " jogos comuns em lotes de " + batchSize + "...");

for (let offset = 0; offset < gameIds.length; offset += batchSize) {
  const batchIds = gameIds.slice(offset, offset + batchSize);
  const batchNumber = Math.floor(offset / batchSize) + 1;
  console.log("\nLote " + batchNumber + " — " + batchIds.length + " jogos...");

  try {
    const [bantu, elephant] = await Promise.all([
      collectSwarm({ ...SWARM_BOOKMAKERS.bantu, gameIds: batchIds, timeoutMs: 60000 }),
      collectSwarm({ ...SWARM_BOOKMAKERS.elephant, gameIds: batchIds, timeoutMs: 60000 })
    ]);

    if (!bantu.received || !elephant.received) {
      throw new Error("Uma das casas não devolveu a recolha completa deste lote.");
    }

    // Keep the same ID and payload if the HTTP request must be replayed.
    const batchId = randomUUID();
    const payload = JSON.stringify({ batchId, bantu, elephant });
    let result = null;
    let lastIngestError = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch(ingestUrl, {
          method: "POST",
          headers: requestHeaders,
          body: payload,
          signal: AbortSignal.timeout(90000)
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.ok) {
          const summary = body.error || body.message || "A nuvem não confirmou a gravação.";
          const detail = body.detail ? ` | Detalhe: ${body.detail}` : "";
          const code = body.code ? ` | Código: ${body.code}` : "";
          const error = new Error(`${summary} (HTTP ${response.status})${detail}${code}`);
          error.status = response.status;
          if (response.status < 500 || attempt === 2) throw error;
          lastIngestError = error;
        } else {
          result = body;
          break;
        }
      } catch (error) {
        if (error.status && error.status < 500) throw error;
        lastIngestError = error;
        if (attempt === 2) throw error;
      }

      console.warn("A ingestão falhou; repetição segura do mesmo lote (" + (attempt + 1) + "/2):", lastIngestError?.message || "erro de rede");
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    if (!result) throw lastIngestError || new Error("A nuvem não confirmou a gravação após a repetição.");

    totalSavedGames += Number(result.savedGames || 0);
    totalSavedComparisons += Number(result.savedComparisons || 0);
    totalSavedSelections += Number(result.savedSelections || 0);
    totalSavedRawMarkets += Number(result.savedRawMarkets || 0);
    console.log("Guardado:", result.savedGames, "jogos;", result.savedRawMarkets, "mercados brutos;", result.savedSelections, "selecções comparáveis.");
  } catch (error) {
    failedBatches++;
    console.error("Falha no lote " + batchNumber + ":", error.message);
  }
}

console.log("\nRECOLHA TERMINADA");
console.log(JSON.stringify({
  discovered: { bantu: discovered.bantu.gamesFound, elephant: discovered.elephant.gamesFound },
  commonGames: gameIds.length,
  savedGames: totalSavedGames,
  savedComparisons: totalSavedComparisons,
  savedSelections: totalSavedSelections,
  savedRawMarkets: totalSavedRawMarkets,
  failedBatches
}, null, 2));

if (dryRun) {
  console.log("\\nANÁLISE NÃO INICIADA: modo --dry-run activo.");
} else if (!sportApiDiscoveryOk || failedBatches > 0 || totalSavedComparisons < 35) {
  console.error("\nANÁLISE NÃO INICIADA");
  console.error("A descoberta SportAPI falhou, a recolha ficou incompleta ou foram guardadas menos de 35 comparações entre as duas casas.");
  console.error("Não serão criados bilhetes com uma amostra insuficiente. Corrige a ligação e executa novamente.");
  process.exitCode = 1;
} else {
console.log("\nA iniciar análise e elaboração dos bilhetes...");
try {
  let pipeline = null;
  const maxAnalysisBatches = 10;
  for (let attempt = 1; attempt <= maxAnalysisBatches; attempt++) {
    pipeline = await post("/api/pipeline/run-daily", {
      skipDiscovery: true,
      discovered: sportApiDiscovered,
      dryRun
    }, 240000);
    console.log("\nETAPA DE ANÁLISE " + attempt);
    console.log(JSON.stringify(pipeline, null, 2));
    if (pipeline.stage !== "analysis-batch-saved" || Number(pipeline.pendingMatches || 0) <= 0) break;
  }
  if (pipeline?.stage === "analysis-batch-saved" && Number(pipeline.pendingMatches || 0) > 0) {
    throw new Error("O limite de lotes foi atingido; ainda existem jogos por analisar.");
  }
} catch (error) {
  console.error("Os dados foram enviados; a análise/publicação não terminou:", error.message);
  process.exitCode = 1;
}
}
