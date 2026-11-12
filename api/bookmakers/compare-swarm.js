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
    const result = compareSwarmCollections({ bantu: req.body?.bantu, elephant: req.body?.elephant });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({ error: "Não foi possível comparar as recolhas Swarm.", detail: error.message });
  }
}
