import test from "node:test";
import assert from "node:assert/strict";
import { normalizeElephantBetPayload } from "../../lib/bookmakers/elephantbet.js";

test("normaliza ElephantBet no formato comum e ignora Tudo", () => {
  const result = normalizeElephantBetPayload({
    bookmaker: "ElephantBet",
    categorias: [
      { categoria: "Tudo", mercados: [{ mercado: "Ignorado", conteudo: "Ignorado" }] },
      { categoria: "Jogo", mercados: [{
        mercado: "Total de golos no jogo",
        selecoes: [
          { selecao: "Mais de 2.5", odd: "1.90" },
          { selecao: "Menos de 2.5", odd: "1.80" }
        ],
        associacaoCompleta: true
      }] }
    ]
  }, { id: "evt-1", home: "Equipa A", away: "Equipa B" });
  assert.equal(result.bookmaker, "ElephantBet");
  assert.equal(result.marketCount, 1);
  assert.equal(result.markets[0].bookmaker, "ElephantBet");
  assert.deepEqual(result.markets[0].selections.map(s => [s.selection, s.odd]), [
    ["Mais de 2.5", 1.9], ["Menos de 2.5", 1.8]
  ]);
  assert.deepEqual(result.markets[0].categories, ["Jogo"]);
});
