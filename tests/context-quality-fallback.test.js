import test from "node:test";
import assert from "node:assert/strict";
import { hasUsableAnalysisContext, isFreshAnalysisContext } from "../lib/pipeline/context-quality.js";

test("InternetSearch hand-off is eligible only with both fixture teams and explicit research flag", () => {
  assert.equal(hasUsableAnalysisContext({
    source: "InternetSearch",
    webResearchRequired: true,
    fixture: { home: "Home FC", away: "Away FC" }
  }), true);
  assert.equal(hasUsableAnalysisContext({
    source: "InternetSearch",
    webResearchRequired: true,
    fixture: { home: "Home FC" }
  }), false);
  assert.equal(hasUsableAnalysisContext({
    source: "InternetSearch",
    fixture: { home: "Home FC", away: "Away FC" }
  }), false);
});

test("InternetSearch hand-off must be fresh before entering analysis", () => {
  const row = {
    collected_at: new Date().toISOString(),
    payload: {
      source: "InternetSearch",
      webResearchRequired: true,
      fixture: { home: "Home FC", away: "Away FC" }
    }
  };
  assert.equal(isFreshAnalysisContext(row), true);
  assert.equal(isFreshAnalysisContext({
    ...row,
    collected_at: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString()
  }), false);
});

test("existing structured statistics remain eligible", () => {
  assert.equal(hasUsableAnalysisContext({
    source: "SportAPI",
    matchStats: { home: { shots: 4 }, away: { shots: 2 } }
  }), true);
});
