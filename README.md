# FK — Ficha Kamba

Plataforma de consulta de odds, análises desportivas e fichas de futebol. A recolha das odds é feita localmente no PC; a investigação e análise diária são feitas manualmente no ChatGPT, quando o utilizador as solicita. O site apresenta os relatórios guardados no Supabase.

## Arquitectura actual

- **PC do utilizador:** recolhe jogos e mercados na BantuBet e ElephantBet.
- **Vercel:** recebe e valida os lotes de recolha e serve o site/API. A recolha diária não chama modelos de IA nem inicia a criação de bilhetes.
- **Supabase:** guarda jogos, mercados brutos, comparações de odds, contexto pesquisado e análises concluídas.
- **ChatGPT (nesta conversa):** consulta os dados do Supabase, pesquisa fontes desportivas, compara mercados, estima probabilidades e riscos e, mediante pedido, grava o relatório em `match_analyses`.
- **Ficha Kamba:** apresenta as odds e análises guardadas. Não chama esta conversa nem precisa de uma chave Groq/DeepSeek para mostrar os relatórios.

A SportAPI não é obrigatória para descobrir ou associar jogos entre BantuBet e ElephantBet. Pode continuar como fonte auxiliar para dados de contexto ou acompanhamento ao vivo, quando estiver disponível, mas a ausência dela não bloqueia a recolha nem a análise manual no ChatGPT.

> O backend do site não consegue invocar automaticamente esta conversa do ChatGPT. O utilizador inicia a análise aqui no ChatGPT depois de confirmar que a recolha terminou.

## Recolha diária

Executa no PC, dentro da pasta do projecto:

```bash
npm run collect:upload
```

O comando:
1. Descobre os jogos disponíveis na BantuBet e ElephantBet.
2. Selecciona jogos comuns das duas casas, com início no dia actual de Luanda e pelo menos uma hora de antecedência.
3. Compara as equipas pela ordem casa/visitante e pelo horário, sem depender dos IDs próprios de cada casa.
4. Recolhe até 50 jogos comuns, em lotes de um jogo.
5. Envia as odds e os mercados para `/api/bookmakers/save-comparison`.
6. Guarda os mercados brutos, as comparações e os respectivos horários no Supabase.
7. Termina. Não chama a SportAPI, não executa análise Groq/DeepSeek, não cria reservas e não publica bilhetes.

### Modo de teste

```bash
npm run collect:upload -- --dry-run
```

O modo `--dry-run` descobre os jogos e recolhe os mercados, mas **não envia dados para o Supabase**. Não necessita das variáveis de autenticação da Vercel.

### Variáveis de ambiente

No PC, para uma recolha real:
- `CRON_SECRET`
- `VERCEL_AUTOMATION_BYPASS_SECRET` se o endpoint de ingestão estiver protegido pela Vercel
- `FK_API_URL` (opcional; endereço da API de ingestão)
- `FK_INGEST_URL` (opcional; URL completa de ingestão)

