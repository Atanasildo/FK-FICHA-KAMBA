import test from "node:test";
import assert from "node:assert/strict";
import { prepareOddsComparison } from "../../lib/bookmakers/prepare-comparison.js";

const categories = [
  { categoria: "Tudo", mercados: [] },
  { categoria: "Jogo", mercados: [{
    mercado: "Resultado do Jogo",
    conteudo: "Resultado do Jogo\n\nCasa FC\nEmpate\nFora FC\n2.10\n3.20\n3.40"
  }] }
];
const event = { home: "Casa FC", away: "Fora FC", competition: "Liga Teste" };

test("prepara duas recolhas e compara a melhor odd", () => {
  const prepared = prepareOddsComparison({
    bantubet: { bookmaker: "BantuBet", categorias: categories, urlPagina: "https://bantu.test/event" },
    elephantbet: { bookmaker: "ElephantBet", categorias: [
      { categoria: "Jogo", mercados: [{
        mercado: "Resultado do Jogo",
        conteudo: "Resultado do Jogo\n\nCasa FC\nEmpate\nFora FC\n2.25\n3.10\n3.50"
      }] }
    ] },
    event
  });
  assert.equal(prepared.result.comparisonCount, 3);
  assert.equal(prepared.result.events[0].comparisons[0].bestBookmaker, "ElephantBet");
  assert.equal(prepared.diagnostics[0].selectionCount, 3);
});

test("exclui mercados marcados como associação incompleta", () => {
  const incomplete = [{ categoria: "Jogo", mercados: [{
    mercado: "Handicap de Golos (3-opções)",
    conteudo: "Twente\nEmpate\nAjax\n-1\n2.0",
    associacaoCompleta: false
  }] }];
  const prepared = prepareOddsComparison({
    bantubet: { categorias: incomplete },
    elephantbet: { categorias: categories },
    event
  });
  assert.equal(prepared.diagnostics[0].selectionCount, 0);
  assert.equal(prepared.diagnostics[0].excludedMarketCount, 1);
});

test("exige os dois ficheiros e os nomes do evento", () => {
  assert.throws(() => prepareOddsComparison({ bantubet: {}, event }), /dois ficheiros/);
  assert.throws(() => prepareOddsComparison({ bantubet: {}, elephantbet: {}, event: {} }), /nomes exactos/);
});

test("recusa ficheiro colocado na casa errada", () => {
  assert.throws(() => prepareOddsComparison({
    bantubet: { bookmaker: "ElephantBet", categorias: categories },
    elephantbet: { bookmaker: "ElephantBet", categorias: categories },
    event
  }), /outra casa/);
});
