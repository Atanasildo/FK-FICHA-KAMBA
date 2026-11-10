# FK — Ficha Kamba

Plataforma web de consulta de fichas de futebol. O utilizador entra para ver as fichas publicadas para o dia, consultar o identificador de reserva e expandir cada ficha para acompanhar os jogos, mercados, selecções e resultados.

## Interface

- Painel principal dedicado às fichas publicadas no dia.
- Cartões expansíveis com todos os jogos e mercados de cada ficha.
- Área de acompanhamento para jogos em curso, com espaço para marcador, minuto, eventos e estado do mercado quando a fonte disponibilizar esses dados.
- Histórico de fichas e página de definições.
- Interface responsiva em português (Angola).

A interface não disponibiliza ao utilizador formulários para elaborar jogos ou construir fichas. A preparação das fichas é uma função interna do serviço de análise.

## Estado actual e integrações pendentes

Esta versão já contém a interface, normalizadores das duas casas, comparador de odds, endpoint de análise Groq e persistência de contexto/analise no Supabase. **A publicação automática de bilhetes ainda não está activa**: a recolha autónoma das casas e a obtenção automática de estatísticas completas continuam dependentes de acesso autorizado e verificável às fontes.

Ainda é necessário implementar e configurar:

1. Backend central e base de dados para publicar as fichas diárias e sincronizar o histórico entre dispositivos.
2. Serviço de IA open-source/gratuito, executado num ambiente controlado, para análise e preparação automática.
3. Fontes desportivas autorizadas para calendário, estatísticas, odds e eventos em directo, com origem e hora de actualização.
4. Integrações permitidas com BantuBet Angola e Elephant Bet Angola para obter IDs de reserva genuínos. Se não existir integração autorizada, o ID terá de ser registado por um operador.
5. Serviço de notificações e relatórios.

O endpoint `GET /api/football-data?date=YYYY-MM-DD` consulta os jogos da SportAPI através de `SPORTAPI_KEY`. A SportAPI é a fonte de descoberta de jogos; não é fonte de odds das casas.

Não contornar autenticação, CAPTCHA, controlos anti-bot ou restrições dos fornecedores. O FK não coloca apostas nem recebe ou movimenta dinheiro.

## Executar no computador

Requer Node.js 20 ou superior.

```bash
npm install
npm run dev
```

Abre o endereço local indicado pelo Vite (normalmente `http://localhost:5173`). Não abras `index.html` directamente com duplo clique: o projecto usa Vite/React.

Para testar a versão de produção:

```bash
npm run build
npm run preview
```

## Publicar na Vercel

Importa `Atanasildo/FK-FICHA-KAMBA` na Vercel. Configuração:

- Framework Preset: Vite
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: `dist`

Para activar a consulta de jogos, adiciona `SPORTAPI_KEY` às variáveis de ambiente do projecto na Vercel. Nunca coloques a chave no código do navegador.

## Motor de análise com Groq

O endpoint protegido `POST /api/ai-analyze` usa a API oficial da xAI (`https://api.groq.com/openai/v1/chat/completions`), modelo `openai/gpt-oss-20b` por defeito, saída JSON estruturada. As instruções do agente cobrem recolha e validação de contexto, análise sem odds, comparação posterior, regras dos boletins e a proibição absoluta de reservar ou gerar IDs de bilhete.

Variáveis necessárias na Vercel:

- `GROQ_API_KEY`: chave criada na consola da xAI.
- `GROQ_MODEL`: opcional; por defeito `openai/gpt-oss-20b`.
- `CRON_SECRET`: segredo longo e aleatório; o endpoint exige `Authorization: Bearer <CRON_SECRET>`.

O pedido deve conter jogos reais em `fixtures`, cada um com `id`, `home`, `away`, `stats` e `markets`. As odds são usadas apenas depois da selecção da IA: a Groq recebe estatísticas e uma lista sem odds, escolhe o mercado, e o servidor compara então as cotações BantuBet/ElephantBet. Só são devolvidas selecções com pelo menos duas cotações equivalentes e melhor odd mínima de 1.40. Jogos live/terminados e jogos sem estatísticas são excluídos.

