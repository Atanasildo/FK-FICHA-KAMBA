import test from "node:test";
import assert from "node:assert/strict";
import { fetchHighlightlyFixtures, fetchHighlightlyDetails, normalizeHighlightlyFixture } from "./highlightly.js";

test("normaliza partida Highlightly com estado, marcador e minuto", () => {
  const result = normalizeHighlightlyFixture({
    id: 77,
    date: "2026-11-17T18:00:00.000Z",
    homeTeam: { name: "Petro de Luanda" },
    awayTeam: { name: "1º de Agosto" },
    state: { description: "Second half", clock: 68, score: { current: "2 - 1" } }
  });
  assert.equal(result.id, 77);
  assert.equal(result.home_team, "Petro de Luanda");
  assert.equal(result.away_team, "1º de Agosto");
  assert.equal(result.status, "2H");
  assert.equal(result.home_score, 2);
  assert.equal(result.away_score, 1);
  assert.equal(result.minute, 68);
  assert.equal(result.provider, "highlightly");
});

test("normaliza estados finais, prolongamento, adiamento e cancelamento", () => {
  const base = { id: 1, date: "2026-11-17T18:00:00Z", homeTeam: { name: "A" }, awayTeam: { name: "B" } };
  assert.equal(normalizeHighlightlyFixture({ ...base, state: { description: "Finished" } }).status, "FT");
  assert.equal(normalizeHighlightlyFixture({ ...base, state: { description: "Finished after extra time" } }).status, "AET");
  assert.equal(normalizeHighlightlyFixture({ ...base, state: { description: "Postponed" } }).status, "postponed");
  assert.equal(normalizeHighlightlyFixture({ ...base, state: { description: "Cancelled" } }).status, "cancelled");
});

test("não aceita partidas sem duas equipas ou ID", () => {
  assert.equal(normalizeHighlightlyFixture({ id: 1, homeTeam: { name: "A" } }), null);
  assert.equal(normalizeHighlightlyFixture({ homeTeam: { name: "A" }, awayTeam: { name: "B" } }), null);
});

test("consulta fixtures com cabeçalho de autenticação e timezone de Luanda", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url: String(url), options };
    return { ok: true, json: async () => ({ data: [{ id: 3, date: "2026-11-17T18:00:00Z", homeTeam: { name: "A" }, awayTeam: { name: "B" }, state: { description: "Not started", score: { current: "0 - 0" } } }], pagination: { totalCount: 1 } }) };
  };
  const fixtures = await fetchHighlightlyFixtures("2026-11-17", "test-key", fetchImpl);
  assert.equal(fixtures.length, 1);
  assert.match(request.url, /timezone=Africa%2FLuanda/);
  assert.equal(request.options.headers["x-rapidapi-key"], "test-key");
});

test("não pagina centenas de jogos sequencialmente no endpoint de acompanhamento", async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => ({
        data: Array.from({ length: 100 }, (_, index) => ({
          id: index + 1, date: "2026-11-17T18:00:00Z",
          homeTeam: { name: "Home " + index }, awayTeam: { name: "Away " + index },
          state: { description: "Not started", score: { current: "0 - 0" } }
        })),
        pagination: { totalCount: 750 }
      })
    };
  };
  const fixtures = await fetchHighlightlyFixtures("2026-11-17", "test-key", fetchImpl);
  assert.equal(fixtures.length, 100);
  assert.equal(calls.length, 1);
});

test("obtém eventos e estatísticas e associa estatísticas às equipas certas", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/events/")) return { ok: true, json: async () => ({ data: [{ type: "Goal", player: "A Striker", time: "45+1", team: { name: "Home FC" } }] }) };
    return { ok: true, json: async () => ({ data: [
      { team: { name: "Home FC" }, statistics: [{ displayName: "Shots on target", value: 4 }, { displayName: "Corners", value: 6 }] },
      { team: { name: "Away FC" }, statistics: [{ displayName: "Shots on target", value: 2 }] }
    ] }) };
  };
  const details = await fetchHighlightlyDetails(99, "test-key", { home_team: "Home FC", away_team: "Away FC" }, fetchImpl);
  assert.equal(calls.length, 2);
  assert.equal(details.events[0].event_type, "goal");
  assert.equal(details.events[0].minute, "45+1");
  assert.equal(details.statistics.home.shots_on_target, 4);
  assert.equal(details.statistics.away.shots_on_target, 2);
  assert.equal(details.statistics.home.corners, 6);
});

test("falha claramente quando a chave não está configurada", async () => {
  await assert.rejects(() => fetchHighlightlyFixtures("2026-11-17", ""), /HIGHLIGHTLY_API_KEY/);
});
