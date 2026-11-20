// NOTA: os dados abaixo são SINTÉTICOS, escritos a partir do formato que se conhece do SofaScore.
// Não foram copiados de uma resposta real. Se o formato real for diferente, corrige o conversor
// (lib/pipeline/sofascore.js) com o resultado de `node tools/collect-live-sofascore.js --probe`.
import test from "node:test";
import assert from "node:assert/strict";
import {
  hasStatistics,
  normalizeSofascoreEvent,
  normalizeSofascoreIncidents,
  normalizeSofascoreLiveList,
  normalizeSofascoreStatistics,
  sofascoreStatus
} from "../../lib/pipeline/sofascore.js";
import { BlockedError, newState, pickTracked, runCycle } from "../../tools/collect-live-sofascore.js";

const NOW = Date.parse("2026-11-20T13:00:00Z");
const KICKOFF = Date.parse("2026-11-20T12:15:00Z");

const liveEvent = (overrides = {}) => ({
  id: 9001,
  homeTeam: { name: "Alpha FC" },
  awayTeam: { name: "Beta United" },
  startTimestamp: KICKOFF / 1000,
  status: { type: "inprogress", description: "2nd half" },
  homeScore: { current: 1 },
  awayScore: { current: 0 },
  time: { currentPeriodStartTimestamp: (NOW - 10 * 60 * 1000) / 1000 },
  tournament: { name: "Liga Teste" },
  ...overrides
});

test("converte estados do SofaScore para os estados internos", () => {
  assert.equal(sofascoreStatus({ type: "inprogress", description: "1st half" }), "1H");
  assert.equal(sofascoreStatus({ type: "inprogress", description: "2nd half" }), "2H");
  assert.equal(sofascoreStatus({ type: "inprogress", description: "Halftime" }), "HT");
  assert.equal(sofascoreStatus({ type: "finished", description: "Ended" }), "FT");
  assert.equal(sofascoreStatus({ type: "finished", description: "AET" }), "AET");
  assert.equal(sofascoreStatus({ type: "finished", description: "After penalties" }), "PENS");
  assert.equal(sofascoreStatus({ type: "postponed", description: "Postponed" }), "postponed");
  assert.equal(sofascoreStatus({ type: "canceled", description: "Canceled" }), "cancelled");
  assert.equal(sofascoreStatus({ type: "notstarted", description: "Not started" }), "NS");
});

test("normaliza um jogo ao vivo e calcula o minuto da 2.ª parte", () => {
  const fixture = normalizeSofascoreEvent(liveEvent(), NOW);
  assert.equal(fixture.id, "9001");
  assert.equal(fixture.status, "2H");
  assert.equal(fixture.home_score, 1);
  assert.equal(fixture.away_score, 0);
  assert.equal(fixture.minute, 56);
  assert.equal(fixture.kickoff_at, "2026-11-20T12:15:00.000Z");
  assert.equal(fixture.provider, "sofascore");
});

test("não inventa marcador nem minuto quando os campos faltam", () => {
  const fixture = normalizeSofascoreEvent(liveEvent({ homeScore: undefined, awayScore: undefined, time: undefined }), NOW);
  assert.equal(fixture.home_score, null);
  assert.equal(fixture.away_score, null);
  assert.equal(fixture.minute, null);
});

test("rejeita eventos sem equipas, id ou hora de início", () => {
  assert.equal(normalizeSofascoreEvent({ id: 1, homeTeam: { name: "A" } }, NOW), null);
  assert.equal(normalizeSofascoreEvent(liveEvent({ id: null }), NOW), null);
  assert.equal(normalizeSofascoreEvent(liveEvent({ startTimestamp: undefined }), NOW), null);
  assert.deepEqual(normalizeSofascoreLiveList({}, NOW), []);
});

test("trunca o tempo de compensação em vez de inventar um minuto", () => {
  const long = liveEvent({ time: { currentPeriodStartTimestamp: (NOW - 52 * 60 * 1000) / 1000 } });
  assert.equal(normalizeSofascoreEvent(long, NOW).minute, 90);
  const absurd = liveEvent({ time: { currentPeriodStartTimestamp: (NOW - 300 * 60 * 1000) / 1000 } });
  assert.equal(normalizeSofascoreEvent(absurd, NOW).minute, null);
});

