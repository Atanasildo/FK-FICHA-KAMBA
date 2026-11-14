import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTeamName, selectCanonicalMatch } from "../../lib/pipeline/match-linking.js";

const fixture = (home_team, away_team, kickoff_at = "2026-11-13T13:00:00.000Z", id = "sport-1") => ({
  id, home_team, away_team, kickoff_at
});

test("normaliza nomes equivalentes em português e inglês", () => {
  assert.equal(normalizeTeamName("Moçambique"), normalizeTeamName("Mozambique"));
  assert.equal(normalizeTeamName("Etiópia"), normalizeTeamName("Ethiopia"));
  assert.equal(normalizeTeamName("Paraguai"), normalizeTeamName("Paraguay"));
  assert.equal(normalizeTeamName("Ilhas Comores"), normalizeTeamName("Comoros"));
  assert.equal(normalizeTeamName("Bosnia and Herzegovina U21"), normalizeTeamName("Bosnia-Herzegovina U21"));
});

test("associa apenas equipas na mesma ordem e horário próximo", () => {
  const swarm = fixture("Moçambique", "Etiópia", "2026-11-13T13:05:00.000Z", "swarm-1");
  const canonical = fixture("Mozambique", "Ethiopia");
  assert.equal(selectCanonicalMatch(swarm, [canonical]), canonical);
  assert.equal(selectCanonicalMatch(swarm, [fixture("Ethiopia", "Mozambique")]), null);
  assert.equal(selectCanonicalMatch(swarm, [fixture("Mozambique", "Ethiopia", "2026-11-13T16:00:00.000Z")]), null);
});

test("não associa quando existem candidatos temporalmente ambíguos", () => {
  const swarm = fixture("Paraguai", "Singapore");
  const first = fixture("Paraguay", "Singapore", "2026-11-13T13:00:00.000Z", "one");
  const second = fixture("Paraguay", "Singapore", "2026-11-13T13:05:00.000Z", "two");
  assert.equal(selectCanonicalMatch(swarm, [first, second]), null);
});

test("não reutiliza o mesmo jogo SportAPI para duas partidas Swarm", () => {
  const canonical = fixture("Zambia", "Burundi");
  assert.equal(selectCanonicalMatch(fixture("Zâmbia", "Burundi"), [canonical]), canonical);
  assert.equal(selectCanonicalMatch(fixture("Zambia", "Burundi"), [canonical], new Set([canonical.id])), null);
});
