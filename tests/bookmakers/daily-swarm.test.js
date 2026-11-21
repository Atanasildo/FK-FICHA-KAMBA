import test from "node:test";
import assert from "node:assert/strict";
import { selectCommonSwarmGames } from "../../lib/bookmakers/daily-swarm.js";

const fixture = (id, start_ts, home, away, extra = {}) => ({
  id, start_ts, home, away, ...extra
});

test("encontra o mesmo jogo mesmo quando os IDs das casas são diferentes", () => {
  const bantu = [fixture("bantu-100", 2000, "Sporting CP", "Benfica")];
  const elephant = [fixture("elephant-900", 2050, "Sporting CP", "Benfica")];
  const pairs = selectCommonSwarmGames(bantu, elephant, { nowSeconds: 1000, minKickoffLeadSeconds: 0, horizonSeconds: 5000 });
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
  assert.deepEqual(selectCommonSwarmGames(bantu, elephant, { nowSeconds: 1000, minKickoffLeadSeconds: 0, horizonSeconds: 5000 }), []);
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
  assert.deepEqual(selectCommonSwarmGames(bantu, elephant, { nowSeconds: 1000, minKickoffLeadSeconds: 0, horizonSeconds: 20000 }), []);
});

test("normaliza acentos e aceita diferença de início até 90 minutos", () => {
  const bantu = [fixture("b", 2000, "Futebol Clube do Porto", "Braga")];
  const elephant = [fixture("e", 2000 + 80 * 60, "Futebol Clube do Pôrto", "Braga")];
  const pairs = selectCommonSwarmGames(bantu, elephant, { nowSeconds: 1000, minKickoffLeadSeconds: 0, horizonSeconds: 20000 });
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
  assert.deepEqual(selectCommonSwarmGames(bantu, elephant, { nowSeconds: 1000, minKickoffLeadSeconds: 0, horizonSeconds: 5000 }), []);
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
  const pairs = selectCommonSwarmGames(bantu, elephant, { nowSeconds: 1000, minKickoffLeadSeconds: 0, maxGames: 2, horizonSeconds: 5000 });
  assert.deepEqual(pairs.map(pair => pair.bantuId), ["b-earlier", "b-middle"]);
});

test("não selecciona jogos em directo sem hora de início", () => {
  const games = [fixture("live", 2000, "Sporting", "Benfica", { is_live: true })];
  assert.deepEqual(selectCommonSwarmGames(games, games), []);
});

test("ignora jogos com menos de uma hora de antecedência por padrão", () => {
  const now = 1000;
  const bantu = [
    fixture("too-soon", now + 30 * 60, "Sporting", "Benfica"),
    fixture("eligible", now + 2 * 60 * 60, "Porto", "Braga")
  ];
  const elephant = [
    fixture("ele-too-soon", now + 30 * 60, "Sporting", "Benfica"),
    fixture("ele-eligible", now + 2 * 60 * 60 + 60, "Porto", "Braga")
  ];
  const pairs = selectCommonSwarmGames(bantu, elephant, { nowSeconds: now });
  assert.deepEqual(pairs.map(pair => pair.bantuId), ["eligible"]);
});

test("permite configurar explicitamente a antecedência mínima", () => {
  const now = 1000;
  const bantu = [fixture("b", now + 4 * 60 * 60, "Sporting", "Benfica")];
  const elephant = [fixture("e", now + 4 * 60 * 60, "Sporting", "Benfica")];
  const pairs = selectCommonSwarmGames(bantu, elephant, {
    nowSeconds: now,
    minKickoffLeadSeconds: 30 * 60
  });
  assert.equal(pairs.length, 1);
});

import { isVirtualSwarmGame } from "../../lib/bookmakers/daily-swarm.js";

test("jogos virtuais (SRL, eSoccer, Cyber) são reconhecidos e jogos reais não", () => {
  assert.equal(isVirtualSwarmGame({ home: "Groningen SRL", away: "NEC Nijmegen SRL" }), true);
  assert.equal(isVirtualSwarmGame({ home: "Arsenal (Esports)", away: "Chelsea (Esports)" }), true);
  assert.equal(isVirtualSwarmGame({ home: "Bayer 04 Leverkusen", away: "Eintracht Frankfurt" }), false);
  assert.equal(isVirtualSwarmGame({ home: "Real Madrid", away: "Barcelona" }), false);
});

