import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLiveMarket } from "../../lib/tickets/live-market.js";

test("acompanha ambas marcam sem declarar vitória antes do fim", () => {
  const waiting = evaluateLiveMarket({
    market: "Ambas as Equipas Marcam",
    selection: "Sim",
    homeScore: 1,
    awayScore: 0,
    status: "LIVE"
  });
  assert.equal(waiting.marketStatus, "Em aberto");

  const won = evaluateLiveMarket({
    market: "Ambas as Equipas Marcam",
    selection: "Sim",
    homeScore: 1,
    awayScore: 1,
    status: "FT"
  });
  assert.equal(won.marketStatus, "Ganha");
});

test("não transforma marcador nulo em 0-0", () => {
  const result = evaluateLiveMarket({
    market: "Resultado do Jogo",
    selection: "Empate",
    homeScore: null,
    awayScore: null,
    status: "LIVE"
  });
  assert.equal(result.marketStatus, "A acompanhar");
  assert.equal(result.supported, false);
});

test("não liquida linhas asiáticas de quarto de golo por aproximação", () => {
  const result = evaluateLiveMarket({
    market: "Total de Golos",
    selection: "Mais de 2.25",
    homeScore: 2,
    awayScore: 0,
    status: "FT"
  });
  assert.equal(result.marketStatus, "Aguardando confirmação");
});

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

test("acompanha cartões amarelos da equipa da casa separadamente", () => {
  const result = evaluateLiveMarket({
    market: "Total de Cartões Amarelos da equipa da casa",
    selection: "Mais de 1.5",
    homeScore: 0,
    awayScore: 0,
    status: "LIVE",
    stats: { home: { yellow_cards: 1 }, away: { yellow_cards: 4 } }
  });
  assert.equal(result.marketStatus, "Em risco neste momento");
  assert.match(result.marketUpdate, /equipa da casa: 1/);
});

test("identifica totais de golos e cartões pelo nome da equipa", () => {
  const goals = evaluateLiveMarket({
    market: "Total de Golos do Club Brugge",
    selection: "Mais de 1.5",
    home: "Club Brugge",
    away: "RSC Anderlecht",
    homeScore: 2,
    awayScore: 0,
    status: "LIVE"
  });
  assert.match(goals.marketUpdate, /Golos da equipa da casa: 2/);

  const cards = evaluateLiveMarket({
    market: "Total de Cartões Amarelos do RSC Anderlecht",
    selection: "Mais de 1.5",
    home: "Club Brugge",
    away: "RSC Anderlecht",
    homeScore: 0,
    awayScore: 0,
    status: "LIVE",
    stats: { home: { yellow_cards: 3 }, away: { yellow_cards: 1 } }
  });
  assert.match(cards.marketUpdate, /equipa visitante: 1/);
});

test("acompanha remates à baliza e faltas através das estatísticas disponíveis", () => {
  const shots = evaluateLiveMarket({
    market: "Total de Remates à Baliza",
    selection: "Mais de 8.5",
    homeScore: 0,
    awayScore: 0,
    status: "LIVE",
    stats: { home: { shots_on_target: 5 }, away: { shots_on_target: 4 } }
  });
  assert.equal(shots.marketStatus, "A favor neste momento");
  assert.match(shots.marketUpdate, /Remates à baliza: 9/);

  const fouls = evaluateLiveMarket({
    market: "Total de Faltas",
    selection: "Mais de 20.5",
    homeScore: 0,
    awayScore: 0,
    status: "LIVE",
    stats: { home: { fouls: 12 }, away: { fouls: 10 } }
  });
  assert.equal(fouls.marketStatus, "A favor neste momento");
});

test("acompanha remates da equipa visitante sem somar os da casa", () => {
  const result = evaluateLiveMarket({
    market: "Total de Remates da equipa visitante",
    selection: "Mais de 5.5",
    homeScore: 0,
    awayScore: 0,
    status: "LIVE",
    home: "Clube A",
    away: "Clube B",
    stats: { home: { shots: 8 }, away: { shots: 4 } }
  });
  assert.equal(result.marketStatus, "Em risco neste momento");
  assert.match(result.marketUpdate, /equipa visitante: 4/);
});

test("acompanha cartões vermelhos apenas quando os eventos foram recebidos", () => {
  const waiting = evaluateLiveMarket({
    market: "Total de Cartões Vermelhos",
    selection: "Mais de 0.5",
    status: "LIVE",
    stats: { events: [], eventsAvailable: false }
  });
  assert.equal(waiting.marketStatus, "Aguardando eventos");

  const counted = evaluateLiveMarket({
    market: "Total de Cartões Vermelhos",
    selection: "Mais de 0.5",
    status: "LIVE",
    stats: { events: [{ event_type: "red_card" }], eventsAvailable: true }
  });
  assert.equal(counted.marketStatus, "A favor neste momento");
});

test("acompanha passes e precisão de passe por equipa", () => {
  const passes = evaluateLiveMarket({
    market: "Total de Passes",
    selection: "Mais de 700.5",
    homeScore: 0,
    awayScore: 0,
    status: "LIVE",
    stats: { home: { total_passes: 400 }, away: { total_passes: 350 } }
  });
  assert.equal(passes.marketStatus, "A favor neste momento");

  const accuracy = evaluateLiveMarket({
    market: "Precisão de Passe da equipa da casa",
    selection: "Mais de 80.5",
    homeScore: 0,
    awayScore: 0,
    status: "LIVE",
    home: "Clube A",
    away: "Clube B",
    stats: { home: { pass_accuracy: 82.4 }, away: { pass_accuracy: 75.2 } }
  });
  assert.equal(accuracy.marketStatus, "A favor neste momento");
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
