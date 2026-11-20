import test from "node:test";
import assert from "node:assert/strict";
import { syncLiveGames } from "../../lib/pipeline/live-games.js";

const NOW = Date.parse("2026-11-20T15:00:00Z");
function fakeDb(open = []) {
  const state = { upserts: [], deletes: [] };
  return {
    state,
    from() {
      return {
        upsert: async (rows) => { state.upserts.push(...[].concat(rows)); return { error: null }; },
        select: () => ({ is: async () => ({ data: open, error: null }) }),
        delete: () => ({ lt: async (c, v) => { state.deletes.push([c, v]); return { error: null }; } })
      };
    }
  };
}
const game = (id, status, extra = {}) => ({ id, home_team: "A" + id, away_team: "B" + id, kickoff_at: "2026-11-20T14:00:00Z", status, home_score: 1, away_score: 0, minute: 30, competition: "Liga X", country: "Angola", ...extra });

test("grava todos os jogos ao vivo com a competição", async () => {
  const db = fakeDb();
  const r = await syncLiveGames({ db, liveList: [game("1", "1H"), game("2", "2H")], getJson: async () => { throw new Error("não devia pedir"); }, now: NOW, pause: async () => {} });
  assert.equal(r.live, 2);
  assert.deepEqual(db.state.upserts.map(x => [x.sofascore_id, x.competition, x.finished_at]), [["1", "Liga X", null], ["2", "Liga X", null]]);
  assert.equal(db.state.deletes.length, 1);
});

test("jogo que saiu da lista é confirmado e fica terminado", async () => {
  const db = fakeDb([{ sofascore_id: "7", home_team: "C", away_team: "D" }]);
  const finished = { id: 7, homeTeam: { name: "C" }, awayTeam: { name: "D" }, startTimestamp: NOW / 1000 - 7200,
    status: { type: "finished", description: "Ended" }, homeScore: { current: 2 }, awayScore: { current: 2 }, tournament: { name: "Copa", category: { name: "Brasil" } } };
  const calls = [];
  const r = await syncLiveGames({ db, liveList: [], getJson: async p => { calls.push(p); return { event: finished }; }, now: NOW, pause: async () => {} });
  assert.deepEqual(calls, ["/event/7"]);
  assert.equal(r.finalized, 1);
  const row = db.state.upserts[0];
  assert.equal(row.status, "FT"); assert.equal(row.home_score, 2); assert.equal(row.competition, "Copa"); assert.equal(row.country, "Brasil");
  assert.ok(row.finished_at);
});

test("jogo que continua na lista não é pedido de novo", async () => {
  const db = fakeDb([{ sofascore_id: "1", home_team: "A1", away_team: "B1" }]);
  await syncLiveGames({ db, liveList: [game("1", "2H")], getJson: async () => { throw new Error("não devia pedir"); }, now: NOW, pause: async () => {} });
});

import { enrichLiveGames } from "../../lib/pipeline/live-games.js";

function enrichDb(rows) {
  const updates = [];
  return {
    updates,
    from: () => ({
      select: async () => ({ data: rows, error: null }),
      update: patch => ({ eq: async (_c, id) => { updates.push({ id, patch }); return { error: null }; } })
    })
  };
}
const statsPayload = { statistics: [{ period: "ALL", groups: [{ statisticsItems: [{ name: "Total shots", homeValue: 5, awayValue: 2 }] }] }] };

test("detalhes: respeita o orçamento e dá prioridade a terminados e nunca consultados", async () => {
  const old = new Date(NOW - 10 * 60000).toISOString();
  const db = enrichDb([
    { sofascore_id: "a", home_team: "A", away_team: "A", finished_at: null, details_at: old },
    { sofascore_id: "b", home_team: "B", away_team: "B", finished_at: null, details_at: null },
    { sofascore_id: "c", home_team: "C", away_team: "C", finished_at: new Date(NOW - 60000).toISOString(), details_at: old },
    { sofascore_id: "d", home_team: "D", away_team: "D", finished_at: null, details_at: new Date(NOW - 1000).toISOString() }
  ]);
  const calls = [];
  const r = await enrichLiveGames({ db, getJson: async p => { calls.push(p); return p.endsWith("statistics") ? statsPayload : { incidents: [] }; }, now: NOW, budget: 2, pause: async () => {} });
  assert.equal(r.updated, 2);
  assert.deepEqual(db.updates.map(u => u.id), ["c", "b"]);
  assert.equal(db.updates[0].patch.stats.home.shots, 5);
  assert.equal("events" in db.updates[0].patch, false);
  assert.equal(calls.length, 4);
});