Na Vercel:
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` ou `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` ou `VITE_SUPABASE_ANON_KEY`
- `CRON_SECRET`

Nunca coloques segredos no código, no GitHub ou em mensagens de chat. Não partilhes os valores das variáveis.

## Análise diária no ChatGPT

Depois de uma recolha concluída, pede nesta conversa: **“Vamos analisar os jogos de hoje da Ficha Kamba.”**

O fluxo é:
1. Consultar no Supabase os jogos e as odds recentes das duas casas.
2. Excluir jogos iniciados, adiados, ambíguos ou com odds desactualizadas.
3. Pesquisar forma recente, confrontos, classificação, ausências, escalações e outras informações relevantes, indicando quando uma fonte não disponibiliza determinado dado.
4. Guardar contexto `InternetSearch` apenas depois de recolher factos verificáveis de pelo menos duas fontes distintas. Um marcador de pesquisa pendente não conta como estatística.
5. Avaliar mercados, probabilidades, odds implícitas, valor esperado e incerteza.
6. Guardar os relatórios estruturados em `match_analyses`.
7. Mostrar as análises na área **Análises** do site.

As análises só devem ser guardadas depois de verificar a identidade do jogo, a actualidade das odds e a qualidade das fontes. Não inventar estatísticas ou probabilidades para preencher lacunas. O formato e as regras de validação do contexto estão em [docs/chatgpt-analysis-workflow.md](docs/chatgpt-analysis-workflow.md).

Para esta rotina manual, **não executar o pipeline legado `/api/pipeline` / `run-daily`**: ele ainda depende de um fornecedor externo de IA e tem uma etapa separada de bilhetes/publicação. O ChatGPT pesquisa e grava os relatórios directamente no Supabase nesta conversa.

## Bilhetes e publicação

A análise manual no ChatGPT não cria bilhetes, não faz reservas, não submete apostas e não movimenta dinheiro. A área **Análises** é separada da área **Bilhetes do dia**. Qualquer futura funcionalidade de criação ou publicação de fichas exige uma decisão e autorização explícitas.

## Acompanhamento ao vivo

O acompanhamento ao vivo é uma funcionalidade separada da análise diária. Se a fonte desportiva configurada estiver disponível, o site pode continuar a consultar marcadores e estados de jogos. Isso não torna a SportAPI necessária para a recolha das odds ou para a análise manual no ChatGPT.

## Desenvolvimento e validação

Requer Node.js 20 ou superior.

```bash
npm install
npm test
npm run build
npm run dev
```

## Segurança

- As chaves do Supabase ficam no servidor; o frontend usa apenas a chave pública com políticas RLS.
- As rotas de ingestão exigem `CRON_SECRET`.
- As análises prontas são públicas apenas para leitura através de uma política RLS específica; as escritas continuam restritas ao servidor/credenciais privilegiadas.
- Não contornar autenticação, CAPTCHA, controlos anti-bot ou restrições dos fornecedores.
- O FK não coloca apostas, não recebe depósitos e não movimenta dinheiro.

## Estado operacional confirmado — 17/11/2026

Esta secção é o ponto de partida para a próxima sessão de desenvolvimento/IA. Deve ser actualizada sempre que uma funcionalidade for concluída ou a arquitectura mudar.

### Versão publicada

- Repositório: `Atanasildo/FK-FICHA-KAMBA`.
- Branch que contém a interface actual: `feat/analysis-before-odds`.
- Commit publicado em produção nesta data: `8ec45599ddc147f169a70c464e5ccda6a699fd27`.
- Projecto Vercel: `fk-ficha-kamba`.
- URL de produção: https://fk-ficha-kamba.vercel.app
- Projecto Supabase: `dcvadrtvyzwwvlwejach` (referência do projecto; não é uma credencial).
- A interface de produção foi publicada a partir da branch `feat/analysis-before-odds`. A branch `main` tem histórico/interface anterior e não deve ser usada como base para substituir a interface actual sem comparar os commits e rever cuidadosamente as diferenças.
- Não fazer merge indiscriminado entre `main` e `feat/analysis-before-odds`: as branches divergiram significativamente. Preservar a interface actual e os quatro separadores descritos abaixo.
- O build de produção desta versão terminou com sucesso e os 105 testes automatizados passaram (0 falhas). Isto confirma testes/build, não substitui a validação funcional no browser e na fonte de dados.

### Interface actualmente confirmada

A interface publicada contém estes separadores principais:

1. **Bilhetes do dia** — apresenta as fichas publicadas para o dia, agrupando as versões das casas BantuBet e ElephantBet pelo `shared_ticket_id`. O detalhe expandido mostra os jogos, mercado, selecção, odd, estado da partida e referência de reserva.
2. **Análises** — consulta análises prontas em `match_analyses`; a análise continua a ser preparada manualmente no ChatGPT, conforme [docs/chatgpt-analysis-workflow.md](docs/chatgpt-analysis-workflow.md).
3. **Acompanhamento ao vivo** — separador existente na navegação. A implementação actual filtra fichas do dia que tenham pelo menos uma partida reconhecida como live; não assumir que todos os jogos ou todas as estatísticas estão cobertos.
4. **Histórico** — separador existente. A implementação actual separa fichas que não pertencem ao dia actual; ainda falta consolidar a liquidação final de todas as selecções e apresentar um resultado inequívoco por ficha.

O comparador de odds não faz parte desta interface actual. Não o reintroduzir.

### Estado dos dados publicados

- Na verificação de 17/11/2026, `public.tickets` continha 16 registos com `status = 'published'`, agrupados em 8 `shared_ticket_id`: oito fichas partilhadas, cada uma com a versão BantuBet e a versão ElephantBet.
- As imagens confirmadas pelo utilizador mostram as oito fichas na página **Bilhetes do dia**, as duas odds totais por ficha e as respectivas selecções/jogos no detalhe.
- As referências/códigos de reserva aparecem como **pendentes** / “A aguardar reserva”. Não foram confirmados códigos reais de reserva pelas casas.
- Não inventar códigos, não preencher uma referência fictícia e não marcar uma reserva como concluída sem confirmação verificável da casa de apostas.
- Não apagar nem substituir os bilhetes existentes para desenvolver as próximas funcionalidades. Preservar os IDs e relações entre `tickets`, `ticket_legs`, `matches` e `shared_ticket_id`.

### Modelo de dados relevante (confirmado no Supabase)

- `tickets`: `id`, `shared_ticket_id`, `title`, `status`, `total_odds`, `booking_reference` (texto nullable), `published_at`, `created_at`, `updated_at`.
- `ticket_legs`: `id`, `ticket_id`, `match_id` (nullable), `market_id` (nullable), `market_name`, `selection`, `odd`, `result`, `created_at`.
- `matches`: `id`, `external_id` (nullable), `home_team`, `away_team`, `competition`, `kickoff_at`, `status`, `source`, timestamps.
- `match_statistics`: `id`, `match_id`, `source`, `payload` (JSONB), `collected_at`, `created_at`.
- `match_analyses`: `id`, `match_id`, `provider`, `model`, `status`, `summary`, `analysis` (JSONB), `generated_at`, `created_at`.
- A relação de uma ficha às suas selecções é `tickets.id -> ticket_legs.ticket_id`; a relação de uma selecção ao jogo é `ticket_legs.match_id -> matches.id`.
- `booking_reference` é actualmente um campo de texto. Antes de o usar para códigos, URLs ou estados mais complexos, inspeccionar os valores existentes e definir um formato compatível/migrável. Não assumir que contém um código válido: a UI interpreta texto/JSON, mas isso não prova que exista uma reserva confirmada.

### Implementação de acompanhamento ao vivo já existente

- O frontend chama `GET /api/pipeline?action=live-tickets` e actualiza a informação a cada 5 minutos.
- A rota está em `api/pipeline.js` e delega para `lib/pipeline/live-tickets.js`.
- O endpoint requer no servidor: `SUPABASE_URL` (ou `VITE_SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY` (ou `SUPABASE_SECRET_KEY`) e `SPORTAPI_KEY`. Se faltar uma destas variáveis, responde com HTTP 503.
- A implementação actual procura jogos ligados a SportAPI, com `matches.source = 'SportAPI'`, `external_id` numérico e início dentro da janela temporal definida no código. Jogos de outras fontes não são automaticamente associados à SportAPI.
- Consulta fixtures, eventos e estatísticas SportAPI; guarda amostras em `match_statistics` com `source = 'SportAPI-live'` e `SportAPI-live-events'`. A recolha de estatísticas/eventos é rodada por lotes e usa uma idade máxima de cache de 15 minutos.
- A lógica de mercado está em `lib/tickets/live-market.js`. Quando o fornecedor confirma um resultado suportado após o fim e os dados finais necessários estão disponíveis, o endpoint actualiza `ticket_legs.result` com valores como `Ganha`, `Perdida` ou `Linha devolvida`.
- Mercados dependentes de estatísticas/eventos podem ficar em “Aguardando estatística final”. Não forçar liquidação quando a fonte não fornece a estatística necessária.
- O endpoint também pode devolver informação da análise guardada antes do início da partida. A ausência de dados live não deve ser convertida em 0-0 nem em resultado de mercado.
- A UI mistura os dados live recebidos com os dados das selecções por ID. A correspondência dos jogos entre fornecedores e o preenchimento de `match_id` são, portanto, fundamentais.
- O código existente é uma base parcial, não uma implementação completa de acompanhamento de todos os jogos. Antes de o ampliar, rever integralmente `lib/pipeline/live-tickets.js`, `lib/tickets/live-market.js`, `api/pipeline.js`, `src/App.jsx` e as variáveis da Vercel. Não assumir que o caminho actual cobre todos os mercados ou que o histórico calcula correctamente o resultado agregado de cada ficha.

