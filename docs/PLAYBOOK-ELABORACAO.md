# Playbook de elaboração — Ficha Kamba

> **Para que serve.** É o procedimento único para a IA que elabora os boletins. Quando o proprietário disser **"ACTIVAR FICHA KAMBA"** (ou "elabora hoje", "faz os boletins"), a IA executa este playbook **sem voltar a perguntar o que já está aqui**. Só pergunta duas coisas: (1) autorização para **publicar** e (2) decisões que não se possam obter dos dados.
>
> Este documento complementa — não substitui — o **Manual Mestre** (regras de segurança e de selecção), o **README** (arquitectura) e `docs/chatgpt-analysis-workflow.md` (formato de `match_statistics` e `match_analyses`). Em caso de conflito, prevalecem as regras de segurança do Manual e do README.
>
> **Aviso de honestidade (ler primeiro).** Nenhum método garante lucro. As casas já têm o seu preço incorporado nas odds; um acumulador de 8 a 10 selecções com ~60% cada acerta, em média, 1–2% das vezes. O objectivo deste playbook é **escolher melhor, evitar erros caros e medir os resultados**, não prometer vitórias. Nunca afirmar "certeza" ao proprietário nem ao público.

---

## 0. Regras que nunca se quebram

1. **Dados reais ou nada.** Não inventar odds, estatísticas, lesões, notícias, resultados, fontes, códigos de reserva. Se a fonte não confirma, o dado fica "indisponível".
2. **Não apostar, não depositar, não movimentar dinheiro.** Reservar (gerar código de aposta com stake 0) é feito só pela tarefa agendada do PC, nunca pela IA.
3. **Não apagar** jogos, análises, boletins ou histórico sem autorização explícita do proprietário. (Rascunhos criados pela própria IA e ainda não publicados podem ser substituídos se a IA avisar.)
4. **Não alterar `main`, produção, esquema do Supabase ou RLS sem autorização expressa.** Migrações só aditivas e versionadas.
5. **Credenciais nunca no chat, em commits, logs ou documentos** (service role, `CRON_SECRET`, bypass da Vercel, tokens do GitHub). Tokens colados pelo utilizador: usar só para a tarefa pedida e lembrar de os revogar no fim.
6. **Um único escritor na base de dados.** Se houver outra sessão/IA a escrever no Supabase ao mesmo tempo, os boletins podem ser apagados ou duplicados (já aconteceu). Antes de elaborar, perguntar quem é o escritor e, depois de gravar, **confirmar com uma consulta** que os registos persistem.
7. **Publicar só com autorização** e só depois de todas as validações passarem. Em dúvida: rascunho + relatório.
8. **Nunca declarar "publicado" sem verificar** na base (e, quando possível, no site). `READY` na Vercel não prova gravação de dados.
9. **Não contornar bloqueios** de SofaScore, casas ou qualquer fonte (403, CAPTCHA, anti-bot). Esperar ou usar outra fonte.
10. Reportar sempre: o que foi feito, o que foi testado, o que **não** foi testado, o que está pendente.

---

## 1. Onde estão as coisas

| Item | Valor |
|---|---|
| Repositório | `Atanasildo/FK-FICHA-KAMBA` (site em `main`; recolha Swarm também em `main` após os PRs recentes) |
| Supabase | projecto `Ficha-Kamba-Novo`, id `dcvadrtvyzwwvlwejach` |
| Site (produção) | `https://fk-ficha-kamba.vercel.app` (serve `main`) |
| PC do proprietário | recolha diária de odds, reservas (`reserve-pending`) e ao vivo (SofaScore) correm lá, em tarefas agendadas do Windows |
| Fuso horário | **sempre `Africa/Luanda`** (UTC+1) para "hoje" |

### 1.1 Como os dados estão realmente guardados (lições aprendidas)

