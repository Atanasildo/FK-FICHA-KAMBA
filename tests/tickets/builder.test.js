import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCandidate, teamKey } from "../../lib/tickets/builder.js";

test("normaliza nomes de equipas com e sem acentos para evitar repetições", () => {
  assert.equal(teamKey("São Paulo"), teamKey("Sao Paulo"));
  assert.equal(teamKey("Atlético Mineiro"), teamKey("Atletico Mineiro"));
});

test("só aceita uma selecção com odds verificadas nas duas casas", () => {
  const now = Date.parse("2026-11-14T10:00:00.000Z");
  const candidate = {
    fixtureId: "sport-1", home: "Porto", away: "Braga", competition: "Liga",
    kickoff: "2026-11-14T12:00:00.000Z",
    market: "Total de golos", selection: "Mais de 1.5",
    rationale: "A forma recente sustenta esta selecção.",
    fairProbability: 0.7,
    quotes: [
      { bookmaker: "BantuBet", odds: 1.8, collectedAt: "2026-11-14T09:50:00.000Z" },
      { bookmaker: "ElephantBet", odds: 1.9, collectedAt: "2026-11-14T09:51:00.000Z" }
    ]
  };
  const normalized = normalizeCandidate(candidate, now);
  assert.equal(normalized.oddsByBookmaker.BantuBet, 1.8);
  assert.equal(normalized.oddsByBookmaker.ElephantBet, 1.9);
  assert.equal(normalizeCandidate({
    ...candidate,
    quotes: candidate.quotes.filter(q => q.bookmaker === "BantuBet")
  }, now), null);
});

test("não rejeita uma selecção válida apenas por EV inferior ao corte antigo", () => {
  const now = Date.parse("2026-11-14T10:00:00.000Z");
  const candidate = {
    fixtureId: "sport-2", home: "Benfica", away: "Sporting", competition: "Liga",
    kickoff: "2026-11-14T12:00:00.000Z",
    market: "Resultado", selection: "Benfica",
    rationale: "A forma recente sustenta esta selecção.",
    fairProbability: 0.5,
    quotes: [
      { bookmaker: "BantuBet", odds: 1.8, collectedAt: "2026-11-14T09:50:00.000Z" },
      { bookmaker: "ElephantBet", odds: 1.45, collectedAt: "2026-11-14T09:51:00.000Z" }
    ]
  };
  assert.ok(normalizeCandidate(candidate, now));
});

test("rejeita jogos de outro dia de Luanda mesmo com antecedência suficiente", () => {
  const now = Date.parse("2026-11-14T10:00:00.000Z");
  const candidate = {
    fixtureId: "tomorrow", home: "Porto", away: "Braga", competition: "Liga",
    kickoff: "2026-11-14T23:30:00.000Z",
    market: "Total de golos", selection: "Mais de 1.5",
    rationale: "A forma recente sustenta esta selecção.",
    fairProbability: 0.7,
    quotes: [
      { bookmaker: "BantuBet", odds: 1.8, collectedAt: "2026-11-14T09:50:00.000Z" },
      { bookmaker: "ElephantBet", odds: 1.9, collectedAt: "2026-11-14T09:51:00.000Z" }
    ]
  };
  assert.equal(normalizeCandidate(candidate, now), null);
});

test("aceita jogos de hoje com pelo menos uma hora de antecedência", () => {
  const now = Date.parse("2026-11-14T10:00:00.000Z");
  const candidate = {
    fixtureId: "today", home: "Porto", away: "Braga", competition: "Liga",
    kickoff: "2026-11-14T11:30:00.000Z",
    market: "Total de golos", selection: "Mais de 1.5",
    rationale: "A forma recente sustenta esta selecção.",
    fairProbability: 0.7,
    quotes: [
      { bookmaker: "BantuBet", odds: 1.8, collectedAt: "2026-11-14T09:50:00.000Z" },
      { bookmaker: "ElephantBet", odds: 1.9, collectedAt: "2026-11-14T09:51:00.000Z" }
    ]
  };
  assert.ok(normalizeCandidate(candidate, now));
});

test("gera fichas 1000x+ quando há selecções suficientes e as duas casas passam das 1000x", async () => {
  const { buildTicketBatch } = await import("../../lib/tickets/builder.js");
  const publishedAt = "2026-11-14T10:00:00.000Z";
  const markets = [["Total de golos", "Mais de 1.5"], ["Ambas marcam", "Sim"], ["Dupla Chance", "1X"], ["Resultado", "Casa"], ["Total de cantos", "Mais de 8.5"], ["Handicap", "Casa +1"],
    ["Cartões", "Mais de 3.5"], ["Total de remates", "Mais de 20.5"], ["Primeira parte", "Casa ou empate"], ["Golos da casa", "Mais de 0.5"], ["Golos do visitante", "Mais de 0.5"], ["Empate anula", "Casa"]];
  const pool = Array.from({ length: 80 }, (_, i) => {
    const [market, selection] = markets[i % markets.length];
    return {
      fixtureId: "g" + i, home: "Casa" + i, away: "Fora" + i, competition: "Liga " + i,
      kickoff: "2026-11-14T15:00:00.000Z", market, selection,
      rationale: "Análise com várias fontes a sustentar esta selecção.",
      fairProbability: 0.5, selectionId: String(1000 + i),
      quotes: [
        { bookmaker: "BantuBet", odds: 2.3, collectedAt: "2026-11-14T09:50:00.000Z" },
        { bookmaker: "ElephantBet", odds: 2.25, collectedAt: "2026-11-14T09:50:00.000Z" }
      ]
    };
  });
  const batch = buildTicketBatch(pool, { publishedAt });
  const mega = batch.slips.filter(slip => slip.tier === "mega");
  assert.ok(mega.length >= 2, "esperava pelo menos uma ficha mega (duas casas)");
  for (const slip of mega) assert.ok(slip.total_odd >= 1000, "odd " + slip.total_odd);
});
