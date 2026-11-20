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

import { sameFixturePair } from "../../lib/bookmakers/team-matching.js";

test("junta nomes abreviados ou em inglês/português sem aliases dedicados", () => {
  const pairs = [
    ["Atl. Madrid", "Atletico Madrid"],
    ["B. Dortmund", "Borussia Dortmund"],
    ["Nott'm Forest", "Nottingham Forest"],
    ["Wolves", "Wolverhampton Wanderers"],
    ["Alemanha", "Germany"]
  ];
  for (const [a, b] of pairs) {
    assert.equal(teamNameSimilarity(a, b) >= 0.7, true, `${a} ~ ${b}`);
  }
});

test("nunca mistura feminino, sub-21 ou reservas com a equipa principal", () => {
  assert.equal(teamsSameFixture("Barcelona", "Barcelona W"), false);
  assert.equal(teamsSameFixture("Barcelona Women", "Barcelona Feminino"), true);
  assert.equal(teamsSameFixture("Portugal", "Portugal U21"), false);
  assert.equal(teamsSameFixture("Portugal U21", "Portugal U-21"), true);
  assert.equal(teamsSameFixture("Real Madrid", "Real Madrid II"), false);
});

test("regra de recurso só vale com hora quase igual e outra equipa idêntica", () => {
  const a = { home: "Hoffenheim", away: "Bayern Munich" };
  const b = { home: "TSG Hoffenheim", away: "Bayern München" };
  assert.equal(sameFixturePair(a, b, { deltaSeconds: 0 }), true);
  assert.equal(sameFixturePair(a, b, { deltaSeconds: 30 * 60 }), false);
  const c = { home: "Arsenal", away: "Chelsea" };
  const d = { home: "Arsenal Tula", away: "Spartak" };
  assert.equal(sameFixturePair(c, d, { deltaSeconds: 0 }), false);
});

test("etiquetas das casas (Wom/Mulh, Reserves/Res, B/II) funcionam como marcadores", () => {
  assert.equal(teamsSameFixture("Arsenal (Mulh)", "Arsenal (Wom)"), true);
  assert.equal(teamsSameFixture("Arsenal (Wom)", "Arsenal"), false);
  assert.equal(teamsSameFixture("Almirante Brown (Reserves)", "Almirante Brown Res"), true);
  assert.equal(teamsSameFixture("Almirante Brown (Reserves)", "Almirante Brown"), false);
  assert.equal(teamsSameFixture("FC Hegelmann B", "FC Hegelmann II"), true);
  assert.equal(teamsSameFixture("FC Hegelmann B", "FC Hegelmann"), false);
  assert.equal(teamNameSimilarity("B. Dortmund", "Borussia Dortmund") >= 0.7, true);
});
