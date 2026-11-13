import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLiveMarket } from "../../lib/tickets/live-market.js";

test("acompanha mercado de mais de golos pelo marcador actual", () => {
  const result = evaluateLiveMarket({
    market: "Total de Golos no jogo",
    selection: "Mais de 2.5",
    homeScore: 2,
    awayScore: 1,
    status: "LIVE"
  });
  assert.equal(result.marketStatus, "A favor neste momento");
  assert.match(result.marketUpdate, /Golos no jogo: 3/);
});

test("acompanha mercado de golos da equipa da casa sem somar golos visitantes", () => {
  const result = evaluateLiveMarket({
    market: "Total de Golos da equipa da casa",
    selection: "Mais de 1.5",
    homeScore: 1,
    awayScore: 3,
    status: "LIVE",
    home: "Clube A",
    away: "Clube B"
  });
  assert.equal(result.marketStatus, "Em risco neste momento");
  assert.match(result.marketUpdate, /Golos da equipa da casa: 1/);
});

test("não confunde dupla hipótese 1X com vitória da equipa da casa", () => {
  const result = evaluateLiveMarket({
    market: "Dupla possibilidade",
    selection: "1X",
    homeScore: 0,
    awayScore: 1,
    status: "LIVE"
  });
  assert.equal(result.marketStatus, "Em risco neste momento");
});

test("acompanha cartões amarelos quando a fonte fornece estatísticas", () => {
  const result = evaluateLiveMarket({
    market: "Total de Cartões Amarelos",
    selection: "Mais de 2.5",
    homeScore: 0,
    awayScore: 0,
    status: "LIVE",
    stats: { home: { yellow_cards: 2 }, away: { yellow_cards: 1 } }
  });
  assert.equal(result.marketStatus, "A favor neste momento");
});

test("não inventa contagem de cantos quando a fonte não a fornece", () => {
  const result = evaluateLiveMarket({
    market: "Total de Cantos",
    selection: "Mais de 8.5",
    homeScore: 1,
    awayScore: 0,
    status: "LIVE"
  });
  assert.equal(result.marketStatus, "Estatística específica indisponível");
  assert.equal(result.supported, false);
});