A Groq recebe pesquisa Web para confirmar contexto público, mas não controla o navegador nem garante acesso às páginas dinâmicas das casas. O endpoint ainda recebe os mercados e odds dos recolhedores; a recolha autónoma e verificável da BantuBet/ElephantBet continua a ser uma ferramenta separada a integrar. Para contexto desportivo, `GET /api/fixture-context?fixtureId=<id>` consulta detalhes, estatísticas, eventos, escalações, H2H, classificação e forma das equipas na SportAPI; cada secção indica se os dados estão disponíveis. Lesões/ausências não são inventadas porque a documentação consultada não apresenta esse endpoint. `POST /api/pipeline/save-analysis` guarda estatísticas, análises e odds verificadas no Supabase, protegido por `CRON_SECRET` e usando a chave secreta apenas no servidor. Esta rota não publica bilhetes nem cria referências de reserva. A execução diária continua desligada até a recolha das duas casas e a primeira execução completa serem validadas.

## Descoberta local de URLs nas casas

Depois de actualizar o projecto, executa `npm run discover:local`. O comando consulta a rota pública SportAPI do FK para hoje e amanhã, abre as páginas de futebol da BantuBet e ElephantBet no Chrome/Edge local e procura os eventos pelos nomes das duas equipas. Só grava em `tools/events.local.json` os jogos encontrados sem ambiguidade nas duas casas. Em seguida, executa `npm run collect:local` para recolher os mercados e odds com os colectores já existentes.

A descoberta usa o perfil local `.fk-browser-profile`; se a casa apresentar um bloqueio ou CAPTCHA, não tenta contorná-lo. URLs das páginas de futebol e endpoint de fixtures podem ser substituídos pelas variáveis `FK_BANTUBET_SPORTS_URL`, `FK_ELEPHANTBET_SPORTS_URL` e `FK_FIXTURES_API_URL`. Os jogos não encontrados ou ambíguos ficam fora da recolha automática e são registados em `data/collections/event-discovery-latest.json`.

## Descoberta automática e pipeline

A rota protegida `POST /api/pipeline/discover-fixtures` consulta a SportAPI e guarda os jogos futuros na tabela `matches` do Supabase. Envia `Authorization: Bearer <CRON_SECRET>`; o corpo pode conter `{"days":2}` (entre 1 e 7 dias, no fuso `Africa/Luanda`). A chave da SportAPI e a chave de serviço do Supabase permanecem no servidor. A origem é guardada como `SportAPI`, igual à rota de persistência de análises, para impedir duplicação do mesmo jogo por diferenças de maiúsculas/minúsculas.

Esta rota apenas descobre e guarda jogos. Não recolhe odds, não chama a Groq e não publica fichas. A recolha das casas continua a depender de URLs reais dos eventos e de acesso permitido às páginas; não são construídos URLs a partir do ID da SportAPI nem contornados bloqueios.

## Fonte de jogos: SportAPI

O endpoint `GET /api/football-data?date=YYYY-MM-DD` consulta os jogos do dia no fuso `Africa/Luanda`, usando `SPORTAPI_KEY` no servidor.

A resposta inclui equipas, competição, início e estado do jogo. A SportAPI não fornece as odds BantuBet/ElephantBet; estas têm de vir exclusivamente dos recolhedores das casas.

Os dados estatísticos detalhados ainda precisam de ser ligados a um endpoint de estatísticas com cobertura comprovada. O motor Groq rejeita jogos sem estatísticas recebidas, em vez de inventar forma, H2H ou ausências.

A rota `POST /api/ai-analyze` é protegida por `CRON_SECRET`. Para guardar o resultado, executar `POST /api/pipeline/save-analysis` com o contexto original e a resposta validada da análise. A migração `supabase/migrations/20261108_match_context.sql` deve ser aplicada no SQL Editor do Supabase.


## Comparação de odds entre casas

A rota protegida `POST /api/bookmakers/compare` compara recolhas já normalizadas de duas ou mais casas. Envia `Authorization: Bearer <CRON_SECRET>` e um corpo JSON com `fixtures`, usando o objecto `fixture` devolvido por cada recolha normalizada.

Exemplo de estrutura:

