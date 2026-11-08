import { compareFixtures, describeMarket, describeSelection } from "../lib/bookmakers/comparison.js";

const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
const MIN_ODDS = 1.4;

const SYSTEM_PROMPT = `És o motor interno de análise do FK — Ficha Kamba.
Analisa exclusivamente os jogos, estatísticas e mercados recebidos.
Nunca inventes jogos, equipas, competições, datas, estatísticas, mercados ou selecções.
Escolhe mercados pela evidência desportiva fornecida, nunca pela odd: as odds não serão mostradas durante a tua decisão.
Só podes devolver uma selecção que exista exactamente na lista de mercados disponíveis para o jogo.
Usa forma recente, golos, casa/fora, confrontos directos, classificação e ausências apenas quando forem fornecidos.
Se as estatísticas forem insuficientes, contraditórias ou desactualizadas, rejeita o jogo.
Não inventes probabilidades, factos nem fontes externas.
Não recomendes apostas em jogos já iniciados ou terminados.
Devolve uma análise preliminar, sem confirmar reservas, bilhetes ou códigos.`;

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

function canonicalMarketKey(marketName, selection) {
  const market = describeMarket(marketName);
  return [
    market.period, market.kind, market.entity || "", market.fallback || "",
    describeSelection(marketName, { selection })
  ].join("|");
}

function isStarted(status) {
  return /live|in.?play|half|finished|ended|full.?time|cancel|postpon|abandon/i.test(String(status || ""));
}

function safeStats(stats) {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return null;
  const encoded = JSON.stringify(stats);
  if (encoded.length > 12000) return null;
  return stats;
}

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
  if (!apiKey) return res.status(503).json({ error: "GROQ_API_KEY ainda não foi configurada no servidor." });

  const fixtures = req.body?.fixtures;
  if (!Array.isArray(fixtures) || fixtures.length === 0 || fixtures.length > 50) {
    return res.status(400).json({ error: "Envia entre 1 e 50 jogos no campo fixtures." });
  }

  const validFixtures = [];
  const excluded = [];
  for (const fixture of fixtures) {
    if (!fixture || typeof fixture.id !== "string" || typeof fixture.home !== "string" ||
        typeof fixture.away !== "string" || !Array.isArray(fixture.markets)) {
      return res.status(400).json({ error: "Cada jogo precisa de id, home, away e markets." });
    }
    if (isStarted(fixture.status)) {
      excluded.push({ fixtureId: fixture.id, reason: "Jogo iniciado, terminado ou indisponível." });
      continue;
    }
    const stats = safeStats(fixture.stats);
    if (!stats) {
      excluded.push({ fixtureId: fixture.id, reason: "Estatísticas ausentes ou demasiado extensas; sem análise não há selecção." });
      continue;
    }
    const markets = fixture.markets.filter(m =>
      m && typeof m.market === "string" && typeof m.selection === "string" &&
      Number.isFinite(Number(m.odds)) && Number(m.odds) > 1 &&
      typeof (m.bookmaker || fixture.bookmaker) === "string"
    );
    const unique = new Map();
    for (const m of markets) {
      const key = canonicalMarketKey(m.market, m.selection);
      if (!unique.has(key)) unique.set(key, { market: m.market, selection: m.selection });
    }
    validFixtures.push({
      id: fixture.id,
      competition: typeof fixture.competition === "string" ? fixture.competition : null,
      kickoff: typeof fixture.kickoff === "string" ? fixture.kickoff : null,
      home: fixture.home,
      away: fixture.away,
      status: fixture.status || "TBD",
      stats,
      markets: [...unique.values()]
    });
  }

  if (!validFixtures.length) {
    return res.status(422).json({
      error: "Nenhum jogo tem estatísticas e mercados suficientes para análise.",
      excluded
    });
  }

  const fixtureQuotes = fixtures.filter(f => validFixtures.some(v => v.id === f.id));
  const aiInput = validFixtures.map(({ stats, markets, ...fixture }) => ({ ...fixture, stats, markets }));
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        max_completion_tokens: 5000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify({
            task: "Analisa primeiro a evidência desportiva e escolhe apenas mercados sustentados. Não recebes odds nesta fase.",
            fixtures: aiInput
          }) }
        ],
        response_format: { type: "json_schema", json_schema: { name: "fk_match_analysis", strict: true, schema: responseSchema } }
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status === 429 ? 429 : 502).json({
        error: response.status === 429 ? "Limite da Groq atingido." : "A Groq não conseguiu concluir a análise.",
        detail: payload.error?.message || `Resposta HTTP ${response.status}.`
      });
    }
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return res.status(502).json({ error: "A Groq devolveu uma resposta vazia." });
    const analysis = JSON.parse(raw);

    // Só depois de a IA escolher o mercado é que consultamos as cotações das casas.
    const comparison = compareFixtures(fixtureQuotes);
    const comparisonByEvent = new Map();
    for (const event of comparison.events) {
      const key = [event.event.home.toLowerCase(), event.event.away.toLowerCase(), (event.event.competition || "").toLowerCase()].join("|");
      comparisonByEvent.set(key, event.comparisons);
    }
    const verifiedSelections = [];
    for (const item of analysis.selections || []) {
      const fixture = validFixtures.find(f => f.id === item.fixtureId);
      if (!fixture || !fixture.markets.some(m => m.market === item.market && m.selection === item.selection)) continue;
      const eventKey = [fixture.home.toLowerCase(), fixture.away.toLowerCase(), (fixture.competition || "").toLowerCase()].join("|");
      const wantedKey = canonicalMarketKey(item.market, item.selection);
      const candidate = (comparisonByEvent.get(eventKey) || []).find(c =>
        canonicalMarketKey(c.market, c.selection) === wantedKey
      );
      if (!candidate || candidate.quotes.length < 2 || candidate.bestOdds < MIN_ODDS) continue;
      verifiedSelections.push({
        fixtureId: item.fixtureId,
        market: item.market,
        selection: item.selection,
        rationale: item.rationale,
        confidence: item.confidence,
        bestOdds: candidate.bestOdds,
        bestBookmaker: candidate.bestBookmaker,
        quotes: candidate.quotes
      });
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      provider: "Groq",
      model: payload.model || MODEL,
      generatedAt: new Date().toISOString(),
      analysisStatus: verifiedSelections.length ? analysis.analysisStatus : "insufficient_data",
      summary: analysis.summary,
      selections: verifiedSelections,
      rejectedFixtureIds: [...new Set([...(analysis.rejectedFixtureIds || []), ...excluded.map(x => x.fixtureId)])],
      excluded,
      comparisonCount: comparison.comparisonCount,
      rules: { minimumIndividualOdds: MIN_ODDS, bookmakerCountRequired: 2 },
      note: "A IA escolheu sem ver as odds; depois foram comparadas cotações equivalentes das duas casas. Isto não confirma disponibilidade nem cria reserva."
    });
  } catch {
    return res.status(502).json({ error: "Falha ao contactar ou interpretar a resposta da Groq." });
  }
}
