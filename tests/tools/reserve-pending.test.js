import test from "node:test";
import assert from "node:assert/strict";
import { pickReservable } from "../../tools/reserve-pending.js";

const now = Date.parse("2026-11-20T08:00:00Z");
const leg = (sid, ko) => ({ selection_id: sid, odd: 1.5, matches: { kickoff_at: ko } });
const future = "2026-11-20T12:00:00Z";

test("reserva boletins com selection_id e jogos futuros", () => {
  const r = pickReservable([{ id: "1", title: "FK · 25x–50x · BantuBet · 20/11/2026", ticket_legs: [leg("7455536947", future)] }], now);
  assert.equal(r.ready.length, 1);
  assert.equal(r.ready[0].site, "bantu");
});

test("salta boletins sem selection_id, com jogo iniciado, sem casa ou sem selecções", () => {
  const r = pickReservable([
    { id: "a", title: "FK · x · ElephantBet", ticket_legs: [leg(null, future)] },
    { id: "b", title: "FK · x · ElephantBet", ticket_legs: [leg("1", "2026-11-20T07:00:00Z")] },
    { id: "c", title: "FK · x · Outra", ticket_legs: [leg("1", future)] },
    { id: "d", title: "FK · x · BantuBet", ticket_legs: [] }
  ], now);
  assert.equal(r.ready.length, 0);
  assert.deepEqual(r.skipped.map(s => s.id), ["a", "b", "c", "d"]);
});
