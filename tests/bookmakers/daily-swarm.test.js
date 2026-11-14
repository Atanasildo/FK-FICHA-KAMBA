import test from "node:test";
import assert from "node:assert/strict";
import { selectCommonSwarmGames } from "../../lib/bookmakers/daily-swarm.js";

const fixture = (id, start_ts, extra = {}) => ({
  id, start_ts, home: "Sporting CP", away: "Benfica", ...extra
});

test("encontra o mesmo jogo mesmo quando os IDs das casas são diferentes", () => {
  const bantu = [fixture("bantu-100", 2000)];
  const elephant = [fixture("elephant-900", 2050)];
  const pairs = selectCommonSwarmGames(bantu, elephant, {
    nowSeconds: 1000, horizonSeconds: 5000
  });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].bantuId, "bantu-100");
  assert.equal(pairs[0].elephantId, "elephant-900");
  assert.equal(pairs[0].home, "Sporting CP");
  assert.equal(pairs[0].away, "Benfica");
});

test("exclui jogos marcados como live por qualquer uma das casas", () => {
  const bantu = [
    fixture("a", 2000),
    fixture("b", 2100, { is_live: true })
  ];
  const elephant = [
    fixture("x", 2000, { is_live: true }),
    fixture("y", 2100)
  ];
  assert.deepEqual(selectCommonSwarmGames(bantu, elephant, {
    nowSeconds: 1000, horizonSeconds: 5000
  }), []);
});

test("exclui equipas diferentes, ordem invertida e horários incompatíveis", () => {
  const bantu = [
    fixture("missing", 2000),
    fixture("wrong-order", 2200),
    fixture("wrong-time", 2300)
  ];
  const elephant = [
    fixture("missing", 2000, { home: "Porto", away: "Braga" }),
    fixture("wrong-order", 2200, { home: "Benfica", away: "Sporting CP" }),
    fixture("wrong-time", 2300 + 4 * 60 * 60)
  ];
  assert.deepEqual(selectCommonSwarmGames(bantu, elephant, {
    nowSeconds: 1000, horizonSeconds: 20000
  }), []);
});

test("normaliza acentos e limita a diferença de início a 90 minutos", () => {
  const bantu = [fixture("b", 2000, { home: "Futebol Clube do Porto" })];
  const elephant = [fixture("e", 2000 + 80 * 60, { home: "Futebol Clube do Pôrto" })];
  const pairs = selectCommonSwarmGames(bantu, elephant, {
    nowSeconds: 1000, horizonSeconds: 20000
  });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].bantuId, "b");
  assert.equal(pairs[0].elephantId, "e");
});

test("não escolhe automaticamente quando há dois candidatos temporais ambíguos", () => {
  const bantu = [fixture("b", 2000)];
  const elephant = [
    fixture("e1", 1900),
    fixture("e2", 2100)
  ];
  assert.deepEqual(selectCommonSwarmGames(bantu, elephant, {
    nowSeconds: 1000, horizonSeconds: 5000
  }), []);
});

test("ordena por hora de início e limita a quantidade", () => {
  const bantu = [
    fixture("b-later", 1300),
    fixture("b-earlier", 1100),
    fixture("b-middle", 1200)
  ];
  const elephant = [
    fixture("e-later", 1300),
    fixture("e-earlier", 1100),
    fixture("e-middle", 1200)
  ];
  const pairs = selectCommonSwarmGames(bantu, elephant, {
    nowSeconds: 1000, maxGames: 2, horizonSeconds: 5000
  });
  assert.deepEqual(pairs.map(pair => pair.bantuId), ["b-earlier", "b-middle"]);
});

test("não selecciona jogos em directo sem hora de início", () => {
  const games = [fixture("live", 2000, { is_live: true })];
  assert.deepEqual(selectCommonSwarmGames(games, games), []);
});
