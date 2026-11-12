import discoverFixtures from "../lib/pipeline/discover-fixtures.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  // Esta ferramenta temporária só pode executar em deployments Preview.
  // O Deployment Protection da Vercel protege o acesso ao Preview.
  if (process.env.VERCEL_ENV !== "preview") {
    return res.status(404).json({ error: "Rota disponível apenas no Preview." });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  // O segredo permanece no servidor e nunca é enviado ao navegador.
  req.headers.authorization = `Bearer ${process.env.CRON_SECRET || ""}`;
  req.body = { days: 2 };
  return discoverFixtures(req, res);
}
