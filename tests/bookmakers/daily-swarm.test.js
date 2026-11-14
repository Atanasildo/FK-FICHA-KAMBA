import test from "node:test";
import assert from "node:assert/strict";
import { selectCommonSwarmGames } from "../../lib/bookmakers/daily-swarm.js";

const fixture = (id, start_ts, home, away, extra = {}) => ({
  id, start_ts, home, away, ...extra
});

test("encontra o mesmo jogo mesmo quando os IDs das casas são diferentes", () => {
  const bantu = [fixture("bantu-100", 2000, "Sporting CP", "Benfica")];
  const elephant = [fixture("elephant-900", 2050, "Sporting CP", "Benfica")];
  const pairs = selectCommonSwarmGames(bantu, elephant, { nowSeconds: 1000, horizonSeconds: 5000 });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].bantuId, "bantu-100");
  assert.equal(pairs[0].elephantId, "elephant-900");
});

test("exclui jogos marcados como live por qualquer uma das casas", () => {
  const bantu = [
    fixture("a", 2000, "Sporting", "Benfica"),
    fixture("b", 2100, "Porto", "Braga", { is_live: true })
  ];
  const elephant = [
    fixture("x", 2000, "Sporting", "Benfica", { is_live: true }),
    fixture("y", 2100, "Porto", "Braga")
  ];
  assert.deepEqual(selectCommonSwarmGames(bantu, elephant, { nowSeconds: 1000, horizonSeconds: 5000 }), []);
});

test("exclui equipas diferentes, ordem invertida e horários incompatíveis", () => {
  const bantu = [
    fixture("missing", 2000, "Sporting", "Benfica"),
    fixture("wrong-order", 2200, "Porto", "Braga"),
    fixture("wrong-time", 2300, "Boavista", "Farense")
  ];
  const elephant = [
    fixture("elephant-different-teams", 2000, "Benfica", "Sporting"),
    fixture("elephant-reversed", 2200, "Braga", "Porto"),
    fixture("elephant-wrong-time", 2300 + 4 * 60 * 60, "Boavista", "Farense")
  ];
  assert.deepEqual(selectCommonSwarmGames(bantu, elephant, { nowSeconds: 1000, horizonSeconds: 20000 }), []);
});

test("normaliza acentos e aceita diferença de início até 90 minutos", () => {
  const bantu = [fixture("b", 2000, "Futebol Clube do Porto", "Braga")];
  const elephant = [fixture("e", 2000 + 80 * 60, "Futebol Clube do Pôrto", "Braga")];
  const pairs = selectCommonSwarmGames(bantu, elephant, { nowSeconds: 1000, horizonSeconds: 20000 });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].bantuId, "b");
  assert.equal(pairs[0].elephantId, "e");
});

test("não escolhe automaticamente quando há dois candidatos temporais ambíguos", () => {
  const bantu = [fixture("b", 2000, "Sporting", "Benfica")];
  const elephant = [
    fixture("e1", 1900, "Sporting", "Benfica"),
    fixture("e2", 2100, "Sporting", "Benfica")
  ];
  assert.deepEqual(selectCommonSwarmGames(bantu, elephant, { nowSeconds: 1000, horizonSeconds: 5000 }), []);
});

test("ordena por hora de início e limita a quantidade", () => {
  const bantu = [
    fixture("b-later", 1300, "Porto", "Braga"),
    fixture("b-earlier", 1100, "Sporting", "Benfica"),
    fixture("b-middle", 1200, "Boavista", "Farense")
  ];
  const elephant = [
    fixture("e-later", 1300, "Porto", "Braga"),
    fixture("e-earlier", 1100, "Sporting", "Benfica"),
    fixture("e-middle", 1200, "Boavista", "Farense")
  ];
  const pairs = selectCommonSwarmGames(bantu, elephant, { nowSeconds: 1000, maxGames: 2, horizonSeconds: 5000 });
  assert.deepEqual(pairs.map(pair => pair.bantuId), ["b-earlier", "b-middle"]);
});

test("não selecciona jogos em directo sem hora de início", () => {
  const games = [fixture("live", 2000, "Sporting", "Benfica", { is_live: true })];
  assert.deepEqual(selectCommonSwarmGames(games, games), []);
});
