const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

const SYSTEM_PROMPT = `És o motor interno de análise do FK — Ficha Kamba.
Analisa exclusivamente os jogos, mercados e odds recebidos no pedido.
Nunca inventes jogos, equipas, competições, datas, estatísticas, mercados, selecções ou odds.
Só podes recomendar uma selecção que exista exactamente na lista de mercados fornecida para o respectivo jogo.
Se os dados forem insuficientes, contraditórios ou desactualizados, não recomendes essa selecção.
Não afirmes que consultaste fontes externas. Não inventes probabilidades nem factos ausentes.
Considera forma recente, casa/fora, confrontos directos e estatísticas apenas quando esses dados forem fornecidos.
Aplica os critérios internos do FK: odds individuais mínimas de 1.40; procurar combinações com odd total mínima de 10.00; preparar um conjunto diário equilibrado e não preencher quantidades artificialmente.
Isto é uma análise preliminar: não confirmes bilhetes, reservas ou IDs de reserva. `;

const responseSchema = {
  type: "object",
  properties: {
    analysisStatus: { type: "string", enum: ["ready", "insufficient_data"] },
    summary: { type: "string" },
    selections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          fixtureId: { type: "string" },
          market: { type: "string" },
          selection: { type: "string" },
          rationale: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] }
        },
        required: ["fixtureId", "market", "selection", "rationale", "confidence"],
        additionalProperties: false
      }
    },
    rejectedFixtureIds: { type: "array", items: { type: "string" } }
  },
  required: ["analysisStatus", "summary", "selections", "rejectedFixtureIds"],
  additionalProperties: false
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "GROQ_API_KEY ainda não foi configurada na Vercel." });
  }

  const fixtures = req.body?.fixtures;
  if (!Array.isArray(fixtures) || fixtures.length === 0 || fixtures.length > 50) {
    return res.status(400).json({ error: "Envia entre 1 e 50 jogos reais no campo fixtures." });
  }

  const validFixtures = [];
  for (const fixture of fixtures) {
    if (
      !fixture || typeof fixture.id !== "string" ||
      typeof fixture.home !== "string" || typeof fixture.away !== "string" ||
      !Array.isArray(fixture.markets)
    ) {
      return res.status(400).json({ error: "Cada jogo precisa de id, home, away e markets." });
    }
    const markets = fixture.markets.filter(m =>
      m && typeof m.market === "string" &&
      typeof m.selection === "string" &&
      Number.isFinite(Number(m.odds)) && Number(m.odds) >= 1.01
    );
    validFixtures.push({
      id: fixture.id,
      competition: typeof fixture.competition === "string" ? fixture.competition : null,
      kickoff: typeof fixture.kickoff === "string" ? fixture.kickoff : null,
      home: fixture.home,
      away: fixture.away,
      status: typeof fixture.status === "string" ? fixture.status : null,
      markets
    });
  }

  if (!validFixtures.some(f => f.markets.length)) {
    return res.status(422).json({ error: "Não existem odds e mercados válidos para analisar. Não serão inventados." });
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_completion_tokens: 5000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify({ task: "Avalia os jogos e devolve apenas selecções sustentadas pelos mercados fornecidos.", fixtures: validFixtures }) }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "fk_match_analysis",
            strict: true,
            schema: responseSchema
          }
        }
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const status = response.status === 429 ? 429 : 502;
      return res.status(status).json({
        error: response.status === 429 ? "Limite gratuito da Groq atingido. Tenta novamente mais tarde." : "A Groq não conseguiu concluir a análise.",
        detail: payload.error?.message || `Resposta HTTP ${response.status}.`
      });
    }

    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return res.status(502).json({ error: "A Groq devolveu uma resposta vazia." });

    const analysis = JSON.parse(raw);
    const byId = new Map(validFixtures.map(f => [f.id, f]));
    const verifiedSelections = analysis.selections.filter(item => {
      const fixture = byId.get(item.fixtureId);
      if (!fixture) return false;
      return fixture.markets.some(m =>
        m.market === item.market &&
        m.selection === item.selection &&
        Number(m.odds) >= 1.4
      );
    });

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      provider: "Groq",
      model: payload.model || MODEL,
      generatedAt: new Date().toISOString(),
      analysisStatus: verifiedSelections.length ? analysis.analysisStatus : "insufficient_data",
      summary: analysis.summary,
      selections: verifiedSelections,
      rejectedFixtureIds: analysis.rejectedFixtureIds,
      note: "Análise preliminar. Não constitui reserva nem publicação de bilhete."
    });
  } catch (error) {
    return res.status(502).json({ error: "Falha ao contactar ou interpretar a resposta da Groq." });
  }
}