```json
{
  "fixtures": [
    {
      "id": "evento-123",
      "home": "Club Brugge",
      "away": "RSC Anderlecht",
      "competition": "Belgium Pro League",
      "kickoff": "2026-11-10T19:00:00Z",
      "bookmaker": "BantuBet",
      "sourceUrl": "https://...",
      "collectedAt": "2026-11-08T10:00:00Z",
      "markets": [
        {
          "market": "Total de golos no jogo",
          "selection": "Mais de 2.5",
          "odds": 1.80,
          "line": "2.5",
          "side": "over"
        }
      ]
    }
  ]
}
```

A comparação exige correspondência de equipas e competição, e separa período, tipo de mercado, equipa e linha. Variações como `Menos 1.5` e `Menos de 1.5` são normalizadas para a mesma selecção. Linhas diferentes (por exemplo, 2.25 e 2.5), primeira parte e jogo completo, handicaps de equipas diferentes e mercados de categorias distintas não são misturados. A resposta conserva bookmaker, odd, origem e hora de recolha e apresenta a melhor odd observada por selecção equivalente.

A rota não calcula arbitragem garantida nem recomenda apostas; apenas compara os preços recebidos. Os dados têm de ser recolhidos e normalizados antes da comparação. O motor não inventa odds nem preenche casas sem dados.

### Área «Comparar Odds» no painel

A aplicação inclui uma área visual para comparar directamente duas recolhas JSON, sem chamar as rotas protegidas e sem expor `CRON_SECRET` ao navegador:

1. Abre **Comparar Odds** no menu.
2. Indica as equipas da casa e visitante exactamente como aparecem nas casas. A competição e a data/hora são opcionais, mas ajudam a evitar comparações entre jogos diferentes.
3. Importa o JSON da BantuBet no primeiro cartão e o JSON da ElephantBet no segundo.
4. Clica em **Comparar odds**. O painel mostra as selecções encontradas nas duas casas, as cotações de cada uma e destaca a melhor odd.
5. Usa o filtro para procurar mercados e exporta os resultados em CSV, se necessário.

Os ficheiros são lidos e processados no próprio navegador; não é necessário introduzir segredos ou tokens. O limite da interface é 12 MB por ficheiro. Também aceita ficheiros `.txt` quando o conteúdo é JSON válido. A categoria agregadora «Tudo» é ignorada para evitar duplicações. Mercados marcados com associação incompleta (incluindo o handicap de três opções ainda não resolvido) são excluídos e listados no diagnóstico. A comparação só é possível quando ambas as casas têm a mesma selecção e linha; sem equivalência segura, o sistema não inventa correspondências.

Para executar os testes dos normalizadores e comparador:

```bash
npm test
```

O comando de build também executa os testes antes de gerar a aplicação.

## Recolha local assistida das odds (Windows)

Enquanto não houver um método remoto autorizado com acesso estável a Angola, o projecto inclui um recolhedor local que usa o Chrome/Edge já instalado, mantém um perfil de navegador e reutiliza os extractores de BantuBet e ElephantBet. Não instala browsers, não faz apostas e não contorna CAPTCHA, autenticação ou bloqueios.

1. Copia `tools/events.local.example.json` para `tools/events.local.json`.
2. Para cada jogo, preenche o ID real da SportAPI, nomes, competição, hora e os URLs públicos do mesmo evento nas duas casas.
3. Executa `npm run collect:local` no terminal, na pasta do projecto.
4. Se o site apresentar uma verificação normal, resolve-a manualmente no Chrome aberto. Se continuar bloqueado, a recolha desse site é marcada como falhada.
5. Consulta `data/collections`: ficam guardados o JSON bruto, o resultado normalizado e a comparação de cada jogo, além de `latest-run.json`.

O perfil do navegador fica em `.fk-browser-profile`, para preservar cookies/sessão entre execuções. O ficheiro `events.local.json`, o perfil e os resultados locais estão no `.gitignore` e não são enviados para o GitHub. Esta é uma etapa assistida: ainda é necessário fornecer os URLs dos eventos. A recolha local ainda não alimenta automaticamente a análise Groq, não grava os bilhetes no Supabase e não agenda a execução diária; essas etapas só devem ser activadas depois de uma recolha real ser validada.
