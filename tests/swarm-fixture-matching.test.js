import test from "node:test";
import assert from "node:assert/strict";
import { teamNameSimilarity, teamsSameFixture } from "../lib/bookmakers/team-matching.js";
import { getSwarmMatchingDiagnostics, selectCommonSwarmGames } from "../lib/bookmakers/daily-swarm.js";

test("normaliza abreviações e nomes alternativos conhecidos", () => {
  assert.equal(teamsSameFixture("Man Utd", "Manchester United"), true);
  assert.equal(teamsSameFixture("Sporting CP", "Sporting Lisbon"), true);
  assert.equal(teamsSameFixture("Bayern München", "Bayern Munich"), true);
  assert.equal(teamsSameFixture("Vitória SC", "Vitoria SC"), true);
});

test("tolera pequenas diferenças de escrita sem aceitar clubes apenas parecidos", () => {
  assert.ok(teamNameSimilarity("Manchester United", "Manchester Utd") >= 0.72);
  assert.equal(teamsSameFixture("Arsenal", "Arsenal Tula"), false);
  assert.equal(teamsSameFixture("Real Madrid", "Real Sociedad"), false);
});

test("associa um jogo por equipa e horário, mesmo sem coincidência literal", () => {
  const nowSeconds = 1_800_000_000;
  const bantu = [{
    id: "b1", home: "Man Utd", away: "Chelsea FC",
    start_ts: nowSeconds + 4 * 60 * 60, is_live: false
  }];
  const elephant = [{
    id: "e1", home: "Manchester United", away: "Chelsea",
    start_ts: nowSeconds + 4 * 60 * 60 + 8 * 60, is_live: false
  }];
  const pairs = selectCommonSwarmGames(bantu, elephant, { nowSeconds, maxGames: 10 });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].bantuId, "b1");
  assert.equal(pairs[0].elephantId, "e1");
  assert.ok(pairs[0].matchingScore >= 0.72);
});

test("diagnóstico explica jogos fora da janela em vez de os contar como elegíveis", () => {
  const nowSeconds = 1_800_000_000;
  const diagnostics = getSwarmMatchingDiagnostics(
    [
      { id: "1", home: "A", away: "B", start_ts: nowSeconds + 2 * 60 * 60, is_live: false },
      { id: "2", home: "C", away: "D", start_ts: nowSeconds + 96 * 60 * 60, is_live: false }
    ],
    [],
    { nowSeconds }
  );
  assert.equal(diagnostics.bantu.discovered, 2);
  assert.equal(diagnostics.bantu.eligible, 1);
  assert.equal(diagnostics.bantu.beyond72Hours, 1);
});
