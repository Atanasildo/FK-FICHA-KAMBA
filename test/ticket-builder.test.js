import test from "node:test";
import assert from "node:assert/strict";
import { buildTicketBatch } from "../lib/tickets/builder.js";

const publishedAt = "2026-11-12T08:00:00.000Z";
const base = {
  fixtureId: "fx-1", home: "Home FC", away: "Away FC",
  competition: "League A", kickoff: "2026-11-12T16:00:00.000Z",
  market: "TOTAL_GOALS", selection: "Over 1.5", bestOdds: 1.8,
  fairProbability: 0.65, bestBookmaker: "BantuBet",
  rationale: "A equipa apresenta média ofensiva consistente nos últimos jogos."
};

test("exclui selecções abaixo da odd mínima e jogos com menos de três horas", () => {
  const result = buildTicketBatch([
    { ...base, fixtureId: "low-odd", bestOdds: 1.39 },
    { ...base, fixtureId: "soon", kickoff: "2026-11-12T10:00:00.000Z" }
  ], { publishedAt });
  assert.equal(result.pool_size, 2);
  assert.equal(result.slips.length, 0);
});


test("aceita jogos que começam com pelo menos três horas de antecedência", () => {
  const pool = Array.from({ length: 5 }, (_, index) => ({
    ...base,
    fixtureId: `four-hours-${index}`,
    home: `Home FC ${index}`,
    away: `Away FC ${index}`,
    competition: `League ${index}`,
    kickoff: "2026-11-12T12:00:00.000Z",
    bestOdds: 2,
    fairProbability: 0.7
  }));
  const result = buildTicketBatch(pool, { publishedAt });
  assert.equal(result.pool_size, 5);
  assert.ok(result.slips.length > 0);
});

test("não inventa boletins quando não há candidatos suficientes", () => {
  const result = buildTicketBatch([base], { publishedAt });
  assert.equal(result.slips.length, 0);
  assert.equal(result.validation.valid, false);
});

test("devolve o contrato de lote e métricas mesmo quando não atinge seis boletins", () => {
  const result = buildTicketBatch([], { publishedAt });
  assert.equal(result.level, "A");
  assert.equal(result.pool_size, 0);
  assert.equal(result.validation.sixSlipsMinimum, false);
  assert.equal(result.validation.probabilityAtLeastOneMinimum, false);
});
