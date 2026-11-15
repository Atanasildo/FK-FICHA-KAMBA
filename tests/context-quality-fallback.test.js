import test from "node:test";
import assert from "node:assert/strict";
import { hasUsableAnalysisContext, isFreshAnalysisContext } from "../lib/pipeline/context-quality.js";

const sources = [
  { name: "Official league", url: "https://league.example/match", checkedAt: "2026-11-15T12:00:00Z" },
  { name: "Club site", url: "https://club.example/news", checkedAt: "2026-11-15T12:00:00Z" }
];
const researchedPayload = {
  source: "InternetSearch",
  collectedAt: new Date().toISOString(),
  fixture: { home: "Home FC", away: "Away FC" },
  research: {
    status: "complete",
    researchedBy: "ChatGPT",
    checkedAt: new Date().toISOString(),
    sources,
    facts: [
      { claim: "A equipa venceu dois dos últimos cinco jogos.", sourceUrl: sources[0].url },
      { claim: "O clube confirmou o estádio e a hora do encontro.", sourceUrl: sources[1].url },
      { claim: "A classificação oficial coloca a equipa na metade superior.", sourceUrl: sources[0].url }
    ]
  }
};

test("an InternetSearch hand-off marker is not treated as completed evidence", () => {
  assert.equal(hasUsableAnalysisContext({
    source: "InternetSearch",
    webResearchRequired: true,
    fixture: { home: "Home FC", away: "Away FC" }
  }), false);
});

test("completed InternetSearch context requires sourced facts from at least two URLs", () => {
  assert.equal(hasUsableAnalysisContext(researchedPayload), true);
  assert.equal(hasUsableAnalysisContext({
    ...researchedPayload,
    research: { ...researchedPayload.research, facts: researchedPayload.research.facts.slice(0, 1) }
  }), false);
  assert.equal(hasUsableAnalysisContext({
    ...researchedPayload,
    research: { ...researchedPayload.research, sources: sources.slice(0, 1) }
  }), false);
  assert.equal(hasUsableAnalysisContext({
    ...researchedPayload,
    research: {
      ...researchedPayload.research,
      facts: researchedPayload.research.facts.map(fact => ({ ...fact, sourceUrl: "https://unknown.example" }))
    }
  }), false);
});

test("completed InternetSearch context must be fresh before entering analysis", () => {
  const row = { collected_at: new Date().toISOString(), payload: researchedPayload };
  assert.equal(isFreshAnalysisContext(row), true);
  assert.equal(isFreshAnalysisContext({
    ...row,
    collected_at: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString()
  }), false);
  assert.equal(isFreshAnalysisContext({
    ...row,
    payload: { ...researchedPayload, research: { ...researchedPayload.research, status: "pending" } }
  }), false);
});

test("existing structured statistics remain eligible", () => {
  assert.equal(hasUsableAnalysisContext({
    source: "SportAPI",
    matchStats: { home: { shots: 4 }, away: { shots: 2 } }
  }), true);
});
