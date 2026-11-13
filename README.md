# FK — Ficha Kamba

Plataforma de consulta de bilhetes de futebol preparados automaticamente. A experiência pública tem três áreas: **Bilhetes do Dia**, **Acompanhamento ao Vivo** e **Histórico**. O utilizador consulta as fichas publicadas; não existe um gerador manual de boletins na interface.

## Arquitectura

- **PC do utilizador:** executa exclusivamente o recolhedor local, porque as casas de apostas bloqueiam a recolha iniciada a partir dos IPs da cloud.
- **Vercel:** recebe os dados, associa os jogos, recolhe contexto desportivo, executa a análise Groq, prepara as fichas e serve o site/API.
- **Supabase:** guarda jogos, mercados brutos, snapshots de odds, estatísticas, análises, bilhetes e respectivas selecções.
- **Groq:** analisa o contexto desportivo sem receber as odds antes da escolha do mercado; depois o servidor valida as cotações equivalentes das duas casas.

O PC não é usado para alojar o site nem para guardar os dados da plataforma. O recolhedor envia directamente os resultados para a API na Vercel; não grava ficheiros JSON locais.

## Recolha e pipeline diário

Executa no PC, na pasta do projecto:

```bash
npm run collect:upload
```

O comando:

1. Descobre os jogos disponíveis na BantuBet e na ElephantBet.
2. Selecciona até 50 jogos comuns às duas casas, dentro da janela de recolha.
3. Recolhe os mercados e odds das duas casas em lotes de 10 jogos.
4. Envia cada lote directamente para `/api/bookmakers/save-comparison`.
5. Guarda no Supabase os mercados brutos e as comparações equivalentes.
6. Actualiza o calendário SportAPI e associa os IDs Swarm aos jogos SportAPI por equipas e hora de início.
7. Executa a análise Groq em lotes de 10 jogos. Jogos sem estatísticas reais ou sem odds recentes das duas casas ficam excluídos e registados como dados insuficientes.
8. Só depois de todos os lotes serem analisados, reúne as selecções e tenta criar o conjunto diário de bilhetes.

O endpoint de pipeline impede duplicar a publicação no mesmo dia. Se o conjunto não cumprir todas as regras de validação, não publica bilhetes. A recolha e a análise podem terminar sem publicação quando não existirem oportunidades suficientes; o sistema não reduz os critérios para preencher a página.

### Variáveis necessárias

Na Vercel:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (ou a variável de service role já usada pelo projecto)
- `SPORTAPI_KEY`
- `GROQ_API_KEY`
- `GROQ_MODEL` (opcional; por defeito `openai/gpt-oss-20b`)
- `CRON_SECRET`

No PC, define temporariamente `CRON_SECRET` no terminal antes de executar o comando. Não coloques a chave no código nem a partilhes no chat.

A recolha Swarm não é executada na Vercel: o cron antigo foi retirado porque as casas bloqueiam os pedidos feitos a partir da cloud. O PC faz apenas a recolha e o envio; o restante processamento continua na cloud.

## Bilhetes e reservas

O pipeline usa as regras do construtor de bilhetes. As reservas geram referências/IDs de partilha quando a casa permite; **não submetem apostas e não movimentam dinheiro**. Se a reserva falhar, o resultado é registado como parcial e não é inventado um ID.

Cada bilhete publicado fica guardado no Supabase com as respectivas selecções, odds, jogos, mercado e referência de reserva. O site lê os bilhetes publicados e apresenta-os em Bilhetes do Dia.

## Acompanhamento ao vivo por jogo e mercado

A página de acompanhamento actualiza o estado a cada três minutos. O marcador e minuto vêm da SportAPI; eventos são apresentados quando a resposta de detalhe os disponibiliza. A estatística de cartões amarelos é actualizada em lotes rotativos para respeitar a quota da fonte.

O FK avalia apenas mercados para os quais a fonte fornece dados suficientes:
- Resultado do jogo e totais de golos: pelo marcador.
- Totais de cartões amarelos, remates, remates à baliza, remates fora, faltas, desarmes e defesas: quando a estatística está disponível.
- Cartões vermelhos: através dos eventos registados.
- Cantos e outros mercados sem estatística correspondente: aparecem como indisponíveis/por confirmar. Nunca são calculados por aproximação.

Durante o jogo, o estado é informativo (por exemplo, “A favor neste momento” ou “Em risco neste momento”), não uma liquidação definitiva. A confirmação final depende do resultado e das regras da casa.

## Desenvolvimento e validação

Requer Node.js 20 ou superior.

```bash
npm install
npm test
npm run build
npm run dev
```

## Segurança

- As chaves da SportAPI, Groq e Supabase ficam no servidor.
- As rotas de recolha, análise, reserva e publicação exigem `CRON_SECRET`.
- Não contornar autenticação, CAPTCHA, controlos anti-bot ou restrições dos fornecedores.
- O FK não coloca apostas, não recebe depósitos e não movimenta dinheiro.
