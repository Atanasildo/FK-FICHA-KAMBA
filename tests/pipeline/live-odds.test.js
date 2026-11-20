import test from "node:test";
import assert from "node:assert/strict";
import { swarmGameId, ticketHouse, computeOddUpdates, totalFromLegs } from "../../lib/pipeline/live-odds.js";

const game = { markets: [{ selections: [{ id: "11", odd: 1.5 }, { id: "12", odd: 2.234 }] }] };

test("swarmGameId lê o número final do external_id", () => {
  assert.equal(swarmGameId("vascodagama-internacional-1994586"), "1994586");
  assert.equal(swarmGameId("sem-numero"), null);
});

test("ticketHouse usa o site da reserva e depois o título", () => {
  assert.equal(ticketHouse({ booking_reference: JSON.stringify({ site: "elephant" }) }), "elephant");
  assert.equal(ticketHouse({ title: "Boletim 01 · BantuBet · 25x" }), "bantu");
  assert.equal(ticketHouse({ title: "x" }), null);
});

test("selecção ausente do jogo fica suspensa e a presente recebe a odd actual", () => {
  const ticket = { ticket_legs: [{ id: "a", selection_id: "11" }, { id: "b", selection_id: "99" }, { id: "c", selection_id: null }] };
  const out = computeOddUpdates({ ticket, game, checkedAt: "t" });
  assert.deepEqual(out.map(o => [o.id, o.current_odd, o.odd_state]), [["a", 1.5, "open"], ["b", null, "suspended"]]);
});

test("sem jogo recolhido não se altera nada", () => {
  assert.deepEqual(computeOddUpdates({ ticket: { ticket_legs: [{ id: "a", selection_id: "11" }] }, game: null, checkedAt: "t" }), []);
});

test("total actual só existe com todas as pernas abertas", () => {
  const legs = [{ id: "a", current_odd: 2 }, { id: "b", current_odd: null }];
  assert.equal(totalFromLegs(legs, new Map([["b", { current_odd: 1.5 }]])), 3);
  assert.equal(totalFromLegs(legs, new Map([["b", { current_odd: null }]])), null);
});
