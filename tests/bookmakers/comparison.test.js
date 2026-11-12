import test from "node:test";
import assert from "node:assert/strict";
import { compareFixtures, canonicalLine } from "../../lib/bookmakers/comparison.js";

const fixture = (bookmaker, markets, extra = {}) => ({
  id: bookmaker + "-1",
  bookmaker,
  home: "Club Brugge",
  away: "RSC Anderlecht",
  competition: "Belgium Pro League",
  kickoff: "2026-11-10T19:00:00Z",
  collectedAt: "2026-11-08T10:00:00Z",
  sourceUrl: "https://example.test/event",
  markets,
  ...extra
});

test("compara a mesma selecção entre casas apesar de variação textual Menos/Menos de", () => {
  const result = compareFixtures([
    fixture("BantuBet", [{ market: "Total de golos no jogo", selection: "Menos 2.5", odds: 2.79, line: "2.5", side: "under" }]),
    fixture("Elephant Bet", [{ market: "Total de golos no jogo", selection: "Menos de 2.5", odds: 2.85, line: "2.5", side: "under" }])
  ]);
  assert.equal(result.comparisonCount, 1);
  assert.equal(result.events[0].comparisons[0].bestBookmaker, "Elephant Bet");
  assert.equal(result.events[0].comparisons[0].bestOdds, 2.85);
});

test("não mistura linhas diferentes nem jogo completo com primeira parte", () => {
  const result = compareFixtures([
    fixture("BantuBet", [
      { market: "Total de golos no jogo", selection: "Mais de 2.5", odds: 1.8, line: "2.5", side: "over" },
      { market: "Total de golos na 1ª Parte", selection: "Mais de 2.5", odds: 1.7, line: "2.5", side: "over" }
    ]),
    fixture("Elephant Bet", [
      { market: "Total de golos no jogo", selection: "Mais de 3.5", odds: 2.2, line: "3.5", side: "over" },
      { market: "Total de golos na 1ª Parte", selection: "Mais de 2.5", odds: 1.9, line: "2.5", side: "over" }
    ])
  ]);
  assert.equal(result.comparisonCount, 1);
  assert.equal(result.events[0].comparisons[0].period, "1H");
});

test("mantém handicaps por equipa e linha distintos", () => {
  const result = compareFixtures([
    fixture("BantuBet", [{ market: "Handicap Asiático de Golos", selection: "Club Brugge (-1.5)", odds: 2.1, team: "Club Brugge", line: "-1.5" }]),
    fixture("Elephant Bet", [{ market: "Handicap Asiático de Golos", selection: "Club Brugge (-0.5)", odds: 1.7, team: "Club Brugge", line: "-0.5" }])
  ]);
  assert.equal(result.comparisonCount, 0);
});

test("não compara eventos com equipas diferentes", () => {
  const result = compareFixtures([
    fixture("BantuBet", [{ market: "Resultado do Jogo", selection: "Club Brugge", odds: 2.1 }]),
    fixture("Elephant Bet", [{ market: "Resultado do Jogo", selection: "Club Brugge", odds: 2.2 }], { away: "Club NXT" })
  ]);
  assert.equal(result.comparisonCount, 0);
});

test("normaliza linha sem colapsar valores diferentes", () => {
  assert.equal(canonicalLine("2,25"), "2.25");
  assert.equal(canonicalLine("2.5"), "2.5");
  assert.notEqual(canonicalLine("2.25"), canonicalLine("2.5"));
  assert.equal(canonicalLine("-1.5"), "-1.5");
});


test("não compara total do jogo com total de golos por intervalo de minutos", () => {
  const result = compareFixtures([
    fixture("BantuBet", [{ market: "Total de golos no jogo", selection: "Mais de 1", odds: 2.08, line: "1", side: "over" }]),
    fixture("Elephant Bet", [{ market: "Total de Golos no minuto 1-15", selection: "Mais de 1", odds: 2.2, line: "1", side: "over" }])
  ]);
  assert.equal(result.comparisonCount, 0);
});

