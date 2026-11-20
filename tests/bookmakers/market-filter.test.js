import test from "node:test";
import assert from "node:assert/strict";
import { isUsefulMarketName } from "../../lib/bookmakers/market-filter.js";

test("guarda mercados principais e descarta props de jogadores, cantos e cartões", () => {
  for (const name of ["Resultado do Jogo", "Dupla Chance", "Ambas equipas marcarão", "Total de golos no jogo",
    "Total de golos no jogo (3-opções)", "Empate anula aposta", "Handicap Asiático", "1º Parte: Resultado e Ambas equipas marcarão"]) {
    assert.equal(isUsefulMarketName(name), true, name);
  }
  for (const name of ["Jogador marcará de cabeça", "Total de Cantos", "Passes de Jogador", "Intervalo de Total de Cartões",
    "Arsenal (Mulh) - Total de Golos (Faixa de Golos)", "Player To Win a Penalty", ""]) {
    assert.equal(isUsefulMarketName(name), false, name);
  }
});
