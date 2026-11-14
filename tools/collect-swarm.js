import { mkdir, writeFile } from "node:fs/promises";
import {
  collectSwarm,
  collectSwarmSports,
  discoverSwarmGames,
  SWARM_BOOKMAKERS
} from "../lib/bookmakers/swarm.js";

const [site, ...args] = process.argv.slice(2);
if (!["elephant", "bantu"].includes(site)) {
  console.error("Uso: node tools/collect-swarm.js <elephant|bantu> [--discover] [gameId ...]");
  process.exit(1);
}

const config = SWARM_BOOKMAKERS[site];
const discover = args.includes("--discover");
const ids = args.filter(arg => arg !== "--discover");
if (discover && ids.length) {
  console.error("Não combines --discover com IDs de jogos.");
  process.exit(1);
}

const result = discover
  ? await discoverSwarmGames({ ...config, sportId: 1, timeoutMs: 30000 })
  : ids.length
    ? await collectSwarm({ ...config, gameIds: ids, timeoutMs: 30000 })
    : await collectSwarmSports({ ...config, timeoutMs: 30000 });

const filename = site === "elephant" ? "elephant" : "bantu";
await mkdir("data/collections", { recursive: true });
const output = discover
  ? `${filename}-swarm-games.json`
  : ids.length
    ? `${filename}-swarm-odds.json`
    : `${filename}-swarm-sports.json`;

await writeFile(`data/collections/${output}`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  bookmaker: filename,
  output: `data/collections/${output}`,
  requested: result.requested ?? 0,
  received: result.received ?? result.gamesFound ?? result.length ?? 0,
  totalRecords: result.totalRecords ?? null,
  excludedRecords: result.excludedRecords ?? null,
  missing: result.missing ?? []
}, null, 2));