- **As odds dos jogos novos estão em `odds_comparisons.comparison` (JSON)**, não na tabela `markets` (que pode vir vazia nos lotes recentes). Estrutura: `comparison -> events[] -> comparisons[] -> quotes[]`. Cada `quote` tem `bookmaker` (`BantuBet`/`ElephantBet`), `market`, `selection`, `line`, `odds`, **`selectionId`**, `marketId`, `fixtureId`.
- **Os nomes dos mercados e das regiões vêm em português** ("Resultado do Jogo", "Ambas equipas marcarão", "Total de golos no jogo", "Dupla Chance"; regiões "Inglaterra", "Itália", "França", "Países Baixos"…). `matches.competition` vem como `"Competição · Região"`.
- **Jogos virtuais "SRL"** (ex.: "Arsenal SRL") têm nomes quase iguais aos reais e **entram na base**. Excluir sempre (`home_team !~* 'SRL'` e `away_team !~* 'SRL'`; também eSoccer/Cyber/Virtual). Ao procurar um jogo por nome, a consulta pode devolver o real **e** o SRL — misturar os dois dá odds erradas.
- **Podem existir várias fotografias (snapshots) por selecção** (recolhas repetidas). Usar sempre a **mais recente** (`created_at`/`collected_at` mais alto) por casa/mercado/selecção/linha. Sem isto, a remoção de margem sai errada.
- **Linhas inteiras e asiáticas (1, 2, 3, x.25, x.75) têm devolução/meia-ganha.** Para probabilidade e "ganha/perde" simples usar só linhas **.5**.
- `matches.competition` pode ser `null` nos jogos recolhidos antes do suporte a competições. Reconhecer a liga pelo nome das equipas e pelas fontes.
- **Os jogos antigos são apagados pela limpeza diária** (FK `ticket_legs.match_id … on delete set null`). Por isso as fichas antigas perdem as equipas no Histórico. Correcção proposta e ainda **por autorizar**: guardar equipas/hora/competição dentro de `ticket_legs` (migração aditiva) — ver §13.
- **Tamanho da base:** ~0,38–0,40 MB por jogo recolhido; limite gratuito do Supabase 500 MB. Verificar `pg_database_size` antes de pedir recolhas grandes.

---

## 2. Passo 0 — preparar (2 min)

1. Ler README, Manual, este playbook e `docs/chatgpt-analysis-workflow.md`.
2. Confirmar a hora actual em Luanda (`select now() at time zone 'Africa/Luanda'`).
3. Confirmar quem escreve na base (regra 6) e se há boletins/rascunhos de hoje:
   `select title,status,created_at from tickets where created_at > now() - interval '24 hours' order by created_at;`
4. Confirmar tamanho da base e quantos jogos futuros existem.

## 3. Passo 1 — validar a recolha

- Última `odds_comparisons.created_at` (deve ser de hoje, idealmente < 1 h antes da elaboração; senão pedir nova recolha ao proprietário).
- Contar jogos de hoje, jogos futuros, jogos com competição, duplicados por jogo.
- Se a recolha cortou o dia a meio (ex.: último jogo às 14:30), o motivo conhecido é o limite `maxGames` (mínimo agora 1000). Pedir `collect-now.ps1 -After "<ISO>" -DryRun` e depois sem `-DryRun`.
- **Todos os jogos entram**; a ordem de recolha e de análise dá prioridade às principais competições (§4).

## 4. Passo 2 — jogos elegíveis e prioridade

**Elegível:** `kickoff_at > now()` (para publicar, exigir pelo menos 30–60 min de antecedência para dar tempo à reserva), do dia de Luanda, com comparação recente das duas casas, não virtual.

**Exclusões por defeito:** SRL/virtuais; feminino, jovens (U17–U23), reservas, "II/III", amadores — **salvo pedido do proprietário**. Registar o motivo de cada exclusão.

**Prioridade de competição (4 níveis; o código em `lib/bookmakers/daily-swarm.js` aplica o mesmo):**

| Nível | Exemplos |
|---|---|
| 0 — principais | Ligas dos Campeões/Europa/Conferência, Libertadores/Sul-Americana, selecções (Mundial, Nações, Euro, CAN, qualificações); Premier League (Inglaterra), La Liga (Espanha), Serie A (Itália), Bundesliga (Alemanha), Ligue 1 (França), Primeira Liga (Portugal), Eredivisie, Süper Lig, Pro League (Bélgica), Premiership (Escócia), Brasileirão Série A, Liga Profesional (Argentina), MLS, Pro League saudita, Liga MX, Girabola |
| 1 — fortes | Championship, League One, 2. Bundesliga, 3. Liga, Serie B, Ligue 2, Segunda (Espanha), Liga Portugal 2, Eerste Divisie, Série B, Ekstraklasa, Allsvenskan, Eliteserien, Superliga, Super League (Suíça/Grécia), Bundesliga austríaca, ligas checa/croata/sérvia/romena, J1, K League 1, A-League, Liga dos Campeões africana/asiática, taças nacionais, amigáveis internacionais |
| 2 — restantes | tudo o resto com competição conhecida (ou sem competição) |
| 3 — por último | feminino, jovens, reservas |

