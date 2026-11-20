> **AVISO — documentação histórica da branch `main` (17/11/2026):** este README descreve uma versão anterior do produto e contém referências a funcionalidades/integrações que já não representam a interface actualmente publicada. A versão activa está na branch `feat/analysis-before-odds`. Antes de qualquer trabalho, consulta o [README actualizado da branch activa](https://github.com/Atanasildo/FK-FICHA-KAMBA/blob/feat/analysis-before-odds/README.md). A produção está em https://fk-ficha-kamba.vercel.app. Não uses este README antigo para inferir o estado actual nem faças merge integral entre branches sem analisar as diferenças.

---

# FK — Ficha Kamba

**Manual de arquitectura, operação e continuidade para desenvolvimento humano ou por IA.**

> Leia este documento inteiro antes de alterar o projecto. Ele descreve a árvore de ficheiros e o comportamento observado no código da branch indicada abaixo. Quando houver conflito entre documentação antiga e código, inspeccione o código e actualize este documento; não invente funcionalidades nem assuma que um deployment `READY` prova que tudo funciona em runtime.

## 1. Identificação e estado da versão

| Item | Valor |
|---|---|
| Repositório | `Atanasildo/FK-FICHA-KAMBA` |
| Plataforma frontend/backend | React 18 + Vite 6 + Vercel Functions |
| Base de dados | Supabase / PostgreSQL |
| Branch descrita nesta revisão | `feat/fk-cosmic-visual-refresh` |
| Commit documentado | `1d7a427bb89f786181333b2505c4457cc3e56026` |
| Branch predefinida do GitHub | `main` |
| Projecto Vercel | `fk-ficha-kamba` |
| Fuso horário operacional | `Africa/Luanda` |
| Linguagem da interface | Português (Angola) |

**Atenção às branches e à produção**
- A documentação desta revisão descreve a branch `feat/fk-cosmic-visual-refresh`, que contém a alteração visual recente da página Bilhetes do Dia.
- A branch `main` é a branch predefinida do GitHub; isso não significa que seja automaticamente a branch certa para continuar o trabalho ou que contenha todas as alterações desta branch.
- O deployment Preview mais recente observado para o commit `1d7a427...` estava `QUEUED` no momento da revisão. A alteração visual ainda não foi confirmada visualmente em browser nem promovida a produção.
- Não fazer merge, reset, rebase destrutivo ou promoção para produção sem comparar branches, confirmar o deployment e obter autorização explícita do responsável pelo projecto.
- Antes de começar qualquer sessão, confirmar branch, commit local, branch remota e deployment Vercel correspondente. Não assumir que o URL de produção representa o código desta branch.

## 2. O que é o Ficha Kamba

O Ficha Kamba é uma plataforma de inteligência futebolística que reúne:
1. Descoberta de jogos e recolha de mercados/odds em BantuBet e ElephantBet.
2. Comparação e persistência dos dados recolhidos.
3. Pesquisa e análise desportiva, incluindo um fluxo manual executado no ChatGPT.
4. Apresentação de fichas publicadas e das respectivas selecções.
5. Acompanhamento de partidas ao vivo e avaliação de mercados quando existem dados suficientes.
6. Histórico e liquidação das selecções, com limitações que ainda precisam de validação.

O projecto **não deve** inventar jogos, odds, estatísticas, resultados, códigos de reserva ou confirmações das casas. Não coloca apostas, não movimenta dinheiro e não deve automatizar uma aposta real.

## 3. Arquitectura geral

```text
Casas de apostas
  BantuBet ─────┐
                ├─> Recolha local no PC (Node.js / Playwright / WebSocket)
  ElephantBet ──┘
                       |
                       | HTTPS + CRON_SECRET + Vercel bypass (Preview protegida)
                       v
              Vercel Functions /api
                       |
                       v
              Supabase PostgreSQL
              - matches
              - bookmakers
              - markets
              - odds_comparisons
              - tickets
              - ticket_legs
              - match_statistics
              - match_analyses
                       |
             +---------+-----------+
             |                     |
             v                     v
       React/Vite no browser   ChatGPT / análise manual
       lê dados via RLS        pesquisa e grava contexto/
                               relatórios por fluxo seguro
```

### Responsabilidades

- **PC do utilizador:** executa scripts locais para descobrir eventos, recolher odds e enviar lotes. A automação Windows diária existente no computador do utilizador é externa à árvore desta branch: os scripts de supervisor/agendamento locais não aparecem no repositório desta branch. Não os recriar nem alterar sem primeiro verificar o computador e a configuração actual.
- **Vercel:** aloja o frontend e as funções em `api/`. Recebe recolhas autenticadas, consulta fornecedores externos e executa operações server-side.
- **Supabase:** fonte persistente dos jogos, casas, mercados, comparações, fichas, selecções, estatísticas e análises.
- **ChatGPT:** no fluxo manual documentado em `docs/chatgpt-analysis-workflow.md`, pesquisa e analisa os jogos depois da recolha. Não existe ligação automática desta conversa a um modelo de ChatGPT externo.
- **SportAPI:** fornecedor auxiliar de fixtures, resultados, eventos, escalações e estatísticas. Não é necessária para descobrir/recolher odds das casas; o fluxo de associação live depende da disponibilidade e quota do fornecedor.
- **BantuBet / ElephantBet:** fontes dos jogos e mercados. IDs de evento de uma casa não devem ser tratados como IDs da outra.

## 4. Árvore completa do repositório nesta branch

A lista abaixo reflecte os ficheiros versionados observados no commit indicado. Pode mudar com novos commits.

```text
FK-FICHA-KAMBA/
├── .env.example
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── test-oddsdog.yml
├── .gitignore
├── README.md
├── index.html
├── package.json
├── vercel.json
├── api/
│   ├── ai-analyze.js
│   ├── bookmakers/
│   │   ├── normalize.js
│   │   ├── reserve.js
│   │   └── save-comparison.js
│   ├── diagnose-cron-secret.js
│   ├── diagnostics/
│   │   └── supabase-write.js
│   ├── fixture-context.js
│   ├── football-data.js
│   ├── matches.js
│   ├── pipeline.js
│   └── test-ai-existing.js
├── docs/
│   └── chatgpt-analysis-workflow.md
├── lib/
│   ├── bookmakers/
│   │   ├── bantubet.js
│   │   ├── comparison.js
│   │   ├── daily-swarm.js
│   │   ├── elephantbet.js
│   │   ├── event-discovery.js
│   │   ├── ingest-swarm-handler.js
│   │   ├── normalize.js
│   │   ├── prepare-comparison.js
│   │   ├── swarm-comparison.js
│   │   ├── swarm.js
│   │   └── team-matching.js
│   ├── pipeline/
│   │   ├── build-tickets.js
│   │   ├── collect-context.js
│   │   ├── context-quality.js
│   │   ├── discover-fixtures.js
│   │   ├── live-tickets.js
│   │   ├── live-tickets.test.js
│   │   ├── match-linking.js
│   │   ├── run-daily.js
│   │   └── save-analysis.js
│   └── tickets/
│       ├── builder.js
│       └── live-market.js
├── public/
│   ├── fk-icon.svg
│   └── manifest.webmanifest
├── src/
│   ├── App.jsx
│   ├── home-redesign.css
│   ├── main.jsx
│   ├── styles.css
│   └── lib/
│       └── supabase.js
├── supabase/
│   ├── README.md
│   ├── schema.sql
│   └── migrations/
│       ├── 20261108_match_context.sql
│       ├── 20261113133000_swarm_ingest_idempotency.sql
│       ├── 20261113150000_swarm_comparison_timeout_rpc.sql
│       ├── 20261113_odds_retention_3_days.sql
│       ├── 20261114001000_odds_comparisons_match_id_index.sql
│       ├── 20261114153141_shared_ticket_pairs.sql
│       ├── 20261115032000_match_analyses_public_read.sql
│       └── 20261116140000_cleanup_swarm_matches_by_luanda_day.sql
├── test/
│   └── ticket-builder.test.js
├── tests/
│   ├── bookmakers/
│   │   ├── comparison.test.js
│   │   ├── daily-swarm.test.js
│   │   ├── elephantbet.test.js
│   │   ├── normalize.test.js
│   │   ├── prepare-comparison.test.js
│   │   ├── reserve.test.js
│   │   ├── swarm-comparison.test.js
│   │   └── team-matching.test.js
│   ├── context-quality-fallback.test.js
│   ├── event-discovery.test.js
│   ├── local-collector.test.js
│   ├── pipeline/
│   │   ├── context-quality.test.js
│   │   └── match-linking.test.js
│   └── tickets/
│       ├── builder.test.js
│       └── live-market.test.js
└── tools/
    ├── bantubet-console-collector.js
    ├── collect-swarm-upload.js
    ├── collect-swarm.js
    ├── discover-bookmaker-events.js
    ├── elephantbet-console-collector.js
    ├── events.local.example.json
    ├── local-bookmaker-check.js
    ├── local-bookmaker-collector.js
    ├── recover-swarm-game.js
    ├── report-swarm-comparison.js
    ├── run-analysis-only.js
    └── run-internet-fallback.js
```

## 5. Responsabilidade dos ficheiros e módulos

### Raiz e configuração

- `package.json`: scripts npm, dependências e comandos de testes/build.
- `index.html`: documento HTML, idioma `pt-AO`, metadados, ícone e manifest.
- `vercel.json`: rewrites das rotas `/api/pipeline/*` para o handler `api/pipeline.js` e limites de execução das funções.
- `.env.example`: nomes e exemplos de variáveis; nunca colocar valores reais.
- `.github/workflows/ci.yml`: workflow de integração contínua.
- `.github/workflows/test-oddsdog.yml`: workflow separado de testes.
- `.gitignore`: exclui dependências, builds, ficheiros locais e segredos.

### Frontend — `src/`

- `src/main.jsx`: ponto de entrada React; importa `App.jsx` e `styles.css`.
- `src/App.jsx`: aplicação e lógica de interface. Carrega fichas publicadas em `tickets` com `ticket_legs` e dados de `matches`; agrupa versões BantuBet/ElephantBet pelo identificador partilhado; carrega análises prontas em `match_analyses`; consulta `/api/pipeline/live-tickets`; calcula vistas de hoje, ao vivo e histórico.
- `src/styles.css`: folha de estilos global/estrutura anterior.
- `src/home-redesign.css`: folha visual da página de Bilhetes do Dia da branch descrita. É importada por `App.jsx`.
- `src/lib/supabase.js`: cria o cliente Supabase do browser com `VITE_SUPABASE_URL` e chave publicável/anon; exporta `supabase` e `isSupabaseConfigured`. Não pode receber chaves secret/service-role.
- `public/`: ícone e manifest PWA.

**Nota importante sobre a interface neste commit:** o componente `App` começa com a página `Bilhetes do dia` e retorna directamente `DailyHome` quando essa página está seleccionada. Nesta implementação, esse retorno antecipado não apresenta a navegação principal que existia na shell anterior. Os componentes/estados de Análises, Acompanhamento ao vivo e Histórico continuam no ficheiro, mas a navegação para os alcançar deve ser revista. A função `TicketPanel` antiga também permanece no ficheiro depois da introdução de `DailyTicketCard`; verificar e remover código morto apenas depois de confirmar que não é usado noutros caminhos. A próxima IA não deve assumir que os quatro separadores estão acessíveis na interface desta branch.

### API — `api/`

- `api/bookmakers/save-comparison.js`: endpoint POST. Com Bearer `CRON_SECRET`, encaminha para o ingest Swarm; no fluxo de importação autenticada também valida utilizador e grava comparação/mercados.
- `api/bookmakers/reserve.js`: constrói pedido de link de partilha para as casas configuradas. A criação de link não equivale a aposta colocada nem a reserva confirmada.
- `api/bookmakers/normalize.js`: normalização de dados por fornecedor, chamada por rewrites.
- `api/pipeline.js`: router das operações de pipeline: descoberta, contexto, análise, gravação, construção de fichas e acompanhamento live, conforme `action`.
- `api/ai-analyze.js`: integração de análise com fornecedor de IA configurado. É parte do pipeline legado/automatizado; não confundir com a análise manual no ChatGPT.
- `api/football-data.js`: consulta fixtures à SportAPI por data.
- `api/fixture-context.js`: obtém detalhes/contexto de um fixture SportAPI, incluindo estatísticas/eventos/lineups e dados associados.
- `api/matches.js`: integração alternativa com football-data.org; requer `FOOTBALL_DATA_TOKEN`.
- `api/diagnose-cron-secret.js`: diagnóstico da presença/comprimento/fingerprint do segredo. Não expor o fingerprint nem usar este endpoint para partilhar segredos.
- `api/diagnostics/supabase-write.js`: diagnóstico de escrita Supabase; rever autenticação e necessidade antes de o usar.
- `api/test-ai-existing.js`: endpoint de teste legado de IA. Não usar em produção sem rever o código e as protecções.

### Bibliotecas — `lib/bookmakers/`

- `swarm.js`: comunicação/recolha dos dados de eventos e odds nas casas.
- `bantubet.js`, `elephantbet.js`: adaptadores específicos.
- `event-discovery.js`: descoberta de eventos.
- `daily-swarm.js`: selecção de jogos comuns e elegíveis para o dia.
- `team-matching.js`: normalização e comparação dos nomes das equipas.
- `comparison.js`, `swarm-comparison.js`, `prepare-comparison.js`: estruturação e comparação de mercados/cotações.
- `normalize.js`: normalização partilhada de dados.
- `ingest-swarm-handler.js`: valida o lote recebido e persiste dados no Supabase, incluindo jogos, bookmakers, mercados e comparações.

### Bibliotecas — `lib/pipeline/`

- `discover-fixtures.js`: descoberta/ligação de jogos.
- `match-linking.js`: associação de fixtures entre fontes.
- `collect-context.js`: recolha de contexto SportAPI.
- `context-quality.js`: validação de qualidade/actualidade do contexto.
- `run-daily.js`: pipeline automatizado legado, incluindo análise e possíveis etapas de criação/publicação. Não é o fluxo manual documentado para o ChatGPT.
- `save-analysis.js`: grava relatórios de análise através de rota autenticada.
- `build-tickets.js`: constrói e publica lotes de fichas no fluxo automatizado; contém efeitos reais na base de dados e chamadas de reserva.
- `live-tickets.js`: consulta dados live, tenta associar jogos Swarm a fixtures SportAPI, guarda estatísticas/resultados suportados e devolve dados ao frontend.
- `live-tickets.test.js`: testes do módulo live.

### Bibliotecas — `lib/tickets/`

- `builder.js`: regras e construção de fichas a partir de selecções.
- `live-market.js`: avaliação de mercados com resultados/eventos/estatísticas finais disponíveis. Não deve adivinhar resultados quando a fonte não fornece os dados necessários.

### Ferramentas locais — `tools/`

- `collect-swarm-upload.js`: fluxo principal de recolha Swarm + envio autenticado para Vercel/Supabase.
- `collect-swarm.js`: recolha manual por casa ou IDs de eventos, com gravação local em `data/collections/` (a pasta de saída é criada em runtime e não está versionada).
- `discover-bookmaker-events.js`: descoberta auxiliar de eventos.
- `bantubet-console-collector.js`, `elephantbet-console-collector.js`: coletores específicos.
- `local-bookmaker-collector.js`, `local-bookmaker-check.js`: recolha/verificação local.
- `recover-swarm-game.js`: recuperação de jogo específico.
- `collect-live-sofascore.js`: recolhe marcador, estado, eventos e estatísticas ao vivo dos jogos dos boletins (fonte não oficial; ver «Fonte ao vivo SofaScore»).
- `report-swarm-comparison.js`: relatório de comparação.
- `run-analysis-only.js`: chama o pipeline legado em Preview, com modo de teste por omissão; rever argumentos antes de qualquer execução.
- `run-internet-fallback.js`: teste isolado do fallback de contexto, em modo dry-run.
- `events.local.example.json`: exemplo de dados locais, não é fonte de verdade nem dados de produção.

## 6. Dados e relações Supabase

A definição-base está em `supabase/schema.sql`; alterações posteriores estão em `supabase/migrations/`. Consultar também `supabase/README.md`.

| Tabela | Papel e relações principais |
|---|---|
| `bookmakers` | Casas de apostas; `code` é único. |
| `matches` | Jogos canónicos; guarda equipas, competição, início, estado, `source` e `external_id`. |
| `markets` | Odds/mercados por jogo e bookmaker; liga a `matches` e `bookmakers`; guarda `market_key`, período, linha, selecção, odd e `collected_at`. |
| `odds_comparisons` | Snapshot JSON da comparação por jogo; guarda `comparison` e `best_prices`. |
| `tickets` | Fichas; `shared_ticket_id` agrupa versões equivalentes de casas diferentes; `booking_reference` pode conter texto ou JSON. |
| `ticket_legs` | Selecções de uma ficha; liga `ticket_id`, opcionalmente `match_id` e `market_id`; guarda mercado, selecção, odd e resultado. |
| `match_statistics` | Contexto desportivo/estatísticas e pesquisa, em JSONB, com fonte e data de recolha. |
| `match_analyses` | Relatórios por jogo; inclui provider/model/status/summary/analysis e data. |

Relações:
- `tickets.id -> ticket_legs.ticket_id`.
- `ticket_legs.match_id -> matches.id`.
- `ticket_legs.market_id -> markets.id`.
- `markets.match_id -> matches.id`.
- `markets.bookmaker_id -> bookmakers.id`.
- `odds_comparisons.match_id -> matches.id`.
- `match_statistics.match_id -> matches.id`.
- `match_analyses.match_id -> matches.id`.
- `tickets.shared_ticket_id` liga as versões do mesmo boletim entre casas; não confundir com `tickets.id`.

**Integridade:** não apagar fichas ou selecções publicadas para testar. Não alterar IDs, ligações ou `shared_ticket_id` sem migração/estratégia explícita. Usar migrações SQL versionadas e aditivas. Confirmar o esquema real do projecto Supabase antes de qualquer mudança: `schema.sql` mais migrações não substituem uma inspecção da base de dados actualmente aplicada.

## 7. Fluxos operacionais

### 7.1 Recolha diária de odds

Comando principal, a partir da raiz do projecto:

```bash
npm run collect:upload
```

O script:
1. Descobre jogos em BantuBet e ElephantBet.
2. Associa jogos comuns por equipas (casa com casa, visitante com visitante) e horário; não usa os IDs próprios das casas como se fossem iguais.
3. Recolhe mercados/odds.
4. Envia lotes para `/api/bookmakers/save-comparison`.
5. A função server-side valida `CRON_SECRET` e guarda dados no Supabase.

Modo de teste sem escrita na base de dados:

```bash
npm run collect:upload -- --dry-run
```

Parâmetro opcional:

```bash
npm run collect:upload -- --max-games=20
```

O valor predefinido de `maxGames` vem de `FK_MAX_GAMES` ou do default definido no script. O limite de validação do script é 1–1500; a selecção diária de jogos comuns tem as próprias regras.

**Atenção:** para uma recolha real, `FK_API_URL` ou `FK_INGEST_URL` tem de apontar explicitamente para o ambiente pretendido. O script recusa escolher Production por defeito. A Preview protegida também pode exigir `VERCEL_AUTOMATION_BYPASS_SECRET`. Nunca executar recolha real sem confirmar o destino e o estado da recolha do dia.

### 7.2 Análise manual no ChatGPT

Seguir integralmente `docs/chatgpt-analysis-workflow.md`. Em resumo:
1. Confirmar que a recolha terminou.
2. Consultar jogos Swarm do dia de Luanda que ainda não começaram e cuja comparação de odds seja recente.
3. Validar a identidade dos jogos e cotações de cada mercado.
4. Pesquisar contexto em fontes identificáveis; separar factos, estimativas e lacunas.
5. Calcular probabilidades/valor esperado apenas quando os dados suportarem.
6. Guardar contexto validado em `match_statistics` e relatórios prontos em `match_analyses`.
7. Não escrever em `tickets` nem `ticket_legs` durante a análise manual.

A documentação de análise manual é a referência prioritária para o fluxo ChatGPT. Não executar `/api/pipeline/run-daily` como se fosse a mesma rotina: esse endpoint pertence ao pipeline legado/automatizado.

### 7.3 Fichas e publicação

- O frontend lê fichas com `status = 'published'`.
- As versões BantuBet e ElephantBet podem ser agrupadas na interface por `shared_ticket_id`, mas continuam a ser registos distintos.
- `booking_reference` pode conter texto simples ou JSON com identificador/link/estado.
- Um link de partilha criado pela casa não é prova de aposta colocada nem de reserva confirmada.
- O pipeline `lib/pipeline/build-tickets.js` pode escrever fichas e chamar o mecanismo de reserva. Tratar como operação com efeitos reais; nunca correr por rotina de análise sem autorização.

### 7.4 Acompanhamento ao vivo

- O frontend consulta `GET /api/pipeline/live-tickets` a cada cinco minutos.
- O handler precisa de Supabase server-side e `SPORTAPI_KEY`.
- A associação Swarm→SportAPI deve respeitar ordem das equipas e tolerância horária; rejeitar candidatos ambíguos.
- Dados ausentes devem continuar ausentes. Não substituir falta de resposta por 0–0, minuto inventado ou estatística zero.
- Estatísticas podem estar sujeitas a cache/rotação para respeitar quotas. Uma partida terminada não implica que todos os mercados estejam liquidados.
- Validar em jogos reais antes de afirmar que o acompanhamento está funcional.

### 7.5 Histórico/liquidação

- O frontend considera o resultado de cada selecção através de `ticket_legs.result`/estado recebido do endpoint live.
- `lib/tickets/live-market.js` contém avaliadores de mercado.
- Mercados que dependem de estatísticas finais devem aguardar os dados necessários.
- A lógica agregada de ficha, devoluções, linhas asiáticas e mercados especiais deve ser testada por mercado; não presumir que todos os casos estão cobertos.

## 8. Variáveis de ambiente

Consultar `.env.example` e as configurações da Vercel. Os nomes abaixo foram encontrados no código/documentação; a necessidade concreta varia conforme o fluxo utilizado.

| Variável | Uso | Onde |
|---|---|---|
| `VITE_SUPABASE_URL` | URL pública do Supabase para o browser | Vercel/frontend |
| `VITE_SUPABASE_PUBLISHABLE_KEY` ou `VITE_SUPABASE_ANON_KEY` | Chave publicável/anon, protegida por RLS | Vercel/frontend |
| `SUPABASE_URL` | URL do Supabase em funções server-side | Vercel |
| `SUPABASE_SECRET_KEY` ou `SUPABASE_SERVICE_ROLE_KEY` | Escritas privilegiadas server-side | Vercel, segredo |
| `CRON_SECRET` | Autentica recolhas e rotas internas | Vercel e ambiente local autorizado |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Acesso automatizado a Preview protegida | ambiente local seguro |
| `FK_API_URL` | Base URL explícita do endpoint de ingestão/Preview | ambiente local |
| `FK_INGEST_URL` | URL completa alternativa de ingestão | ambiente local |
| `FK_MAX_GAMES` | Limite local de jogos a recolher | ambiente local |
| `SPORTAPI_KEY` | Fixtures, eventos, estatísticas e acompanhamento | Vercel |
| `FOOTBALL_DATA_TOKEN` | Endpoint alternativo football-data.org | Vercel |
| `AI_PROVIDER` | Escolha do fornecedor no pipeline legado | Vercel |
| `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_RESEARCH_MODEL` | Fornecedor Groq no pipeline legado | Vercel |
| `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` | Fornecedor DeepSeek no pipeline legado | Vercel |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Fornecedor Gemini no pipeline legado | Vercel |
| `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID` | Integração Browserbase opcional | Vercel/ambiente seguro |

Regras:
- Nunca colocar segredos em `VITE_*`, no browser, no Git, no README ou em mensagens.
- Nunca pedir ao utilizador que cole API keys, cookies, OTPs ou passwords no chat.
- Não mostrar valores de variáveis nos logs; mostrar apenas se estão configuradas quando necessário.
- `.env.example` contém placeholders, não credenciais funcionais.
- Não assumir que todas as variáveis listadas estão actualmente configuradas na Vercel; verificar o painel/ambiente sem revelar os valores.

## 9. Instalação, desenvolvimento e testes

Requisito declarado no histórico do projecto: Node.js 20 ou superior. Confirmar versão local antes de instalar.

```bash
npm install
npm test
npm run build
npm run dev
```

Scripts definidos:
- `npm run dev`: Vite em `0.0.0.0`.
- `npm test`: verificações de sintaxe e suite Node `node --test`.
- `npm run build`: corre os testes e depois `vite build`.
- `npm run preview`: preview local do build.
- `npm run collect:upload`: recolha real/upload, salvo `--dry-run`.

Depois de alterações:
1. Correr testes.
2. Correr build.
3. Inspeccionar logs e erros.
4. Validar comportamento em Preview no browser, desktop e telemóvel.
5. Confirmar dados reais e integrações sem fazer escritas destrutivas.
6. Distinguir explicitamente build concluído, deployment READY e validação funcional real.

## 10. Segurança e limites operacionais

- RLS deve permanecer activo nas tabelas expostas ao browser.
- O browser usa apenas chave publicável/anon; escritas privilegiadas são server-side.
- Rotas internas exigem autenticação adequada. Não remover verificações para facilitar testes.
- Não expor service-role/secret key, CRON_SECRET, chaves de fornecedores ou bypass da Vercel.
- Não contornar CAPTCHA, autenticação, anti-bot ou limites das casas.
- Não enviar apostas, não movimentar dinheiro e não afirmar que uma reserva foi confirmada sem resposta verificável.
- Não alterar dados publicados para testes. Usar fixtures/mocks/testes isolados.
- Antes de migrações, rever RLS, grants, índices, chaves e dados reais.
- Não fazer chamadas de reserva nem publicar fichas sem autorização explícita.

## 11. Estado conhecido, limitações e tarefas em aberto

Esta secção evita que uma nova IA confunda código existente com funcionalidade validada.

### Confirmado por inspecção do código nesta branch
- Frontend React/Vite e cliente Supabase.
- Leitura de fichas publicadas e análises prontas no frontend.
- Endpoint de ingestão Swarm em `api/bookmakers/save-comparison.js` com handler em `lib/bookmakers/ingest-swarm-handler.js`.
- Scripts locais de recolha em `tools/`.
- Módulos de comparação, ligação de equipas, construção de fichas, reserva/link e avaliação live.
- Migrations SQL versionadas.
- Fluxo de análise manual documentado em `docs/chatgpt-analysis-workflow.md`.
- Nova composição visual da página Bilhetes do Dia na branch `feat/fk-cosmic-visual-refresh`.

### Não confirmado nesta revisão
- A conclusão do deployment Vercel do commit `1d7a427...` (o último estado consultado foi `QUEUED`).
- A reprodução visual exacta no browser após o último commit.
- A acessibilidade actual de Análises, Acompanhamento ao vivo e Histórico na interface desta branch.
- A disponibilidade actual da SportAPI e a taxa de associação de jogos reais.
- A liquidação correcta de todos os mercados e todos os cenários.
- A criação/validação de links de partilha nas duas casas com dados reais.
- A configuração actual das variáveis de ambiente.
- A configuração actual da automação Windows que corre no PC do utilizador.
- O estado actual da produção e a branch/commit que a serve. Confirmar na Vercel antes de qualquer alteração de produção.

### Prioridades recomendadas para a próxima IA
1. **Validar e concluir o layout da página inicial:** abrir o deployment Preview mais recente; comparar com a referência visual fornecida pelo utilizador; corrigir a navegação para que os outros separadores não desapareçam; testar desktop/mobile. Não substituir dados reais por exemplos hardcoded.
2. **Restaurar/confirmar a navegação funcional:** manter Bilhetes do dia, Análises, Acompanhamento ao vivo e Histórico acessíveis, com rotas/estado e layouts coerentes. A actual composição da página inicial retorna antes da shell de navegação.
3. **Rever agrupamento e cartões de fichas:** confirmar que as versões BantuBet/ElephantBet não perdem dados específicos da casa, odds, selecções, IDs e referências de reserva.
4. **Validar links de partilha/reserva:** separar link criado, reserva pendente e confirmação real; não submeter apostas.
5. **Validar acompanhamento ao vivo:** associação inequívoca Swarm→SportAPI, cache, estados, marcador, eventos e estatísticas.
6. **Completar liquidação/histórico:** testar mercado por mercado e não liquidar sem dados finais suficientes.
7. **Rever segurança e migrações:** RLS, autenticação das rotas, idempotência, índices e retenção.

## 12. Instruções obrigatórias para qualquer outra IA

1. Ler este README inteiro, `docs/chatgpt-analysis-workflow.md` e `supabase/README.md`.
2. Antes de editar, confirmar a branch, SHA e estado da Vercel. Fazer `git status` e não apagar alterações locais.
3. Inspeccionar os ficheiros concretos relacionados com a tarefa; esta árvore é um mapa, não substitui leitura do código.
4. Não assumir que `main` é a branch correcta. Não misturar branches divergentes sem comparar commits e rever o diff.
5. Não alterar produção, esquema Supabase ou dados publicados sem autorização explícita.
6. Não inventar estatísticas, odds, selecções, resultados, referências de reserva ou estado de deployment.
7. Não pedir novamente ao utilizador informação que já está neste documento; pedir apenas decisões/credenciais que não possam ser obtidas com segurança. Segredos não devem ser enviados no chat.
8. Para recolha real, confirmar o destino em `FK_API_URL`/`FK_INGEST_URL`, data local de Luanda e se já houve recolha nesse dia. Preferir `--dry-run` para validar sem escrita.
9. Para análise manual, seguir o procedimento em `docs/chatgpt-analysis-workflow.md`; não chamar o pipeline legado automaticamente.
10. Após cada alteração, correr `npm test` e `npm run build`; validar Preview visual e funcionalmente. Reportar o que foi implementado, testado, não testado e ainda pendente.
11. Actualizar este README e os documentos de apoio quando arquitectura, comandos, tabelas, variáveis ou estado operacional mudarem.
12. Não declarar uma tarefa concluída só porque o commit foi criado ou o deployment está `READY`.

## 13. Documentos de referência

- [Procedimento de análise manual no ChatGPT](docs/chatgpt-analysis-workflow.md)
- [Fundação e configuração Supabase](supabase/README.md)
- [Schema base Supabase](supabase/schema.sql)
- [Exemplo de variáveis de ambiente](.env.example)
- [Configuração Vercel e rewrites](vercel.json)
- [Scripts e dependências](package.json)

---

**Regra final:** preservar a integridade dos dados e a operação existente é mais importante do que completar uma tarefa depressa. Se a fonte não confirmar um dado ou uma operação, mostrar que está pendente/indisponível em vez de inventar.

## Reserva via Swarm (código de reserva)

- O código de reserva é criado no momento da elaboração do boletim, com o comando `create_bet_book_v2` do Swarm (o mesmo que o botão "Obter reserva ID" do site), em `lib/bookmakers/swarm.js` (`createSwarmBooking`). Envia só `SelectionId` + preço, com `Amount: 0`; não coloca aposta.
- A casa devolve o código em `data.details.Id`. A reserva mostra as odds **actuais** da casa, não as enviadas; por isso deve ser pedida logo após a recolha.
- `api/bookmakers/reserve.js` (`createBooking`) usa essa função. O pipeline (`lib/pipeline/build-tickets.js`) só publica um par de boletins quando as duas casas devolvem código, e guarda o `selection_id` de cada selecção em `ticket_legs.selection_id` (migração `20261119230000_ticket_legs_selection_id.sql`).
- `POST /api/bookmakers/reserve` com `{ "ticketId": "<uuid>" }` só funciona para fichas com `selection_id` guardado e jogos que ainda não começaram.
- O endpoint `image-creator/share-booking` já não é usado para criar o código; serve apenas para a imagem de partilha, e exige um `bookId` já existente.

### Reserva a partir do PC local (o Swarm recusa a Vercel)

- Testado em 19/11/2026: a ligação WebSocket ao Swarm a partir de servidores da Vercel responde **HTTP 403** nas duas casas. A partir do PC local funciona.
- Por isso o pipeline na Vercel **publica** os pares de boletins com `booking_reference = null` e `selection_id` guardado; e `tools/reserve-pending.js` (PC local) pede o código a seguir:
  `npm run reserve:pending` (uma vez) ou `tools\windows\reserve-pending.bat` (a cada 2 minutos). Precisa de `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
- O programa só reserva boletins com `selection_id` em todas as selecções e nenhum jogo iniciado; usa um bloqueio em `booking_reference` para não duplicar e faz uma só tentativa por boletim.

### Reserva agendada no PC local (automática)

- `tools/windows/install-reserve-task.ps1` instala a tarefa agendada **Ficha Kamba - Reservas**. Ao iniciar sessão no Windows, `tools/windows/reserve-supervisor.ps1` corre `tools/reserve-pending.js` a cada 120 segundos e pede o código dos boletins publicados sem código e com jogos futuros. Não precisa de ser lançado à mão.
- Instalação (uma vez, na pasta do projecto que tem `tools/reserve-pending.js` e `node_modules`): `powershell -ExecutionPolicy Bypass -File tools\windows\install-reserve-task.ps1`. A `SUPABASE_SERVICE_ROLE_KEY` é pedida numa janela com a escrita oculta e guardada cifrada para o utilizador do Windows, em `%LOCALAPPDATA%\FichaKamba\reserve-secrets.json`. Nunca vai para o GitHub.
- Registo diário em `%LOCALAPPDATA%\FichaKamba\logs\reservas-AAAA-MM-DD.log`. Só regista reservas feitas e erros; os boletins antigos saltados não enchem o registo.
- É independente da recolha diária (`daily-collector-supervisor.ps1`): a recolha corre uma vez por dia, enquanto as reservas têm de ser pedidas sempre que um boletim novo é publicado, a qualquer hora.
- Remover: `Unregister-ScheduledTask -TaskName "Ficha Kamba - Reservas" -Confirm:$false`.
- Estado: os scripts PowerShell não foram executados num Windows real nesta sessão; só o lado Node (`reserve-pending.js`) tem testes automatizados.

## Fonte ao vivo SofaScore (recolhida no PC)

Fonte adicional de marcador, estado, eventos e estatísticas para os jogos dos boletins, pensada para ligas pequenas que as outras fontes não cobrem. **Não é uma API oficial**: o SofaScore não tem API pública, os endereços usados são internos do site, podem mudar ou ser bloqueados, e os termos do site restringem o acesso automático. A decisão de a usar é do utilizador.

- `tools/collect-live-sofascore.js` corre no PC (a Vercel costuma ser bloqueada por este tipo de fonte). Lê `GET https://www.sofascore.com/api/v1/sport/football/events/live` (1 pedido por ciclo), associa só os jogos dos boletins publicados por equipas (ordem casa/visitante) e hora, e pede estatísticas e incidentes apenas desses jogos.
- Grava em `match_statistics`, **uma linha por jogo e fonte, actualizada no lugar** (a base está perto do limite do plano): `SofaScore-fixture` (estado, marcador, minuto, `eventId`), `SofaScore-live` (estatísticas) e `SofaScore-live-events` (eventos).
- `lib/pipeline/live-tickets.js` usa o `SofaScore-fixture` **apenas como último recurso**, para jogos que Highlightly, Sportmonks e SportAPI não associaram. Um jogo «em curso» sem actualização há mais de 10 minutos é ignorado (o recolhedor pode ter parado); estados finais, adiado e cancelado mantêm-se.
- Sem dados não há marcador: o site mostra «Dados indisponíveis». Eventos e estatísticas **vazios não são gravados**, porque podem significar falta de cobertura e não «sem cartões»; os mercados que dependem deles ficam pendentes em vez de serem liquidados.
- O minuto é calculado a partir do início do período e é aproximado: o tempo de compensação é truncado em 45' e 90'.
- Se o SofaScore responder 403/429, o script **pára e espera 5 minutos**. Nunca disfarça o pedido nem contorna o bloqueio.
- Uso: `npm run collect:live -- --probe` (mostra o JSON bruto, não grava), `npm run collect:live` (uma vez), `npm run collect:live -- --watch` (a cada 60 s; mínimo 30 s). Precisa de `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`, excepto em `--probe`.
- **Estado:** os testes automatizados usam dados sintéticos escritos a partir do formato conhecido do SofaScore, e **nenhum pedido real foi feito**. Antes de confiar nos dados, correr `--probe` com jogos ao vivo e confirmar os nomes dos campos em `lib/pipeline/sofascore.js`. A associação a jogos reais e o bloqueio a IPs de casa ainda não foram verificados.
