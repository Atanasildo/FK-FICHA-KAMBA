# FK — Ficha Kamba

Plataforma de consulta de odds, análises desportivas e fichas de futebol. A recolha das odds é feita localmente no PC; a investigação e análise diária são feitas manualmente no ChatGPT, quando o utilizador as solicita. O site apresenta os relatórios guardados no Supabase.

## Arquitectura actual

- **PC do utilizador:** recolhe jogos e mercados na BantuBet e ElephantBet.
- **Vercel:** recebe e valida os lotes de recolha e serve o site/API. A recolha diária não chama modelos de IA nem inicia a criação de bilhetes.
- **Supabase:** guarda jogos, mercados brutos, comparações de odds e análises concluídas.
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

O fluxo previsto é:

1. Consultar no Supabase os jogos e as odds recentes das duas casas.
2. Excluir jogos iniciados, adiados, ambíguos ou com odds desactualizadas.
3. Pesquisar forma recente, confrontos, classificação, ausências, escalações e outras informações relevantes, indicando quando uma fonte não disponibiliza determinado dado.
4. Avaliar mercados, probabilidades, odds implícitas, valor esperado e incerteza.
5. Guardar os relatórios estruturados em `match_analyses`, associados aos jogos.
6. Mostrar as análises na área **Análises** do site.

As análises só devem ser guardadas depois de verificar a identidade do jogo, a actualidade das odds e a qualidade das fontes. Não inventar estatísticas ou probabilidades para preencher lacunas.

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