> Atenção: **"Premier League" só é principal em Inglaterra.** No Botswana, Nigéria, Burkina Faso, Egipto… é nível 2 (a região decide).

## 5. Passo 3 — contexto e fontes (a parte que mais separa uma boa elaboração de uma má)

**Regra de ouro:** por cada jogo que entre num boletim, **≥ 3 fontes independentes** (≥ 2 URLs distintos), com data de consulta, separando **factos**, **estimativas** e **lacunas**. Previsões de sites **não são factos**: são opiniões (muitos copiam o mesmo modelo — contar "consenso" de fontes independentes, não de réplicas).

### 5.1 O que procurar por jogo
1. **Forma** (últimos 5–10, casa/fora separados) e **qualidade dos adversários** enfrentados.
2. **Golos marcados/sofridos** e, quando houver, **xG/xGA**, remates e remates à baliza.
3. **Classificação e motivação** (luta pelo título, descida, taça, jogo a seguir importante, fim de época, jogos decisivos).
4. **Ausências e escalações prováveis** (lesões, suspensões, castigos, rotação). Confirmar o mais perto possível do início.
5. **Confrontos directos** (com prudência: amostras pequenas enganam).
6. **Calendário e cansaço** (jogos a meio da semana, viagens, selecções).
7. **Treinador/situação do clube** (treinador novo, despedimento, crise).
8. **Condições** (relvado, meteorologia extrema, jogo à porta fechada) — só se a fonte o confirmar.
9. **Mercado:** movimento de odds (a odd baixou desde a recolha? sinal de dinheiro/informação), diferença entre as duas casas.

### 5.2 Fontes a usar (por ordem de fiabilidade)
- **Oficiais:** sites das ligas e dos clubes; comunicados de lesões/escalações.
- **Dados:** SofaScore, FotMob, WhoScored, FBref, Understat (xG nas 5 grandes ligas), Transfermarkt (lesões/valor), Soccerway/Flashscore (resultados e tabelas).
- **Previsões (como segunda opinião, nunca como única fonte):** PrimaTips, FootballSuper.tips, PredictZ (referidos no Manual); Forebet, Statarea, Sports Mole, SportyTrader, FootballPredictions.com, Squawka, LiveScore previews, Vitibet, ScoreGPT/Statz (modelos automáticos — peso baixo).
- **Notícias:** BBC Sport, Sky Sports, Marca/AS, Kicker, L'Équipe, A Bola/Record, Globo Esporte, ESPN.
- Não copiar previsões sem validação independente (Manual §6.1). Registar origem, hora e qualidade.

### 5.3 Como pesquisar (modelos de pesquisa)
- `"<Liga> predictions <data> <equipa A> <equipa B> team news"`
- `"<equipa A> vs <equipa B> prediction <data>"` (Forebet/PredictZ/Sports Mole/FootballPredictions).
- `"<equipa> injury news <data>"`, `"<equipa> predicted lineup"`.
- Uma pesquisa por **liga/dia** costuma devolver várias partidas de uma vez; depois aprofundar só os jogos candidatos.
- Registar o que **não** foi encontrado (lacuna). Se não houver pelo menos 3 fontes → o jogo **não** entra nos boletins.

### 5.4 Guardar (formato do repositório)
- Contexto em `match_statistics` (`source='InternetSearch'`) com ≥ 3 factos e ≥ 2 fontes — exactamente como em `docs/chatgpt-analysis-workflow.md`.
- Relatório por jogo em `match_analyses` (`provider`, `model`, `status='ready'`, `analysis` JSON com `selections`, `sources`, `riskFlags`, `verdict`). A página **Análises** lê só `status='ready'`.
- Não inserir em `tickets`/`ticket_legs` durante a análise (isso é o passo de rascunho).

## 6. Passo 4 — modelação e valor esperado

Combinar **vários métodos** (nenhum é fiável sozinho) e reportar a incerteza.

