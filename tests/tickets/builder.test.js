import test from "node:test";
import assert from "node:assert/strict";
import { teamKey } from "../../lib/tickets/builder.js";

test("normaliza nomes de equipas com e sem acentos para evitar repetições", () => {
  assert.equal(teamKey("São Paulo"), teamKey("Sao Paulo"));
  assert.equal(teamKey("Atlético Mineiro"), teamKey("Atletico Mineiro"));
});
