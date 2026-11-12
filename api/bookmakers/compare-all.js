import { compareFixtures } from "../../lib/bookmakers/comparison.js";
import { compareSwarmCollections } from "../../lib/bookmakers/swarm-comparison.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  try {
    const mode = String(req.query?.mode || "fixtures").toLowerCase();
    let result;
    if (mode === "swarm") {
      result = compareSwarmCollections({ bantu: req.body?.bantu, elephant: req.body?.elephant });
    } else if (mode === "fixtures") {
      const fixtures = req.body?.fixtures;
      if (!Array.isArray(fixtures) || fixtures.length < 2 || fixtures.length > 100) {
        return res.status(400).json({ error: "Envia entre 2 e 100 recolhas de jogos no campo fixtures." });
      }
      const invalid = fixtures.some(f =>
        !f || typeof f.home !== "string" || typeof f.away !== "string" ||
        !Array.isArray(f.markets) || !(f.bookmaker || f.provider)
      );
      if (invalid) {
        return res.status(400).json({
          error: "Cada recolha precisa de home, away, bookmaker e markets."
        });
      }
      result = compareFixtures(fixtures);
    } else {
      return res.status(400).json({ error: "Modo de comparação inválido." });
    }
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({
      error: "Não foi possível concluir a comparação.",
      detail: error.message
    });
  }
}