1. **Probabilidade implícita sem margem (devig).** Para cada casa e mercado completo: `p_i = (1/odd_i) / Σ(1/odd)` (método proporcional). Alternativas mais finas: **potência** ou **Shin** (corrigem o "favourite–longshot bias": os azarões ficam sobreavaliados). Fazer a média das duas casas. Só em mercados **completos** (1X2 = 3 saídas; BTTS/over-under = 2). Dupla Chance deriva do 1X2.
2. **Modelo de golos (Poisson / Dixon–Coles).** Estimar golos esperados `λ_casa` e `λ_fora` a partir de ataque/defesa (golos ou xG marcados/sofridos, casa/fora, ajustados à média da liga e ao nível dos adversários). Matriz de resultados → 1X2, totais, BTTS, handicaps, resultado exacto. A correcção de Dixon–Coles ajusta 0-0/1-0/0-1/1-1.
3. **Elo (ou rating equivalente)** para a força relativa e vantagem de casa; converter diferença de Elo em probabilidade de vitória e calibrar com o empate.
4. **Previsões de fontes externas** (golos previstos, probabilidades publicadas): usar como entrada, ponderada pela independência e histórico da fonte.
5. **Ajustes de contexto** (ausências, rotação, motivação, treinador novo): pequenos e justificados; nunca > alguns pontos percentuais sem facto forte.
6. **Combinação (shrinkage).** `p_final = w_mercado·p_mercado + w_modelo·p_modelo + w_fontes·p_fontes`, com **maior peso ao mercado** (é o melhor estimador único) e **encolhimento para o mercado** quando os dados próprios são fracos. Só afastar a probabilidade do mercado quando houver evidência concreta.
7. **Valor esperado e edge.** `EV = p·odd − 1` (com a odd **da casa do boletim**); `edge = p − 1/odd`. Se EV ≤ 0 em todas as selecções, **dizê-lo**: a escolha passa a ser "maior probabilidade com risco aceitável", não "valor".
8. **Incerteza.** Dar intervalo ou nível de confiança (alta/média/baixa). Penalizar amostras pequenas, fontes em conflito e lacunas.
9. **Modelos de aprendizagem automática** só com dados suficientes e validação fora da amostra (Manual §6.1). Sem isso, não usar.

> Os métodos 2–4 exigem dados que nem sempre existem; quando não houver, **não inventar**: usar 1 + 4 + 5 e declarar "análise assente no mercado e em previsões externas".

## 7. Passo 5 — escolher o mercado certo por jogo

Não limitar-se a 1X2/BTTS: há **centenas de mercados** por jogo. Escolher o que a **evidência** suporta melhor e que respeita a odd mínima.

| Família | Quando faz sentido | Cuidados |
|---|---|---|
| Resultado (1X2) | favorito claro com odd ≥ 1,40 | odds baixas demais para grandes favoritos |
| Dupla Chance | jogo equilibrado ou favorito fora | em jogos equilibrados a odd costuma ser < 1,40 |
| Empate anula aposta / Handicap -0,5/0 | quer-se reduzir o risco de empate | linhas inteiras têm devolução; liquidação automática não cobre |
| Handicap asiático/europeu (-1, -1,5) | favorito forte e golos esperados altos | variância alta; liquidação manual |
| Total de golos (linhas .5) | previsões convergem em muitos/poucos golos | usar linhas .5; olhar xG e estilo de jogo |
| Golos por equipa ("Total de golos do X") | favorito com ataque forte / defesa adversária fraca | só linhas .5 |
| Ambas marcam (Sim/Não) | duas equipas a marcar de forma consistente; ou uma muito frágil defensivamente | correlaciona com totais do mesmo jogo |
| Resultado + Total / DC + Ambas marcam | quando a previsão é um cenário concreto | probabilidade conjunta; odds mais altas; liquidação manual |
| 1.ª parte (golo, total, resultado) | equipas que marcam cedo | informação limitada |
| Cantos / cartões | só com dados específicos do árbitro/estilo | liquidação depende de estatísticas finais |

**Liquidação automática** (`lib/tickets/live-market.js`): totais de golos (jogo e equipa), ambas marcam, resultado/dupla chance, cartões amarelos/vermelhos, cantos. **Não** cobre handicaps, empate anula aposta, combinações nem mercados da 1.ª parte — as selecções nesses mercados ficam "a aguardar resultados" até serem liquidadas à mão. Preferir mercados cobertos; se usar os outros, avisar o proprietário.

