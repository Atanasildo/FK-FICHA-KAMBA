import { collectSwarm, SWARM_BOOKMAKERS } from "../lib/bookmakers/swarm.js";

function argument(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : "";
}

const gameId = String(argument("game-id") || "").trim();
const batchId = String(argument("batch-id") || "").trim();
const baseUrl = String(process.env.FK_API_URL || "").replace(/\/$/, "");
const ingestUrl = process.env.FK_INGEST_URL || (baseUrl ? baseUrl + "/api/bookmakers/save-comparison" : "");
const secret = process.env.CRON_SECRET;
const vercelBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (!/^\d+$/.test(gameId)) {
  console.error("Uso: node tools/recover-swarm-game.js --game-id ID --batch-id UUID");
  process.exit(1);
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batchId)) {
  console.error("O batch-id deve ser um UUID válido.");
  process.exit(1);
}
if (!baseUrl || !ingestUrl) {
  console.error("Define FK_API_URL e FK_INGEST_URL para a Preview antes de executar.");
  process.exit(1);
}
const target = new URL(ingestUrl);
if (target.hostname === "fk-ficha-kamba.vercel.app" || target.hostname === "www.fk-ficha-kamba.vercel.app") {
  console.error("Bloqueado: este script de recuperação não pode enviar dados para Produção.");
  process.exit(1);
}
if (!secret || !vercelBypass) {
  console.error("Faltam credenciais no ambiente. Confirma as variáveis sem mostrar os seus valores.");
  process.exit(1);
}

const headers = {
  "content-type": "application/json",
  authorization: "Bearer " + secret,
  "x-vercel-protection-bypass": vercelBypass
};

console.log("Recuperação isolada do jogo", gameId);
console.log("Destino:", target.hostname);
console.log("A recolher novamente apenas este jogo nas duas casas...");

const [bantu, elephant] = await Promise.all([
  collectSwarm({ ...SWARM_BOOKMAKERS.bantu, gameIds: [gameId], timeoutMs: 60000 }),
  collectSwarm({ ...SWARM_BOOKMAKERS.elephant, gameIds: [gameId], timeoutMs: 60000 })
]);

if (!bantu.received || !elephant.received ||
    bantu.games.length !== 1 || elephant.games.length !== 1) {
  throw new Error("Uma das casas não devolveu o jogo solicitado. Nada foi enviado à Supabase.");
}

const payload = JSON.stringify({ batchId, bantu, elephant });
const rawMarkets = [...bantu.games, ...elephant.games]
  .reduce((sum, game) => sum + (game.markets || []).reduce(
    (count, market) => count + (market.selections || []).length, 0
  ), 0);

console.log("BantuBet:", bantu.games[0].markets.length, "mercados;");
console.log("ElephantBet:", elephant.games[0].markets.length, "mercados;");
console.log("Selecções brutas:", rawMarkets);
console.log("A enviar com o batchId existente para actualizar apenas as chaves deste jogo...");

let lastError = null;
for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    const response = await fetch(ingestUrl, {
      method: "POST",
      headers,
      body: payload,
      signal: AbortSignal.timeout(55000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      const detail = result.detail ? " | " + result.detail : "";
      throw new Error((result.error || `HTTP ${response.status}`) + detail);
    }
    console.log("RECUPERAÇÃO CONCLUÍDA");
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.error("Tentativa " + attempt + "/2 falhou:", error.message);
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

console.error("A recuperação não foi confirmada:", lastError?.message || "erro desconhecido");
process.exitCode = 1;
