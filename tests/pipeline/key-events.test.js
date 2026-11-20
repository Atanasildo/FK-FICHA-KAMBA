import test from "node:test";
import assert from "node:assert/strict";
import { summarizeKeyEvents } from "../../lib/pipeline/live-tickets.js";

test("mostra golos e expulsões, ignora amarelos e substituições", () => {
  const events = [
    { event_type: "yellow_card", player_name: "A", minute: 10, team_side: "home" },
    { event_type: "goal", player_name: "Silva", minute: 23, team_side: "home" },
    { event_type: "substitution", player_name: "B", minute: 60, team_side: "away" },
    { event_type: "red_card", player_name: "Costa", minute: 71, team_side: "away" },
    { event_type: "goal", player_name: "Reis", minute: "90", team_side: "weird" }
  ];
  assert.deepEqual(summarizeKeyEvents(events), [
    { type: "goal", minute: 23, player: "Silva", side: "home" },
    { type: "red_card", minute: 71, player: "Costa", side: "away" },
    { type: "goal", minute: 90, player: "Reis", side: null }
  ]);
  assert.deepEqual(summarizeKeyEvents(null), []);
});