## Próximas etapas acordadas com o utilizador

Trabalhar por etapas e validar cada uma antes de avançar. A ordem acordada é:

### Estado técnico adicional — reserva/partilha (17/11/2026)

- Foi recuperado o código fornecido pelo utilizador em 12/11/2026 e comparado com o repositório.
- Já existe a implementação base em `api/bookmakers/reserve.js`, com `createBooking()`, construção do payload `translations/share/configs/betslip`, os dois endpoints `image-creator/share-booking`, extracção de `share.bookId` ou do parâmetro `bookingId` em `share.bookingLink`.
- Configuração recuperada do código original: ElephantBet `siteId=18756188`, BantuBet `siteId=1869146`; os respectivos domínios e URLs estão definidos no ficheiro. O payload usa stake zero e serve para gerar uma ligação de partilha; não é uma submissão de aposta nem confirmação de aposta colocada.
- A rota HTTP actual exige `Authorization: Bearer CRON_SECRET`. O frontend `src/App.jsx` ainda não chama esta rota e não existe, nesta versão inspeccionada, um fluxo de administração/autorização no frontend para a invocar com segurança. Não colocar `CRON_SECRET` no browser.
- O frontend lê `tickets.booking_reference` e interpreta texto simples ou JSON com `id` e `url`, mas o carregamento não grava reservas.
- A revisão de 17/11 confirmou `booking_reference IS NULL` nos 16 registos publicados.
- Foi removido do endpoint o limite artificial de odd mínima 1.40 e o máximo artificial de 11 selecções, pois não constavam do código original fornecido pelo utilizador e impediam boletins publicados com odds abaixo de 1.40 ou 12 jogos. Mantém-se a validação de odd decimal superior a 1.00, campos essenciais e partidas ainda não iniciadas.
- **Ainda não gerar códigos automaticamente nem marcar reservas como concluídas:** falta implementar uma chamada server-side autenticada que leia a ficha e os seus `ticket_legs/matches/markets`, construa os campos originais sem inventar `base`/IDs de mercado, contacte a casa, e grave a resposta em `booking_reference`. A execução deve ser idempotente: não criar um segundo código se já existir um código válido.
- A tabela `markets` contém `market_key`, `period`, `line`, `selection`, `market_name`, `odd` e `bookmaker_id`; `ticket_legs.market_id` liga a selecção ao mercado. Usar esses dados para mapear o payload e validar que a casa corresponde à ficha. O campo `base` ainda precisa de ser confrontado com o objecto bruto do Network fornecido originalmente; não assumir que `market_key` é equivalente.
- A criação de link de partilha deve ser distinguida de reserva confirmada: apresentar “Link de partilha criado”/“Aguardando confirmação” até haver confirmação explícita na casa.

