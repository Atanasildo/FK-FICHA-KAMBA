# Procedimento de análise manual no ChatGPT

Este procedimento substitui a análise automática por Groq/DeepSeek. A recolha das odds continua a ser feita pelo PC e a análise é iniciada pelo utilizador nesta conversa.

## 1. Seleccionar jogos elegíveis

Consultar apenas jogos:
- com `source = 'swarm'`;
- agendados para a data actual em `Africa/Luanda`;
- com início pelo menos uma hora depois da hora actual;
- com uma comparação de odds criada na última hora;
- com cotações recentes das duas casas.

Consulta-base:

```sql
select
  m.id as match_id,
  m.external_id,
  m.home_team,
  m.away_team,
  m.competition,
  m.kickoff_at,
  m.status,
  latest.created_at as comparison_at,
  latest.comparison
from public.matches m
join lateral (
  select oc.created_at, oc.comparison
  from public.odds_comparisons oc
  where oc.match_id = m.id
  order by oc.created_at desc
  limit 1
) latest on true
where m.source = 'swarm'
  and m.kickoff_at > now() + interval '1 hour'
  and (m.kickoff_at at time zone 'Africa/Luanda')::date =
      (now() at time zone 'Africa/Luanda')::date
  and latest.created_at >= now() - interval '1 hour'
order by m.kickoff_at asc;
```

A consulta é apenas o ponto de partida. Antes de recomendar um mercado, confirmar também que as duas cotações desse mercado estão presentes e recentes em `comparison.events[].comparisons[].quotes[]`. Não interpretar mercados especiais (por exemplo, empate anula aposta) como resultado final 1X2.

## 2. Pesquisa e análise no ChatGPT

Para cada jogo elegível:
- confirmar competição, data, hora e identidade das equipas;
- pesquisar forma recente, classificação, confrontos directos, ausências e escalações, quando disponíveis;
- usar fontes identificáveis e guardar os URLs e a data/hora de consulta;
- calcular probabilidade implícita e retirar a margem do mercado quando existirem cotações suficientes;
- estimar probabilidade própria apenas quando os dados sustentarem a estimativa;
- calcular edge e valor esperado, considerando a incerteza;
- excluir mercados sem informação suficiente, linhas ambíguas ou odds desactualizadas.

Não inventar xG, escalações, lesões, clima ou estatísticas. Distinguir claramente factos confirmados, estimativas e informação indisponível. A ausência de SportAPI não bloqueia esta pesquisa: ChatGPT pesquisa fontes públicas e regista explicitamente as lacunas.

### Contexto de pesquisa a guardar

Quando o jogo não tiver estatísticas SportAPI, guardar em `match_statistics` um registo com `source = 'InternetSearch'` e um payload de pesquisa concluída. Exemplo de estrutura:

```json
{
  "source": "InternetSearch",
  "collectedAt": "ISO-8601",
  "fixture": {
    "home": "Equipa da casa",
    "away": "Equipa visitante",
    "competition": "Competição confirmada ou null",
    "kickoff": "ISO-8601"
  },
  "research": {
    "status": "complete",
    "researchedBy": "ChatGPT",
    "checkedAt": "ISO-8601",
    "facts": [
      {
        "topic": "recent_form",
        "claim": "Facto confirmado e datado, sem extrapolação.",
        "sourceUrl": "https://...",
        "observedAt": "ISO-8601"
      },
      {
        "topic": "standings",
        "claim": "Outro facto confirmado por fonte independente.",
        "sourceUrl": "https://...",
        "observedAt": "ISO-8601"
      },
      {
        "topic": "availability",
        "claim": "A fonte consultada não confirmou ausências.",
        "sourceUrl": "https://...",
        "observedAt": "ISO-8601"
      }
    ],
    "sources": [
      {
        "name": "Fonte oficial da competição",
        "url": "https://...",
        "checkedAt": "ISO-8601",
        "usedFor": "Classificação e calendário"
      },
      {
        "name": "Fonte oficial do clube",
        "url": "https://...",
        "checkedAt": "ISO-8601",
        "usedFor": "Forma recente e notícias da equipa"
      }
    ],
    "limitations": ["Escalações ainda não confirmadas."]
  }
}
```

Regras de validação:
- o payload tem de identificar as duas equipas;
- tem de conter pelo menos três factos concretos;
- tem de referenciar pelo menos duas fontes HTTP/HTTPS distintas;
- pelo menos dois factos têm de apontar para URLs incluídos na lista de fontes;
- cada facto deve ter uma afirmação verificável e, quando aplicável, uma data;
- um marcador `webResearchRequired: true` é apenas uma indicação de pesquisa pendente e **não** conta como estatística nem como contexto concluído.

O validador `lib/pipeline/context-quality.js` aplica estes requisitos aos registos `InternetSearch`. O contexto SportAPI estruturado continua a ser aceite pelas regras existentes.

## 3. Estrutura do relatório

Guardar cada relatório em `match_analyses`, com `provider = 'ChatGPT'`, `model = 'GPT-6'`, `status = 'ready'` e `match_id` da linha correspondente em `matches`.

Estrutura JSON recomendada para a coluna `analysis`:

```json
{
  "version": 1,
  "fixture": {
    "home": "Equipa da casa",
    "away": "Equipa visitante",
    "competition": "Competição",
    "kickoff": "ISO-8601",
    "oddsSnapshotAt": "ISO-8601"
  },
  "sources": [
    {
      "name": "Nome da fonte",
      "url": "https://...",
      "checkedAt": "ISO-8601",
      "usedFor": "Forma recente / classificação / ausências"
    }
  ],
  "selections": [
    {
      "market": "Nome do mercado",
      "selection": "Selecção",
      "line": null,
      "bestOdds": 1.85,
      "bestBookmaker": "BantuBet",
      "probability": 0.62,
      "impliedProbability": 0.54,
      "edge": 0.08,
      "expectedValue": 0.147,
      "confidence": "média",
      "rationale": "Fundamento conciso",
      "riskFlags": [],
      "quotes": [
        {
          "bookmaker": "BantuBet",
          "odds": 1.85,
          "collectedAt": "ISO-8601"
        },
        {
          "bookmaker": "ElephantBet",
          "odds": 1.80,
          "collectedAt": "ISO-8601"
        }
      ]
    }
  ],
  "riskFlags": [],
  "verdict": "Resumo da avaliação"
}
```

Os valores acima são apenas exemplos de formato, não previsões nem dados reais. Se não existir uma selecção com evidência e valor esperado suficientes, guardar `selections: []` e explicar a razão no veredicto; não forçar recomendações.

## 4. Gravação e apresentação

- Inserir o contexto de pesquisa em `match_statistics` e o relatório em `match_analyses` apenas depois de validar jogo, odds e fontes.
- A área **Análises** do site lê apenas registos com `status = 'ready'`.
- A política RLS permite leitura pública de análises prontas; as escritas continuam reservadas ao servidor/credenciais privilegiadas.
- Não inserir nem actualizar linhas em `tickets` ou `ticket_legs` durante este procedimento.
- Não chamar endpoints de reserva, construção de bilhetes ou publicação.

**Importante:** para a rotina manual do ChatGPT, não executar o pipeline legado `/api/pipeline` / `run-daily`. Esse fluxo ainda depende de um fornecedor de IA configurado e contém uma etapa separada de bilhetes/publicação. A análise manual consulta o Supabase nesta conversa, pesquisa a Web e grava directamente os registos validados.

Se não houver evidência suficiente, não criar uma análise pronta para esse jogo. Registar a razão separadamente como dados insuficientes, se for útil.
