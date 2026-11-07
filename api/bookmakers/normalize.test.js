import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBookmakerMarkets, parseMarket } from "./normalize.js";

test("normaliza 1X2 com nomes e odds correspondentes", () => {
  const parsed = parseMarket({
    mercado: "Resultado do Jogo",
    conteudo: "Resultado do Jogo\n\nOud-Heverlee Leuven\nEmpate\nKV Mechelen\n2.25\n3.50\n3.03"
  });
  assert.equal(parsed.status, "ok");
  assert.deepEqual(parsed.selections.map(x => [x.selection, x.odd]), [
    ["Oud-Heverlee Leuven", 2.25],
    ["Empate", 3.5],
    ["KV Mechelen", 3.03]
  ]);
});

test("expande totais Mais/Menos por linha", () => {
  const parsed = parseMarket({
    mercado: "Total de golos no jogo",
    conteudo: "Total de golos no jogo\n\nMais de\nMenos\n0.5\n1.03\n7.80\n1\n1.04\n7.30\n2.5\n1.72\n1.93"
  });
  assert.equal(parsed.status, "ok");
  assert.deepEqual(parsed.selections.map(x => [x.selection, x.odd]), [
    ["Mais de 0.5", 1.03], ["Menos de 0.5", 7.8],
    ["Mais de 1", 1.04], ["Menos de 1", 7.3],
    ["Mais de 2.5", 1.72], ["Menos de 2.5", 1.93]
  ]);
});

test("associa handicaps às equipas e linhas", () => {
  const parsed = parseMarket({
    mercado: "Handicap de Golos",
    conteudo: "Handicap de Golos\n\nOud-Heverlee Leuven\nKV Mechelen\n-2.5\n8.10\n+2.5\n1.045\n-2\n7.10\n+2\n1.07"
  });
  assert.equal(parsed.status, "ok");
  assert.deepEqual(parsed.selections.map(x => [x.team, x.line, x.odd]), [
    ["Oud-Heverlee Leuven", "-2.5", 8.1],
    ["KV Mechelen", "+2.5", 1.045],
    ["Oud-Heverlee Leuven", "-2", 7.1],
    ["KV Mechelen", "+2", 1.07]
  ]);
});

test("normaliza jogador e combinações como pares descrição/odd", () => {
  const player = parseMarket({
    mercado: "Marcará a Qualquer Momento",
    conteudo: "Marcará a Qualquer Momento\n\nRobin Mirisola\n2.65\nBenito Raman\n3.20"
  });
  assert.deepEqual(player.selections.map(x => [x.selection, x.odd]), [
    ["Robin Mirisola", 2.65], ["Benito Raman", 3.2]
  ]);

  const combo = parseMarket({
    mercado: "Resultado e ambas marcam",
    conteudo: "Resultado e ambas marcam\n\nEquipa A e sim\n3.38\nEmpate e Não\n14.00"
  });
  assert.deepEqual(combo.selections.map(x => [x.selection, x.odd]), [
    ["Equipa A e sim", 3.38], ["Empate e Não", 14]
  ]);
});

test("remove duplicados entre Tudo e categoria específica", () => {
  const result = normalizeBookmakerMarkets([
    { categoria: "Tudo", mercados: [{ mercado: "Resultado do Jogo", conteudo: "Resultado do Jogo\n\nCasa\nEmpate\nFora\n2.1\n3.2\n3.4" }] },
    { categoria: "Jogo", mercados: [{ mercado: "Resultado do Jogo", conteudo: "Resultado do Jogo\n\nCasa\nEmpate\nFora\n2.1\n3.2\n3.4" }] }
  ]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].categories, ["Tudo", "Jogo"]);
  assert.equal(result[0].category, "Jogo");
});

test("aceita linhas de handicap zero", () => {
  const parsed = parseMarket({
    mercado: "Handicap de Golos",
    conteudo: "Handicap de Golos\n\nOud-Heverlee Leuven\nKV Mechelen\n-0.5\n2.16\n+0.5\n1.63\n0\n1.63\n0\n2.16"
  });
  assert.equal(parsed.status, "ok");
  assert.deepEqual(parsed.selections.slice(-2).map(x => [x.team, x.line, x.odd]), [
    ["Oud-Heverlee Leuven", "0", 1.63],
    ["KV Mechelen", "0", 2.16]
  ]);
});

test("usa selecções estruturadas do recolhedor BantuBet sem re-parsing ambíguo", () => {
  const parsed = parseMarket({
    mercado: "Resultado do Jogo",
    conteudo: "Resultado do Jogo\\nCasa\\nEmpate\\nFora\\n2.10\\n3.20\\n3.40",
    selecoes: [
      { selecao: "Casa", odd: "2.10" },
      { selecao: "Empate", odd: "3.20" },
      { selecao: "Fora", odd: "3.40" }
    ]
  });
  assert.equal(parsed.status, "ok");
  assert.deepEqual(parsed.selections.map(x => [x.selection, x.odd]), [
    ["Casa", 2.1], ["Empate", 3.2], ["Fora", 3.4]
  ]);
});

test("não aceita selecções estruturadas incompletas", () => {
  const parsed = parseMarket({
    mercado: "Resultado do Jogo",
    conteudo: "Resultado do Jogo\\nCasa\\nEmpate\\nFora\\n2.10\\n3.20\\n3.40",
    selecoes: [
      { selecao: "Casa", odd: "2.10" },
      { selecao: "Empate", odd: "3.20" }
    ]
  });
  assert.equal(parsed.status, "review");
  assert.equal(parsed.selections.length, 0);
});