### 1. Códigos de reserva (próxima tarefa)

Objectivo: registar e apresentar os códigos/IDs de reserva reais, separadamente para BantuBet e ElephantBet, em cada versão do boletim.

Antes de implementar:
- Inspeccionar o fluxo real de reserva de cada casa e determinar se existe API, confirmação manual ou comprovativo que forneça o código.
- Distinguir claramente: não reservado, reserva iniciada, aguardando confirmação, reservado/confirmado e erro/cancelado (os estados finais devem ser ajustados ao fluxo real de cada bookmaker).
- Definir onde guardar o identificador, URL/comprovativo, estado, data/hora e casa de apostas. Considerar uma tabela própria de reservas em vez de sobrecarregar `booking_reference`, caso os dados e relações justifiquem.
- Nunca guardar passwords, cookies de sessão ou tokens privados no frontend, GitHub ou README.
- Não automatizar submissão de apostas nem movimentação de dinheiro. Qualquer acção que confirme uma reserva tem de respeitar os controlos e termos da casa e exigir a confirmação/autorização do utilizador quando aplicável.
- Manter as duas versões da ficha independentes: o código BantuBet não é o código ElephantBet.

Critério de conclusão: o código apresentado no site tem de corresponder a uma confirmação real fornecida pela casa; caso contrário, mostrar “Pendente” ou “Não reservado”.

