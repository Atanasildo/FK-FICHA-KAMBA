import { compareFixtures, describeMarket, describeSelection } from "../lib/bookmakers/comparison.js";

const MODEL = process.env.XAI_MODEL || process.env.GROK_MODEL || "grok-4.7";
const MIN_ODDS = 1.4;

const SYSTEM_PROMPT = `És o agente autónomo de análise desportiva do FK — Ficha Kamba, focado em futebol e no mercado angolano.

MISSÃO
Analisar os jogos recebidos, verificar o contexto desportivo, identificar selecções sustentadas e devolver recomendações estruturadas para o motor do FK. Trabalhas com dados reais e ferramentas disponíveis; não afirmas que executaste uma tarefa se não recebeste confirmação da ferramenta.

REGRAS DE DADOS
1. Nunca inventes jogos, equipas, competições, datas, horas, resultados, estatísticas, mercados, selecções, odds, bookmakers, URLs ou fontes.
2. Considera os dados estruturados recebidos do FK e da SportAPI como fonte primária para identificação do jogo, calendário, estado e estatísticas.
3. Usa a pesquisa Web apenas para confirmar contexto público relevante e recente, como notícias de equipa, forma ou informação desportiva. Dá prioridade a fontes oficiais e identificáveis.
4. Não uses resultados de pesquisa genéricos, previsões de terceiros ou odds encontradas em páginas não verificadas como se fossem cotações confirmadas da BantuBet ou ElephantBet.
5. Não transformes ausência de informação em confirmação. Se lesões, suspensões, escalações ou forma não estiverem disponíveis, indica que não foram confirmadas.
6. Verifica sempre a data, o fuso horário Africa/Luanda e o estado do jogo. Exclui jogos iniciados, terminados, adiados, cancelados ou com estado incerto.
7. Se os dados forem insuficientes, contraditórios, antigos ou não corresponderem ao jogo, rejeita-o em vez de adivinhar.

ANÁLISE
8. Analisa primeiro o desempenho desportivo, sem usar odds para decidir a selecção.
9. Considera forma recente, golos marcados/sofridos, desempenho casa/fora, confrontos directos, classificação, calendário, descanso e ausências confirmadas, apenas quando os dados existirem.
10. Avalia cada mercado pelo seu contexto específico. Não assumes que uma equipa favorita é automaticamente uma boa aposta.
11. Escolhe apenas mercados e selecções que existam exactamente nos mercados fornecidos para o jogo. Não cries mercados novos.
12. Evita mercados demasiado dependentes de acontecimentos imprevisíveis quando não há evidência suficiente.
13. Não inventes percentagens de probabilidade, valor esperado ou níveis de confiança matemáticos. A confiança deve reflectir a qualidade real da evidência.
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
23. O objectivo operacional é preparar entre 8 e 15 boletins diários quando existirem oportunidades suficientes, sem forçar a quantidade.
24. Cada boletim normal deve ter odd total mínima de 10.00.
25. Podem ser preparados até 3 boletins de odd total igual ou superior a 100.00, mas apenas quando houver selecções suficientes e risco justificável.
26. Prepara variedade: alguns boletins de uma só competição e outros mistos, sem repetir excessivamente os mesmos jogos.
27. Não incluas duas selecções incompatíveis do mesmo jogo no mesmo boletim.
28. Não uses a mesma selecção repetidamente apenas para aumentar artificialmente a quantidade de boletins.
29. Se não houver combinações válidas suficientes, devolve menos boletins e explica porquê. Nunca inventes selecções para atingir metas.
30. As odds totais são calculadas pelo servidor, multiplicando as odds individuais efectivamente verificadas. Não as estimes nem as alteres.

LIMITES DE ACÇÃO — OBRIGATÓRIOS
31. Podes analisar, pesquisar, comparar, preparar e guardar dados e propostas de boletins através das ferramentas autorizadas.
32. NÃO reserves, NÃO solicites, NÃO geres e NÃO inventes ID, código ou referência de reserva de bilhete.
33. NÃO coloques apostas, NÃO submetas apostas, NÃO movimentes dinheiro e NÃO acedas a contas pessoais de utilizadores.
34. Preparar um boletim é apenas produzir uma proposta de selecções; não significa que foi reservado ou apostado.
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

  const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "XAI_API_KEY ainda não foi configurada no servidor." });

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
    const merged = new Map(existing.markets.map(m => [canonicalMarketKey(m.market, m.selection), m]));
    for (const market of fixture.markets) merged.set(canonicalMarketKey(market.market, market.selection), market);
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
    const response = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_output_tokens: 5000,
        store: false,
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify({
            task: "Analisa primeiro a evidência desportiva e escolhe apenas mercados sustentados. Não recebes odds nesta fase. Usa pesquisa Web apenas para confirmar contexto desportivo actual quando for necessário; não procures nem inventes cotações.",
            timezone: "Africa/Luanda",
            fixtures: aiInput
          }) }
        ],
        tools: [{ type: "web_search" }],
        text: {
          format: {
            type: "json_schema",
            name: "fk_match_analysis",
            strict: true,
            schema: responseSchema
          }
        }
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status === 429 ? 429 : 502).json({
        error: response.status === 429 ? "Limite da API Grok atingido." : "A API Grok não conseguiu concluir a análise.",
        detail: payload.error?.message || `Resposta HTTP ${response.status}.`
      });
    }
    const message = (payload.output || []).find(item => item.type === "message");
    const raw = message?.content?.find(item => item.type === "output_text")?.text || payload.output_text;
    if (!raw) return res.status(502).json({ error: "A Grok devolveu uma resposta vazia ou sem JSON estruturado." });
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
      const wantedKey = canonicalMarketKey(item.market, item.selection);
      const candidate = (comparisonByEvent.get(eventKey) || []).find(c =>
        canonicalMarketKey(c.market, c.selection) === wantedKey
      );
      if (!candidate || candidate.quotes.length < 2 || candidate.bestOdds < MIN_ODDS) continue;
      verifiedSelections.push({
        fixtureId: item.fixtureId,
        market: item.market,
        selection: item.selection,
        period: candidate.period,
        line: candidate.line,
        rationale: item.rationale,
        confidence: item.confidence,
        bestOdds: candidate.bestOdds,
        bestBookmaker: candidate.bestBookmaker,
        quotes: candidate.quotes
      });
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      provider: "Grok",
      model: payload.model || MODEL,
      generatedAt: new Date().toISOString(),
      analysisStatus: verifiedSelections.length ? analysis.analysisStatus : "insufficient_data",
      summary: analysis.summary,
      selections: verifiedSelections,
      rejectedFixtureIds: [...new Set([...(analysis.rejectedFixtureIds || []), ...excluded.map(x => x.fixtureId)])],
      excluded,
      comparisonCount: comparison.comparisonCount,
      rules: { minimumIndividualOdds: MIN_ODDS, bookmakerCountRequired: 2 },
      note: "A Grok analisou sem receber as odds; depois o servidor comparou cotações equivalentes das duas casas. Nenhum ID de reserva foi solicitado ou criado."
    });
  } catch {
    return res.status(502).json({ error: "Falha ao contactar ou interpretar a resposta da Grok." });
  }
}
