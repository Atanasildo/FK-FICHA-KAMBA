import test from "node:test";
import assert from "node:assert/strict";
import { selectCommonSwarmGames } from "../../lib/bookmakers/daily-swarm.js";

test("selecciona apenas IDs comuns e jogos dentro da janela", () => {
  const bantu = [
    { id: "1", start_ts: 2000 },
    { id: "2", start_ts: 500, is_live: true },
    { id: "3", start_ts: 90000 },
    { id: "4", start_ts: 3000 }
  ];
  const elephant = [
    { id: "1", start_ts: 2000 },
    { id: "2", start_ts: 500, is_live: true },
    { id: "3", start_ts: 90000 }
  ];
  assert.deepEqual(selectCommonSwarmGames(bantu, elephant, {
    nowSeconds: 1000, lookbackSeconds: 100, horizonSeconds: 5000
  }), ["2", "1"]);
});

test("limita a quantidade de jogos solicitados", () => {
  const games = Array.from({ length: 5 }, (_, i) => ({ id: String(i), start_ts: 1100 + i }));
  assert.deepEqual(selectCommonSwarmGames(games, games, {
    nowSeconds: 1000, maxGames: 2, horizonSeconds: 5000
  }), ["0", "1"]);
});

test("mantém jogos em directo mesmo sem hora de início", () => {
  const games = [{ id: "live", is_live: true }];
  assert.deepEqual(selectCommonSwarmGames(games, games), ["live"]);
});
