import test from "node:test";
import assert from "node:assert/strict";
import { settleFinishedLegs, isSettleableMarket } from "../../lib/pipeline/settlement.js";

function fakeDb(lines = {}) {
  const updates = [];
  return {
    updates,
    from(table) {
      if (table === "markets") {
        return { select: () => ({ in: async (_c, ids) => ({ data: ids.map(id => ({ id, line: lines[id] ?? null })), error: null }) }) };
      }
      return {
        update: patch => ({ eq: (_c, id) => ({ eq: async (_c2, cur) => { updates.push({ id, patch, cur }); return { error: null }; } }) })
      };
    }
  };
}
const match = { id: "m1", home_team: "Casa", away_team: "Fora" };
const ft = (h, a, status = "FT") => ({ status, home_score: h, away_score: a });
const leg = (id, market_name, selection, extra = {}) => ({ id, match_id: "m1", market_id: "mk" + id, market_name, selection, result: "pending", ...extra });

test("liquida resultado, dupla chance, ambas marcam e golos em FT", async () => {
  const db = fakeDb({ mk4: "2.5" });
  const legs = [
    leg("1", "Resultado do Jogo", "W1"),
    leg("2", "Dupla Chance", "X2"),
    leg("3", "Ambas equipas marcarão", "Sim"),
    leg("4", "Total de golos no jogo", "Mais de")
  ];
  const n = await settleFinishedLegs({ db, match, legs, fixture: ft(2, 1) });
  assert.equal(n, 4);
  const by = Object.fromEntries(db.updates.map(u => [u.id, u.patch.result]));
  assert.deepEqual(by, { 1: "Ganha", 2: "Perdida", 3: "Ganha", 4: "Ganha" });
  assert.ok(db.updates.every(u => u.cur === "pending"));
});

test("não liquida jogos que ainda não estão em FT nem AET/PENS", async () => {
  for (const status of ["1H", "HT", "2H", "AET", "PENS", "NS"]) {
    const db = fakeDb();
    assert.equal(await settleFinishedLegs({ db, match, legs: [leg("1", "Resultado do Jogo", "W1")], fixture: ft(1, 0, status) }), 0);
    assert.equal(db.updates.length, 0);
  }
});

test("mercados fora da lista segura ficam pendentes", async () => {
  const db = fakeDb();
  const names = ["Golos na 1.ª parte", "Handicap asiático", "Resultado e total de golos", "Total de cartões amarelos", "Resultado exacto"];
  const legs = names.map((n, i) => leg(String(i), n, "Mais de"));
  assert.equal(await settleFinishedLegs({ db, match, legs, fixture: ft(3, 0) }), 0);
  assert.equal(isSettleableMarket("Total de golos no jogo"), true);
  assert.equal(isSettleableMarket("Total de golos na 1.ª parte"), false);
});

test("selecções já liquidadas ou de outro jogo são ignoradas; linha exacta devolve", async () => {
  const db = fakeDb({ mk1: "2", mk3: "2.5" });
  const legs = [
    leg("1", "Total de golos no jogo", "Mais de"),
    leg("2", "Resultado do Jogo", "W1", { result: "Ganha" }),
    leg("3", "Total de golos no jogo", "Menos", { match_id: "outro" })
  ];
  assert.equal(await settleFinishedLegs({ db, match, legs, fixture: ft(1, 1) }), 1);
  assert.equal(db.updates[0].patch.result, "Linha devolvida");
});