test("não compara resultado normal com resultado com um golo de avanço", () => {
  const result = compareFixtures([
    fixture("BantuBet", [{ market: "Resultado do Jogo", selection: "Club Brugge", odds: 2.08 }]),
    fixture("Elephant Bet", [{ market: "Resultado do Jogo (1 Golo de Avanço)", selection: "Club Brugge", odds: 2.2 }])
  ]);
  assert.equal(result.comparisonCount, 0);
});

test("continua a comparar aliases legítimos do mesmo total de golos", () => {
  const result = compareFixtures([
    fixture("BantuBet", [{ market: "Total de golos no jogo", selection: "Mais de 2.5", odds: 1.8, line: "2.5", side: "over" }]),
    fixture("Elephant Bet", [{ market: "Total de Golos", selection: "Mais de 2.5", odds: 1.9, line: "2.5", side: "over" }])
  ]);
  assert.equal(result.comparisonCount, 1);
});


test("mantém linhas distintas quando a casa envia apenas Mais de e a linha separada", () => {
  const result = compareFixtures([
    fixture("BantuBet", [
      { market: "Total de golos no jogo", selection: "Mais de", odds: 1.55, line: "1.5", side: "over" },
      { market: "Total de golos no jogo", selection: "Mais de", odds: 2.10, line: "2.5", side: "over" }
    ]),
    fixture("Elephant Bet", [
      { market: "Total de golos no jogo", selection: "Mais de", odds: 1.60, line: "1.5", side: "over" },
      { market: "Total de golos no jogo", selection: "Mais de", odds: 2.20, line: "2.5", side: "over" }
    ])
  ]);
  assert.equal(result.comparisonCount, 2);
  assert.deepEqual(result.events[0].comparisons.map(x => x.line).sort(), ["1.5", "2.5"]);
});

test("identifica total de cantos pelo tipo nativo e mantém a linha", () => {
  const result = compareFixtures([
    fixture("BantuBet", [{ market: "Total", marketType: "TotalCorners", selection: "Mais de", odds: 1.8, line: "8.5", side: "over" }]),
    fixture("Elephant Bet", [{ market: "Total", marketType: "TotalCorners", selection: "Mais de", odds: 1.9, line: "8.5", side: "over" }])
  ]);
  assert.equal(result.comparisonCount, 1);
  assert.equal(result.events[0].comparisons[0].marketType, "TotalCorners");
  assert.equal(result.events[0].comparisons[0].line, "8.5");
});

test("não compara totais Mais de sem linha identificável", () => {
  const result = compareFixtures([
    fixture("BantuBet", [{ market: "Total de golos no jogo", selection: "Mais de", odds: 1.8 }]),
    fixture("Elephant Bet", [{ market: "Total de golos no jogo", selection: "Mais de", odds: 1.9 }])
  ]);
  assert.equal(result.comparisonCount, 0);
});


test("identifica total de golos quando o nome do mercado é genérico", () => {
  const result = compareFixtures([
    fixture("BantuBet", [{ market: "Total", marketType: "TotalGoals", selection: "Mais de", odds: 1.7, line: "2.5" }]),
    fixture("Elephant Bet", [{ market: "Total", marketType: "TotalGoals", selection: "Mais de", odds: 1.8, line: "2.5" }])
  ]);
  assert.equal(result.comparisonCount, 1);
  assert.equal(result.events[0].comparisons[0].line, "2.5");
});


test("compara o mesmo mercado quando o código nativo difere entre casas", () => {
  const result = compareFixtures([
    fixture("BantuBet", [{ market: "Total", marketType: "TotalGoals", selection: "Mais de", odds: 1.8, line: "2.5", marketBase: "2.5" }]),
    fixture("Elephant Bet", [{ market: "Total de golos no jogo", marketType: "G_TOTAL", selection: "Mais de", odds: 1.9, line: "2.5", marketBase: "2.5" }])
  ]);
  assert.equal(result.comparisonCount, 1);
});

test("não mistura linhas nativas diferentes mesmo quando a selecção tem o mesmo texto", () => {
  const result = compareFixtures([
    fixture("BantuBet", [{ market: "Total de golos no jogo", selection: "Mais de", odds: 1.8, line: "1.5" }]),
    fixture("Elephant Bet", [{ market: "Total de golos no jogo", selection: "Mais de", odds: 1.9, line: "2.5" }])
  ]);
  assert.equal(result.comparisonCount, 0);
});
