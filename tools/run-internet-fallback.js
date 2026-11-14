const baseUrl = process.env.FK_API_URL;
const secret = process.env.CRON_SECRET;
const vercelBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (!baseUrl) {
  console.error("Define FK_API_URL para apontar explicitamente para a Preview da Vercel.");
  process.exit(1);
}
if (!secret) {
  console.error("Falta definir CRON_SECRET no ambiente deste computador.");
  process.exit(1);
}
if (!vercelBypass) {
  console.error("Falta definir VERCEL_AUTOMATION_BYPASS_SECRET para aceder à Preview protegida.");
  process.exit(1);
}

const apiUrl = baseUrl.replace(/\/$/, "");
const headers = {
  "content-type": "application/json",
  authorization: "Bearer " + secret,
  "x-vercel-protection-bypass": vercelBypass
};

async function runBatch() {
  const response = await fetch(apiUrl + "/api/pipeline/run-daily", {
    method: "POST",
    headers,
    body: JSON.stringify({
      skipDiscovery: true,
      dryRun: true,
      internetFallbackOnly: true
    }),
    signal: AbortSignal.timeout(240000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error((body.error || body.message || "Falha na análise") + " (HTTP " + response.status + "): " + JSON.stringify(body));
  }
  return body;
}

console.log("TESTE ISOLADO: jogos sem correspondência SportAPI.");
console.log("As odds já guardadas serão reutilizadas; não haverá nova recolha.");
console.log("Nenhum bilhete será publicado nem será criada qualquer reserva.");

try {
  const maxLinkBatches = 12;
  let result = null;
  for (let attempt = 1; attempt <= maxLinkBatches; attempt++) {
    result = await runBatch();
    console.log("\nETAPA " + attempt);
    console.log(JSON.stringify(result, null, 2));

    if (result.stage !== "linking-batch-saved") break;
  }

  if (result?.stage === "analysis-batch-saved") {
    console.log("\nTESTE DE FALLBACK CONCLUÍDO: um lote de jogo sem SportAPI foi analisado e guardado.");
    console.log("Os restantes jogos não foram processados nesta execução.");
  } else if (result?.stage === "analysis-dry-run-complete") {
    console.log("\nTESTE DE FALLBACK CONCLUÍDO: não havia mais jogos sem SportAPI por analisar.");
  } else if (result?.stage === "no-matches") {
    console.log("\nNão existem jogos sem SportAPI elegíveis neste momento.");
  } else {
    console.log("\nO teste terminou nesta etapa. Verifica o resultado acima antes de continuar.");
  }
  console.log("MODO DE TESTE: não houve publicação nem reservas.");
} catch (error) {
  console.error("\nFALHA NO TESTE:", error.message);
  process.exitCode = 1;
}
