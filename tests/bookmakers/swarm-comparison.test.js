import test from "node:test";
import assert from "node:assert/strict";
import { compareSwarmCollections } from "../../lib/bookmakers/swarm-comparison.js";

const collection = (games, extra = {}) => ({
  collectionStartedAt: "2026-11-12T10:48:00.000Z",
  collectedAt: "2026-11-12T10:48:02.000Z",
  received: games.length,
  games,
  ...extra
});
const game = (id, markets, extra = {}) => ({
  id, home: "Eslovênia", away: "Suíça", start_ts: 1794500000,
  receivedAt: "2026-11-12T10:48:01.000Z", markets, ...extra
});
const market = (id, type, name, selections, base = null) => ({ id, type, name, base, selections });
const selection = (id, name, odd) => ({ id, name, odd, receivedAt: "2026-11-12T10:48:01.000Z" });

test("compara ficheiros Swarm nativos por ID de jogo e selecção equivalente", () => {
  const bantu = collection([game("123", [market("m1", "TotalGoals", "Total de Golos (Faixa de Golos)", [
    selection("s1", "7 ou Mais", 12.63)
  ])])]);
  const elephant = collection([game("123", [market("m1", "TotalGoals", "Total de Golos (Faixa de Golos)", [
    selection("s1", "7 ou Mais", 51)
  ])])]);
  const result = compareSwarmCollections({ bantu, elephant });
  assert.equal(result.collection.commonGameCount, 1);
  assert.equal(result.comparisonCount, 1);
  assert.equal(result.events[0].comparisons[0].bestBookmaker, "ElephantBet");
  assert.equal(result.events[0].comparisons[0].bestOdds, 51);
});

test("não compara jogos que não existem nas duas recolhas", () => {
  const bantu = collection([game("123", [market("m1", "TotalGoals", "Total de Golos", [selection("s1", "7 ou Mais", 12)])])]);
  const elephant = collection([game("456", [market("m1", "TotalGoals", "Total de Golos", [selection("s1", "7 ou Mais", 51)])])]);
  const result = compareSwarmCollections({ bantu, elephant });
  assert.equal(result.collection.commonGameCount, 0);
  assert.equal(result.comparisonCount, 0);
});

test("preserva type e base para não misturar mercados com o mesmo nome", () => {
  const bantu = collection([game("123", [
    market("m1", "TotalGoals", "Total", [selection("s1", "7 ou Mais", 12)], null),
    market("m2", "TeamTotalGoals", "Total", [selection("s1", "7 ou Mais", 12)], 1)
  ])]);
  const elephant = collection([game("123", [
    market("m1", "TotalGoals", "Total", [selection("s1", "7 ou Mais", 51)], null),
    market("m2", "TeamTotalGoals", "Total", [selection("s1", "7 ou Mais", 51)], 1)
  ])]);
  const result = compareSwarmCollections({ bantu, elephant });
  assert.equal(result.comparisonCount, 2);
});

test("rejeita recolha sem lista de jogos", () => {
  assert.throws(() => compareSwarmCollections({ bantu: {}, elephant: { games: [] } }), /BantuBet/);
});
