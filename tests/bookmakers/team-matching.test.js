import test from "node:test";
import assert from "node:assert/strict";
import {
  teamNameSimilarity,
  teamsSameFixture,
  selectUniqueTeamFixture
} from "../../lib/bookmakers/team-matching.js";

test("reconhece abreviaturas conhecidas sem depender dos IDs", () => {
  assert.equal(teamsSameFixture("PSG", "Paris Saint-Germain"), true);
  assert.equal(teamsSameFixture("Man Utd", "Manchester United"), true);
  assert.equal(teamsSameFixture("Man City", "Manchester City"), true);
  assert.equal(teamsSameFixture("Bayern München", "Bayern Munich"), true);
  assert.equal(teamsSameFixture("Spurs", "Tottenham Hotspur"), true);
  assert.equal(teamsSameFixture("Sporting CP", "Sporting Lisbon"), true);
});

test("não usa apenas iniciais ou prefixos para declarar equipas iguais", () => {
  assert.equal(teamsSameFixture("Aston Villa", "Atletico Valencia"), false);
  assert.equal(teamsSameFixture("Arsenal", "Arsenal Tula"), false);
  assert.equal(teamsSameFixture("Manchester United", "Manchester City"), false);
  assert.equal(teamNameSimilarity("Porto", "Portimonense") < 0.8, true);
});

test("associa apenas casa com casa e visitante com visitante", () => {
  const kickoff = "2026-11-15T18:00:00.000Z";
  const wanted = {
    id: "wanted",
    home_team: "Paris Saint-Germain",
    away_team: "Bayern Munich",
    kickoff_at: kickoff
  };
  const reversed = {
    id: "reversed",
    home_team: "Bayern Munich",
    away_team: "Paris Saint-Germain",
    kickoff_at: kickoff
  };
  assert.equal(
    selectUniqueTeamFixture("PSG", "Bayern München", kickoff, [reversed]),
    null
  );
  assert.equal(
    selectUniqueTeamFixture("PSG", "Bayern München", kickoff, [wanted]),
    wanted
  );
});

test("não escolhe automaticamente candidatos temporalmente ambíguos", () => {
  const kickoff = "2026-11-15T18:00:00.000Z";
  const first = {
    id: "one",
    home_team: "Manchester United",
    away_team: "Chelsea",
    kickoff_at: kickoff
  };
  const second = {
    ...first,
    id: "two",
    kickoff_at: "2026-11-15T18:05:00.000Z"
  };
  assert.equal(
    selectUniqueTeamFixture("Man Utd", "Chelsea", kickoff, [first, second]),
    null
  );
});
