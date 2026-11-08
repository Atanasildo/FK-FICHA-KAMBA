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

Esta versão é a estrutura de interface do produto. **A publicação automática pela IA ainda não está ligada** e, por isso, o painel não inventa nem apresenta fichas, odds, IDs de reserva, marcadores ou eventos como se fossem reais.

Ainda é necessário implementar e configurar:

1. Backend central e base de dados para publicar as fichas diárias e sincronizar o histórico entre dispositivos.
2. Serviço de IA open-source/gratuito, executado num ambiente controlado, para análise e preparação automática.
3. Fontes desportivas autorizadas para calendário, estatísticas, odds e eventos em directo, com origem e hora de actualização.
4. Integrações permitidas com BantuBet Angola e Elephant Bet Angola para obter IDs de reserva genuínos. Se não existir integração autorizada, o ID terá de ser registado por um operador.
5. Serviço de notificações e relatórios.

O endpoint opcional `/api/matches` consulta calendário e estado de partidas via football-data.org quando a variável `FOOTBALL_DATA_TOKEN` está configurada no servidor. Esse fornecedor não fornece, por si só, as odds das casas nem garante cobertura de todas as competições.

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

Para activar a consulta opcional de jogos, adiciona `FOOTBALL_DATA_TOKEN` às variáveis de ambiente do projecto na Vercel. Nunca coloques a chave no código do navegador.

## Motor de análise com Groq

O endpoint protegido `POST /api/ai-analyze` envia jogos e mercados reais para a Groq e devolve uma análise estruturada. Usa o modelo `openai/gpt-oss-20b` por defeito. A chave Groq e o segredo de execução ficam exclusivamente nas variáveis de ambiente do servidor.

Variáveis necessárias na Vercel:

- `GROQ_API_KEY`: chave criada na consola Groq.
- `GROQ_MODEL`: opcional; por defeito `openai/gpt-oss-20b`.
- `CRON_SECRET`: segredo longo e aleatório; o endpoint exige `Authorization: Bearer <CRON_SECRET>`.

O pedido deve conter jogos reais em `fixtures`, cada um com `id`, `home`, `away` e uma lista `markets` com `market`, `selection` e `odds`. O endpoint valida novamente cada selecção contra os mercados recebidos e rejeita selecções que não correspondam exactamente aos dados de entrada ou tenham odds inferiores a 1.40.

Este endpoint é apenas a primeira integração do motor de IA. Ainda não obtém automaticamente odds, não cria IDs de reserva, não guarda/publica fichas numa base de dados e não agenda a geração diária. Essas etapas dependem da integração das fontes desportivas, armazenamento central e agendamento. Os limites gratuitos da Groq variam por modelo e conta.

## Fonte de jogos e odds: API-Football

O endpoint `GET /api/football-data?date=YYYY-MM-DD` consulta os jogos do dia no fuso `Africa/Luanda` e tenta associar as odds pré-jogo disponibilizadas pela API-Football. A variável necessária é `API_FOOTBALL_KEY`, configurada apenas no servidor Vercel.

A resposta distingue jogos com e sem odds. A disponibilidade de mercados depende da competição, partida, bookmaker e plano da API. A consulta de odds é paginada pelo fornecedor; esta primeira versão lê a página 1. Não trata ausência de odds como odd zero e não inventa mercados.

A API-Football documenta actualização e cobertura variáveis por competição; odds pré-jogo podem estar disponíveis apenas numa janela anterior ao início do jogo. Confirma no painel do fornecedor se o plano da conta dá acesso aos endpoints de odds e acompanha o consumo diário.

A rota existente `POST /api/ai-analyze` é protegida por `CRON_SECRET`. O próximo passo é um processo interno que obtenha a resposta desta fonte, prepare o payload de mercados reais e chame a análise Groq; esta integração de ponta a ponta e a publicação persistente ainda não estão activadas.


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

Para executar os testes dos normalizadores e comparador:

```bash
npm test
```

O comando de build também executa os testes antes de gerar a aplicação.
