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

test("aceita jogos futuros mesmo quando começam em menos de uma hora e exclui os já iniciados", () => {
  const now = Date.parse(publishedAt);
  assert.ok(normalizeCandidate({ ...base, kickoff: "2026-11-12T08:01:00.000Z" }, now));
  assert.equal(normalizeCandidate({ ...base, kickoff: publishedAt }, now), null);
  assert.equal(normalizeCandidate({ ...base, kickoff: "2026-11-12T07:59:00.000Z" }, now), null);
});

test("não aplica um corte automático de EV quando a odd e a análise são válidas", () => {
  const candidate = {
    ...base,
    fairProbability: 0.5,
    quotes: [
      { bookmaker: "BantuBet", odds: 1.8, collectedAt: publishedAt },
      { bookmaker: "ElephantBet", odds: 1.45, collectedAt: publishedAt }
    ]
  };
  assert.ok(normalizeCandidate(candidate, Date.parse(publishedAt)));
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

test("respeita a nova distribuição: 2 fichas 25-50, 2 fichas 30-70 e 4 fichas 100-10000", () => {
  const pool = [];
  const expected = [
    { tier: "alta", odd: 3.3, count: 4 },
    { tier: "mediaAlta", odd: 2.7, count: 2 },
    { tier: "media", odd: 2.5, count: 2 }
  ];

  expected.forEach((group, groupIndex) => {
    for (let ticket = 0; ticket < group.count; ticket++) {
      const ticketIndex = expected.slice(0, groupIndex).reduce((sum, item) => sum + item.count, 0) + ticket;
      for (let legIndex = 0; legIndex < 4; legIndex++) {
        const fixtureId = `tier-${ticketIndex}-fixture-${legIndex}`;
        pool.push({
          fixtureId,
          home: `Home ${fixtureId}`,
          away: `Away ${fixtureId}`,
          competition: `League ${fixtureId}`,
          kickoff: "2026-11-12T18:00:00.000Z",
          market: legIndex < 2 ? `Market ${ticketIndex} A` : `Market ${ticketIndex} B`,
          selection: `Selection ${legIndex}`,
          rationale: "A evidência estatística sustenta esta selecção.",
          fairProbability: 0.5,
          quotes: [
            { bookmaker: "BantuBet", odds: group.odd, collectedAt: publishedAt },
            { bookmaker: "ElephantBet", odds: group.odd + 0.01, collectedAt: publishedAt }
          ]
        });
      }
    }
  });

  const result = buildTicketBatch(pool, { publishedAt });
  assert.equal(result.sharedTicketGroups, 8);
  assert.equal(result.slips.length, 16);
  assert.equal(result.validation.valid, true);

  const groups = new Map();
  for (const slip of result.slips) {
    if (!groups.has(slip.shared_ticket_id)) groups.set(slip.shared_ticket_id, []);
    groups.get(slip.shared_ticket_id).push(slip);
  }
  const tierCounts = {};
  for (const pair of groups.values()) {
    assert.equal(pair.length, 2, "cada ficha partilhada deve ter uma versão por casa");
    assert.deepEqual(
      pair[0].legs.map(leg => [leg.event_id, leg.market, leg.selection]),
      pair[1].legs.map(leg => [leg.event_id, leg.market, leg.selection])
    );
    assert.notEqual(pair[0].bookmaker, pair[1].bookmaker);
    for (const slip of pair) {
      tierCounts[slip.tier] = (tierCounts[slip.tier] || 0) + (slip.bookmaker === "BantuBet" ? 1 : 0);
      if (slip.tier === "alta") assert.ok(slip.total_odd >= 100 && slip.total_odd <= 10000);
      if (slip.tier === "mediaAlta") assert.ok(slip.total_odd >= 30 && slip.total_odd <= 70);
      if (slip.tier === "media") assert.ok(slip.total_odd >= 25 && slip.total_odd <= 50);
    }
  }
  assert.deepEqual(tierCounts, { alta: 4, mediaAlta: 2, media: 2 });

  const fixturesByGroup = [...groups.values()].map(pair =>
    new Set(pair[0].legs.map(leg => leg.event_id))
  );
  for (let i = 0; i < fixturesByGroup.length; i++) {
    for (let j = i + 1; j < fixturesByGroup.length; j++) {
      assert.equal([...fixturesByGroup[i]].some(id => fixturesByGroup[j].has(id)), false,
        "um jogo não deve ser repetido entre fichas diferentes");
    }
  }
});
