import { createHash } from "node:crypto";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const secret = process.env.CRON_SECRET;
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(200).json({
    diagnosticOnly: true,
    cronSecretConfigured: typeof secret === "string" && secret.length > 0,
    cronSecretLength: typeof secret === "string" ? secret.length : 0,
    cronSecretFingerprint: typeof secret === "string" && secret.length > 0
      ? createHash("sha256").update(secret, "utf8").digest("hex")
      : null
  });
}
