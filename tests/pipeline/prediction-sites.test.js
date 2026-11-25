import test from "node:test";
import assert from "node:assert/strict";
import { htmlToText, findInText, norm } from "../../lib/pipeline/prediction-sites.js";
const f = (html, h, a) => { const raw = htmlToText(html); return findInText(norm(raw), raw, h, a); };

test("vitibet: percentagens rotuladas do jogo certo, não do vizinho", () => {
  const r = f("24% 2 57% Tip 1-2 2 Ukraine: Premier League 12:00 Kryvbas KR FC Kharkiv INDEX -1.80 1 18% X 26% 2 56% Tip 1-2 2 England: National League 20:00 Foo Bar", "Kryvbas Kryvyi Rih", "FC Kharkiv");
  assert.deepEqual(r.pct, [18, 26, 56]);
});
test("betstudy: trio simples depois da equipa de fora", () => {
  const r = f("25/11 11:00 Polonia Sroda Sokol Kleczew 1 41% 25% 34% 1 2.28 @ 1xbet 25/11 11:00 Kryvbas Kryvyi Rih Metalist 1925 Kharkiv 2 26% 13% 61% 2 Bet Here", "Kryvbas Kryvyi Rih", "FC Kharkiv");
  assert.deepEqual(r.pct, [26, 13, 61]);
});
test("statarea e mybets: palpite", () => {
  assert.equal(f("20:00 X2 Pisa - Modena close X 20:00 1 0 TIP X2 2026-11-25 20:00", "AC Pisa", "FC Modena").tip, "X2");
  assert.equal(f("19:00 Pisa Vs Modena 1 Italy Serie C", "AC Pisa", "FC Modena").tip, "1");
});
test("jogo ausente devolve null", () => {
  assert.equal(f("Lille OSC vs Bayern Munchen 11% 16% 73%", "Inter Milan", "VfB Stuttgart"), null);
});
