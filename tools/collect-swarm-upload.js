import {
  collectSwarm,
  discoverSwarmGames,
  SWARM_BOOKMAKERS
} from "../lib/bookmakers/swarm.js";
import { selectCommonSwarmGames } from "../lib/bookmakers/daily-swarm.js";

const baseUrl = (process.env.FK_API_URL || "https://fk-ficha-kamba.vercel.app").replace(/\/$/, "");
const ingestUrl = process.env.FK_INGEST_URL || baseUrl + "/api/bookmakers/save-comparison";
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error("Falta definir a variável CRON_SECRET no ambiente deste computador.");
  process.exit(1);
}

async function post(path, body, timeout = 90000) {
  const response = await fetch(baseUrl.replace(/\/$/, "") + path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + secret },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    throw new Error(result.error || result.detail || `HTTP ${response.status}`);
  }
  return result;
}

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
try {
  const discovery = await post("/api/pipeline/discover-fixtures", { days: 4 });
  console.log("Calendário SportAPI:", discovery.fixturesDiscovered, "jogos encontrados.");
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

    const response = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + secret
      },
      body: JSON.stringify({ bantu, elephant }),
      signal: AbortSignal.timeout(90000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      throw new Error(result.error || result.detail || "A nuvem não confirmou a gravação.");
    }

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

console.log("\nA iniciar análise e elaboração dos bilhetes...");
try {
  let pipeline = null;
  const maxAnalysisBatches = 10;
  for (let attempt = 1; attempt <= maxAnalysisBatches; attempt++) {
    pipeline = await post("/api/pipeline/run-daily", {}, 240000);
    console.log("\\nETAPA DE ANÁLISE " + attempt);
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
