import test from "node:test";
import assert from "node:assert/strict";
import { matchEventLink, selectUniqueEventLink } from "../lib/bookmakers/event-discovery.js";

test("matches both teams despite accents and common club suffixes", () => {
  assert.equal(matchEventLink(
    { home: "Sporting CP", away: "FC Porto" },
    { text: "Sporting Clube de Portugal vs Futebol Clube do Porto" }
  ).matched, true);
});

test("does not match when only one team is present", () => {
  assert.equal(matchEventLink(
    { home: "Manchester City", away: "Fulham" },
    { text: "Manchester City vs Arsenal" }
  ).matched, false);
});

test("does not silently choose between equally strong event URLs", () => {
  const result = selectUniqueEventLink(
    { home: "Manchester City", away: "Fulham" },
    [
      { text: "Manchester City vs Fulham", url: "https://example.test/event/1" },
      { text: "Manchester City vs Fulham", url: "https://example.test/event/2" }
    ]
  );
  assert.equal(result.status, "ambiguous");
});

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("automatic discovery runner has valid JavaScript syntax", () => {
  const script = new URL("../tools/discover-bookmaker-events.js", import.meta.url);
  const result = spawnSync(process.execPath, ["--check", fileURLToPath(script)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
