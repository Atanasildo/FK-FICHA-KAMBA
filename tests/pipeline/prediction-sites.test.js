import test from "node:test";
import assert from "node:assert/strict";
import { htmlToText, findInText, norm } from "../../lib/pipeline/prediction-sites.js";

test("findInText encontra jogo e percentagens 1/X/2", () => {
  const raw = htmlToText("<div>Lille OSC</div><span>vs</span><div>Bayern München</div><b>11%</b><b>16%</b><b>73%</b> Home win");
  const r = findInText(norm(raw), raw, "Lille OSC", "Bayern Munich");
  assert.deepEqual(r?.pct, [11, 16, 73]);
  assert.equal(findInText(norm(raw), raw, "Inter Milan", "VfB Stuttgart"), null);
});
