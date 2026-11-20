import test from "node:test";
import assert from "node:assert/strict";
import { pickReservable, applyAction } from "../../api/bookmakers/reserve.js";

const now = Date.parse("2026-11-20T08:00:00Z");
const leg = (sid, ko) => ({ selection_id: sid, odd: 1.5, matches: { kickoff_at: ko } });
const future = "2026-11-20T12:00:00Z";

test("lista boletins com selection_id e jogos futuros", () => {
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

// Base de dados falsa mínima para o ciclo claim -> save / release.
function fakeDb(ticket) {
  const state = { ...ticket };
  const q = { _eq: [], _isnull: false };
  const builder = {
    select() { return builder; },
    eq(col, val) { q._eq.push([col, val]); return builder; },
    is() { q._isnull = true; return builder; },
    update(v) { q._update = v; return builder; },
    maybeSingle() {
      if (q._update) {
        const ok = q._eq.every(([c, v]) => state[c] === v) && (!q._isnull || state.booking_reference == null);
        if (ok) Object.assign(state, q._update);
        const out = { data: ok ? { id: state.id } : null, error: null };
        q._update = null; q._eq = []; q._isnull = false;
        return Promise.resolve(out);
      }
      q._eq = [];
      return Promise.resolve({ data: { ...state }, error: null });
    },
    then(resolve) { // update sem maybeSingle()
      if (q._update) { if (q._eq.every(([c, v]) => state[c] === v)) Object.assign(state, q._update); q._update = null; q._eq = []; }
      resolve({ error: null });
    }
  };
  return { from: () => builder, state };
}

test("claim -> save grava o código e o link da casa", async () => {
  const db = fakeDb({ id: "t1", title: "FK · x · BantuBet", status: "published", booking_reference: null });
  await applyAction(db, { action: "claim", ticketId: "t1" });
  const out = await applyAction(db, { action: "save", ticketId: "t1", bookingId: "1084699" });
  assert.equal(out.bookingId, "1084699");
  const ref = JSON.parse(db.state.booking_reference);
  assert.equal(ref.id, "1084699");
  assert.equal(ref.url, "https://m.bantubet.co.ao?bookingId=1084699");
});

test("não deixa gravar sem claim nem com bookingId inválido; claim duplicado dá 409", async () => {
  const db = fakeDb({ id: "t1", title: "FK · x · ElephantBet", status: "published", booking_reference: null });
  await assert.rejects(applyAction(db, { action: "save", ticketId: "t1", bookingId: "123456" }), /não está em processamento/);
  await applyAction(db, { action: "claim", ticketId: "t1" });
  await assert.rejects(applyAction(db, { action: "save", ticketId: "t1", bookingId: "abc" }), /inválido/);
  await assert.rejects(applyAction(db, { action: "claim", ticketId: "t1" }), e => e.status === 409);
  await applyAction(db, { action: "release", ticketId: "t1" });
  assert.equal(db.state.booking_reference, null);
});
