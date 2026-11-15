import { randomUUID } from "node:crypto";
import {
  collectSwarm,
  discoverSwarmGames,
  SWARM_BOOKMAKERS
} from "../lib/bookmakers/swarm.js";
import { selectCommonSwarmGames } from "../lib/bookmakers/daily-swarm.js";

const dryRun = process.argv.includes("--dry-run");
const maxGamesArg = process.argv.find(arg => arg.startsWith("--max-games="));
const maxGames = Number(maxGamesArg?.split("=")[1] ?? process.env.FK_MAX_GAMES ?? 1);
if (!Number.isInteger(maxGames) || maxGames < 1 || maxGames > 50) {
  console.error("FK_MAX_GAMES/--max-games deve ser um número inteiro entre 1 e 50.");
  process.exit(1);
}
const baseUrl = (process.env.FK_API_URL || "").replace(/\/$/, "");
const ingestUrl = process.env.FK_INGEST_URL || (baseUrl ? baseUrl + "/api/bookmakers/save-comparison" : "");
const secret = process.env.CRON_SECRET;
const vercelBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (!dryRun && !ingestUrl) {
  console.error("Falta definir FK_API_URL para escolher explicitamente o ambiente de destino. Por segurança, não será usada Production por defeito.");
  process.exit(1);
}
if (!dryRun && !secret) {
  console.error("Falta definir a variável CRON_SECRET no ambiente deste computador.");
  process.exit(1);
}
if (!dryRun && !vercelBypass) {
  console.error("Falta definir VERCEL_AUTOMATION_BYPASS_SECRET para aceder à Preview protegida da Vercel.");
  process.exit(1);
}

const requestHeaders = {
  "content-type": "application/json",
  authorization: "Bearer " + secret,
  "x-vercel-protection-bypass": vercelBypass
};

if (dryRun) console.log("MODO DE TESTE: os jogos serão recolhidos, mas nada será enviado para o Supabase.");

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

const commonPairs = selectCommonSwarmGames(
  discovered.bantu.games,
  discovered.elephant.games,
  { maxGames: 1500, maxKickoffDifferenceSeconds: 90 * 60, onlyToday: true }
);
const bantuById = new Map(discovered.bantu.games.map(game => [String(game.id), game]));
const elephantById = new Map(discovered.elephant.games.map(game => [String(game.id), game]));
const eligiblePairs = commonPairs.map(pair => ({
  pair,
  bantu: bantuById.get(pair.bantuId),
  elephant: elephantById.get(pair.elephantId)
})).filter(item => item.bantu && item.elephant);

const pairsToCollect = eligiblePairs.slice(0, maxGames);

console.log("Jogos comuns BantuBet/ElephantBet:", commonPairs.length);
console.log("A SportAPI não é necessária para esta recolha.");
console.log("Limite configurado:", maxGames, "par(es).");
console.log("A recolher:", pairsToCollect.length, "pares de jogos comuns.");

if (!pairsToCollect.length) {
  console.error("Não foram encontrados jogos comuns inequívocos entre as duas casas. Nenhuma odd será guardada.");
  process.exit(1);
}

const batchSize = 1;
let totalSavedGames = 0;
let totalSavedComparisons = 0;
let totalSavedSelections = 0;
let totalSavedRawMarkets = 0;
let failedBatches = 0;

console.log("A recolher os dois IDs independentes em lotes de " + batchSize + "...");

for (let offset = 0; offset < pairsToCollect.length; offset += batchSize) {
  const batch = pairsToCollect.slice(offset, offset + batchSize);
  const batchNumber = Math.floor(offset / batchSize) + 1;
  const item = batch[0];
  console.log("\nLote " + batchNumber + " — " + item.bantu.home + " x " + item.bantu.away + "...");

  try {
    const [bantu, elephant] = await Promise.all([
      collectSwarm({ ...SWARM_BOOKMAKERS.bantu, gameIds: [String(item.bantu.id)], timeoutMs: 60000 }),
      collectSwarm({ ...SWARM_BOOKMAKERS.elephant, gameIds: [String(item.elephant.id)], timeoutMs: 60000 })
    ]);

    if (!bantu.received || !elephant.received) {
      throw new Error("Uma das casas não devolveu a recolha completa deste jogo.");
    }

    if (dryRun) {
      console.log("Teste concluído para este jogo; envio ao Supabase ignorado.");
      continue;
    }

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
          const detail = body.detail ? " | Detalhe: " + body.detail : "";
          const error = new Error(summary + " (HTTP " + response.status + ")" + detail);
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
    console.log("Guardado:", result.savedGames, "jogo comum;", result.savedRawMarkets, "mercados brutos;", result.savedSelections, "selecções equivalentes.");
  } catch (error) {
    failedBatches++;
    console.error("Falha no lote " + batchNumber + ":", error.message);
  }
}

console.log("\nRECOLHA TERMINADA");
console.log(JSON.stringify({
  discovered: { bantu: discovered.bantu.gamesFound, elephant: discovered.elephant.gamesFound },
  commonGames: pairsToCollect.length,
  savedGames: totalSavedGames,
  savedComparisons: totalSavedComparisons,
  savedSelections: totalSavedSelections,
  savedRawMarkets: totalSavedRawMarkets,
  failedBatches
}, null, 2));

if (dryRun) {
  console.log("\nMODO DE TESTE: nenhuma odd foi enviada e nenhuma análise/bilhete foi criada.");
} else {
  console.log("\nRECOLHA CONCLUÍDA. As odds estão guardadas no Supabase.");
  console.log("A análise será iniciada manualmente aqui no ChatGPT, quando o utilizador pedir.");
}
