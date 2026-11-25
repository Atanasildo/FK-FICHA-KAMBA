import test from "node:test";
import assert from "node:assert/strict";
import { toPrematchPayload } from "../../lib/pipeline/prematch.js";

test("toPrematchPayload resume votos, forma e confrontos", () => {
  const p = toPrematchPayload({
    event: { id: 7, tournament: { name: "Eliteserien", category: { name: "Noruega" } } },
    votes: { vote: { vote1: 50, voteX: 20, vote2: 30 } },
    form: { homeTeam: { form: ["W", "L"], position: 3, value: "1.8" }, awayTeam: { form: ["D"], position: 9 } },
    h2h: { teamDuel: { homeWins: 4, awayWins: 1, draws: 2 } }, collectedAt: "x"
  });
  assert.deepEqual(p.publico, { casa: 50, empate: 20, fora: 30, votos: 100 });
  assert.equal(p.casa.posicao, 3);
  assert.deepEqual(p.confrontos, { vitoriasCasa: 4, empates: 2, vitoriasFora: 1 });
  assert.equal(toPrematchPayload({ event: { id: 1 }, collectedAt: "x" }).publico, null);
});
