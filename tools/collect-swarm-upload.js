import {
  collectSwarm,
  discoverSwarmGames,
  SWARM_BOOKMAKERS
} from "../lib/bookmakers/swarm.js";
import { selectCommonSwarmGames } from "../lib/bookmakers/daily-swarm.js";

const endpoint = process.env.FK_INGEST_URL || "https://fk-ficha-kamba.vercel.app/api/bookmakers/save-comparison";
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error("Falta definir a variável CRON_SECRET no ambiente deste computador.");
  process.exit(1);
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
  { maxGames: 5 }
);

if (!gameIds.length) {
  console.error("Não foram encontrados jogos comuns dentro da janela de recolha.");
  process.exit(1);
}

console.log("A recolher odds de " + gameIds.length + " jogos nas duas casas...");
const [bantu, elephant] = await Promise.all([
  collectSwarm({ ...SWARM_BOOKMAKERS.bantu, gameIds, timeoutMs: 60000 }),
  collectSwarm({ ...SWARM_BOOKMAKERS.elephant, gameIds, timeoutMs: 60000 })
]);

if (!bantu.received || !elephant.received) {
  console.error("Uma das casas não devolveu odds. Nada foi enviado.");
  process.exit(1);
}

console.log("A enviar os dados diretamente para a nuvem...");
const response = await fetch(endpoint, {
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
  console.error("A nuvem recusou ou não conseguiu guardar os dados:", JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log("\nRECOLHA CONCLUÍDA");
console.log(JSON.stringify(result, null, 2));
