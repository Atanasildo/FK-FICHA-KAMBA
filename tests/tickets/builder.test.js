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

test("rejeita odds abaixo do mínimo ou EV insuficiente em qualquer uma das casas", () => {
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
  assert.equal(normalizeCandidate(candidate, now), null);
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