test("jogos virtuais não ocupam vagas e o dia inteiro cabe quando o limite é alto", () => {
  const nowSeconds = 1_000_000;
  const mk = (id, home, away, offsetMin) => ({ id: String(id), home, away, start_ts: nowSeconds + 3600 + offsetMin * 60, is_live: false });
  const bantu = [], elephant = [];
  for (let i = 0; i < 30; i++) {
    bantu.push(mk(i, "Casa " + i + " FC", "Fora " + i + " FC", i * 20));
    elephant.push(mk(1000 + i, "Casa " + i + " FC", "Fora " + i + " FC", i * 20));
  }
  bantu.push(mk(900, "Groningen SRL", "NEC Nijmegen SRL", 5));
  elephant.push(mk(1900, "Groningen SRL", "NEC Nijmegen SRL", 5));
  const pairs = selectCommonSwarmGames(bantu, elephant, { nowSeconds, minKickoffLeadSeconds: 0, horizonSeconds: 48 * 3600, maxGames: 1500 });
  assert.equal(pairs.length, 30);
  assert.ok(!pairs.some(pair => /SRL/.test(pair.home)));
  assert.equal(Math.max(...pairs.map(pair => pair.bantuKickoff)), nowSeconds + 3600 + 29 * 20 * 60);
});

import { competitionPriority } from "../../lib/bookmakers/daily-swarm.js";
import { parseSwarmCompetitionTree } from "../../lib/bookmakers/swarm.js";

test("principais competições têm prioridade; feminino, jovens e reservas ficam para o fim", () => {
  const tier = (competition, extra = {}) => competitionPriority({ competition, ...extra });
  assert.equal(tier("UEFA Champions League"), 0);
  assert.equal(tier("Premier League", { region: "England" }), 0);
  assert.equal(tier("La Liga", { region: "Spain" }), 0);
  assert.equal(tier("Brasileirão Série A", { region: "Brazil" }), 0);
  assert.equal(tier("Championship", { region: "England" }), 1);
  assert.equal(tier("Segunda División", { region: "Spain" }), 1);
  assert.equal(tier("Division 3 Reserve League", { region: "Sweden" }), 3);
  assert.equal(tier("Premier League", { region: "England", home: "Arsenal Women", away: "Chelsea Women" }), 3);
  assert.equal(tier("FA Women's Super League", { region: "England" }), 3);
  assert.equal(tier("Liga Nacional", { region: "Guatemala" }), 2);
  assert.equal(tier(""), 2);
});

test("a ordem dos pares põe as principais competições antes das outras", () => {
  const nowSeconds = 1_000_000;
  const mk = (id, home, away, offsetMin, competition) => ({ id: String(id), home, away, competition, start_ts: nowSeconds + 3600 + offsetMin * 60, is_live: false });
  const bantu = [mk(1, "Aaa Town", "Bbb Town", 5, "Liga Nacional"), mk(2, "Arsenal", "Chelsea", 600, "Premier League"), mk(3, "Ccc FC", "Ddd FC", 10, "Division 3 Reserve League")];
  const elephant = [mk(11, "Aaa Town", "Bbb Town", 5, "Liga Nacional"), mk(12, "Arsenal", "Chelsea", 600, "Premier League"), mk(13, "Ccc FC", "Ddd FC", 10, "Division 3 Reserve League")];
  const pairs = selectCommonSwarmGames(bantu, elephant, { nowSeconds, minKickoffLeadSeconds: 0, horizonSeconds: 48 * 3600, maxGames: 1500 });
  assert.deepEqual(pairs.map(pair => pair.home), ["Arsenal", "Aaa Town", "Ccc FC"]);
  assert.equal(pairs[0].competition, "Premier League");
  const limited = selectCommonSwarmGames(bantu, elephant, { nowSeconds, minKickoffLeadSeconds: 0, horizonSeconds: 48 * 3600, maxGames: 1 });
  assert.equal(limited[0].home, "Arsenal");
});

test("parseSwarmCompetitionTree associa cada jogo à competição e à região", () => {
  const data = { sport: { 1: { region: {
    10: { name: "England", competition: { 100: { name: "Premier League", game: { 5001: { id: 5001 }, 5002: { id: 5002 } } } } },
    20: { name: "Spain", competition: { 200: { name: "La Liga", game: { 6001: { id: 6001 } } } } }
  } } } };
  const map = parseSwarmCompetitionTree(data, 1);
  assert.equal(map.size, 3);
  assert.deepEqual(map.get("5001"), { competition: "Premier League", region: "England" });
  assert.deepEqual(map.get("6001"), { competition: "La Liga", region: "Spain" });
  assert.equal(parseSwarmCompetitionTree({}, 1).size, 0);
});
