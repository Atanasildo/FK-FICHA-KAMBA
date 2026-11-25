import test from "node:test";
import assert from "node:assert/strict";
import { extract1x2, marketProbs, buildCandidates, collectSignals } from "../../lib/pipeline/consensus.js";

const q = (selection, bookmaker, odds, selectionId) => ({ selection, bookmaker, odds, selectionId });
const comparison = { events: [{ comparisons: [{ market: "Resultado do Jogo", period: "FT", quotes: [
  q("W1", "BantuBet", 5.1, "a1"), q("W1", "ElephantBet", 4.7, "b1"), q("Empate", "BantuBet", 4, "a2"), q("Empate", "ElephantBet", 3.96, "b2"),
  q("W2", "BantuBet", 1.54, "a3"), q("W2", "ElephantBet", 1.49, "b3")] }] }] };

test("extract1x2 guarda número de selecção por casa", () => {
  const o = extract1x2(comparison);
  assert.equal(o.W2.BantuBet.id, "a3"); assert.equal(o.W2.ElephantBet.id, "b3");
  const p = marketProbs(o); assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test("só propõe quando as fontes concordam e há margem", () => {
  const o = extract1x2(comparison);
  const stats = [{ source: "site:vitibet", payload: { site: "vitibet", pct: [18, 26, 56], tip: "2" } },
                 { source: "site:betstudy", payload: { site: "betstudy", pct: [26, 13, 61] } }];
  const c = buildCandidates({ odds: o, signals: collectSignals(stats) });
  assert.equal(c.length, 1); assert.equal(c[0].selection, "W2"); assert.ok(c[0].valueVsMarket >= -0.02);
  const none = buildCandidates({ odds: o, signals: collectSignals([{ source: "site:vitibet", payload: { pct: [18, 26, 56] } }]) });
  assert.equal(none.length, 0);
});
