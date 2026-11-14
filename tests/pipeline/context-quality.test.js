import test from "node:test";
import assert from "node:assert/strict";
import { hasUsableAnalysisContext, isFreshAnalysisContext } from "../../lib/pipeline/context-quality.js";

const now = Date.parse("2026-11-13T08:00:00.000Z");
const results = (count, daysAgo = 10) => Array.from({ length: count }, (_, index) => ({
  status: "FT",
  date: new Date(now - (daysAgo + index) * 86400000).toISOString().slice(0, 10),
  home_score: index + 1,
  away_score: 0
}));

test("aceita estatísticas reais não vazias", () => {
  assert.equal(hasUsableAnalysisContext({ matchStats: { shots: { home: 4, away: 2 } } }, now), true);
});

test("aceita forma recente apenas com três resultados válidos de cada equipa", () => {
  assert.equal(hasUsableAnalysisContext({
    matchStats: null,
    homeTeam: { recentResults: results(3) },
    awayTeam: { recentResults: results(3, 20) }
  }, now), true);
});

test("rejeita contexto com forma insuficiente ou sem placares", () => {
  assert.equal(hasUsableAnalysisContext({
    matchStats: null,
    homeTeam: { recentResults: results(3) },
    awayTeam: { recentResults: results(2) }
  }, now), false);
  assert.equal(hasUsableAnalysisContext({
    matchStats: null,
    homeTeam: { recentResults: results(3) },
    awayTeam: { recentResults: results(3).map(row => ({ ...row, home_score: null })) }
  }, now), false);
});

test("rejeita forma antiga e contexto recolhido fora da janela", () => {
  const payload = {
    matchStats: null,
    homeTeam: { recentResults: results(3, 220) },
    awayTeam: { recentResults: results(3, 220) }
  };
  assert.equal(hasUsableAnalysisContext(payload, now), false);
  assert.equal(isFreshAnalysisContext({
    collected_at: "2026-11-13T07:00:00.000Z",
    payload: { matchStats: { shots: 2 } }
  }, now, 30 * 60 * 1000), false);
});
