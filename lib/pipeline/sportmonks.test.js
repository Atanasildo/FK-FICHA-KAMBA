import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSportmonksFixture } from "./sportmonks.js";

test("normaliza fixture Sportmonks para o formato interno do FK", () => {
  const fixture = {
    id: 9001,
    starting_at: "2026-11-17T17:00:00Z",
    state: { short_name: "2H", developer_name: "INPLAY_2ND_HALF" },
    participants: [
      { id: 10, name: "Togo", meta: { location: "home" } },
      { id: 20, name: "Argélia", meta: { location: "away" } }
    ],
    scores: [
      { description: "CURRENT", score: { participant: "home", goals: 1 } },
      { description: "CURRENT", score: { participant: "away", goals: 2 } }
    ],
    events: [
      { type: { name: "Goal" }, participant_id: 20, minute: 61, player_name: "Player A" },
      { type: { name: "Yellowcard" }, participant_id: 10, minute: 70, player_name: "Player B" }
    ],
    statistics: [
      { participant_id: 10, type: { name: "Shots on Target" }, data: { value: 3 } },
      { participant_id: 20, type: { name: "Shots on Target" }, data: { value: 5 } },
      { participant_id: 10, type: { name: "Yellow Cards" }, data: { value: 1 } }
    ],
    periods: [{ ticking: true, minutes: 73 }]
  };
  const result = normalizeSportmonksFixture(fixture);
  assert.equal(result.id, 9001);
  assert.equal(result.home_team, "Togo");
  assert.equal(result.away_team, "Argélia");
  assert.equal(result.status, "2H");
  assert.equal(result.home_score, 1);
  assert.equal(result.away_score, 2);
  assert.equal(result.minute, 73);
  assert.equal(result.events[0].event_type, "goal");
  assert.equal(result.events[1].team_side, "home");
  assert.equal(result.statistics.home.shots_on_target, 3);
  assert.equal(result.statistics.away.shots_on_target, 5);
  assert.equal(result.statistics.home.yellow_cards, 1);
});

test("não aceita fixture sem participantes identificáveis", () => {
  assert.equal(normalizeSportmonksFixture({ id: 1, participants: [] }), null);
});

test("normaliza estados finais, adiados e cancelados", () => {
  const base = { participants: [{ id: 1, name: "A", meta: { location: "home" } }, { id: 2, name: "B", meta: { location: "away" } }] };
  assert.equal(normalizeSportmonksFixture({ ...base, state: { short_name: "FT" } }).status, "FT");
  assert.equal(normalizeSportmonksFixture({ ...base, state: { short_name: "POSTP" } }).status, "postponed");
  assert.equal(normalizeSportmonksFixture({ ...base, state: { short_name: "CANC" } }).status, "cancelled");
});
