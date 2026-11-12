import buildTickets from "../lib/pipeline/build-tickets.js";
import discoverFixtures from "../lib/pipeline/discover-fixtures.js";
import saveAnalysis from "../lib/pipeline/save-analysis.js";

const handlers = {
  "build-tickets": buildTickets,
  "discover-fixtures": discoverFixtures,
  "save-analysis": saveAnalysis
};

export default async function handler(req, res) {
  const action = String(req.query?.action || "").trim();
  const selected = handlers[action];
  if (!selected) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).json({
      error: "Operação de pipeline não encontrada.",
      available: Object.keys(handlers)
    });
  }
  return selected(req, res);
}
