import test from "node:test";
import assert from "node:assert/strict";
import { selectCommonSwarmGames } from "../../lib/bookmakers/daily-swarm.js";

test("selecciona apenas IDs comuns e jogos futuros dentro da janela", () => {
  const bantu = [
    { id: "1", start_ts: 2000 },
    { id: "2", start_ts: 500, is_live: true },
    { id: "3", start_ts: 90000 },
    { id: "4", start_ts: 3000 },
    { id: "5", start_ts: 2500 }
  ];
  const elephant = [
    { id: "1", start_ts: 2000 },
    { id: "2", start_ts: 500, is_live: true },
    { id: "3", start_ts: 90000 },
    { id: "5", start_ts: 2500 }
  ];
  assert.deepEqual(selectCommonSwarmGames(bantu, elephant, {
    nowSeconds: 1000, horizonSeconds: 5000
  }), ["1", "5"]);
});

test("exclui jogos marcados como live por qualquer uma das casas", () => {
  const bantu = [
    { id: "a", start_ts: 2000 },
    { id: "b", start_ts: 2100, is_live: true }
  ];
  const elephant = [
    { id: "a", start_ts: 2000, is_live: true },
    { id: "b", start_ts: 2100 }
  ];
  assert.deepEqual(selectCommonSwarmGames(bantu, elephant, {
    nowSeconds: 1000, horizonSeconds: 5000
  }), []);
});

test("exclui jogos sem hora válida ou com horas incompatíveis", () => {
  const bantu = [
    { id: "missing", start_ts: 2000 },
    { id: "mismatch", start_ts: 2000 },
    { id: "past", start_ts: 900 }
  ];
  const elephant = [
    { id: "mismatch", start_ts: 2000 + 4 * 60 * 60 },
    { id: "past", start_ts: 900 }
  ];
  assert.deepEqual(selectCommonSwarmGames(bantu, elephant, {
    nowSeconds: 1000, horizonSeconds: 5000
  }), []);
});

test("ordena por hora de início e limita a quantidade", () => {
  const games = [
    { id: "later", start_ts: 1300 },
    { id: "earlier", start_ts: 1100 },
    { id: "middle", start_ts: 1200 }
  ];
  assert.deepEqual(selectCommonSwarmGames(games, games, {
    nowSeconds: 1000, maxGames: 2, horizonSeconds: 5000
  }), ["earlier", "middle"]);
});

test("não selecciona jogos em directo sem hora de início", () => {
  const games = [{ id: "live", is_live: true }];
  assert.deepEqual(selectCommonSwarmGames(games, games), []);
});
