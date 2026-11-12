import { compareFixtures, describeMarket, describeSelection, canonicalLine } from "../lib/bookmakers/comparison.js";

const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
const MIN_ODDS = 1.4;

const SYSTEM_PROMPT = `És o agente autónomo de análise desportiva do FK — Ficha Kamba, focado em futebol e no mercado angolano.

MISSÃO
Analisar os jogos recebidos, verificar o contexto desportivo, identificar selecções sustentadas e devolver recomendações estruturadas para o motor do FK. Trabalhas com dados reais e ferramentas disponíveis; não afirmas que executaste uma tarefa se não recebeste confirmação da ferramenta.

REGRAS DE DADOS
1. Nunca inventes jogos, equipas, competições, datas, horas, resultados, estatísticas, mercados, selecções, odds, bookmakers, URLs ou fontes.
2. Considera os dados estruturados recebidos do FK e da SportAPI como fonte primária para identificação do jogo, calendário, estado e estatísticas.
3. Na primeira fase, usa a ferramenta browser_search para procurar contexto público recente de cada jogo quando isso puder melhorar a análise. Dá prioridade a fontes oficiais de clubes, ligas e federações. Na segunda fase, usa apenas os resultados dessa pesquisa e os dados estruturados enviados pelo FK.
4. Não uses resultados de pesquisa genéricos, previsões de terceiros ou odds encontradas em páginas não verificadas como se fossem cotações confirmadas da BantuBet ou ElephantBet.
5. Não transformes ausência de informação em confirmação. Se lesões, suspensões, escalações ou forma não estiverem disponíveis, indica que não foram confirmadas.
6. Verifica sempre a data, o fuso horário Africa/Luanda e o estado do jogo. Exclui jogos iniciados, terminados, adiados, cancelados ou com estado incerto.
7. Se os dados forem insuficientes, contraditórios, antigos ou não corresponderem ao jogo, rejeita-o em vez de adivinhar.

ANÁLISE
8. Analisa primeiro o desempenho desportivo, sem usar odds para decidir a selecção.
9. Considera forma recente, golos marcados/sofridos, desempenho casa/fora, confrontos directos, classificação, calendário, descanso e ausências confirmadas, apenas quando os dados existirem.
10. Avalia cada mercado pelo seu contexto específico. Não assumes que uma equipa favorita é automaticamente uma boa aposta.
11. Escolhe apenas mercados e selecções que existam exactamente nos mercados fornecidos para o jogo. Não cries mercados novos. Mantém sempre a linha, o tipo e a base exactos de cada mercado; duas selecções chamadas apenas “Mais de” com linhas diferentes são selecções diferentes.
12. Evita mercados demasiado dependentes de acontecimentos imprevisíveis quando não há evidência suficiente.
13. Estima fairProbability apenas com base em estatísticas fornecidas e evidência verificável; se não houver base suficiente, rejeita a selecção. O servidor calcula EV = fairProbability × odd − 1 e valida o mínimo de +3%. Não inventes dados de suporte.
14. Se não houver uma oportunidade suficientemente sustentada, não selecciones o jogo.

ODDS E CASAS
15. As odds não podem influenciar a escolha inicial do mercado.
16. Depois da escolha desportiva, o servidor do FK valida e compara as cotações recebidas das casas.
17. Só considera BantuBet e ElephantBet como casas válidas para esta fase, salvo instrução explícita futura.
18. Uma selecção só é elegível quando existe a mesma partida, o mesmo período, o mesmo mercado, a mesma linha e a mesma selecção nas duas casas.
19. A odd individual mínima é 1.40. Nunca reduzas este limite para preencher boletins.
20. Não combines linhas diferentes, períodos diferentes, handicaps diferentes ou mercados semanticamente distintos.
21. Não inventes uma cotação em falta nem uses uma cotação antiga como actual. Se a hora de recolha não estiver disponível, assinala a limitação.
22. A comparação final das odds é feita pelo servidor; não declares uma odd como confirmada apenas com base na tua pesquisa Web.

BOLETINS
23. O motor deve construir 6 a 8 boletins: 2 curtas (odd 15–25, 3–5 selecções), 2 médias (25–60, 3–6), 2 a 3 longas (60–150, 5–8) e 0 a 1 extrema (400–900, 9–11).
24. Nenhuma odd individual pode ser inferior a 1.40; EV por selecção ≥ +3%; EV por boletim ≥ +10%.
25. Cada jogo aparece num único boletim do lote; só no extrema se admitem até 2 selecções do mesmo jogo. Nenhuma equipa pode repetir no lote. Máximo 2 selecções da mesma liga por boletim.
26. Cada jogo deve começar pelo menos 6 horas depois da publicação. Cada selecção precisa de justificação clara com pelo menos 12 caracteres.
27. Não inventes probabilidades, odds, correlações ou dados em falta. A probabilidade conjunta e o EV são validados no servidor; não declares o lote válido sem essa validação.
28. Se o pool não permitir cumprir as regras, devolve menos selecções válidas e explica as limitações; nunca relaxes a odd mínima, exclusividade de jogos ou número de selecções.
29. As odds totais são calculadas pelo servidor, multiplicando odds individuais efectivamente verificadas.

LIMITES DE ACÇÃO — OBRIGATÓRIOS
31. Podes analisar e pesquisar com as ferramentas efectivamente disponibilizadas no pedido. A gravação de dados é executada pelo servidor FK apenas quando a rota de persistência é chamada e confirma sucesso.
32. Podes solicitar a reserva de um boletim exclusivamente através da rota protegida de reserva do servidor FK, depois de todas as validações. Nunca fabriques bookingId; usa apenas o ID devolvido pela casa.
33. NÃO coloques apostas, NÃO submetas apostas, NÃO movimentes dinheiro e NÃO acedas a contas pessoais de utilizadores.
34. Reservar significa apenas gerar um link/bookingId de partilha. Não significa que foi colocada uma aposta.
35. Nunca declares que um boletim foi publicado, guardado ou acompanhado sem confirmação explícita da ferramenta correspondente.
36. Devolve resultados claros, com fontes, hora de recolha, dados em falta e motivo de rejeição.

Responde exclusivamente no formato JSON definido pelo esquema da API. `;

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
          line: { type: ["string", "null"] },
          marketType: { type: ["string", "null"] },
          marketBase: { type: ["string", "null"] },
          rationale: { type: "string", minLength: 12 },
          fairProbability: { type: "number", minimum: 0, maximum: 1 },
          confidence: { type: "string", enum: ["low", "medium", "high"] }
        },
        required: ["fixtureId", "market", "selection", "line", "marketType", "marketBase", "rationale", "fairProbability", "confidence"],
        additionalProperties: false
      }
    },
    rejectedFixtureIds: { type: "array", items: { type: "string" } }
  },
  required: ["analysisStatus", "summary", "selections", "rejectedFixtureIds"],
  additionalProperties: false
};

