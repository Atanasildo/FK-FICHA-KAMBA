import test from "node:test";
import assert from "node:assert/strict";
import { matchFixture, normalizeTeam } from "./live-tickets.js";

test("normaliza nomes de selecções nacionais em português e inglês", () => {
  assert.equal(normalizeTeam("Polônia"), normalizeTeam("Poland"));
  assert.equal(normalizeTeam("País de Gales"), normalizeTeam("Wales"));
  assert.equal(normalizeTeam("República da Irlanda"), normalizeTeam("Republic of Ireland"));
});

test("associa equipas na ordem correcta e com tolerância horária", () => {
  const match = {
    home_team: "Portugal", away_team: "País de Gales",
    kickoff_at: "2026-11-17T19:45:00Z"
  };
  const fixture = {
    id: 991, home_team: "Portugal", away_team: "Wales",
    kickoff_at: "2026-11-17T20:15:00Z"
  };
  assert.equal(matchFixture(match, [fixture])?.id, 991);
});

test("não associa equipas invertidas nem jogos com hora incompatível", () => {
  const match = {
    home_team: "Portugal", away_team: "Wales",
    kickoff_at: "2026-11-17T19:45:00Z"
  };
  const reversed = {
    id: 1, home_team: "Wales", away_team: "Portugal",
    kickoff_at: "2026-11-17T19:45:00Z"
  };
  const tooLate = {
    id: 2, home_team: "Portugal", away_team: "Wales",
    kickoff_at: "2026-11-18T02:00:00Z"
  };
  assert.equal(matchFixture(match, [reversed, tooLate]), null);
});

test("recusa correspondências temporais ambíguas", () => {
  const match = {
    home_team: "Portugal", away_team: "Wales",
    kickoff_at: "2026-11-17T19:45:00Z"
  };
  const fixtures = [
    { id: 1, home_team: "Portugal", away_team: "Wales", kickoff_at: "2026-11-17T19:40:00Z" },
    { id: 2, home_team: "Portugal", away_team: "Wales", kickoff_at: "2026-11-17T19:50:00Z" }
  ];
  assert.equal(matchFixture(match, fixtures), null);
});

test("não reutiliza um ID SportAPI já atribuído a outro jogo", () => {
  const match = {
    home_team: "Portugal", away_team: "Wales",
    kickoff_at: "2026-11-17T19:45:00Z"
  };
  const fixture = {
    id: 991, home_team: "Portugal", away_team: "Wales",
    kickoff_at: "2026-11-17T19:45:00Z"
  };
  assert.equal(matchFixture(match, [fixture], new Set(["991"])), null);
});