**Correlação:** no mesmo boletim, no máximo **uma selecção por jogo**. Entre boletins, limitar a repetição dos mesmos jogos (diversificação, §8).

## 8. Passo 6 — construir os boletins

Regras do **Manual** (§6.2): odd individual **≥ 1,40**; **uma casa por boletim** (BantuBet e ElephantBet são boletins separados com as mesmas selecções e as odds de cada casa; `shared_ticket_id` liga as duas versões); sem jogos iniciados; **não forçar**; cada selecção com mercado, odd, casa, probabilidade, justificação, risco e fonte.

- **Distribuição de referência:** 6 a 8 boletins — 2 em 25–50x, 2 em 30–70x, os restantes em 100–10.000x. São metas, **não** licença para incluir selecções fracas. Se não houver qualidade: **menos boletins ou nenhum**, com explicação.
- **Boletins "1000x+":** permitidos (até 2 por dia) se as duas casas ultrapassarem 1000 e **todas** as selecções passarem na análise. Probabilidade conjunta típica < 0,1%: tratar como bilhete de risco extremo e dizê-lo.
- **Número de selecções:** livre; é o necessário para a faixa de odds. Mais selecções = menor probabilidade; preferir menos selecções com odds mais altas e boas (ex.: handicap, golos por equipa) a muitas selecções de 1,40.
- **Diversificação:** repartir os jogos pelos boletins; evitar que todos dependam dos mesmos 3 resultados. Se só restam ~9 selecções fortes, **publicar poucos boletins** em vez de variações quase iguais.
- **Probabilidade conjunta:** produto das probabilidades (se independentes) — **mostrar** ao proprietário. Selecções do mesmo jogo não são independentes.
- **Horário:** ordenar por hora; o primeiro jogo deve começar com antecedência para a reserva. Se as notícias de escalações forem decisivas, publicar em **duas vagas** (manhã: jogos da tarde; tarde: jogos da noite) e revalidar o onze inicial antes da 2.ª.

## 9. Passo 7 — validações finais (todas têm de passar)

```sql
-- para cada boletim em rascunho
select t.title, t.total_odds, count(l.id) pernas, count(l.selection_id) com_selection_id,
       min(l.odd) odd_min, count(distinct l.match_id) jogos,
       min(m.kickoff_at) primeiro, bool_and(m.home_team !~* 'SRL') sem_virtuais
from tickets t join ticket_legs l on l.ticket_id=t.id join matches m on m.id=l.match_id
where t.status='draft' group by t.id;
```
Checklist: jogo **não** iniciado (com margem); **odd actual ≥ 1,40 nas duas casas** (re-ler o JSON mais recente); `selection_id` numérico em todas as selecções; mercado e linha iguais nas duas casas; uma selecção por jogo; total dentro da faixa; sem duplicação com boletins existentes; probabilidade conjunta calculada; sem SRL; selecções com fonte e justificação.

## 10. Passo 8 — gravar (rascunho → publicar)

**Formato dos registos** (para o site, o acompanhamento ao vivo e a reserva funcionarem):
- `tickets`: `title` = `Boletim NN BASE · <Casa> · <faixa>` (ex.: `Boletim 02 BASE · BantuBet · 25x–50x`); `status='draft'`; `shared_ticket_id` igual nas duas versões; `total_odds` = produto das odds dessa casa.
- `ticket_legs`: `ticket_id`, `match_id`, `market_name` (= `quote.market`), `selection`, `odd` (da casa), **`selection_id` = `quote.selectionId`** (obrigatório: sem ele a reserva é saltada). `market_id` pode ficar nulo (a tabela `markets` pode estar vazia).
- Texto das selecções: 1X2 → `Vitória <Equipa>`; Dupla Chance → `1X`/`X2`/`12`; Ambas marcam → `Sim`/`Não`; Totais → `Mais de 2.5`/`Menos de 3.5`. Outros mercados: usar `quote.selection` (+ linha).
- `selectionId` obtém-se do JSON mais recente da comparação, filtrando `bookmaker`, `market`, `selection`, `line` e `odds`.

**Publicar** (`status='published'`, `published_at=now()`) **só com autorização** e só se todas as validações passarem. Depois: consultar a base para **confirmar que persistiu** (regra 6) e que `booking_reference` aparece em poucos minutos (a tarefa do PC gera o código). Se, ao fim de ~10 min, não houver código, pedir ao proprietário o log da tarefa de reservas.