function canonicalMarketKey(marketName, selection, meta = {}) {
  const market = describeMarket(marketName, meta.marketType);
  const line = canonicalLine(meta.line ?? meta.marketBase);
  return [
    market.period, market.scope, market.kind, market.entity || "", market.fallback || "",
    String(meta.marketType || ""), String(meta.marketBase ?? ""),
    describeSelection(marketName, { selection, line, marketBase: meta.marketBase, marketType: meta.marketType })
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
    const markets = fixture.markets.filter(m => {
      if (!m || typeof m.market !== "string" || typeof m.selection !== "string" ||
          !Number.isFinite(Number(m.odds)) || Number(m.odds) <= 1 ||
          typeof (m.bookmaker || fixture.bookmaker) !== "string") return false;
      const isOverUnder = /^(mais de|mais|over|menos de|menos|under)\\b/i.test(m.selection.trim());
      const line = canonicalLine(m.line ?? m.marketBase) || canonicalLine(
        m.selection.match(/(?:mais de|mais|over|menos de|menos|under)\\s+([+-]?\\d+(?:[.,]\\d+)?)/i)?.[1]
      );
      return !isOverUnder || !!line;
    });
    const unique = new Map();
    for (const m of markets) {
      const line = canonicalLine(m.line ?? m.marketBase) || canonicalLine(
        String(m.selection).match(/(?:mais de|mais|over|menos de|menos|under)\\s+([+-]?\\d+(?:[.,]\\d+)?)/i)?.[1]
      );
      const key = canonicalMarketKey(m.market, m.selection, { line, marketType: m.marketType, marketBase: m.marketBase });
      if (!unique.has(key)) unique.set(key, {
        market: m.market, selection: m.selection,
        line, marketType: m.marketType || null,
        marketBase: m.marketBase == null ? null : String(m.marketBase)
      });
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

  // Junta as recolhas das duas casas num único jogo antes de enviar à IA.
  const groupedFixtures = new Map();
  const conflictedIds = new Set();
  for (const fixture of validFixtures) {
    if (conflictedIds.has(fixture.id)) continue;
    if (!groupedFixtures.has(fixture.id)) {
      groupedFixtures.set(fixture.id, { ...fixture, markets: [...fixture.markets] });
      continue;
    }
    const existing = groupedFixtures.get(fixture.id);
    if (existing.home !== fixture.home || existing.away !== fixture.away ||
        (existing.competition || "") !== (fixture.competition || "")) {
      excluded.push({ fixtureId: fixture.id, reason: "As recolhas com o mesmo ID apresentam equipas ou competição diferentes." });
      groupedFixtures.delete(fixture.id);
      conflictedIds.add(fixture.id);
      continue;
    }
    const merged = new Map(existing.markets.map(m => [canonicalMarketKey(m.market, m.selection, m), m]));
    for (const market of fixture.markets) merged.set(canonicalMarketKey(market.market, market.selection, market), market);
    existing.markets = [...merged.values()];
  }
  const safeIds = new Set(groupedFixtures.keys());
  const deduplicatedFixtures = [...groupedFixtures.values()];

  if (!deduplicatedFixtures.length) {
    return res.status(422).json({
      error: "Nenhum jogo tem estatísticas e mercados suficientes para análise.",
      excluded
    });
  }

  const fixtureQuotes = fixtures.filter(f => safeIds.has(f.id) && !isStarted(f.status));
  const aiInput = deduplicatedFixtures.map(({ stats, markets, ...fixture }) => ({ ...fixture, stats, markets }));
  try {
    const researchResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_completion_tokens: 3500,
        messages: [
          {
            role: "system",
            content: "És o investigador desportivo do FK. Pesquisa na Web usando browser_search. Para cada jogo, procura notícias recentes e fontes oficiais sobre forma, ausências confirmadas, calendário, descanso e contexto competitivo. Não procures odds nem previsões de apostas. Não inventes dados. Se não encontrares informação fiável, diz claramente que não foi encontrada. Devolve um resumo conciso com URLs/fontes e a data de cada informação."
          },
          {
            role: "user",
            content: JSON.stringify({ timezone: "Africa/Luanda", fixtures: aiInput.map(({ markets, ...fixture }) => fixture) })
          }
        ],
        tools: [{ type: "browser_search" }],
        tool_choice: "auto"
      })
    });

    const researchPayload = await researchResponse.json().catch(() => ({}));
    if (!researchResponse.ok) {
      return res.status(researchResponse.status === 429 ? 429 : 502).json({
        error: researchResponse.status === 429 ? "Limite de pesquisa Web da Groq atingido." : "A pesquisa Web da Groq falhou.",
        detail: researchPayload.error?.message || `Resposta HTTP ${researchResponse.status}.`
      });
    }
    const researchText = researchPayload.choices?.[0]?.message?.content || "";
    if (!researchText.trim()) return res.status(502).json({ error: "A Groq não devolveu resultados da pesquisa Web." });

    const analysisResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        max_completion_tokens: 5000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify({
            task: "Analisa a evidência desportiva e escolhe apenas mercados sustentados. As odds não são fornecidas. Usa a pesquisa Web como complemento, não como substituto das estatísticas verificadas.",
            timezone: "Africa/Luanda",
            fixtures: aiInput,
            webResearch: researchText
          }) }
        ],
        response_format: { type: "json_schema", json_schema: { name: "fk_match_analysis", strict: true, schema: responseSchema } }
      })
    });

    const payload = await analysisResponse.json().catch(() => ({}));
    if (!analysisResponse.ok) {
      return res.status(analysisResponse.status === 429 ? 429 : 502).json({
        error: analysisResponse.status === 429 ? "Limite da análise Groq atingido." : "A Groq não conseguiu concluir a análise estruturada.",
        detail: payload.error?.message || `Resposta HTTP ${analysisResponse.status}.`
      });
    }
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return res.status(502).json({ error: "A Groq devolveu uma resposta vazia ou sem JSON estruturado." });
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
      const fixture = deduplicatedFixtures.find(f => f.id === item.fixtureId);
      if (!fixture || !fixture.markets.some(m => m.market === item.market && m.selection === item.selection)) continue;
      const eventKey = [fixture.home.toLowerCase(), fixture.away.toLowerCase(), (fixture.competition || "").toLowerCase()].join("|");
      const wantedKey = canonicalMarketKey(item.market, item.selection, item);
      const candidate = (comparisonByEvent.get(eventKey) || []).find(c =>
        canonicalMarketKey(c.market, c.selection, c) === wantedKey
      );
      if (!candidate || candidate.quotes.length < 2 || candidate.bestOdds < MIN_ODDS) continue;
      const fairProbability = Number(item.fairProbability);
      const expectedValue = fairProbability * candidate.bestOdds - 1;
      if (!Number.isFinite(fairProbability) || fairProbability <= 0 || fairProbability > 1 || expectedValue < 0.03 || String(item.rationale || "").trim().length < 12) continue;
      verifiedSelections.push({
        fixtureId: item.fixtureId,
        home: fixture.home,
        away: fixture.away,
        competition: fixture.competition,
        kickoff: fixture.kickoff,
        market: item.market,
        selection: item.selection,
        period: candidate.period,
        line: candidate.line,
        marketType: candidate.marketType,
        marketBase: candidate.marketBase,
        rationale: item.rationale,
        fairProbability,
        ev: Number(expectedValue.toFixed(4)),
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
      researchModel: researchPayload.model || MODEL,
      webResearchUsed: true,
      generatedAt: new Date().toISOString(),
      analysisStatus: verifiedSelections.length ? analysis.analysisStatus : "insufficient_data",
      summary: analysis.summary,
      selections: verifiedSelections,
      rejectedFixtureIds: [...new Set([...(analysis.rejectedFixtureIds || []), ...excluded.map(x => x.fixtureId)])],
      excluded,
      comparisonCount: comparison.comparisonCount,
      rules: { minimumIndividualOdds: MIN_ODDS, bookmakerCountRequired: 2 },
      note: "A Groq analisou sem receber as odds; depois o servidor comparou cotações equivalentes das duas casas. Nenhum ID de reserva foi solicitado ou criado."
    });
  } catch {
    return res.status(502).json({ error: "Falha ao contactar ou interpretar a resposta da Groq." });
  }
}
