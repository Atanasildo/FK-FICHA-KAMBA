const baseUrl = (process.env.FK_API_URL || "https://fk-ficha-kamba-fqkuhujr9-atanasildos-projects.vercel.app").replace(/\/$/, "");
const cronSecret = process.env.CRON_SECRET;
const vercelBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const publishRequested = process.argv.includes("--publish");

if (!cronSecret || !vercelBypass) {
  console.error("Faltam variáveis de ambiente. Confirma CRON_SECRET e VERCEL_AUTOMATION_BYPASS_SECRET no CMD; não partilhes os seus valores.");
  process.exit(1);
}

if (baseUrl.includes("fk-ficha-kamba.vercel.app")) {
  console.error("Bloqueado: este teste deve ser executado na Preview, nunca em produção.");
  process.exit(1);
}

const headers = {
  "content-type": "application/json",
  authorization: `Bearer ${cronSecret}`,
  "x-vercel-protection-bypass": vercelBypass
};

async function runBatch(attempt) {
  const response = await fetch(baseUrl + "/api/pipeline/run-daily", {
    method: "POST",
    headers,
    body: JSON.stringify({ skipDiscovery: true, discovered: 433, dryRun: true }),
    signal: AbortSignal.timeout(240000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    const message = result.error || result.message || `HTTP ${response.status}`;
    throw new Error(`${message} (HTTP ${response.status})${result.detail ? " — " + result.detail : ""}`);
  }
  console.log(`\nLOTE DE ANÁLISE ${attempt}`);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

console.log("FK — ANÁLISE DOS JOGOS JÁ RECOLHIDOS");
console.log("Preview:", baseUrl);
console.log(publishRequested
  ? "Modo: analisar primeiro; publicar apenas se os controlos automáticos aprovarem."
  : "Modo de teste activo: não publica bilhetes.");
console.log("Não será feita nova recolha de odds.");

try {
  let result;
  for (let attempt = 1; attempt <= 40; attempt++) {
    result = await runBatch(attempt);
    if (result.stage === "linking-batch-saved" && Number(result.pendingLinks || 0) > 0) continue;
    if (result.stage !== "analysis-batch-saved" || Number(result.pendingMatches || 0) <= 0) break;
  }

  if ((result?.stage === "analysis-batch-saved" && Number(result.pendingMatches || 0) > 0) ||
      (result?.stage === "linking-batch-saved" && Number(result.pendingLinks || 0) > 0)) {
    throw new Error("Ainda existem jogos por analisar após 10 lotes. Nenhum bilhete foi publicado.");
  }

  console.log("\nRESULTADO DA ANÁLISE:", result?.stage || "sem etapa");

  if (publishRequested) {
    if (result?.stage !== "analysis-dry-run-complete" || Number(result.candidateSelections || 0) <= 0) {
      console.log("Publicação bloqueada: a análise não terminou com selecções candidatas. Nenhum bilhete foi publicado.");
      process.exitCode = 2;
    } else {
      console.log("\nA solicitar publicação. O servidor voltará a validar existência de bilhetes, casas e actualidade das odds.");
      const response = await fetch(baseUrl + "/api/pipeline/run-daily", {
        method: "POST",
        headers,
        body: JSON.stringify({ skipDiscovery: true, discovered: 433, dryRun: false }),
        signal: AbortSignal.timeout(240000)
      });
      const publication = await response.json().catch(() => ({}));
      console.log("\nRESULTADO DA PUBLICAÇÃO:");
      console.log(JSON.stringify(publication, null, 2));
      if (!response.ok || publication.ok === false) {
        throw new Error(publication.error || publication.message || `HTTP ${response.status}`);
      }
      if (!["published", "already-published-today", "no-valid-selections", "batch-not-published"].includes(publication.stage)) {
        throw new Error(`Estado de publicação inesperado: ${publication.stage || "desconhecido"}`);
      }
    }
  } else {
    console.log("Este procedimento não publica bilhetes. Revê os resultados antes de avançar.");
  }
} catch (error) {
  console.error("\nA análise não terminou:", error.message);
  process.exitCode = 1;
}
