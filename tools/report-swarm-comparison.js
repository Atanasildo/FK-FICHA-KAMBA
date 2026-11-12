import { readFile, writeFile, mkdir } from "node:fs/promises";

const FILES = {
  bantu: "data/collections/bantu-swarm-odds.json",
  elephant: "data/collections/elephant-swarm-odds.json"
};
const LIMIT = 30;

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt");
}

async function load(file) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Não foi possível ler ${file}: ${error.message}`);
  }
  if (!Array.isArray(parsed.games)) {
    throw new Error(`Formato inválido em ${file}: campo "games" não encontrado.`);
  }
  return parsed;
}

function indexGames(collection, label) {
  const map = new Map();
  for (const game of collection.games) {
    const id = String(game.id ?? "");
    if (!id) throw new Error(`${label}: jogo sem ID.`);
    if (map.has(id)) throw new Error(`${label}: ID de jogo duplicado: ${id}`);
    map.set(id, game);
  }
  return map;
}

function buildIndex(game, label, gameId) {
  const map = new Map();
  for (const market of game.markets ?? []) {
    const marketKey = JSON.stringify([
      normalize(market.type),
      normalize(market.base),
      normalize(market.name)
    ]);
    if (map.has(marketKey)) {
      throw new Error(
        `${label}: mercado duplicado no jogo ${gameId}: ${market.name} [${market.type}]`
      );
    }

    const selections = new Map();
    for (const selection of market.selections ?? []) {
      const selectionKey = normalize(selection.name);
      if (!selectionKey) {
        throw new Error(`${label}: selecção sem nome no jogo ${gameId}, mercado ${market.name}`);
      }
      if (selections.has(selectionKey)) {
        throw new Error(
          `${label}: selecção duplicada "${selection.name}" no jogo ${gameId}, mercado ${market.name}`
        );
      }
      const odd = Number(selection.odd);
      if (!Number.isFinite(odd) || odd <= 1) {
        throw new Error(
          `${label}: odd inválida "${selection.odd}" no jogo ${gameId}, mercado ${market.name}, selecção ${selection.name}`
        );
      }
      selections.set(selectionKey, { ...selection, odd });
    }
    map.set(marketKey, { ...market, selections });
  }
  return map;
}

const [bantu, elephant] = await Promise.all([
  load(FILES.bantu),
  load(FILES.elephant)
]);
const bantuGames = indexGames(bantu, "BantuBet");
const elephantGames = indexGames(elephant, "ElephantBet");
const commonGameIds = [...bantuGames.keys()].filter(id => elephantGames.has(id));

if (!commonGameIds.length) {
  throw new Error("Não existem IDs de jogos comuns nos dois ficheiros.");
}

const rows = [];
let commonMarkets = 0;
let marketsOnlyBantu = 0;
let marketsOnlyElephant = 0;
let selectionsCompared = 0;
let oddsEqual = 0;
let bantuHigher = 0;
let elephantHigher = 0;
let selectionsOnlyBantu = 0;
let selectionsOnlyElephant = 0;

for (const gameId of commonGameIds) {
  const bg = bantuGames.get(gameId);
  const eg = elephantGames.get(gameId);
  const bm = buildIndex(bg, "BantuBet", gameId);
  const em = buildIndex(eg, "ElephantBet", gameId);

  for (const [key, market] of bm) {
    if (!em.has(key)) {
      marketsOnlyBantu++;
      continue;
    }
    const otherMarket = em.get(key);
    commonMarkets++;

    for (const [selectionKey, selection] of market.selections) {
      const other = otherMarket.selections.get(selectionKey);
      if (!other) {
        selectionsOnlyBantu++;
        continue;
      }

      selectionsCompared++;
      if (selection.odd === other.odd) {
        oddsEqual++;
        continue;
      }

      const higherBookmaker = selection.odd > other.odd ? "BantuBet" : "ElephantBet";
      const higher = Math.max(selection.odd, other.odd);
      const lower = Math.min(selection.odd, other.odd);
      if (higherBookmaker === "BantuBet") bantuHigher++;
      else elephantHigher++;

      rows.push({
        game: `${bg.home || eg.home} vs ${bg.away || eg.away}`,
        market: market.name,
        selection: selection.name,
        bantuOdd: selection.odd,
        elephantOdd: other.odd,
        best: higherBookmaker,
        absoluteDifference: Math.abs(selection.odd - other.odd),
        percentageDifference: (higher / lower - 1) * 100
      });
    }

    for (const selectionKey of otherMarket.selections.keys()) {
      if (!market.selections.has(selectionKey)) selectionsOnlyElephant++;
    }
  }

  for (const key of em.keys()) {
    if (!bm.has(key)) marketsOnlyElephant++;
  }
}

rows.sort((a, b) =>
  b.percentageDifference - a.percentageDifference ||
  b.absoluteDifference - a.absoluteDifference
);
const top = rows.slice(0, LIMIT);
const totalOdds = selectionsCompared || 1;
const pct = value => (value / totalOdds * 100).toFixed(2) + "%";
const fmt = value => Number(value).toFixed(2);

console.log("\n=== FK | TOP 30 DIFERENÇAS DE ODDS ===");
console.log("Ordenação: diferença percentual da odd maior sobre a menor.");
console.log(`Jogos comuns: ${commonGameIds.length}`);
console.log(`Mercados comuns: ${commonMarkets}`);
console.log(`Mercados exclusivos BantuBet: ${marketsOnlyBantu}`);
console.log(`Mercados exclusivos ElephantBet: ${marketsOnlyElephant}`);
console.log(`Selecções comparadas: ${selectionsCompared}`);
console.log(`Odds iguais: ${oddsEqual} (${pct(oddsEqual)})`);
console.log(`BantuBet com odd maior: ${bantuHigher} (${pct(bantuHigher)})`);
console.log(`ElephantBet com odd maior: ${elephantHigher} (${pct(elephantHigher)})`);
console.log(`Só BantuBet: ${selectionsOnlyBantu}; só ElephantBet: ${selectionsOnlyElephant}`);
console.log("\nTOP 30:");
console.table(top.map((r, i) => ({
  "#": i + 1,
  Jogo: r.game,
  Mercado: r.market,
  Selecção: r.selection,
  Bantu: fmt(r.bantuOdd),
  Elephant: fmt(r.elephantOdd),
  "Melhor odd": r.best,
  "Dif. odd": fmt(r.absoluteDifference),
  "Dif. %": r.percentageDifference.toFixed(2) + "%"
})));

const csvEscape = value => '"' + String(value ?? "").replace(/"/g, '""') + '"';
const csv = [
  ["Jogo", "Mercado", "Selecção", "Odd BantuBet", "Odd ElephantBet", "Melhor odd", "Diferença absoluta", "Diferença percentual"],
  ...top.map(r => [
    r.game, r.market, r.selection, r.bantuOdd, r.elephantOdd,
    r.best, r.absoluteDifference.toFixed(4), r.percentageDifference.toFixed(2) + "%"
  ])
].map(line => line.map(csvEscape).join(";")).join("\n");

await mkdir("data/collections", { recursive: true });
const output = "data/collections/swarm-comparison-top30.csv";
await writeFile(output, "\uFEFF" + csv, "utf8");
console.log(`\nCSV guardado em: ${output}`);
console.log("Nota: odd mais alta não significa, por si só, aposta de valor ou arbitragem.");
