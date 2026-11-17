import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLiveStats } from "./normalize.js";
import { normalizeSwarmLiveGame } from "./live-stats.js";

test("normaliza estatísticas casa/visitante apenas quando os dois valores estão disponíveis", () => {
  const result = normalizeLiveStats({
    shot_on_target: [5, 3],
    corner: { home: 4, away: 2 },
    yellow_card: "1:2",
    dangerous_attack: 17
  });
  assert.deepEqual(result.home, {
    shots_on_target: 5,
    corners: 4,
    yellow_cards: 1
  });
  assert.deepEqual(result.away, {
    shots_on_target: 3,
    corners: 2,
    yellow_cards: 2
  });
  assert.equal(result.raw.dangerous_attack, 17);
});

test("não inventa pares casa/visitante para valores escalares ou formatos desconhecidos", () => {
  const result = normalizeLiveStats({ shot_on_target: 8, mystery_stat: [2, 3] });
  assert.deepEqual(result.home, {});
  assert.deepEqual(result.away, {});
  assert.equal(result.raw.shot_on_target, 8);
});

test("normaliza jogo Swarm com marcador, relógio, período e estatísticas", () => {
  const game = normalizeSwarmLiveGame({
    id: 123,
    team1_name: "Equipa Casa",
    team2_name: "Equipa Visitante",
    start_ts: 1794931200,
    is_live: 1,
    info: { score1: 2, score2: 1, current_game_time: "67:12", current_game_state: "2nd half" },
    stats: { shot_on_target: [6, 4], corner: [3, 5] },
    live_events: [{ type: "goal", minute: 65, player: "Jogador" }]
  }, "123", "ElephantBet");

  assert.equal(game.id, "123");
  assert.equal(game.status, "live");
  assert.equal(game.home_score, 2);
  assert.equal(game.away_score, 1);
  assert.equal(game.minute, "67");
  assert.equal(game.statistics.home.shots_on_target, 6);
  assert.equal(game.statistics.away.corners, 5);
  assert.equal(game.events[0].event_type, "goal");
  assert.equal(game.bookmaker, "ElephantBet");
});