test("converte estatísticas do período ALL para home/away", () => {
  const stats = normalizeSofascoreStatistics({
    statistics: [
      { period: "1ST", groups: [{ statisticsItems: [{ name: "Corner kicks", homeValue: 9, awayValue: 9 }] }] },
      { period: "ALL", groups: [{ groupName: "Match overview", statisticsItems: [
        { name: "Ball possession", home: "58%", away: "42%", homeValue: 58, awayValue: 42 },
        { name: "Total shots", homeValue: 14, awayValue: 7 },
        { name: "Shots on target", homeValue: 6, awayValue: 2 },
        { name: "Corner kicks", homeValue: 5, awayValue: 3 },
        { name: "Yellow cards", homeValue: 2, awayValue: 1 },
        { name: "Passes", homeValue: 400, awayValue: 300 },
        { name: "Accurate passes", home: "340/400 (85%)", away: "210/300 (70%)" }
      ] }] }
    ]
  });
  assert.equal(stats.home.possession, 58);
  assert.equal(stats.home.shots, 14);
  assert.equal(stats.home.shots_on_target, 6);
  assert.equal(stats.away.corners, 3);
  assert.equal(stats.home.yellow_cards, 2);
  assert.equal(stats.home.accurate_passes, 340);
  assert.equal(stats.home.pass_accuracy, 85);
  assert.equal(hasStatistics(stats), true);
});

test("estatísticas ausentes ou desconhecidas ficam vazias", () => {
  assert.equal(hasStatistics(normalizeSofascoreStatistics({})), false);
  assert.equal(hasStatistics(normalizeSofascoreStatistics({ statistics: [{ period: "ALL", groups: [{ statisticsItems: [{ name: "Algo novo", homeValue: 1 }] }] }] })), false);
});

test("converte incidentes e devolve do mais antigo para o mais recente", () => {
  const events = normalizeSofascoreIncidents({ incidents: [
    { incidentType: "card", incidentClass: "red", time: 70, isHome: false, player: { name: "Jogador C" } },
    { incidentType: "goal", incidentClass: "regular", time: 52, isHome: true, player: { name: "Jogador B" } },
    { incidentType: "card", incidentClass: "yellowRed", time: 40, isHome: false, player: { name: "Jogador A" } },
    { incidentType: "period", text: "HT" },
    { incidentType: "substitution", time: 60, isHome: true, playerIn: { name: "Entra" }, playerOut: { name: "Sai" } }
  ] });
  assert.deepEqual(events.map(event => event.event_type), ["second_yellow", "goal", "substitution", "red_card"]);
  assert.equal(events[1].player_name, "Jogador B");
  assert.equal(events[1].team_side, "home");
  assert.equal(events.at(-1).minute, 70);
});

test("pickTracked só escolhe jogos na janela de acompanhamento", () => {
  const tickets = [{ ticket_legs: [
    { matches: { id: "a", kickoff_at: "2026-11-20T12:15:00Z" } },
    { matches: { id: "b", kickoff_at: "2026-11-20T20:00:00Z" } },
    { matches: { id: "c", kickoff_at: "2026-11-20T03:00:00Z" } },
    { matches: { id: "a", kickoff_at: "2026-11-20T12:15:00Z" } },
    { matches: { id: "d", kickoff_at: "hora inválida" } }
  ] }];
  assert.deepEqual(pickTracked(tickets, NOW).map(match => match.id), ["a"]);
});

// ---- ciclo completo com uma base de dados e um SofaScore simulados ----
function fakeDb(tickets) {
  const rows = [], writes = [];
  let nextId = 1;
  return {
    rows, writes,
    from(table) {
      const query = { filters: [], op: "select", payload: null };
      const run = single => {
        if (table === "tickets") return { data: tickets, error: null };
        const matching = rows.filter(row => query.filters.every(([col, value]) => row[col] === value));
        if (query.op === "insert") { rows.push({ id: nextId++, ...query.payload }); writes.push(query.payload.source); return { error: null }; }
        if (query.op === "update") { for (const row of matching) Object.assign(row, query.payload); writes.push(matching[0]?.source); return { error: null }; }
        return { data: single ? matching[0] ?? null : matching, error: null };
      };
      const builder = {
        select: () => builder,
        eq: (col, value) => { query.filters.push([col, value]); return builder; },
        order: () => builder, limit: () => builder,
        update: payload => { query.op = "update"; query.payload = payload; return builder; },
        insert: payload => { query.op = "insert"; query.payload = payload; return Promise.resolve(run()); },
        maybeSingle: () => Promise.resolve(run(true)),
        then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject)
      };
      return builder;
    }
  };
}

const ticketsFor = matches => [{ ticket_legs: matches.map(match => ({ matches: match })) }];
const matchA = { id: "m-a", home_team: "Alpha FC", away_team: "Beta United", kickoff_at: "2026-11-20T12:15:00Z", status: "scheduled" };
const matchB = { id: "m-b", home_team: "Gama", away_team: "Delta", kickoff_at: "2026-11-20T12:30:00Z", status: "scheduled" };
const quiet = () => {};
const noPause = () => Promise.resolve();

