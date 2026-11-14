export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const secret = process.env.CRON_SECRET || "";

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    diagnosticOnly: true,
    cronSecretConfigured: secret.length > 0,
    cronSecretLength: secret.length,
    hasLeadingOrTrailingWhitespace: secret !== secret.trim(),
    containsWhitespace: /\\s/.test(secret),
    vercelEnvironment: process.env.VERCEL_ENV || null
  });
}
