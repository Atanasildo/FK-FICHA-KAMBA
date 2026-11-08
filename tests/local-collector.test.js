import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

test("runner local e extractores têm sintaxe JavaScript válida", () => {
  for (const file of [
    "tools/local-bookmaker-collector.js",
    "tools/bantubet-console-collector.js",
    "tools/elephantbet-console-collector.js"
  ]) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ["--check", file]));
  }
});

test("exemplo de configuração contém campos necessários para as duas casas", () => {
  const events = JSON.parse(readFileSync("tools/events.local.example.json", "utf8"));
  assert.ok(Array.isArray(events) && events.length > 0);
  for (const event of events) {
    for (const key of ["id", "home", "away", "bantubetUrl", "elephantbetUrl"]) {
      assert.equal(typeof event[key], "string");
      assert.ok(event[key].length > 0);
    }
  }
});