## 11. Passo 9 — acompanhar, liquidar e aprender (é aqui que se ganha "êxito" a longo prazo)

1. **Ao vivo e liquidação.** O recolhedor SofaScore corre no PC. 403 = bloqueio temporário: esperar, não contornar. Fichas com selecções sem liquidação automática ficam a aguardar até serem liquidadas à mão.
2. **Registo de resultados (ledger).** Para cada selecção publicada guardar: previsão (probabilidade), odd à elaboração, odd ao início do jogo, resultado. (Guardar em `match_analyses.analysis`; propor migração para uma tabela `prediction_log` se o proprietário aprovar.)
3. **Calibração.** Semanalmente: taxa de acerto por faixa de probabilidade (60–65%, 65–70%…), **Brier score**, ROI teórico por mercado e por liga. Se as selecções "65%" acertam 55%, **baixar a confiança** e encolher mais para o mercado.
4. **Closing Line Value (CLV).** Comparar a odd da elaboração com a odd perto do início (o acompanhador de odds do PC grava-a). Bater a linha de fecho de forma consistente é o melhor indicador de que a análise tem vantagem real.
5. **Lições por mercado/liga.** Registar onde falha (ex.: BTTS em ligas defensivas, favoritos fora, selecções) e **ajustar as regras deste playbook** (e avisar o proprietário).
6. **Realismo estatístico.** Para "acertar vários boletins na semana" é preciso **volume e variedade** de boletins independentes e uma taxa de acerto por selecção acima da implícita; com 8–10 selecções, ~1–2% por boletim é normal. Dizer isto.

## 12. Relatório obrigatório de cada ciclo (Manual §9)

Data/hora e lote · jogos descobertos por casa e comuns · contadores de gravação · falhas · jogos analisados/excluídos **com motivo** · fontes consultadas e dados em falta · boletins (selecções, odds por casa, probabilidade conjunta, estado) · confirmação de persistência e de presença no site · **o que não foi testado** · decisões pendentes do proprietário.

## 13. Pendências conhecidas (precisam de decisão do proprietário)

- **Migração para o Histórico não perder equipas:** acrescentar colunas (equipas, competição, hora) a `ticket_legs`, preenchidas ao gravar e antes da limpeza. Aditiva; ainda **não autorizada nem aplicada**.
- **Fonte ao vivo alternativa** se o SofaScore continuar a bloquear.
- **Tabela `prediction_log`** para calibração/CLV.
- **API/MCP segura para agentes** com permissões por agente (Manual §5).

## 14. Erros já cometidos (não repetir)

1. Elaborar só a partir das odds, sem pesquisar forma, notícias e previsões.
2. Misturar o jogo real com a cópia **SRL** ao procurar por nome.
3. Usar linhas inteiras/asiáticas como se fossem de dois resultados.
4. Usar vários snapshots da mesma selecção na remoção de margem.
5. Dar prioridade a "Premier League" de qualquer país.
6. Gravar sem confirmar depois que os registos persistiram.
7. Publicar boletins quase iguais (dependentes dos mesmos jogos) como se fossem diversificados.
8. Ficar só em 1X2/BTTS quando havia centenas de mercados mais adequados.
9. Cortar o dia da recolha a meio (limite de jogos) e não avisar.
10. Esquecer `selection_id` (a reserva salta a ficha).

---

## 15. Resumo para o comando "ACTIVAR FICHA KAMBA"

1. Passo 0–1: ler, preparar, validar recolha (e pedir recolha se faltar).
2. Passo 2: jogos elegíveis, por nível de competição.
3. Passo 3: pesquisar ≥ 3 fontes por jogo candidato; guardar contexto.
4. Passo 4: devig + Poisson/Elo + previsões → `p_final`, EV, confiança.
5. Passo 5: escolher o **melhor mercado** por jogo (todas as famílias).
6. Passo 6: construir boletins (regras do Manual), diversificar, calcular probabilidade conjunta.
7. Passo 7: validar tudo (checklist §9) → rascunho.
8. Mostrar ao proprietário o resumo honesto e **pedir autorização** → publicar → confirmar persistência → acompanhar reservas.
9. Passo 9: registar resultados, calibrar, melhorar.