function fakeApi(routes, calls = []) {
  return async path => {
    calls.push(path);
    const value = routes[path];
    if (value instanceof Error) throw value;
    if (value === undefined) throw new Error("sem resposta simulada para " + path);
    return value;
  };
}

const fullRoutes = () => ({
  "/sport/football/events/live": { events: [liveEvent()] },
  "/event/9001/incidents": { incidents: [{ incidentType: "goal", incidentClass: "regular", time: 52, isHome: true, player: { name: "Jogador B" } }] },
  "/event/9001/statistics": { statistics: [{ period: "ALL", groups: [{ statisticsItems: [{ name: "Corner kicks", homeValue: 5, awayValue: 3 }] }] }] }
});

test("ciclo: grava o jogo primeiro, depois eventos e estatísticas; ignora o jogo sem correspondência", async () => {
  const db = fakeDb(ticketsFor([matchA, matchB]));
  const summary = await runCycle({ db, getJson: fakeApi(fullRoutes()), now: NOW, log: quiet, pause: noPause });
  assert.deepEqual(db.writes, ["SofaScore-fixture", "SofaScore-live-events", "SofaScore-live"]);
  assert.equal(summary.tracked, 2);
  assert.equal(summary.matched, 1);
  assert.ok(db.rows.every(row => row.match_id === "m-a"));
  const fixtureRow = db.rows.find(row => row.source === "SofaScore-fixture");
  assert.equal(fixtureRow.payload.fixture.home_score, 1);
  assert.equal(fixtureRow.payload.eventId, "9001");
  const stats = db.rows.find(row => row.source === "SofaScore-live");
  assert.ok(Date.parse(stats.collected_at) >= Date.parse(fixtureRow.collected_at));
});

test("ciclo: não grava eventos nem estatísticas vazios (podia ser falta de cobertura)", async () => {
  const routes = fullRoutes();
  routes["/event/9001/incidents"] = { incidents: [] };
  routes["/event/9001/statistics"] = { statistics: [] };
  const db = fakeDb(ticketsFor([matchA]));
  await runCycle({ db, getJson: fakeApi(routes), now: NOW, log: quiet, pause: noPause });
  assert.deepEqual(db.writes, ["SofaScore-fixture"]);
});

test("ciclo: actualiza a mesma linha em vez de acumular linhas novas", async () => {
  const db = fakeDb(ticketsFor([matchA]));
  await runCycle({ db, getJson: fakeApi(fullRoutes()), now: NOW, log: quiet, pause: noPause });
  await runCycle({ db, getJson: fakeApi(fullRoutes()), now: NOW + 60_000, log: quiet, pause: noPause });
  assert.equal(db.rows.length, 3);
});

test("ciclo: um bloqueio 403/429 pára o ciclo e não grava nada", async () => {
  const db = fakeDb(ticketsFor([matchA]));
  const getJson = fakeApi({ "/sport/football/events/live": new BlockedError("bloqueado") });
  await assert.rejects(runCycle({ db, getJson, now: NOW, log: quiet, pause: noPause }), BlockedError);
  assert.equal(db.writes.length, 0);
});

test("ciclo: sem jogos na janela não faz nenhum pedido ao SofaScore", async () => {
  const db = fakeDb(ticketsFor([{ ...matchA, kickoff_at: "2026-11-21T20:00:00Z" }]));
  const calls = [];
  const summary = await runCycle({ db, getJson: fakeApi(fullRoutes(), calls), now: NOW, log: quiet, pause: noPause });
  assert.equal(summary.tracked, 0);
  assert.equal(calls.length, 0);
});

test("ciclo: confirma o estado final uma única vez quando o jogo sai da lista ao vivo", async () => {
  const db = fakeDb(ticketsFor([matchA]));
  const state = newState();
  await runCycle({ db, getJson: fakeApi(fullRoutes()), state, now: NOW, log: quiet, pause: noPause });

  const finished = liveEvent({ status: { type: "finished", description: "Ended" }, homeScore: { current: 2 }, awayScore: { current: 1 } });
  const calls = [];
  const routes = { ...fullRoutes(), "/sport/football/events/live": { events: [] }, "/event/9001": { event: finished } };
  await runCycle({ db, getJson: fakeApi(routes, calls), state, now: NOW + 3_600_000, log: quiet, pause: noPause });
  const fixtureRow = db.rows.find(row => row.source === "SofaScore-fixture");
  assert.equal(fixtureRow.payload.fixture.status, "FT");
  assert.equal(fixtureRow.payload.fixture.home_score, 2);
  assert.ok(state.final.has("m-a"));

  calls.length = 0;
  await runCycle({ db, getJson: fakeApi(routes, calls), state, now: NOW + 3_660_000, log: quiet, pause: noPause });
  assert.deepEqual(calls, ["/sport/football/events/live"]);
});