### 2. Acompanhamento ao vivo dentro dos boletins

Objectivo: dentro do detalhe de cada boletim, cada jogo deve apresentar estado, minuto (quando disponível), marcador, eventos relevantes e estatísticas disponíveis. O separador **Acompanhamento ao vivo** deve oferecer uma visão conjunta das partidas em curso.

Tarefas:
- Rever a associação entre os jogos recolhidos (fonte Swarm/bookmakers) e os fixtures da fonte de resultados. Usar IDs externos quando confiáveis; caso contrário, associação por equipas normalizadas, competição e horário, com limiar de confiança e rejeição de ambiguidades.
- Não associar o mesmo fixture a dois jogos diferentes. Registar a fonte, o ID externo, quando foi actualizado e a confiança/método de associação.
- Mostrar “Dados indisponíveis” quando não houver correspondência ou resposta do fornecedor; não inventar marcador, minuto, eventos ou estatísticas.
- Definir intervalos de actualização e cache respeitando limites/custos da API. Distinguir estado da partida de estado da selecção.
- Preservar a última actualização válida em falhas temporárias e mostrar a hora da última actualização.

### 3. Histórico e liquidação dos boletins

Objectivo: depois de cada partida terminar, cruzar o resultado real com a selecção correspondente e mostrar claramente quais selecções entraram/falharam e o resultado total de cada ficha.

Requisitos:
- Avaliar cada `ticket_leg` pelo seu mercado e selecção exactos, não apenas pelo resultado 1X2 ou pelo marcador final.
- Cobrir mercados suportados com regras explícitas (incluindo linhas asiáticas, handicaps, totais, ambas marcam, cartões e estatísticas, quando a fonte fornece os dados). Não aproximar linhas nem inventar estatísticas.
- Estados por selecção: pendente, em curso, ganha, perdida, devolvida/void, adiada/cancelada e não liquidável/aguarda dados, conforme aplicável.
- Uma partida terminada não significa que todos os mercados estejam automaticamente liquidados: aguardar estatísticas finais quando necessário.
- Calcular o resultado agregado da ficha só quando todas as selecções tiverem estado final. Uma selecção perdida torna a ficha perdida; todas ganhas/devolvidas exigem cálculo correcto de odds efectivas e regras do bookmaker. Fichas incompletas continuam pendentes.
- No histórico, mostrar por ficha e por casa: odd total, cada jogo, mercado, selecção, odd, resultado real, decisão da selecção e resultado final da ficha. As duas casas devem continuar separadas.
- Criar testes unitários para cada mercado e cenários de empate/devolução, adiamento, cancelamento, abandono, prolongamento e dados ausentes.

### 4. Segurança, integridade e validação

- Rever políticas RLS, grants e validações do servidor antes de qualquer alteração de esquema.
- Preferir migrações SQL versionadas no repositório para alterações de tabelas/índices/políticas; não alterar dados publicados para testar.
- Não expor a chave service-role nem a SPORTAPI_KEY ao browser.
- Testar com fixtures/dados de teste isolados; não liquidar os boletins reais com resultados simulados.
- Depois de cada etapa: executar `npm test`, `npm run build`, verificar logs/deployment e validar no browser. Dizer explicitamente o que foi e não foi testado.
- Não reintroduzir o comparador de odds nem substituir a interface moderna pela interface antiga da `main`.

## Instruções para a próxima IA

1. Ler este README inteiro e `docs/chatgpt-analysis-workflow.md` antes de modificar código.
2. Confirmar a branch e o commit actualmente publicados na Vercel; não assumir que `main` é a versão de produção.
3. Inspeccionar o código e o esquema real do Supabase antes de propor migrações ou alterações.
4. Começar pela tarefa **Códigos de reserva**, conforme a ordem acordada com o utilizador.
5. Não pedir novamente ao utilizador informação já documentada aqui; perguntar apenas quando for necessária uma decisão ou confirmação que não possa ser obtida com segurança.
6. Não declarar concluída uma funcionalidade apenas porque o build passou. Confirmar o comportamento real e separar claramente implementado, testado e ainda pendente.
