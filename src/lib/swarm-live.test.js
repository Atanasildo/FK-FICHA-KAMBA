import test from "node:test";
import assert from "node:assert/strict";
import { buildSwarmLegUpdates } from "./swarm-live.js";

test("associa jogo Swarm ao boletim por equipas e hora e devolve marcador/minuto", () => {
  const kickoff = "2026-11-17T14:00:00.000Z";
  const tickets = [{ legs: [{
    id: "leg-1",
    home: "Togo",
    away: "Argélia",
    date: kickoff
  }] }];
  const feeds = [{
    name: "ElephantBet",
    games: [{
      id: "swarm-1",
      home: "Togo",
      away: "Algeria",
      kickoff: Date.parse(kickoff),
      live: true,
      homeScore: 0,
      awayScore: 1,
      clock: "67:12",
      lastEvent: { type: "goal", minute: 65, player: "Jogador" },
      statsRaw: { corner: [3, 4] },
      bookmaker: "ElephantBet"
    }]
  }];
  const result = buildSwarmLegUpdates(tickets, feeds);
  assert.equal(result.matched, 1);
  assert.equal(result.totalGames, 1);
  assert.equal(result.updates["leg-1"].matchStatus, "LIVE");
  assert.equal(result.updates["leg-1"].homeScore, 0);
  assert.equal(result.updates["leg-1"].awayScore, 1);
  assert.equal(result.updates["leg-1"].minute, "67");
  assert.equal(result.updates["leg-1"].liveSource, "ElephantBet");
});

test("não associa jogos quando os nomes ou o horário são ambíguos", () => {
  const tickets = [{ legs: [{ id: "leg-2", home: "Togo", away: "Argélia", date: "2026-11-17T14:00:00.000Z" }] }];
  const feeds = [{ name: "BantuBet", games: [
    { id: "a", home: "Togo", away: "Algeria", kickoff: Date.parse("2026-11-18T14:00:00.000Z"), live: true },
    { id: "b", home: "Togo", away: "Outro", kickoff: Date.parse("2026-11-17T14:00:00.000Z"), live: true }
  ] }];
  const result = buildSwarmLegUpdates(tickets, feeds);
  assert.equal(result.matched, 0);
  assert.deepEqual(result.updates, {});
});
