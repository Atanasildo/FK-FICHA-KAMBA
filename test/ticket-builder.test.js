import test from "node:test";
import assert from "node:assert/strict";
import { buildTicketBatch, normalizeCandidate } from "../lib/tickets/builder.js";

const publishedAt = "2026-11-12T08:00:00.000Z";
const base = {
  fixtureId: "fx-1", home: "Home FC", away: "Away FC",
  competition: "League A", kickoff: "2026-11-12T16:00:00.000Z",
  market: "TOTAL_GOALS", selection: "Over 1.5",
  fairProbability: 0.7,
  rationale: "A equipa apresenta média ofensiva consistente nos últimos jogos.",
  quotes: [
    { bookmaker: "BantuBet", odds: 1.8, collectedAt: publishedAt },
    { bookmaker: "ElephantBet", odds: 1.9, collectedAt: publishedAt }
  ]
};

test("exclui selecções abaixo da odd mínima ou sem cotação de uma das casas", () => {
  assert.equal(normalizeCandidate({
    ...base,
    quotes: [
      { bookmaker: "BantuBet", odds: 1.39, collectedAt: publishedAt },
      { bookmaker: "ElephantBet", odds: 1.9, collectedAt: publishedAt }
    ]
  }, Date.parse(publishedAt)), null);
  assert.equal(normalizeCandidate({
    ...base,
    quotes: base.quotes.filter(q => q.bookmaker === "BantuBet")
  }, Date.parse(publishedAt)), null);
});

test("aceita apenas jogos com pelo menos seis horas de antecedência", () => {
  const now = Date.parse(publishedAt);
  assert.ok(normalizeCandidate({ ...base, kickoff: "2026-11-12T14:00:00.000Z" }, now));
  assert.equal(normalizeCandidate({ ...base, kickoff: "2026-11-12T12:00:00.000Z" }, now), null);
});

test("exige EV mínimo individual nas duas casas", () => {
  const candidate = {
    ...base,
    fairProbability: 0.5,
    quotes: [
      { bookmaker: "BantuBet", odds: 1.8, collectedAt: publishedAt },
      { bookmaker: "ElephantBet", odds: 1.45, collectedAt: publishedAt }
    ]
  };
  assert.equal(normalizeCandidate(candidate, Date.parse(publishedAt)), null);
});

test("não inventa boletins quando não há candidatos comuns suficientes", () => {
  const result = buildTicketBatch([base], { publishedAt });
  assert.equal(result.slips.length, 0);
  assert.equal(result.sharedTicketGroups, 0);
  assert.equal(result.validation.valid, false);
});

test("devolve o contrato de lote e métricas mesmo sem candidatos", () => {
  const result = buildTicketBatch([], { publishedAt });
  assert.equal(result.level, "A");
  assert.equal(result.pool_size, 0);
  assert.equal(result.sharedTicketGroups, 0);
  assert.equal(result.validation.sixSlipsMinimum, false);
  assert.equal(result.validation.probabilityAtLeastOneMinimum, false);
});
